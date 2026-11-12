package api

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/netip"
	"strconv"
	"sync"
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

// antiRobot vérifie la preuve anti-robot d'une création (partage ou salon) et consomme le
// défi. shown_at ne vient que d'un jeton signé, lié au sel du défi résolu ; absent, invalide,
// expiré ou d'un autre défi → errBadRequest ; solution fausse, trop rapide ou champ piège
// rempli → captcha.ErrInvalid.
func (s *server) antiRobot(alt, shownAt, hp string, ip netip.Addr) error {
	salt, err := altchaSalt(alt)
	if err != nil {
		return err
	}
	_, exp, err := s.sig.CheckExp(shownAt, token.CaptchaShown, saltID(salt))
	if err != nil || exp.IsZero() {
		return errBadRequest
	}
	return s.cap.Verify(alt, ip, hp, exp.Add(-captchaTTL))
}

// createBody : création v2 (spec §29.8). Ni id, ni durée, ni ouvertures, ni sel, ni
// V_preuve ; K_accès et S_gestion passent en en-tête (X-Shh-Access, X-Shh-Manage).
type createBody struct {
	Bucket  int    `json:"bucket"`
	Altcha  string `json:"altcha"`
	HP      string `json:"hp"`
	ShownAt string `json:"shown_at"`
}

