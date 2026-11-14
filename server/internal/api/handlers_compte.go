package api

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"time"

	"github.com/skoow/shhdrop/server/internal/captcha"
	"github.com/skoow/shhdrop/server/internal/compte"
)

// Routes du compte (plan du compte, lot 4 ; conception §8.6, §21.6.2), enregistrées seulement
// avec SHH_COMPTES=1 (sinon la 404 uniforme des routes inconnues). JSON strict, sans `null`
// (absent ≠ null, §8.6) ; secrets en base64url sans bourrage de longueur exacte ; rien dans
// l'URL. Le jeton de session n'est lu qu'ici (X-Shh-Session, minimize_test.go) ; le serveur
// n'en garde que SHA-256. Aucune réponse ne dit si une adresse ou un pseudo existe avant le
// code juste reçu par e-mail.

type compteAPI struct {
	*server
	c *compte.Service
}

// Plafonds des corps : inscription/fin porte les deux coffres (256 Kio + 45 octets au plus
// chacun, 349 586 caractères en base64url) ; PUT d'un coffre, un seul.
const (
	maxInscriptionJSON = 1 << 20
	maxCoffreJSON      = 384 << 10
)

func (a compteAPI) routes(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/compte/inscription/debut", a.inscriptionDebut)
	mux.HandleFunc("POST /api/compte/inscription/renvoyer", a.renvoyer)
	mux.HandleFunc("POST /api/compte/inscription/fin", a.inscriptionFin)
	mux.HandleFunc("POST /api/compte/connexion", a.connexion)
	mux.HandleFunc("POST /api/compte/reauth", a.reauth)
	mux.HandleFunc("GET /api/compte/sessions", a.sessions)
	mux.HandleFunc("POST /api/compte/sessions/fermer", a.fermer)
	mux.HandleFunc("POST /api/compte/deconnexion", a.deconnexion)
	mux.HandleFunc("GET /api/compte/coffre/profil", a.lireCoffre(compte.Profil))
	mux.HandleFunc("PUT /api/compte/coffre/profil", a.ecrireCoffre(compte.Profil))
	mux.HandleFunc("GET /api/compte/coffre/prive", a.lireCoffre(compte.Prive))
	mux.HandleFunc("PUT /api/compte/coffre/prive", a.ecrireCoffre(compte.Prive))
	mux.HandleFunc("POST /api/compte/pseudo/verifier", a.pseudoVerifier)
	mux.HandleFunc("POST /api/compte/pseudo", a.pseudo)
	// Lot 5 : double authentification, récupération, paramètres, suppression.
	mux.HandleFunc("POST /api/compte/connexion/totp", a.connexionTOTP)
	mux.HandleFunc("POST /api/compte/oubli/debut", a.oubliDebut)
	mux.HandleFunc("POST /api/compte/oubli/renvoyer", a.oubliRenvoyer)
	mux.HandleFunc("POST /api/compte/oubli/verifier", a.oubliVerifier)
	mux.HandleFunc("POST /api/compte/oubli/fin", a.oubliFin)
	mux.HandleFunc("GET /api/compte", a.etat)
	mux.HandleFunc("POST /api/compte/mdp", a.mdp)
	mux.HandleFunc("POST /api/compte/email/debut", a.emailDebut)
	mux.HandleFunc("POST /api/compte/email/renvoyer", a.emailRenvoyer)
	mux.HandleFunc("POST /api/compte/email/fin", a.emailFin)
	mux.HandleFunc("POST /api/compte/totp/debut", a.totpDebut)
	mux.HandleFunc("POST /api/compte/totp/fin", a.totpFin)
	mux.HandleFunc("POST /api/compte/totp/retirer", a.sansCorps(a.c.TOTPRetirer))
	mux.HandleFunc("POST /api/compte/totp/annuler-retrait", a.sansCorps(a.c.TOTPAnnulerRetrait))
	mux.HandleFunc("GET /api/compte/export", a.export)
	mux.HandleFunc("POST /api/compte/supprimer", a.supprimer)
}

