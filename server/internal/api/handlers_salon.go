package api

import (
	"errors"
	"net/http"
	"time"

	"github.com/skoow/shhdrop/server/internal/captcha"
	"github.com/skoow/shhdrop/server/internal/salon"
	"github.com/skoow/shhdrop/server/internal/share"
)

// Routes JSON du salon (plan C-2 Task 7, spec §39.3.3, §39.3.9) : création, meta, entrée,
// gestion. Enregistrées seulement si le gestionnaire est donné (SHH_SALONS=1) : sinon la 404
// uniforme des routes inconnues. Secrets en en-tête ou dans le corps (base64url sans
// bourrage, longueur exacte), jamais dans l'URL ; aucun identifiant de salon dans le chemin.

// limitRetry : Retry-After d'une limite du gestionnaire sans délai propre (salon.ErrLimit).
const limitRetry = 60 * time.Second

// salonAPI : gestionnaires HTTP du salon.
type salonAPI struct {
	*server
	m *salon.Manager
}

func (a salonAPI) routes(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/salons", a.creer)
	mux.HandleFunc("GET /api/salons/meta", a.meta)
	mux.HandleFunc("POST /api/salons/rejoindre", a.rejoindre)
	mux.HandleFunc("GET /api/salons/gestion", a.gestion)
}

// failSalon traduit une erreur du gestionnaire en réponse fixe ; toute autre erreur (base,
// disque) → 500 sans détail.
func failSalon(w http.ResponseWriter, err error) {
	var bp *salon.BadPassword
	var at *salon.Attente
	switch {
	case errors.As(err, &bp) && bp != nil && bp.AttemptsLeft > 0:
		writeJSON(w, http.StatusForbidden, struct {
			Error string `json:"error"`
			Left  int    `json:"attempts_left"`
		}{"bad_password", bp.AttemptsLeft})
	case errors.As(err, &bp), errors.Is(err, salon.ErrNotFound):
		// Sans essai restant : salon détruit, réponse « introuvable » uniforme.
		writeErr(w, http.StatusNotFound, "not_found")
	case errors.Is(err, salon.ErrFull):
		writeErr(w, http.StatusConflict, "full")
	case errors.Is(err, salon.ErrBudget):
		writeErr(w, http.StatusConflict, "budget")
	case errors.Is(err, salon.ErrStale):
		writeErr(w, http.StatusConflict, "stale")
	case errors.Is(err, salon.ErrExcluded):
		writeErr(w, http.StatusForbidden, "excluded")
	case errors.Is(err, salon.ErrForbidden):
		writeErr(w, http.StatusForbidden, "forbidden")
	case errors.As(err, &at) && at != nil:
		writeLimit(w, at.Retry)
	case errors.Is(err, salon.ErrLimit):
		writeLimit(w, limitRetry)
	case errors.Is(err, salon.ErrBusy):
		writeErr(w, http.StatusServiceUnavailable, "busy")
	case errors.Is(err, salon.ErrBadRequest), errors.Is(err, salon.ErrConflict), errors.Is(err, errBadRequest),
		errors.Is(err, captcha.ErrInvalid):
		writeErr(w, http.StatusBadRequest, "bad_request")
	default:
		writeErr(w, http.StatusInternalServerError, "internal")
	}
}

// creerBody : POST /api/salons. K_accès_s et S_gestion passent en en-tête (X-Shh-Access,
// X-Shh-Manage) ; le serveur en calcule access_v et manage_v. members_can_destroy est exigé
// (null ou absent → 400).
type creerBody struct {
	TTLHours          int    `json:"ttl_hours"`
	MaxMembers        int    `json:"max_members"`
	MembersCanDestroy *bool  `json:"members_can_destroy"`
	Salt              string `json:"salt"`
	KdfOps            int    `json:"kdf_ops"`
	KdfMem            int    `json:"kdf_mem"`
	ProofV            string `json:"proof_v"`
	Altcha            string `json:"altcha"`
	HP                string `json:"hp"`
	ShownAt           string `json:"shown_at"`
}

