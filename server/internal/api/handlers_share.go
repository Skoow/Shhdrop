package api

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"time"

	altcha "github.com/altcha-org/altcha-lib-go"

	"github.com/skoow/shhdrop/server/internal/limits"
	"github.com/skoow/shhdrop/server/internal/share"
	"github.com/skoow/shhdrop/server/internal/token"
)

func secs(d time.Duration) int64 { return int64(d / time.Second) }

// saltID lie un jeton shown_at à un seul défi : 128 bits de SHA-256 du sel ALTCHA.
func saltID(salt string) string {
	h := sha256.Sum256([]byte(salt))
	return hex.EncodeToString(h[:16])
}

// altchaSalt extrait le sel d'une solution ALTCHA (vérifiée ensuite par captcha.Verify).
func altchaSalt(payload string) (string, error) {
	raw, err := base64.StdEncoding.DecodeString(payload)
	var p struct {
		Salt string `json:"salt"`
	}
	if err != nil || json.Unmarshal(raw, &p) != nil || p.Salt == "" {
		return "", errBadRequest
	}
	return p.Salt, nil
}

// GET /api/captcha : défi ALTCHA + jeton signé de l'heure d'affichage (valable 2 min),
// lié à ce défi : un shown_at ne sert qu'une fois, puisque le défi est à usage unique.
func (s *server) captcha(w http.ResponseWriter, r *http.Request) {
	ch, err := s.cap.Challenge(ipOf(r))
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, struct {
		altcha.Challenge
		ShownAt string `json:"shown_at"`
	}{ch, s.sig.Issue(token.CaptchaShown, saltID(ch.Salt), 0, s.svc.Now().Add(captchaTTL))})
}

// createBody : création v2 (spec §29.8). Ni durée, ni ouvertures, ni sel, ni V_preuve.
type createBody struct {
	ID      string `json:"id"`
	Bucket  int    `json:"bucket"`
	AccessV string `json:"access_v"`
	ManageV string `json:"manage_v"`
	Altcha  string `json:"altcha"`
	HP      string `json:"hp"`
	ShownAt string `json:"shown_at"`
}

// POST /api/shares : format et gel → anti-robot → quotas (réservation) → création →
// difficulté suivante. Une requête invalide ou un serveur gelé ne consomme ni le défi ni
// le quota ; le défi est en revanche consommé si le quota ou la création échoue ensuite.
// Un id déjà pris (en base, ou envoi en cours sous cet id) → 409, rien n'est compté.
func (s *server) create(w http.ResponseWriter, r *http.Request) {
	var b createBody
	if err := readJSON(w, r, &b); err != nil {
		fail(w, err)
		return
	}
	req := share.CreateReq{ID: b.ID, Bucket: b.Bucket}
	var errs [3]error
	_, errs[0] = secret(b.ID, 16)
	req.AccessV, errs[1] = secret(b.AccessV, 32)
	req.ManageV, errs[2] = secret(b.ManageV, 32)
	if errs != [3]error{} || share.Validate(req) != nil {
		fail(w, errBadRequest)
		return
	}
	if s.svc.Frozen() {
		fail(w, share.ErrFrozen)
		return
	}
	// shown_at ne vient que d'un jeton signé, lié au sel du défi résolu ;
	// absent, invalide, expiré ou d'un autre défi → 400.
	salt, err := altchaSalt(b.Altcha)
	if err != nil {
		fail(w, err)
		return
	}
	_, exp, err := s.sig.CheckExp(b.ShownAt, token.CaptchaShown, saltID(salt))
	if err != nil || exp.IsZero() {
		fail(w, errBadRequest)
		return
	}
	ip := ipOf(r)
	if err := s.cap.Verify(b.Altcha, ip, b.HP, exp.Add(-captchaTTL)); err != nil {
		fail(w, err)
		return
	}
	// Quotas en capacité utile (données du palier, sans le morceau du manifeste), réservés ici et débités à la
	// finalisation ; 2 envois non finalisés à la fois ; octets abandonnés (spec §29.5).
	switch retry, err := s.lim.BeginUpload(ip, req.ID, share.ContentBytes(b.Bucket)); {
	case errors.Is(err, limits.ErrDuplicate):
		fail(w, share.ErrConflict)
		return
	case err != nil:
		writeLimit(w, retry)
		return
	}
	id, segs, err := s.svc.Create(req)
	if err != nil {
		s.lim.CancelUpload(req.ID)
		fail(w, err)
		return
	}
	s.cap.RecordCreate(ip)
	writeJSON(w, http.StatusCreated, struct {
		Token    string `json:"upload_token"`
		Segments int    `json:"segments"`
	}{s.sig.Issue(token.Upload, id, 0, s.svc.Now().Add(uploadTTL)), segs})
}