// failCompte : erreur du service → réponse fixe (§8.6) ; toute autre → 500 sans détail.
func failCompte(w http.ResponseWriter, err error) {
	var cf compte.ErrCodeFaux
	var lim compte.ErrLimit
	var bn compte.ErrBanni
	var cl compte.ErrConflit
	var at compte.ErrAttente
	switch {
	case errors.As(err, &cf):
		writeJSON(w, http.StatusForbidden, struct {
			Error string `json:"error"`
			Left  int    `json:"attempts_left"`
		}{"code_faux", cf.Restants})
	case errors.As(err, &lim):
		writeLimit(w, lim.Retry)
	case errors.As(err, &bn):
		writeJSON(w, http.StatusForbidden, struct {
			Error string `json:"error"`
			Jusqu string `json:"jusqu"`
		}{"banni", bn.Jusqu})
	case errors.As(err, &at):
		writeJSON(w, http.StatusForbidden, struct {
			Error string `json:"error"`
			Jusqu string `json:"jusqu"`
		}{"attente", at.Jusqu})
	case errors.As(err, &cl):
		writeJSON(w, http.StatusConflict, struct {
			Error string `json:"error"`
			Gen   uint64 `json:"gen"`
		}{"conflict", cl.Gen})
	case errors.Is(err, compte.ErrRequete), errors.Is(err, errBadRequest), errors.Is(err, captcha.ErrInvalid):
		writeErr(w, http.StatusBadRequest, "bad_request")
	case errors.Is(err, compte.ErrAdresse):
		writeErr(w, http.StatusBadRequest, "adresse_invalide")
	case errors.Is(err, compte.ErrJetable):
		writeErr(w, http.StatusBadRequest, "jetable")
	case errors.Is(err, compte.ErrSession):
		writeErr(w, http.StatusUnauthorized, "session")
	case errors.Is(err, compte.ErrIdentifiants):
		writeErr(w, http.StatusForbidden, "identifiants")
	case errors.Is(err, compte.ErrPreuveRequise):
		writeErr(w, http.StatusForbidden, "preuve_requise")
	case errors.Is(err, compte.ErrTOTPRequis):
		writeErr(w, http.StatusForbidden, "totp_requis")
	case errors.Is(err, compte.ErrTOTPFaux):
		writeErr(w, http.StatusForbidden, "totp_faux")
	case errors.Is(err, compte.ErrTOTPRejoue):
		writeErr(w, http.StatusForbidden, "totp_rejoue")
	case errors.Is(err, compte.ErrRecent):
		writeErr(w, http.StatusForbidden, "recent")
	case errors.Is(err, compte.ErrEtape):
		writeErr(w, http.StatusNotFound, "not_found")
	case errors.Is(err, compte.ErrDejaInscrit):
		writeErr(w, http.StatusConflict, "deja_inscrit")
	case errors.Is(err, compte.ErrPseudoPris):
		writeErr(w, http.StatusConflict, "pseudo_pris")
	case errors.Is(err, compte.ErrBusy):
		writeRetry(w, http.StatusServiceUnavailable, "busy", slotRetry)
	default:
		writeErr(w, http.StatusInternalServerError, "internal")
	}
}

// lire : corps JSON strict (readJSONMax) et sans aucun `null`. Même échéance de lecture que
// readJSONMax (audit du 13 novembre, D5), posée avant la première lecture.
func lire(w http.ResponseWriter, r *http.Request, v any, max int64) error {
	rc := http.NewResponseController(w)
	if err := rc.SetReadDeadline(time.Now().Add(jsonReadTimeout)); err != nil && !errors.Is(err, http.ErrNotSupported) {
		return errBadRequest
	}
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, max))
	if err != nil || sansNull(body) != nil {
		return errBadRequest
	}
	r.Body = io.NopCloser(bytes.NewReader(body))
	return readJSONMax(w, r, v, max)
}

func sansNull(b []byte) error {
	dec := json.NewDecoder(bytes.NewReader(b))
	for {
		tok, err := dec.Token()
		if err == io.EOF {
			return nil
		}
		if err != nil || tok == nil {
			return errBadRequest
		}
	}
}

// session : la session de X-Shh-Session (absente, mal formée, inconnue, échue : 401).
func (a compteAPI) session(r *http.Request) (compte.Courante, error) {
	tok, err := headerSecret(r, "X-Shh-Session")
	if err != nil {
		return compte.Courante{}, compte.ErrSession
	}
	return a.c.Session([32]byte(tok))
}

func b32(s string) ([32]byte, error) {
	b, err := secret(s, 32)
	if err != nil {
		return [32]byte{}, err
	}
	return [32]byte(b), nil
}

// options : persistante (exigée) et étiquette ("" : aucune ; sinon 64 octets).
func options(pers *bool, etiq *string) (compte.OptionsSession, error) {
	if pers == nil || etiq == nil {
		return compte.OptionsSession{}, errBadRequest
	}
	o := compte.OptionsSession{Persistante: *pers}
	if *etiq != "" {
		var err error
		if o.Etiquette, err = secret(*etiq, 64); err != nil {
			return o, err
		}
	}
	return o, nil
}

