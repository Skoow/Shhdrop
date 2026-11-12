package api

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/skoow/shhdrop/server/internal/captcha"
	"github.com/skoow/shhdrop/server/internal/salon"
	"github.com/skoow/shhdrop/server/internal/share"
	"github.com/skoow/shhdrop/server/internal/token"
)

// Routes JSON du salon (plan C-2 Task 7, spec §39.3.3, §39.3.9) : création, meta, entrée,
// gestion. Enregistrées seulement si le gestionnaire est donné (SHH_SALONS=1) : sinon la 404
// uniforme des routes inconnues. Secrets en en-tête ou dans le corps (base64url sans
// bourrage, longueur exacte), jamais dans l'URL ; aucun identifiant de salon dans le chemin.

// salonAPI : gestionnaires HTTP du salon.
type salonAPI struct {
	*server
	m      *salon.Manager
	origin string // SHH_ORIGIN : seule origine admise pour le WebSocket
}

func (a salonAPI) routes(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/salons", a.creer)
	mux.HandleFunc("GET /api/salons/meta", a.meta)
	mux.HandleFunc("POST /api/salons/rejoindre", a.rejoindre)
	mux.HandleFunc("GET /api/salons/gestion", a.gestion)
	mux.HandleFunc("POST /api/salons/exclure", a.exclure)
	mux.HandleFunc("POST /api/salons/detruire", a.detruire)
	mux.HandleFunc("POST /api/salons/signaler", a.signaler)
	mux.HandleFunc("GET /api/salons/ws", a.salonWS)
	a.routesPieces(mux)
}