// creer : patron de create des partages : format → gel → anti-robot → quota → création →
// difficulté suivante. Une requête invalide ou un serveur gelé ne consomme ni le défi ni le
// quota. access_v ou manage_v déjà pris : 400 comme une création invalide (§29.8), compté au
// quota et dans la difficulté.
func (a salonAPI) creer(w http.ResponseWriter, r *http.Request) {
	var b creerBody
	if err := readJSON(w, r, &b); err != nil || b.MembersCanDestroy == nil {
		failSalon(w, errBadRequest)
		return
	}
	var errs [4]error
	var ka, sg []byte
	ka, errs[0] = headerSecret(r, "X-Shh-Access")
	sg, errs[1] = headerSecret(r, "X-Shh-Manage")
	req := salon.CreerReq{AccessV: share.Verifier(ka), ManageV: share.Verifier(sg), TTLHours: b.TTLHours,
		MaxMembers: b.MaxMembers, KdfOps: b.KdfOps, KdfMem: b.KdfMem, MembersCanDestroy: *b.MembersCanDestroy}
	req.Salt, errs[2] = secret(b.Salt, 16)
	req.ProofV, errs[3] = secret(b.ProofV, 32)
	if errs != [4]error{} || !req.Valide() {
		failSalon(w, errBadRequest)
		return
	}
	if a.svc.Frozen() {
		fail(w, share.ErrFrozen)
		return
	}
	ip := ipOf(r)
	if err := a.antiRobot(b.Altcha, b.ShownAt, b.HP, ip); err != nil {
		failSalon(w, err)
		return
	}
	if !a.lim.AllowSalonCreate(ip) {
		writeLimit(w, a.lim.SalonCreateRetry())
		return
	}
	left, err := a.m.Creer(req)
	if err != nil {
		if errors.Is(err, salon.ErrConflict) {
			a.cap.RecordCreate(ip)
		}
		failSalon(w, err)
		return
	}
	a.cap.RecordCreate(ip)
	writeJSON(w, http.StatusCreated, struct {
		ExpiresIn int64 `json:"expires_in_s"`
	}{secs(left)})
}

// meta : GET /api/salons/meta (X-Shh-Access). Inconnu, échu ou détruit : 404 uniforme.
func (a salonAPI) meta(w http.ResponseWriter, r *http.Request) {
	ka, err := headerSecret(r, "X-Shh-Access")
	if err != nil {
		failSalon(w, err)
		return
	}
	m, err := a.m.Meta(ka)
	if err != nil {
		failSalon(w, err)
		return
	}
	writeJSON(w, http.StatusOK, struct {
		ExpiresIn int64  `json:"expires_in_s"`
		Salt      string `json:"salt"`
		KdfOps    int    `json:"kdf_ops"`
		KdfMem    int    `json:"kdf_mem"`
	}{secs(m.ExpiresIn), b64.EncodeToString(m.Salt), m.KdfOps, m.KdfMem})
}

// rejoindre : POST /api/salons/rejoindre (X-Shh-Access, X-Shh-Manage facultatif pour le
// créateur, corps {proof}). Toute requête bien formée compte dans les entrées de l'heure
// (20 par connexion, 60 par /48), mot de passe juste ou faux.
func (a salonAPI) rejoindre(w http.ResponseWriter, r *http.Request) {
	ka, err := headerSecret(r, "X-Shh-Access")
	if err != nil {
		failSalon(w, err)
		return
	}
	var sg []byte
	if len(r.Header.Values("X-Shh-Manage")) != 0 {
		if sg, err = headerSecret(r, "X-Shh-Manage"); err != nil {
			failSalon(w, err)
			return
		}
	}
	var b struct {
		Proof string `json:"proof"`
	}
	if err := readJSON(w, r, &b); err != nil {
		failSalon(w, err)
		return
	}
	kp, err := secret(b.Proof, 32)
	if err != nil {
		failSalon(w, err)
		return
	}
	if !a.lim.AllowJoin(ipOf(r)) {
		writeLimit(w, a.lim.JoinRetry())
		return
	}
	e, err := a.m.Rejoindre(ka, kp, sg)
	if err != nil {
		failSalon(w, err)
		return
	}
	writeJSON(w, http.StatusOK, struct {
		Token             string `json:"member_token"`
		Seat              int    `json:"seat"`
		Seq               uint64 `json:"seq"`
		Nonce             string `json:"nonce_arrivee"`
		ExpiresIn         int64  `json:"expires_in_s"`
		MaxMembers        int    `json:"max_members"`
		MembersCanDestroy bool   `json:"members_can_destroy"`
		BudgetLeft        int64  `json:"budget_left"`
	}{b64.EncodeToString(e.Jeton[:]), int(e.Siege), e.Seq, b64.EncodeToString(e.Nonce[:]), secs(e.ExpiresIn),
		e.MaxMembers, e.MembersCanDestroy, e.BudgetLeft})
}

// gestion : GET /api/salons/gestion (X-Shh-Manage) ; present = sièges occupés.
func (a salonAPI) gestion(w http.ResponseWriter, r *http.Request) {
	sg, err := headerSecret(r, "X-Shh-Manage")
	if err != nil {
		failSalon(w, err)
		return
	}
	left, present, err := a.m.Gestion(sg)
	if err != nil {
		failSalon(w, err)
		return
	}
	writeJSON(w, http.StatusOK, struct {
		ExpiresIn int64 `json:"expires_in_s"`
		Present   int   `json:"present"`
	}{secs(left), present})
}