func (a compteAPI) inscriptionDebut(w http.ResponseWriter, r *http.Request) {
	var b struct {
		Email   string `json:"email"`
		Langue  string `json:"langue"`
		Altcha  string `json:"altcha"`
		HP      string `json:"hp"`
		ShownAt string `json:"shown_at"`
	}
	if err := lire(w, r, &b, maxJSON); err != nil {
		failCompte(w, err)
		return
	}
	ip := ipOf(r)
	if err := a.antiRobot(b.Altcha, b.ShownAt, b.HP, ip); err != nil {
		failCompte(w, err)
		return
	}
	a.cap.RecordCreate(ip)
	h, e, err := a.c.InscriptionDebut(ip, b.Email, b.Langue)
	if err != nil {
		failCompte(w, err)
		return
	}
	writeJSON(w, http.StatusOK, struct {
		H     string `json:"h"`
		Etape string `json:"etape"`
	}{b64.EncodeToString(h[:]), b64.EncodeToString(e[:])})
}

func (a compteAPI) renvoyer(w http.ResponseWriter, r *http.Request) {
	var b struct {
		Etape string `json:"etape"`
		Email string `json:"email"`
	}
	if err := lire(w, r, &b, maxJSON); err != nil {
		failCompte(w, err)
		return
	}
	e, err := b32(b.Etape)
	if err == nil {
		err = a.c.Renvoyer(ipOf(r), e, b.Email)
	}
	if err != nil {
		failCompte(w, err)
		return
	}
	writeJSON(w, http.StatusOK, struct{}{})
}