// checkToken : jeton Bearer du type attendu, lié à l'{id} du chemin ; rend le n° d'ouverture.
func (s *server) checkToken(r *http.Request, kind byte) (string, int, error) {
	tok, err := bearer(r)
	if err != nil {
		return "", 0, err
	}
	id := r.PathValue("id")
	openN, err := s.sig.Check(tok, kind, id)
	return id, openN, err
}

func (s *server) putSegment(w http.ResponseWriter, r *http.Request) {
	id, _, err := s.checkToken(r, token.Upload) // jeton vérifié avant de lire le corps
	if err != nil {
		fail(w, err)
		return
	}
	n, err := segNum(r.PathValue("n"))
	if err != nil {
		fail(w, err)
		return
	}
	// Plafond = plus grand segment possible ; la taille exacte du palier est vérifiée
	// par PutSegment avant toute écriture.
	if r.ContentLength > maxSegmentLen {
		fail(w, errBadRequest)
		return
	}
	release, ok := s.slot(w, r, s.xfer.ul)
	if !ok {
		return
	}
	defer release()
	// Échéance de lecture du corps proportionnelle au plus grand segment possible.
	if err := http.NewResponseController(w).SetReadDeadline(time.Now().Add(s.xfer.deadline(maxSegmentLen))); err != nil &&
		!errors.Is(err, http.ErrNotSupported) {
		fail(w, err)
		return
	}
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxSegmentLen))
	if err != nil {
		fail(w, errBadRequest)
		return
	}
	if err := s.svc.PutSegment(id, n, body); err != nil {
		fail(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *server) finalize(w http.ResponseWriter, r *http.Request) {
	id, _, err := s.checkToken(r, token.Upload)
	if err != nil {
		fail(w, err)
		return
	}
	var b struct {
		Salt     string `json:"salt"`
		KdfOps   int    `json:"kdf_ops"`
		KdfMem   int    `json:"kdf_mem"`
		ProofV   string `json:"proof_v"`
		Envelope string `json:"envelope"`
		TTLHours int    `json:"ttl_hours"`
		MaxOpens int    `json:"max_opens"`
		FillFrom *int   `json:"fill_from"`
		FillTo   *int   `json:"fill_to"`
	}
	if err := readJSON(w, r, &b); err != nil {
		fail(w, err)
		return
	}
	req := share.FinalizeReq{TTLHours: b.TTLHours, MaxOpens: b.MaxOpens, KdfOps: b.KdfOps, KdfMem: b.KdfMem}
	var errs [3]error
	req.Salt, errs[0] = secret(b.Salt, 16)
	req.ProofV, errs[1] = secret(b.ProofV, 32)
	req.Envelope, errs[2] = secret(b.Envelope, share.EnvelopeLen)
	if errs != [3]error{} || b.FillFrom == nil || b.FillTo == nil {
		fail(w, errBadRequest)
		return
	}
	req.FillFrom, req.FillTo = *b.FillFrom, *b.FillTo
	left, err := s.svc.Finalize(id, req)
	if err != nil {
		fail(w, err)
		return
	}
	s.lim.FinishUpload(id)
	writeJSON(w, http.StatusOK, map[string]int64{"expires_in_s": secs(left)})
}

type kdfJSON struct {
	Ops int `json:"ops"`
	Mem int `json:"mem"`
}

func (s *server) meta(w http.ResponseWriter, r *http.Request) {
	ka, err := headerSecret(r, "X-Shh-Access")
	if err != nil {
		fail(w, err)
		return
	}
	m, err := s.svc.Meta(r.PathValue("id"), ka)
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, struct {
		ExpiresIn int64   `json:"expires_in_s"`
		Salt      string  `json:"salt"`
		Kdf       kdfJSON `json:"kdf"`
		Bucket    int     `json:"bucket"`
		Segments  int     `json:"segments"`
	}{secs(m.ExpiresIn), b64.EncodeToString(m.Salt), kdfJSON{m.KdfOps, m.KdfMem}, m.Bucket, m.Segments})
}