// failSalon traduit une erreur du gestionnaire en réponse fixe ; toute autre erreur (base,
// disque) → 500 sans détail. salon.ErrLimit (journal des annonces du salon saturé, seule
// source sur ces routes) est définitif pour ce salon : 409 full, sans délai. salon.ErrBusy :
// 503 busy avec le délai fixe des partages (slotRetry).
func failSalon(w http.ResponseWriter, err error) {
	var bp *salon.BadPassword
	var at *salon.Attente
	switch {
	case errors.As(err, &bp) && bp != nil && bp.AttemptsLeft > 0:
		writeJSON(w, http.StatusForbidden, struct {
			Error string `json:"error"`
			Left  int    `json:"attempts_left"`
		}{"bad_password", bp.AttemptsLeft})
	case errors.As(err, &bp), errors.Is(err, salon.ErrNotFound), errors.Is(err, token.ErrInvalid):
		// Sans essai restant : salon détruit, réponse « introuvable » uniforme. Jeton d'envoi
		// de pièce invalide ou expiré : même réponse.
		writeErr(w, http.StatusNotFound, "not_found")
	case errors.Is(err, salon.ErrFull), errors.Is(err, salon.ErrLimit):
		writeErr(w, http.StatusConflict, "full")
	case errors.Is(err, salon.ErrBudget):
		writeErr(w, http.StatusConflict, "budget")
	case errors.Is(err, salon.ErrTropEcrit):
		// Pièce trop réécrite (2 × sa taille) : 413, pas 429, car la même requête resterait
		// refusée ; le client abandonne la pièce.
		writeErr(w, http.StatusRequestEntityTooLarge, "too_large")
	case errors.Is(err, salon.ErrStale):
		writeErr(w, http.StatusConflict, "stale")
	case errors.Is(err, salon.ErrExcluded):
		writeErr(w, http.StatusForbidden, "excluded")
	case errors.Is(err, salon.ErrForbidden):
		writeErr(w, http.StatusForbidden, "forbidden")
	case errors.As(err, &at) && at != nil:
		writeLimit(w, at.Retry)
	case errors.Is(err, salon.ErrBusy):
		writeRetry(w, http.StatusServiceUnavailable, "busy", slotRetry)
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
// quota et dans la difficulté. Refus du gestionnaire sans faute du client (503 busy,
// plafond des salons vivants du bloc : 429 limit) : quota du jour rendu.
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
	ip := ipOf(r)
	req := salon.CreerReq{AccessV: share.Verifier(ka), ManageV: share.Verifier(sg), TTLHours: b.TTLHours,
		MaxMembers: b.MaxMembers, KdfOps: b.KdfOps, KdfMem: b.KdfMem, MembersCanDestroy: *b.MembersCanDestroy,
		Bloc: a.lim.CleBloc(ip)}
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
		var at *salon.Attente
		switch {
		case errors.Is(err, salon.ErrConflict):
			a.cap.RecordCreate(ip)
		case errors.Is(err, salon.ErrBusy), errors.As(err, &at):
			a.lim.RefundSalonCreate(ip)
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

// exclure : POST /api/salons/exclure (X-Shh-Manage, X-Shh-Access-New = K_accès_s' ; corps
// {seat?, nonce_arrivee?, r, proof_v, salt, kdf_ops, kdf_mem}) → {} (spec §39.13.2, plan C-2
// Task 14). X-Shh-Manage absent, mal formé ou d'aucun salon vivant (jeton de membre à sa
// place) : 403 forbidden, avant même la lecture du corps. seat et nonce_arrivee tous deux
// présents (exclusion) ou tous deux absents (rotation seule) ; siège 0 : 400 ; siège
// réattribué ou r déjà vu : 409 stale ; nouvelle K_accès_s' déjà prise : 400 (comme une
// création en conflit).
func (a salonAPI) exclure(w http.ResponseWriter, r *http.Request) {
	sg, err := headerSecret(r, "X-Shh-Manage")
	if err != nil {
		failSalon(w, salon.ErrForbidden)
		return
	}
	var b struct {
		Seat   *int    `json:"seat"`
		Nonce  *string `json:"nonce_arrivee"`
		R      *uint32 `json:"r"`
		ProofV string  `json:"proof_v"`
		Salt   string  `json:"salt"`
		KdfOps *int    `json:"kdf_ops"`
		KdfMem *int    `json:"kdf_mem"`
	}
	if err := readJSON(w, r, &b); err != nil || b.R == nil || b.KdfOps == nil || b.KdfMem == nil ||
		b.Seat != nil && (*b.Seat < 0 || *b.Seat > 255) {
		failSalon(w, errBadRequest)
		return
	}
	var errs [4]error
	var kn []byte
	kn, errs[0] = headerSecret(r, "X-Shh-Access-New")
	req := salon.ExclureReq{ManageV: share.Verifier(sg), AccessNewV: share.Verifier(kn), KdfOps: *b.KdfOps,
		KdfMem: *b.KdfMem, R: *b.R}
	req.ProofV, errs[1] = secret(b.ProofV, 32)
	req.Salt, errs[2] = secret(b.Salt, 16)
	if b.Seat != nil {
		siege := uint8(*b.Seat)
		req.Siege = &siege
	}
	if b.Nonce != nil {
		var n []byte
		if n, errs[3] = secret(*b.Nonce, 16); errs[3] == nil {
			nonce := [16]byte(n)
			req.Nonce = &nonce
		}
	}
	if errs != [4]error{} {
		failSalon(w, errBadRequest)
		return
	}
	if err := a.m.Exclure(req); err != nil {
		failSalon(w, err)
		return
	}
	writeJSON(w, http.StatusOK, struct{}{})
}

// detruire : POST /api/salons/detruire (X-Shh-Manage du créateur, ou X-Shh-Membre si
// members_can_destroy ; exactement l'un des deux ; corps {reason?: "report"}) → {} (spec
// §39.3.9, plan C-2 Task 15). Ni l'un ni l'autre, ou membre sans la permission : 403
// forbidden ; les deux, en-tête mal formé, raison autre que "report" : 400 ; salon inconnu,
// échu ou détruit, jeton inconnu : 404 ; jeton révoqué : 403 excluded. Un signalement réussi
// compte dans l'entier horaire des signalements (§9.5, sans identifiant), comme les partages.
func (a salonAPI) detruire(w http.ResponseWriter, r *http.Request) {
	var b struct {
		Reason json.RawMessage `json:"reason"` // valeur brute : null, "" ou "REPORT" refusés
	}
	if err := readJSON(w, r, &b); err != nil {
		failSalon(w, err)
		return
	}
	report := b.Reason != nil
	if report && string(b.Reason) != `"report"` {
		failSalon(w, errBadRequest)
		return
	}
	avecGestion := len(r.Header.Values("X-Shh-Manage")) != 0
	avecMembre := len(r.Header.Values("X-Shh-Membre")) != 0
	var sg, jeton []byte
	var err error
	switch {
	case avecGestion && avecMembre:
		err = errBadRequest
	case avecGestion:
		sg, err = headerSecret(r, "X-Shh-Manage")
	case avecMembre:
		jeton, err = headerSecret(r, "X-Shh-Membre")
	default:
		err = salon.ErrForbidden
	}
	if err == nil {
		err = a.m.Detruire(sg, jeton)
	}
	if err != nil {
		failSalon(w, err)
		return
	}
	if report {
		a.reports.add(a.svc.Now())
	}
	writeJSON(w, http.StatusOK, struct{}{})
}

// signaler : POST /api/salons/signaler (X-Shh-Membre, corps {}) → {} : « Quitter et signaler »
// (spec §39.5, §39.3.9). Le membre part comme par un 0x03 du WebSocket (Quitter : départ
// diffusé, jeton oublié, WebSocket fermé en 1000), puis le signalement compte dans l'entier
// horaire des signalements (§9.5, sans identifiant, le même que pour un partage) : seulement
// après un départ réussi, comme detruire. Un jeton ne signale donc qu'une fois (oublié
// aussitôt). En-tête absent ou mal formé, corps autre que {} : 400 ; jeton inconnu, salon
// échu ou détruit : 404 ; jeton révoqué : 403 excluded.
func (a salonAPI) signaler(w http.ResponseWriter, r *http.Request) {
	var b struct{}
	if err := readJSON(w, r, &b); err != nil {
		failSalon(w, err)
		return
	}
	jeton, err := headerSecret(r, "X-Shh-Membre")
	var mb salon.Membre
	if err == nil {
		mb, err = a.m.Membre(jeton)
	}
	if err == nil {
		err = a.m.Quitter(mb)
	}
	if err != nil {
		failSalon(w, err)
		return
	}
	a.reports.add(a.svc.Now())
	writeJSON(w, http.StatusOK, struct{}{})
}