func (a compteAPI) inscriptionFin(w http.ResponseWriter, r *http.Request) {
	var b struct {
		Etape       string  `json:"etape"`
		Code        string  `json:"code"`
		AAuth       string  `json:"a_auth"`
		EnvMdp      string  `json:"env_mdp"`
		SProfil     string  `json:"s_profil"`
		PCanon      string  `json:"p_canon"`
		BlobProfil  string  `json:"blob_profil"`
		BlobPrive   string  `json:"blob_prive"`
		Persistante *bool   `json:"persistante"`
		Etiquette   *string `json:"etiquette"`
	}
	if err := lire(w, r, &b, maxInscriptionJSON); err != nil {
		failCompte(w, err)
		return
	}
	var errs [7]error
	var e [32]byte
	var d compte.Donnees
	var env []byte
	e, errs[0] = b32(b.Etape)
	d.AAuth, errs[1] = b32(b.AAuth)
	d.SProfil, errs[2] = b32(b.SProfil)
	env, errs[3] = secret(b.EnvMdp, 60)
	d.BlobProfil, errs[4] = b64.DecodeString(b.BlobProfil)
	d.BlobPrive, errs[5] = b64.DecodeString(b.BlobPrive)
	o, err := options(b.Persistante, b.Etiquette)
	errs[6] = err
	if errs != [7]error{} || b.PCanon == "" {
		failCompte(w, errBadRequest)
		return
	}
	d.EnvMdp, d.PCanon = [60]byte(env), []byte(b.PCanon)
	tok, err := a.c.InscriptionFin(e, b.Code, d, o)
	if err != nil {
		failCompte(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, struct {
		Session string `json:"session"`
	}{b64.EncodeToString(tok[:])})
}

func (a compteAPI) connexion(w http.ResponseWriter, r *http.Request) {
	var b struct {
		Email       string  `json:"email"`
		AAuth       string  `json:"a_auth"`
		Persistante *bool   `json:"persistante"`
		Etiquette   *string `json:"etiquette"`
		Altcha      *string `json:"altcha"`
		HP          *string `json:"hp"`
		ShownAt     *string `json:"shown_at"`
	}
	if err := lire(w, r, &b, maxJSON); err != nil {
		failCompte(w, err)
		return
	}
	aAuth, err := b32(b.AAuth)
	o, err2 := options(b.Persistante, b.Etiquette)
	n := 0
	for _, p := range []*string{b.Altcha, b.HP, b.ShownAt} {
		if p != nil {
			n++
		}
	}
	if err != nil || err2 != nil || (n != 0 && n != 3) {
		failCompte(w, errBadRequest)
		return
	}
	ip := ipOf(r)
	// Preuve ALTCHA (exigée après 5 échecs dans l'heure sur ce compte, §8.8) : vérifiée et
	// consommée si elle est donnée.
	if n == 3 {
		if err := a.antiRobot(*b.Altcha, *b.ShownAt, *b.HP, ip); err != nil {
			failCompte(w, err)
			return
		}
	}
	ov, err := a.c.Connexion(ip, b.Email, aAuth, o, n == 3)
	if err != nil {
		failCompte(w, err)
		return
	}
	if ov.Etape != nil {
		writeJSON(w, http.StatusOK, struct {
			TOTP  bool   `json:"totp_requis"`
			Etape string `json:"etape"`
		}{true, b64.EncodeToString(ov.Etape[:])})
		return
	}
	ecrireOuverture(w, ov)
}

// ecrireOuverture : réponse d'une connexion (§21.6.2) ; s_profil effacé au mieux (la réponse
// encodée, elle, ne s'efface pas).
func ecrireOuverture(w http.ResponseWriter, ov compte.Ouverture) {
	writeJSON(w, http.StatusOK, struct {
		Session    string `json:"session"`
		H          string `json:"h"`
		EnvMdp     string `json:"env_mdp"`
		SProfil    string `json:"s_profil"`
		BlobProfil string `json:"blob_profil"`
		GenProfil  uint64 `json:"gen_profil"`
		BlobPrive  string `json:"blob_prive"`
		GenPrive   uint64 `json:"gen_prive"`
	}{b64.EncodeToString(ov.Jeton[:]), b64.EncodeToString(ov.H[:]), b64.EncodeToString(ov.EnvMdp[:]),
		b64.EncodeToString(ov.SProfil[:]), b64.EncodeToString(ov.BlobProfil), ov.GenProfil,
		b64.EncodeToString(ov.BlobPrive), ov.GenPrive})
	clear(ov.SProfil[:])
}

func (a compteAPI) reauth(w http.ResponseWriter, r *http.Request) {
	c, err := a.session(r)
	if err != nil {
		failCompte(w, err)
		return
	}
	var b struct {
		AAuth string  `json:"a_auth"`
		TOTP  *string `json:"totp"`
	}
	if err := lire(w, r, &b, maxJSON); err != nil || b.TOTP == nil {
		failCompte(w, errBadRequest)
		return
	}
	aAuth, err := b32(b.AAuth)
	if err == nil {
		err = a.c.Reauth(ipOf(r), c, aAuth, *b.TOTP)
	}
	if err != nil {
		failCompte(w, err)
		return
	}
	writeJSON(w, http.StatusOK, struct{}{})
}

type sessionJSON struct {
	Sid         string `json:"sid"`
	Ajoutee     string `json:"ajoutee"`
	Etiquette   string `json:"etiquette"`
	Courante    bool   `json:"courante"`
	Persistante bool   `json:"persistante"`
}

func (a compteAPI) sessions(w http.ResponseWriter, r *http.Request) {
	c, err := a.session(r)
	if err != nil {
		failCompte(w, err)
		return
	}
	vs, err := a.c.Sessions(c)
	if err != nil {
		failCompte(w, err)
		return
	}
	out := make([]sessionJSON, 0, len(vs))
	for _, v := range vs {
		out = append(out, sessionJSON{b64.EncodeToString(v.Sid[:]), v.Ajoutee, b64.EncodeToString(v.Etiquette),
			v.Courante, v.Persistante})
	}
	writeJSON(w, http.StatusOK, struct {
		Sessions []sessionJSON `json:"sessions"`
	}{out})
}

// fermer : { sid } ou { autres: true }, exactement l'un des deux.
func (a compteAPI) fermer(w http.ResponseWriter, r *http.Request) {
	c, err := a.session(r)
	if err != nil {
		failCompte(w, err)
		return
	}
	var b struct {
		Sid    *string `json:"sid"`
		Autres *bool   `json:"autres"`
	}
	if err := lire(w, r, &b, maxJSON); err != nil || (b.Sid == nil) == (b.Autres == nil) || (b.Autres != nil && !*b.Autres) {
		failCompte(w, errBadRequest)
		return
	}
	if b.Autres != nil {
		err = a.c.FermerAutres(c)
	} else {
		var sid []byte
		if sid, err = secret(*b.Sid, 16); err == nil {
			err = a.c.FermerSession(c, [16]byte(sid))
		}
	}
	if err != nil {
		failCompte(w, err)
		return
	}
	writeJSON(w, http.StatusOK, struct{}{})
}

func (a compteAPI) deconnexion(w http.ResponseWriter, r *http.Request) {
	c, err := a.session(r)
	if err != nil {
		failCompte(w, err)
		return
	}
	var b struct{}
	if err := lire(w, r, &b, maxJSON); err != nil {
		failCompte(w, err)
		return
	}
	if err := a.c.Deconnexion(c); err != nil {
		failCompte(w, err)
		return
	}
	writeJSON(w, http.StatusOK, struct{}{})
}

func (a compteAPI) lireCoffre(sorte compte.Coffre) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		c, err := a.session(r)
		if err != nil {
			failCompte(w, err)
			return
		}
		blob, gen, err := a.c.LireCoffre(c, sorte)
		if err != nil {
			failCompte(w, err)
			return
		}
		writeJSON(w, http.StatusOK, struct {
			Blob string `json:"blob"`
			Gen  uint64 `json:"gen"`
		}{b64.EncodeToString(blob), gen})
	}
}