// POST /api/shares : format et gel → anti-robot → quotas (réservation) → création →
// difficulté suivante. Une requête invalide ou un serveur gelé ne consomme ni le défi ni
// le quota ; le défi est en revanche consommé si le quota ou la création échoue ensuite.
//
// Le partage est indexé par V_accès et V_gestion, que le serveur calcule lui-même depuis
// K_accès et S_gestion (spec §29.8) : une création ne peut heurter un partage existant que
// si son auteur connaît l'un de ces secrets. Qui ne connaît qu'un id (ou un vérificateur
// lu dans la base) ne peut donc pas savoir si un partage existe (revue K1, I2). L'id
// interne est tiré ici (share.NewID), jamais choisi par le client.
func (s *server) create(w http.ResponseWriter, r *http.Request) {
	var b createBody
	if err := readJSON(w, r, &b); err != nil {
		fail(w, err)
		return
	}
	ka, err1 := headerSecret(r, "X-Shh-Access")
	sg, err2 := headerSecret(r, "X-Shh-Manage")
	req := share.CreateReq{ID: share.NewID(), Bucket: b.Bucket, AccessV: share.Verifier(ka), ManageV: share.Verifier(sg)}
	if err1 != nil || err2 != nil || share.Validate(req) != nil {
		fail(w, errBadRequest)
		return
	}
	if s.svc.Frozen() {
		fail(w, share.ErrFrozen)
		return
	}
	ip := ipOf(r)
	if err := s.antiRobot(b.Altcha, b.ShownAt, b.HP, ip); err != nil {
		fail(w, err)
		return
	}
	// Quotas en capacité utile (données du palier, sans le morceau du manifeste), réservés ici et débités à la
	// finalisation ; 2 envois non finalisés à la fois ; octets abandonnés (spec §29.5).
	//
	// V_accès ou V_gestion déjà pris : seul un détenteur du secret peut le provoquer (deux
	// créations avec le même lien). Réponse identique à une création invalide (400
	// bad_request), création comptée au quota et dans la difficulté anti-robot.
	// Envoi dès l'ajout (spec §41.14) : la réservation (création, puis chaque grow) est
	// débitée d'avance ; les octets reçus au-delà (segments effacés et renvoyés) aussi.
	switch retry, err := s.lim.BeginUpload(ip, req.ID, share.ContentBytes(b.Bucket)); {
	case errors.Is(err, limits.ErrDuplicate): // id interne de 128 bits déjà en cours : impossible
		fail(w, errors.New("id interne en double"))
		return
	case err != nil:
		writeLimit(w, retry)
		return
	}
	id, segs, err := s.svc.Create(req)
	if errors.Is(err, share.ErrConflict) {
		s.lim.FinishUpload(req.ID, ip) // le quota reste débité
		s.cap.RecordCreate(ip)
		fail(w, errBadRequest)
		return
	}
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

// checkToken : jeton Bearer du type attendu ; rend l'id interne qu'il désigne (signé par le
// serveur : aucun id dans le chemin, spec §32) et le n° d'ouverture.
func (s *server) checkToken(r *http.Request, kind byte) (string, int, error) {
	tok, err := bearer(r)
	if err != nil {
		return "", 0, err
	}
	return s.sig.Subject(tok, kind)
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
	release, ok := s.xferSlot(w, r, s.xfer.perUp, id, s.xfer.ul)
	if !ok {
		return
	}
	defer release()
	// Débit minimal mesuré par tranche (audit I3) : un client trop lent est coupé et rend sa place.
	rc := http.NewResponseController(w)
	p := newPacer(rc.SetReadDeadline, s.xfer)
	if err := p.arm(); err != nil {
		fail(w, err)
		return
	}
	buf := segBufs.Get().(*[]byte)
	defer segBufs.Put(buf)
	k, err := readBody(paceReader{http.MaxBytesReader(w, r.Body, maxSegmentLen), p}, r.ContentLength, *buf)
	// Octets reçus comptés au quota du jour, en données utiles (audit F1), même si le segment
	// est effacé ensuite (§41.14) ou si le corps est incomplet (coupé, trop lent) : sinon un
	// client pourrait tenir des places sans jamais rien payer.
	retry, qerr := s.lim.Receive(id, share.PayloadBytes(int64(k)))
	if err != nil {
		fail(w, errBadRequest)
		return
	}
	if qerr != nil {
		writeLimit(w, retry)
		return
	}
	body := (*buf)[:k]
	// ?from=c : plage de morceaux d'un segment de brouillon (audit H-2, petits éléments
	// empaquetés) ; sans : segment entier.
	if f := r.URL.Query(); f.Has("from") {
		c, err := segNum(f.Get("from"))
		if err == nil {
			err = s.svc.PutChunks(id, n, c, body)
		}
		if err != nil {
			fail(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if err := s.svc.PutSegment(id, n, body); err != nil {
		fail(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// readBody lit le corps d'un segment dans buf (maxSegmentLen octets, repris de segBufs : pas
// de tampon de 4 Mio alloué par envoi, revue B8) et rend sa longueur. Longueur annoncée
// (Content-Length, déjà plafonnée par l'appelant) : un corps plus court est une erreur, et
// net/http ne livre jamais plus que l'annonce. Longueur inconnue (envoi par blocs) : borné
// par le lecteur reçu (MaxBytesReader), un octet de plus est une erreur. En cas d'erreur, la
// longueur rendue est celle des octets déjà lus.
func readBody(r io.Reader, announced int64, buf []byte) (int, error) {
	if announced >= 0 {
		return io.ReadFull(r, buf[:announced])
	}
	n, err := io.ReadFull(r, buf)
	switch {
	case errors.Is(err, io.EOF), errors.Is(err, io.ErrUnexpectedEOF):
		return n, nil
	case err != nil:
		return n, err
	}
	var one [1]byte
	if _, err := io.ReadFull(r, one[:]); !errors.Is(err, io.EOF) {
		return n, errBadRequest
	}
	return n, nil
}

// segBufs : tampons des segments reçus (un par envoi en cours, ulTotal au plus). Le contenu
// est du chiffré, écrit tel quel : un tampon repris n'a pas à être effacé ; seuls les octets
// lus pour la requête en cours sont utilisés.
var segBufs = sync.Pool{New: func() any { b := make([]byte, maxSegmentLen); return &b }}

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
		// Brouillon (spec §41.14) : palier final, en-tête et manifeste chiffré, sans fill_*.
		Bucket *int    `json:"bucket"`
		Header *string `json:"header"`
		Tail   *string `json:"tail"`
		// Plages de morceaux de petits éléments retirés (audit H-2), remplies d'aléa.
		Void [][2]int `json:"void"`
	}
	if err := readJSONMax(w, r, &b, maxFinalizeJSON); err != nil {
		fail(w, err)
		return
	}
	req := share.FinalizeReq{TTLHours: b.TTLHours, MaxOpens: b.MaxOpens, KdfOps: b.KdfOps, KdfMem: b.KdfMem}
	var errs [3]error
	req.Salt, errs[0] = secret(b.Salt, 16)
	req.ProofV, errs[1] = secret(b.ProofV, 32)
	req.Envelope, errs[2] = secret(b.Envelope, share.EnvelopeLen)
	// fill_from et fill_to ensemble, ou aucun des deux (spec §36 S4, Q-MIN1 : le navigateur a
	// envoyé lui-même tout le bourrage ; tous les segments sont alors exigés).
	if errs != [3]error{} || (b.FillFrom == nil) != (b.FillTo == nil) {
		fail(w, errBadRequest)
		return
	}
	if b.FillFrom != nil {
		req.FillFrom, req.FillTo = *b.FillFrom, *b.FillTo
	}
	draft := b.Bucket != nil
	if draft != (b.Header != nil) || draft != (b.Tail != nil) || draft && b.FillFrom != nil || !draft && b.Void != nil {
		fail(w, errBadRequest)
		return
	}
	if draft {
		var e1, e2 error
		req.Bucket = *b.Bucket
		req.Void = b.Void
		req.Header, e1 = secret(*b.Header, share.Header)
		req.Tail, e2 = secret(*b.Tail, share.ChunkCT)
		if e1 != nil || e2 != nil || req.Bucket == 0 {
			fail(w, errBadRequest)
			return
		}
	}
	// Bourrage déjà payé : le palier final ne dépasse pas la réservation débitée (audit M1).
	left, err := s.svc.Finalize(id, req)
	if err != nil {
		fail(w, err)
		return
	}
	// Un envoi commencé la veille compte dans les quotas du jour où il finit (audit M5).
	s.lim.FinishUpload(id, ipOf(r))
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
	g, err := grantHeader(r)
	if err != nil {
		fail(w, err)
		return
	}
	m, err := s.svc.MetaGrant(ka, g)
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
		OpensLeft int     `json:"opens_left"`
	}{secs(m.ExpiresIn), b64.EncodeToString(m.Salt), kdfJSON{m.KdfOps, m.KdfMem}, m.Bucket, m.Segments, m.OpensLeft})
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
	// Octroi d'ouverture (facultatif, spec §41.4) : rouvre la même ouverture sans en consommer.
	g, err := grantHeader(r)
	if err != nil {
		fail(w, err)
		return
	}
	// Meta d'abord : il trouve le partage par V_accès (un « draining » seulement avec un octroi
	// valable). Une clé d'accès fausse échoue ici sans compter d'essai.
	m, err := s.svc.MetaGrant(ka, g)
	if err != nil {
		fail(w, err)
		return
	}
	id := m.ID
	o, err := s.svc.UnlockGrant(id, ka, kp, g)
	if err != nil {
		fail(w, err)
		return
	}
	openN, envelope := o.N, o.Envelope
	// Jeton de dlTTL (6 h), non plafonné à expires_at : il borne la grâce d'une ouverture
	// active après l'échéance ; le partage reste revérifié à chaque requête (spec §41.8).
	exp := s.svc.Now().Add(s.dlTTL).Unix()
	writeJSON(w, http.StatusOK, struct {
		Token     string `json:"download_token"`
		Segments  int    `json:"segments"`
		Envelope  string `json:"envelope"`
		Grant     string `json:"grant"`
		OpensLeft int    `json:"opens_left"`
		// last_open : dernière ouverture permise (n = opens_issued, plus aucune) ; seule
		// celle-ci se voit proposer « Détruire » (revue D42-22).
		LastOpen bool `json:"last_open"`
	}{s.sig.Issue(token.Download, id, openN, time.Unix(exp, 0)), m.Segments, b64.EncodeToString(envelope), o.Grant, o.OpensLeft, o.LastOpen})
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
	release, ok := s.xferSlot(w, r, s.xfer.perOpen, id+"|"+strconv.Itoa(openN), s.xfer.dl)
	if !ok {
		return
	}
	defer release()
	sec, err := s.svc.OpenSegmentCtx(r.Context(), id, n, openN)
	if err != nil {
		fail(w, err)
		return
	}
	defer sec.Close()
	// Débit minimal mesuré par tranche (audit M4, remplace le WriteTimeout de 300 s) : un
	// client trop lent est coupé et rend sa place. Absent des tests en mémoire (ErrNotSupported).
	rc := http.NewResponseController(w)
	p := newPacer(rc.SetWriteDeadline, s.xfer)
	// Révocation (signalement, administrateur, exclusion ; spec §41.8) : la connexion est
	// coupée tout de suite, même si l'écriture attend un client lent (échéance dans le passé,
	// que le débit minimal ne repousse plus). La lecture du segment s'arrête aussi à la tranche
	// suivante (share.ctxReader).
	stop := context.AfterFunc(sec.Context(), func() {
		if errors.Is(context.Cause(sec.Context()), share.ErrRevoked) {
			p.stop(time.Unix(1, 0))
		}
	})
	defer stop()
	if err := p.arm(); err != nil {
		fail(w, err)
		return
	}
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Length", strconv.FormatInt(sec.Size(), 10))
	w.WriteHeader(http.StatusOK)
	// En flux depuis le fichier (audit E1). Une copie incomplète (client coupé, échéance,
	// erreur de lecture) coupe la connexion : une réponse tronquée ne passe pas pour complète.
	// Tampon de 256 Kio repris d'une réserve (revue B8) ; paceWriter masque le ReadFrom de la
	// réponse, qui recopierait sinon par tranches de 32 Kio.
	buf := copyBufs.Get().(*[]byte)
	k, err := io.CopyBuffer(paceWriter{w, p}, sec, *buf)
	copyBufs.Put(buf)
	if err != nil || k != sec.Size() {
		panic(http.ErrAbortHandler)
	}
}

// copyBufs : tampons de copie des segments servis (un par téléchargement en cours).
var copyBufs = sync.Pool{New: func() any { b := make([]byte, 256<<10); return &b }}

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

// POST /api/shares/destroy : destruction ou signalement par le destinataire (K_accès en
// en-tête, K_preuve dans le corps). L'expéditeur passe par /api/manage/destroy.
// reason : absent (destruction : les ouvertures actives finissent) ou exactement "report"
// (signalement : flux coupés, compté dans l'heure) ; toute autre valeur → 400, jamais de
// texte libre (spec §36 S14, §41.8).
func (s *server) destroy(w http.ResponseWriter, r *http.Request) {
	var b struct {
		Proof  string          `json:"proof"`
		Reason json.RawMessage `json:"reason"` // valeur brute : null, "" ou "REPORT" refusés
	}
	if err := readJSON(w, r, &b); err != nil {
		fail(w, err)
		return
	}
	report := b.Reason != nil
	if report && string(b.Reason) != `"report"` {
		fail(w, errBadRequest)
		return
	}
	ka, err := headerSecret(r, "X-Shh-Access")
	if err != nil {
		fail(w, err)
		return
	}
	kp, err := secret(b.Proof, 32)
	if err != nil {
		fail(w, err)
		return
	}
	if err := s.svc.DestroyWithProof(ka, kp, report); err != nil {
		fail(w, err)
		return
	}
	if report {
		s.reports.add(s.svc.Now())
	}
	w.WriteHeader(http.StatusNoContent)
}

// POST /api/shares/grow {"bucket": b} : agrandit la réservation d'un brouillon (spec §41.14).
func (s *server) grow(w http.ResponseWriter, r *http.Request) {
	id, _, err := s.checkToken(r, token.Upload)
	if err != nil {
		fail(w, err)
		return
	}
	var b struct {
		Bucket *int `json:"bucket"`
	}
	if err := readJSON(w, r, &b); err != nil || b.Bucket == nil {
		fail(w, errBadRequest)
		return
	}
	// Place débitée d'avance au quota du jour (audit H1), par Grow lui-même, sous la
	// réservation de l'envoi, et rendue par lui si l'agrandissement échoue (revue B3a) : un
	// grow refusé ou « busy » en parallèle ne touche plus au quota.
	var retry time.Duration
	quota := false
	err = s.svc.GrowCharged(id, *b.Bucket, func(bucket int) error {
		d, err := s.lim.Reserve(id, share.ContentBytes(bucket))
		if err != nil {
			retry, quota = d, true
		}
		return err
	})
	switch {
	case quota:
		writeLimit(w, retry)
	case err != nil:
		fail(w, err)
	default:
		w.WriteHeader(http.StatusNoContent)
	}
}

// POST /api/shares/erase {"from": a, "to": b} : efface tout de suite, sur le disque, les
// segments [a, b) d'un élément retiré du brouillon (spec §41.14).
func (s *server) erase(w http.ResponseWriter, r *http.Request) {
	id, _, err := s.checkToken(r, token.Upload)
	if err != nil {
		fail(w, err)
		return
	}
	var b struct {
		From *int `json:"from"`
		To   *int `json:"to"`
	}
	if err := readJSON(w, r, &b); err != nil || b.From == nil || b.To == nil {
		fail(w, errBadRequest)
		return
	}
	if err := s.svc.Erase(id, *b.From, *b.To); err != nil {
		fail(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// POST /api/shares/keep : signe de vie de la page qui compose, corps vide (spec §41.14).
func (s *server) keep(w http.ResponseWriter, r *http.Request) {
	id, _, err := s.checkToken(r, token.Upload)
	if err != nil {
		fail(w, err)
		return
	}
	if r.ContentLength > 0 {
		fail(w, errBadRequest)
		return
	}
	if err := s.svc.Keep(id); err != nil {
		fail(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