func (s *server) unlock(w http.ResponseWriter, r *http.Request) {
	ka, err := headerSecret(r, "X-Shh-Access")
	if err != nil {
		fail(w, err)
		return
	}
	var b struct {
		Proof string `json:"proof"`
	}
	if err := readJSON(w, r, &b); err != nil {
		fail(w, err)
		return
	}
	kp, err := secret(b.Proof, 32)
	if err != nil {
		fail(w, err)
		return
	}
	id := r.PathValue("id")
	// Meta d'abord : expires_at (figé une fois prêt) plafonne le jeton, et le nombre de
	// segments. Une clé d'accès fausse échoue ici sans compter d'essai, comme dans Unlock.
	m, err := s.svc.Meta(id, ka)
	if err != nil {
		fail(w, err)
		return
	}
	openN, envelope, err := s.svc.Unlock(id, ka, kp)
	if err != nil {
		fail(w, err)
		return
	}
	now := s.svc.Now()
	exp := min(now.Add(downloadTTL).Unix(), now.Add(m.ExpiresIn).Unix())
	writeJSON(w, http.StatusOK, struct {
		Token    string `json:"download_token"`
		Segments int    `json:"segments"`
		Envelope string `json:"envelope"`
	}{s.sig.Issue(token.Download, id, openN, time.Unix(exp, 0)), m.Segments, b64.EncodeToString(envelope)})
}

func (s *server) getSegment(w http.ResponseWriter, r *http.Request) {
	// openN vient du jeton signé : une ouverture terminée (done) ne lit plus rien.
	id, openN, err := s.checkToken(r, token.Download)
	if err != nil {
		fail(w, err)
		return
	}
	n, err := segNum(r.PathValue("n"))
	if err != nil {
		fail(w, err)
		return
	}
	release, ok := s.slot(w, r, s.xfer.dl)
	if !ok {
		return
	}
	defer release()
	sec, err := s.svc.OpenSegment(id, n, openN)
	if err != nil {
		fail(w, err)
		return
	}
	defer sec.Close()
	// Échéance propre à la requête (remplace le WriteTimeout de 300 s) : un client trop
	// lent est coupé et rend sa place. Absente des tests en mémoire (ErrNotSupported).
	if err := http.NewResponseController(w).SetWriteDeadline(time.Now().Add(s.xfer.deadline(sec.Size()))); err != nil &&
		!errors.Is(err, http.ErrNotSupported) {
		fail(w, err)
		return
	}
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Length", strconv.FormatInt(sec.Size(), 10))
	w.WriteHeader(http.StatusOK)
	// En flux depuis le fichier (audit E1). Une copie incomplète (client coupé, échéance,
	// erreur de lecture) coupe la connexion : une réponse tronquée ne passe pas pour complète.
	if k, err := io.Copy(w, sec); err != nil || k != sec.Size() {
		panic(http.ErrAbortHandler)
	}
}

func (s *server) done(w http.ResponseWriter, r *http.Request) {
	// openN ne vient que du jeton signé : impossible de marquer l'ouverture d'un autre.
	id, openN, err := s.checkToken(r, token.Download)
	if err != nil {
		fail(w, err)
		return
	}
	if err := s.svc.Done(id, openN); err != nil {
		fail(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *server) destroy(w http.ResponseWriter, r *http.Request) {
	var b struct {
		Proof  *string `json:"proof"`
		Manage *string `json:"manage"`
		Reason string  `json:"reason"` // motif de signalement : non conservé
	}
	if err := readJSON(w, r, &b); err != nil {
		fail(w, err)
		return
	}
	if (b.Proof == nil && b.Manage == nil) || len(b.Reason) > 64 {
		fail(w, errBadRequest)
		return
	}
	var ka, kp, sg []byte
	var err error
	if b.Proof != nil {
		if ka, err = headerSecret(r, "X-Shh-Access"); err == nil {
			kp, err = secret(*b.Proof, 32)
		}
	}
	if err == nil && b.Manage != nil {
		sg, err = secret(*b.Manage, 32)
	}
	if err != nil {
		fail(w, err)
		return
	}
	if err := s.svc.Destroy(r.PathValue("id"), ka, kp, sg); err != nil {
		fail(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *server) status(w http.ResponseWriter, r *http.Request) {
	sg, err := headerSecret(r, "X-Shh-Manage")
	if err != nil {
		fail(w, err)
		return
	}
	st, err := s.svc.Status(r.PathValue("id"), sg)
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, struct {
		OpensUsed int    `json:"opens_used"`
		MaxOpens  int    `json:"max_opens"`
		ExpiresIn int64  `json:"expires_in_s"`
		State     string `json:"state"`
	}{st.OpensUsed, st.MaxOpens, secs(st.ExpiresIn), st.State})
}