func (a compteAPI) ecrireCoffre(sorte compte.Coffre) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		c, err := a.session(r)
		if err != nil {
			failCompte(w, err)
			return
		}
		var b struct {
			IfGen *uint64 `json:"if_gen"`
			Blob  string  `json:"blob"`
		}
		if err := lire(w, r, &b, maxCoffreJSON); err != nil || b.IfGen == nil {
			failCompte(w, errBadRequest)
			return
		}
		blob, err := b64.DecodeString(b.Blob)
		if err != nil {
			failCompte(w, errBadRequest)
			return
		}
		gen, err := a.c.EcrireCoffre(c, sorte, *b.IfGen, blob)
		if err != nil {
			failCompte(w, err)
			return
		}
		writeJSON(w, http.StatusOK, struct {
			Gen uint64 `json:"gen"`
		}{gen})
	}
}

// pseudoVerifier : { p_canon } avec une session, ou { etape, p_canon } pendant l'inscription.
func (a compteAPI) pseudoVerifier(w http.ResponseWriter, r *http.Request) {
	var b struct {
		Etape  *string `json:"etape"`
		PCanon string  `json:"p_canon"`
	}
	var c compte.Courante
	var err error
	if len(r.Header.Values("X-Shh-Session")) != 0 {
		if c, err = a.session(r); err != nil {
			failCompte(w, err)
			return
		}
	}
	if err := lire(w, r, &b, maxJSON); err != nil {
		failCompte(w, err)
		return
	}
	var libre bool
	switch {
	case b.Etape != nil:
		var e [32]byte
		if e, err = b32(*b.Etape); err == nil {
			libre, err = a.c.PseudoVerifierEtape(e, []byte(b.PCanon))
		}
	case c.H != [16]byte{}:
		libre, err = a.c.PseudoVerifier(c, []byte(b.PCanon))
	default:
		err = compte.ErrSession
	}
	if err != nil {
		failCompte(w, err)
		return
	}
	writeJSON(w, http.StatusOK, struct {
		Libre bool `json:"libre"`
	}{libre})
}

func (a compteAPI) pseudo(w http.ResponseWriter, r *http.Request) {
	c, err := a.session(r)
	if err != nil {
		failCompte(w, err)
		return
	}
	var b struct {
		PCanon string `json:"p_canon"`
	}
	if err := lire(w, r, &b, maxJSON); err != nil {
		failCompte(w, err)
		return
	}
	if err := a.c.ChangerPseudo(c, []byte(b.PCanon)); err != nil {
		failCompte(w, err)
		return
	}
	writeJSON(w, http.StatusOK, struct{}{})
}

// --- Lot 5 : double authentification, récupération, paramètres, suppression (§21.6.2). ---

// etapeCode : corps { etape, code } (connexion/totp, totp/fin).
func etapeCode(w http.ResponseWriter, r *http.Request) ([32]byte, string, error) {
	var b struct {
		Etape string `json:"etape"`
		Code  string `json:"code"`
	}
	if err := lire(w, r, &b, maxJSON); err != nil {
		return [32]byte{}, "", err
	}
	e, err := b32(b.Etape)
	return e, b.Code, err
}

func (a compteAPI) connexionTOTP(w http.ResponseWriter, r *http.Request) {
	e, code, err := etapeCode(w, r)
	if err != nil {
		failCompte(w, err)
		return
	}
	ov, err := a.c.ConnexionTOTP(e, code)
	if err != nil {
		failCompte(w, err)
		return
	}
	ecrireOuverture(w, ov)
}

