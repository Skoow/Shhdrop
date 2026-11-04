package api

import (
	"io"
	"net/http"
	"slices"
	"strconv"
	"time"

	altcha "github.com/altcha-org/altcha-lib-go"

	"github.com/skoow/shhdrop/server/internal/share"
	"github.com/skoow/shhdrop/server/internal/token"
)

func secs(d time.Duration) int64 { return int64(d / time.Second) }

// GET /api/captcha : défi ALTCHA + jeton signé de l'heure d'affichage (valable 2 min).
func (s *server) captcha(w http.ResponseWriter, r *http.Request) {
	ch, err := s.cap.Challenge(ipOf(r))
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, struct {
		altcha.Challenge
		ShownAt string `json:"shown_at"`
	}{ch, s.sig.Issue(token.CaptchaShown, captchaTokID, 0, s.svc.Now().Add(captchaTTL))})
}

type createBody struct {
	Bucket   int    `json:"bucket"`
	TTLHours int    `json:"ttl_hours"`
	MaxOpens int    `json:"max_opens"`
	Salt     string `json:"salt"`
	Kdf      struct {
		Ops int `json:"ops"`
		Mem int `json:"mem"`
	} `json:"kdf"`
	AccessV string `json:"access_v"`
	ProofV  string `json:"proof_v"`
	ManageV string `json:"manage_v"`
	Altcha  string `json:"altcha"`
	HP      string `json:"hp"`
	ShownAt string `json:"shown_at"`
}

// POST /api/shares : anti-robot → quotas → création → difficulté suivante.
// Le défi est consommé même si une étape suivante échoue.
func (s *server) create(w http.ResponseWriter, r *http.Request) {
	var b createBody
	if err := readJSON(w, r, &b); err != nil {
		fail(w, err)
		return
	}
	req := share.CreateReq{Bucket: b.Bucket, TTLHours: b.TTLHours, MaxOpens: b.MaxOpens,
		KdfOps: b.Kdf.Ops, KdfMem: b.Kdf.Mem}
	var errs [4]error
	req.Salt, errs[0] = secret(b.Salt, 16)
	req.AccessV, errs[1] = secret(b.AccessV, 32)
	req.ProofV, errs[2] = secret(b.ProofV, 32)
	req.ManageV, errs[3] = secret(b.ManageV, 32)
	// Palier vérifié avant les quotas : il fixe les octets comptés.
	if errs != [4]error{} || !slices.Contains(share.Buckets, b.Bucket) {
		fail(w, errBadRequest)
		return
	}
	// shown_at ne vient que d'un jeton signé ; absent, invalide ou expiré → 400.
	_, exp, err := s.sig.CheckExp(b.ShownAt, token.CaptchaShown, captchaTokID)
	if err != nil || exp.IsZero() {
		fail(w, errBadRequest)
		return
	}
	ip := ipOf(r)
	if err := s.cap.Verify(b.Altcha, ip, b.HP, exp.Add(-captchaTTL)); err != nil {
		fail(w, err)
		return
	}
	if ok, retry := s.lim.AllowCreate(ip, int64(share.Header+b.Bucket*share.ChunkCT)); !ok {
		writeLimit(w, retry)
		return
	}
	id, segs, err := s.svc.Create(req)
	if err != nil {
		fail(w, err)
		return
	}
	s.cap.RecordCreate(ip)
	writeJSON(w, http.StatusCreated, struct {
		ID       string `json:"id"`
		Token    string `json:"upload_token"`
		Segments int    `json:"segments"`
	}{id, s.sig.Issue(token.Upload, id, 0, s.svc.Now().Add(uploadTTL)), segs})
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
	left, err := s.svc.Finalize(id)
	if err != nil {
		fail(w, err)
		return
	}
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
	openN, err := s.svc.Unlock(id, ka, kp)
	if err != nil {
		fail(w, err)
		return
	}
	now := s.svc.Now()
	exp := min(now.Add(downloadTTL).Unix(), now.Add(m.ExpiresIn).Unix())
	writeJSON(w, http.StatusOK, struct {
		Token    string `json:"download_token"`
		Segments int    `json:"segments"`
	}{s.sig.Issue(token.Download, id, openN, time.Unix(exp, 0)), m.Segments})
}

func (s *server) getSegment(w http.ResponseWriter, r *http.Request) {
	id, _, err := s.checkToken(r, token.Download)
	if err != nil {
		fail(w, err)
		return
	}
	n, err := segNum(r.PathValue("n"))
	if err != nil {
		fail(w, err)
		return
	}
	b, err := s.svc.ReadSegment(id, n)
	if err != nil {
		fail(w, err)
		return
	}
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Length", strconv.Itoa(len(b)))
	w.WriteHeader(http.StatusOK)
	w.Write(b)
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