// oubliDebut : { email, langue, altcha, hp, shown_at } → { etape }, toujours la même forme
// (§21.3).
func (a compteAPI) oubliDebut(w http.ResponseWriter, r *http.Request) {
	var b struct {
		Email   string `json:"email"`
		Langue  string `json:"langue"`
		Altcha  string `json:"altcha"`
		HP      string `json:"hp"`
		ShownAt string `json:"shown_at"`
	}
	if err := lire(w, r, &b, maxJSON); err != nil {
		failCompte(w, err)
		return
	}
	ip := ipOf(r)
	if err := a.antiRobot(b.Altcha, b.ShownAt, b.HP, ip); err != nil {
		failCompte(w, err)
		return
	}
	a.cap.RecordCreate(ip)
	e, err := a.c.OubliDebut(ip, b.Email, b.Langue)
	if err != nil {
		failCompte(w, err)
		return
	}
	writeJSON(w, http.StatusOK, struct {
		Etape string `json:"etape"`
	}{b64.EncodeToString(e[:])})
}

// etapeEmail : corps { etape, email } (renvois).
func etapeEmail(w http.ResponseWriter, r *http.Request) ([32]byte, string, error) {
	var b struct {
		Etape string `json:"etape"`
		Email string `json:"email"`
	}
	if err := lire(w, r, &b, maxJSON); err != nil {
		return [32]byte{}, "", err
	}
	e, err := b32(b.Etape)
	return e, b.Email, err
}

func (a compteAPI) oubliRenvoyer(w http.ResponseWriter, r *http.Request) {
	e, email, err := etapeEmail(w, r)
	if err == nil {
		err = a.c.RenvoyerOubli(ipOf(r), e, email)
	}
	if err != nil {
		failCompte(w, err)
		return
	}
	writeJSON(w, http.StatusOK, struct{}{})
}

// oubliVerifier : { etape, code, totp, totp_perdu } → { h } ou { attente_jusqu }.
func (a compteAPI) oubliVerifier(w http.ResponseWriter, r *http.Request) {
	var b struct {
		Etape     string  `json:"etape"`
		Code      string  `json:"code"`
		TOTP      *string `json:"totp"`
		TOTPPerdu *bool   `json:"totp_perdu"`
	}
	if err := lire(w, r, &b, maxJSON); err != nil || b.TOTP == nil || b.TOTPPerdu == nil {
		failCompte(w, errBadRequest)
		return
	}
	e, err := b32(b.Etape)
	if err != nil {
		failCompte(w, err)
		return
	}
	h, att, err := a.c.OubliVerifier(e, b.Code, *b.TOTP, *b.TOTPPerdu)
	if err != nil {
		failCompte(w, err)
		return
	}
	if att != "" {
		writeJSON(w, http.StatusOK, struct {
			Attente string `json:"attente_jusqu"`
		}{att})
		return
	}
	writeJSON(w, http.StatusOK, struct {
		H string `json:"h"`
	}{b64.EncodeToString(h[:])})
}

// oubliFin : { etape, a_auth, env_mdp, blob_prive, persistante, etiquette } →
// { session, h, s_profil, blob_profil, gen_profil, gen_prive }.
func (a compteAPI) oubliFin(w http.ResponseWriter, r *http.Request) {
	var b struct {
		Etape       string  `json:"etape"`
		AAuth       string  `json:"a_auth"`
		EnvMdp      string  `json:"env_mdp"`
		BlobPrive   string  `json:"blob_prive"`
		Persistante *bool   `json:"persistante"`
		Etiquette   *string `json:"etiquette"`
	}
	if err := lire(w, r, &b, maxCoffreJSON); err != nil {
		failCompte(w, err)
		return
	}
	var errs [5]error
	var e [32]byte
	var d compte.DonneesOubli
	var env []byte
	e, errs[0] = b32(b.Etape)
	d.AAuth, errs[1] = b32(b.AAuth)
	env, errs[2] = secret(b.EnvMdp, 60)
	d.BlobPrive, errs[3] = b64.DecodeString(b.BlobPrive)
	o, err := options(b.Persistante, b.Etiquette)
	errs[4] = err
	if errs != [5]error{} {
		failCompte(w, errBadRequest)
		return
	}
	d.EnvMdp = [60]byte(env)
	ov, err := a.c.OubliFin(e, d, o)
	if err != nil {
		failCompte(w, err)
		return
	}
	writeJSON(w, http.StatusOK, struct {
		Session    string `json:"session"`
		H          string `json:"h"`
		SProfil    string `json:"s_profil"`
		BlobProfil string `json:"blob_profil"`
		GenProfil  uint64 `json:"gen_profil"`
		GenPrive   uint64 `json:"gen_prive"`
	}{b64.EncodeToString(ov.Jeton[:]), b64.EncodeToString(ov.H[:]), b64.EncodeToString(ov.SProfil[:]),
		b64.EncodeToString(ov.BlobProfil), ov.GenProfil, ov.GenPrive})
	clear(ov.SProfil[:])
}

// ouNull : chaîne vide → null (absent ≠ null : ces champs sont toujours présents).
func ouNull(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

func motifOuNull(m uint8) *uint8 {
	if m == 0 {
		return nil
	}
	return &m
}

// etat : GET /api/compte (§8.6, §21.6.2).
func (a compteAPI) etat(w http.ResponseWriter, r *http.Request) {
	c, err := a.session(r)
	if err != nil {
		failCompte(w, err)
		return
	}
	et, err := a.c.Etat(c)
	if err != nil {
		failCompte(w, err)
		return
	}
	type limites struct {
		Salons int `json:"salons"`
		Places int `json:"places"`
		Heures int `json:"heures"`
	}
	writeJSON(w, http.StatusOK, struct {
		H             string  `json:"h"`
		CreeLe        string  `json:"cree_le"`
		Palier        string  `json:"palier"`
		ConfirmeLe    *string `json:"confirme_le"`
		Limites       limites `json:"limites"`
		SalonsActifs  int     `json:"salons_actifs"`
		TOTP          bool    `json:"totp"`
		Banni         bool    `json:"banni"`
		RecupJusqu    *string `json:"recup_jusqu"`
		RetraitTOTPLe *string `json:"retrait_totp_le"`
		BanniJusqu    *string `json:"banni_jusqu"`
		BanniMotif    *uint8  `json:"banni_motif"`
	}{b64.EncodeToString(et.H[:]), et.CreeLe, et.Palier, ouNull(et.ConfirmeLe),
		limites{et.Limites.Salons, et.Limites.Places, et.Limites.Heures}, et.SalonsActifs, et.TOTP, et.Banni,
		ouNull(et.RecupJusqu), ouNull(et.RetraitTOTPLe), ouNull(et.BanniJusqu), motifOuNull(et.BanniMotif)})
}

// mdp : { a_auth, env_mdp } (session récente ; autres sessions fermées).
func (a compteAPI) mdp(w http.ResponseWriter, r *http.Request) {
	c, err := a.session(r)
	if err != nil {
		failCompte(w, err)
		return
	}
	var b struct {
		AAuth  string `json:"a_auth"`
		EnvMdp string `json:"env_mdp"`
	}
	if err := lire(w, r, &b, maxJSON); err != nil {
		failCompte(w, err)
		return
	}
	aAuth, err := b32(b.AAuth)
	env, err2 := secret(b.EnvMdp, 60)
	if err != nil || err2 != nil {
		failCompte(w, errBadRequest)
		return
	}
	if err := a.c.ChangerMdp(c, aAuth, [60]byte(env)); err != nil {
		failCompte(w, err)
		return
	}
	writeJSON(w, http.StatusOK, struct{}{})
}

// emailDebut : { email_actuel, email_nouveau, langue } → { etape } (session récente).
func (a compteAPI) emailDebut(w http.ResponseWriter, r *http.Request) {
	c, err := a.session(r)
	if err != nil {
		failCompte(w, err)
		return
	}
	var b struct {
		Actuel  string `json:"email_actuel"`
		Nouveau string `json:"email_nouveau"`
		Langue  string `json:"langue"`
	}
	if err := lire(w, r, &b, maxJSON); err != nil {
		failCompte(w, err)
		return
	}
	e, err := a.c.EmailDebut(c, ipOf(r), b.Actuel, b.Nouveau, b.Langue)
	if err != nil {
		failCompte(w, err)
		return
	}
	writeJSON(w, http.StatusOK, struct {
		Etape string `json:"etape"`
	}{b64.EncodeToString(e[:])})
}

func (a compteAPI) emailRenvoyer(w http.ResponseWriter, r *http.Request) {
	c, err := a.session(r)
	if err != nil {
		failCompte(w, err)
		return
	}
	e, email, err := etapeEmail(w, r)
	if err == nil {
		err = a.c.RenvoyerEmail(c, ipOf(r), e, email)
	}
	if err != nil {
		failCompte(w, err)
		return
	}
	writeJSON(w, http.StatusOK, struct{}{})
}

// emailFin : { etape, code, a_auth, env_mdp, totp } (session récente).
func (a compteAPI) emailFin(w http.ResponseWriter, r *http.Request) {
	c, err := a.session(r)
	if err != nil {
		failCompte(w, err)
		return
	}
	var b struct {
		Etape  string  `json:"etape"`
		Code   string  `json:"code"`
		AAuth  string  `json:"a_auth"`
		EnvMdp string  `json:"env_mdp"`
		TOTP   *string `json:"totp"`
	}
	if err := lire(w, r, &b, maxJSON); err != nil || b.TOTP == nil {
		failCompte(w, errBadRequest)
		return
	}
	e, err := b32(b.Etape)
	aAuth, err2 := b32(b.AAuth)
	env, err3 := secret(b.EnvMdp, 60)
	if err != nil || err2 != nil || err3 != nil {
		failCompte(w, errBadRequest)
		return
	}
	if err := a.c.EmailFin(c, e, b.Code, aAuth, [60]byte(env), *b.TOTP); err != nil {
		failCompte(w, err)
		return
	}
	writeJSON(w, http.StatusOK, struct{}{})
}

// totpDebut : {} → { etape, secret } (session récente). Seule réponse qui contient le secret.
func (a compteAPI) totpDebut(w http.ResponseWriter, r *http.Request) {
	c, err := a.session(r)
	if err != nil {
		failCompte(w, err)
		return
	}
	var b struct{}
	if err := lire(w, r, &b, maxJSON); err != nil {
		failCompte(w, err)
		return
	}
	e, sec, err := a.c.TOTPDebut(c)
	if err != nil {
		failCompte(w, err)
		return
	}
	writeJSON(w, http.StatusOK, struct {
		Etape  string `json:"etape"`
		Secret string `json:"secret"`
	}{b64.EncodeToString(e[:]), sec})
}

func (a compteAPI) totpFin(w http.ResponseWriter, r *http.Request) {
	c, err := a.session(r)
	if err != nil {
		failCompte(w, err)
		return
	}
	e, code, err := etapeCode(w, r)
	if err == nil {
		err = a.c.TOTPFin(c, e, code)
	}
	if err != nil {
		failCompte(w, err)
		return
	}
	writeJSON(w, http.StatusOK, struct{}{})
}

// sansCorps : route de session au corps {} qui rend {} (totp/retirer, totp/annuler-retrait).
func (a compteAPI) sansCorps(f func(compte.Courante) error) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		c, err := a.session(r)
		if err != nil {
			failCompte(w, err)
			return
		}
		var b struct{}
		if err := lire(w, r, &b, maxJSON); err != nil {
			failCompte(w, err)
			return
		}
		if err := f(c); err != nil {
			failCompte(w, err)
			return
		}
		writeJSON(w, http.StatusOK, struct{}{})
	}
}

// export : GET export (§12.4) : données du serveur, sans adresse.
func (a compteAPI) export(w http.ResponseWriter, r *http.Request) {
	c, err := a.session(r)
	if err != nil {
		failCompte(w, err)
		return
	}
	x, err := a.c.Export(c)
	if err != nil {
		failCompte(w, err)
		return
	}
	type appareil struct {
		Ajoutee     string `json:"ajoutee"`
		Persistante bool   `json:"persistante"`
	}
	ss := make([]appareil, 0, len(x.Sessions))
	for _, v := range x.Sessions {
		ss = append(ss, appareil{v.Ajoutee, v.Persistante})
	}
	writeJSON(w, http.StatusOK, struct {
		CreeLe           string     `json:"cree_le"`
		AncienneteDepuis string     `json:"anciennete_depuis"`
		VuMois           string     `json:"vu_mois"`
		TOTP             bool       `json:"totp"`
		RetraitTOTPLe    *string    `json:"retrait_totp_le"`
		RecupJusqu       *string    `json:"recup_jusqu"`
		BanniJusqu       *string    `json:"banni_jusqu"`
		BanniMotif       *uint8     `json:"banni_motif"`
		SalonsActifs     int        `json:"salons_actifs"`
		Sessions         []appareil `json:"sessions"`
	}{x.CreeLe, x.AncienneteDepuis, x.VuMois, x.TOTP, ouNull(x.RetraitTOTPLe), ouNull(x.RecupJusqu),
		ouNull(x.BanniJusqu), motifOuNull(x.BanniMotif), x.SalonsActifs, ss})
}

// supprimer : {} → { salons_fermes } (session récente ; attente après une récupération).
func (a compteAPI) supprimer(w http.ResponseWriter, r *http.Request) {
	c, err := a.session(r)
	if err != nil {
		failCompte(w, err)
		return
	}
	var b struct{}
	if err := lire(w, r, &b, maxJSON); err != nil {
		failCompte(w, err)
		return
	}
	n, err := a.c.Supprimer(c)
	if err != nil {
		failCompte(w, err)
		return
	}
	writeJSON(w, http.StatusOK, struct {
		Salons int `json:"salons_fermes"`
	}{n})
}
