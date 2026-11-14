package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"

	"github.com/skoow/shhdrop/server/internal/captcha"
	"github.com/skoow/shhdrop/server/internal/compte"
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
	// comptes : service du compte (SHH_COMPTES=1) ; nil : création sans compte, comme avant le
	// compte (conception du compte §8.1).
	comptes *compte.Service
}

// errCompteRequis : création de salon sans session valable avec SHH_COMPTES=1 (401
// compte_requis).
var errCompteRequis = errors.New("compte requis")

func (a salonAPI) routes(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/salons", a.creer)
	mux.HandleFunc("GET /api/salons/meta", a.meta)
	mux.HandleFunc("POST /api/salons/rejoindre", a.rejoindre)
	mux.HandleFunc("GET /api/salons/gestion", a.gestion)
	mux.HandleFunc("POST /api/salons/reglages", a.reglages)
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
	var pd *salon.PalierDepasse
	var bn compte.ErrBanni
	switch {
	case errors.As(err, &pd) && pd != nil:
		writeJSON(w, http.StatusConflict, struct {
			Error  string `json:"error"`
			Salons int    `json:"salons"`
			Places int    `json:"places"`
			Heures int    `json:"heures"`
		}{"palier", pd.Salons, pd.Places, pd.Heures})
	case errors.As(err, &bn):
		writeJSON(w, http.StatusForbidden, struct {
			Error string `json:"error"`
			Jusqu string `json:"jusqu"`
		}{"banni", bn.Jusqu})
	case errors.Is(err, errCompteRequis), errors.Is(err, compte.ErrSession):
		// Compte supprimé entre la session et la création : même réponse que sans session.
		writeErr(w, http.StatusUnauthorized, "compte_requis")
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
	case errors.Is(err, salon.ErrOccupied):
		writeErr(w, http.StatusConflict, "occupied")
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

// creer : patron de create des partages : format → gel → (SHH_COMPTES=1 : session) →
// anti-robot → quota → création → difficulté suivante. Une requête invalide, un serveur gelé
// ou une session absente ne consomme ni le défi ni le quota. access_v ou manage_v déjà pris :
// 400 comme une création invalide (§29.8), compté au quota et dans la difficulté. Refus du
// gestionnaire sans faute du client (503 busy, plafond des salons vivants du bloc : 429
// limit) et refus du compte (409 palier, 403 banni, 401 compte_requis : compte supprimé
// entre-temps) : quota du jour rendu.
//
// SHH_COMPTES=1 (conception du compte §8.6) : X-Shh-Session exigé (sessionCreation, seule
// lecture de cet en-tête hors des routes /api/compte/*) ; la ligne du salon garde le compte.
// SHH_COMPTES=0 : l'en-tête n'est pas lu, création sans compte comme avant.
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
	if a.comptes != nil {
		c, err := sessionCreation(a.comptes, r)
		if err != nil {
			failSalon(w, errCompteRequis)
			return
		}
		req.Compte = &c.H
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
		var pd *salon.PalierDepasse
		var bn compte.ErrBanni
		switch {
		case errors.Is(err, salon.ErrConflict):
			a.cap.RecordCreate(ip)
		case errors.Is(err, salon.ErrBusy), errors.As(err, &at), errors.As(err, &pd), errors.As(err, &bn),
			errors.Is(err, compte.ErrSession):
			a.lim.RefundSalonCreate(ip)
		}
		failSalon(w, err)
		return
	}
	a.cap.RecordCreate(ip)
	a.usage.SalonCree()
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
	a.usage.EntreeSalon()
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

// errQuotaSalon : quota de création de salons atteint (reglages, renouvellement : 429 limit).
var errQuotaSalon = errors.New("quota de création de salons")

// reglages : POST /api/salons/reglages (X-Shh-Manage ; corps {max_members?, renouveler_h?,
// altcha?, hp?, shown_at?}, au moins un réglage) → {max_members, expires_in_s, depuis} (spec
// 2026-11-13, révision du 13 novembre). Corps invalide, champs de la preuve sans
// renouveler_h : 400. X-Shh-Manage : mêmes réponses fixes que gestion (absent ou mal formé
// 400, inconnu ou salon plus vivant 404). Places sous les sièges occupés : 409 occupied.
// renouveler_h (renouvellement : conversation effacée, membres gardés) compte comme une
// création de salon : gel (503 frozen), preuve anti-robot (400) et quota de AllowSalonCreate
// (429 limit jusqu'à minuit UTC), dans cet ordre, seulement une fois S_gestion et les places
// vérifiés (salon.Manager.Regler, fonction avant) : une demande refusée avant ne consomme ni
// le défi ni le quota. Quota rendu si le renouvellement échoue ensuite ; succès : difficulté
// suivante comptée (RecordCreate), comme creer.
func (a salonAPI) reglages(w http.ResponseWriter, r *http.Request) {
	var b struct {
		MaxMembers  *int   `json:"max_members"`
		RenouvelerH *int   `json:"renouveler_h"`
		Altcha      string `json:"altcha"`
		HP          string `json:"hp"`
		ShownAt     string `json:"shown_at"`
	}
	if err := readJSON(w, r, &b); err != nil {
		failSalon(w, errBadRequest)
		return
	}
	var req salon.ReglagesReq
	ok := true
	if b.MaxMembers != nil {
		req.Places = *b.MaxMembers
		ok = req.Places > 0 // 0 vaudrait « inchangé »
	}
	if b.RenouvelerH != nil {
		req.Heures = *b.RenouvelerH
		ok = ok && req.Heures > 0
	} else if b.Altcha != "" || b.HP != "" || b.ShownAt != "" {
		ok = false // preuve sans renouvellement : corps strict
	}
	if !ok || !req.Valide() {
		failSalon(w, errBadRequest)
		return
	}
	sg, err := headerSecret(r, "X-Shh-Manage")
	if err != nil {
		failSalon(w, err)
		return
	}
	ip := ipOf(r)
	pris := false
	var avant func() error
	if req.Heures != 0 {
		avant = func() error {
			if a.svc.Frozen() {
				return share.ErrFrozen
			}
			if err := a.antiRobot(b.Altcha, b.ShownAt, b.HP, ip); err != nil {
				return err
			}
			if !a.lim.AllowSalonCreate(ip) {
				return errQuotaSalon
			}
			pris = true
			return nil
		}
	}
	res, err := a.m.Regler(sg, req, avant)
	if err != nil {
		if pris {
			a.lim.RefundSalonCreate(ip) // rien de renouvelé
		}
		switch {
		case errors.Is(err, share.ErrFrozen):
			fail(w, err)
		case errors.Is(err, errQuotaSalon):
			writeLimit(w, a.lim.SalonCreateRetry())
		default:
			failSalon(w, err)
		}
		return
	}
	if pris {
		a.cap.RecordCreate(ip)
	}
	writeJSON(w, http.StatusOK, struct {
		MaxMembers int    `json:"max_members"`
		ExpiresIn  int64  `json:"expires_in_s"`
		Depuis     uint64 `json:"depuis"`
	}{res.MaxMembers, secs(res.ExpiresIn), res.Depuis})
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
// compte dans l'entier horaire des signalements (§9.5, sans identifiant), comme les partages,
// une fois par salon avec « Quitter et signaler » (salon.signale ; revue finale C-2, mineur d).
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
	var sig salon.Signalement
	if err == nil {
		if report {
			sig, err = a.m.DetruireSignaler(sg, jeton)
		} else {
			err = a.m.Detruire(sg, jeton)
		}
	}
	if err != nil {
		failSalon(w, err)
		return
	}
	if report {
		// Sans catégorie sur cette route : « Autre » (conception du compte §21.10.2 ne prévoit de
		// catégorie que pour « Quitter et signaler »).
		a.usage.SignalementSalon(salon.CategorieAutre)
	}
	a.signale(sig)
	writeJSON(w, http.StatusOK, struct{}{})
}

// signale : premier signalement d'un salon : compté dans l'entier horaire (/healthz) et, salon
// créé par un compte, ancienneté du créateur remise à zéro (conception du compte §11, D4 ; au
// mieux : le signalement est déjà fait, une erreur de comptes.db n'y change rien).
func (a salonAPI) signale(sig salon.Signalement) {
	if !sig.Premier {
		return
	}
	a.reports.add(a.svc.Now())
	if sig.Compte != nil && a.comptes != nil {
		_ = a.comptes.Signale(*sig.Compte)
	}
}

// categorieDe : catégorie d'un signalement (conception du compte §21.10.1) : absente → 10
// « Autre » (clients d'avant) ; sinon exactement un entier de 1 à 10 en JSON (null, texte,
// décimal, 0, 11 : errBadRequest).
func categorieDe(raw json.RawMessage) (uint8, error) {
	if raw == nil {
		return salon.CategorieAutre, nil
	}
	for c := uint8(1); c <= salon.NbCategories; c++ {
		if string(raw) == strconv.Itoa(int(c)) {
			return c, nil
		}
	}
	return 0, errBadRequest
}

// signaler : POST /api/salons/signaler (X-Shh-Membre, corps {} ou {"categorie": 1..10}) → {} :
// « Quitter et signaler ». Catégorie absente : 10 « Autre » ; comptée en mémoire seulement, sur
// le salon vivant et dans les compteurs d'usage (conception du compte §21.10 ; jamais sur
// disque) ; catégorie invalide : 400, aucun départ. Premier signalement d'un salon créé par un
// compte : ancienneté du créateur remise à zéro. Le reste :
// (spec §39.5, §39.3.9). Le membre part comme par un 0x03 du WebSocket (Quitter : départ
// diffusé, jeton oublié, WebSocket fermé en 1000), puis le signalement compte dans l'entier
// horaire des signalements (§9.5, sans identifiant, le même que pour un partage) : seulement
// après un départ réussi, comme detruire, et une fois par salon (salon.signale : les
// signalements suivants du même salon font partir sans compter). Un jeton ne signale donc
// qu'une fois (oublié aussitôt). En-tête absent ou mal formé, corps autre que {} : 400 ;
// jeton inconnu, salon échu ou détruit : 404 ; jeton révoqué : 403 excluded.
func (a salonAPI) signaler(w http.ResponseWriter, r *http.Request) {
	var b struct {
		Categorie json.RawMessage `json:"categorie"` // valeur brute : null, "3", 3.0 refusés
	}
	if err := readJSON(w, r, &b); err != nil {
		failSalon(w, err)
		return
	}
	cat, err := categorieDe(b.Categorie)
	if err != nil {
		failSalon(w, err)
		return
	}
	jeton, err := headerSecret(r, "X-Shh-Membre")
	var mb salon.Membre
	if err == nil {
		mb, err = a.m.Membre(jeton)
	}
	var sig salon.Signalement
	if err == nil {
		sig, err = a.m.QuitterSignaler(mb, cat)
	}
	if err != nil {
		failSalon(w, err)
		return
	}
	a.usage.SignalementSalon(cat)
	a.signale(sig)
	writeJSON(w, http.StatusOK, struct{}{})
}

// PalierDuCompte : crochet salon.Config.Palier (SHH_COMPTES=1) : limites du compte lues dans
// *svc à chaque appel (le service du compte est créé après le gestionnaire des salons, qui lui
// donne ses propres crochets : BrancherSalonsDuCompte). *svc encore nil : refus fermé.
func PalierDuCompte(svc **compte.Service) func(h [16]byte) (salon.Palier, error) {
	return func(h [16]byte) (salon.Palier, error) {
		if *svc == nil {
			return salon.Palier{}, salon.ErrBase
		}
		l, err := (*svc).Palier(h)
		return salon.Palier{Salons: l.Salons, Places: l.Places, Heures: l.Heures}, err
	}
}

// BrancherSalonsDuCompte : crochets du salon dans la configuration du compte (SHH_SALONS=1) :
// fermer, compter, lister et détruire les salons d'un compte. Salon inconnu, fini ou d'un
// autre compte : compte.ErrEtape (404 not_found).
func BrancherSalonsDuCompte(c *compte.Config, m *salon.Manager) {
	c.FermerSalons, c.SalonsActifs = m.FermerDuCompte, m.SalonsDuCompte
	c.SalonsVivants = func(h [16]byte) ([]compte.SalonVivant, error) {
		vs, err := m.SalonsVivantsDuCompte(h)
		out := make([]compte.SalonVivant, 0, len(vs))
		for _, v := range vs {
			out = append(out, compte.SalonVivant{ID: v.ID, ExpireVers: v.ExpireVers, Places: v.Places, Sieges: v.Sieges})
		}
		return out, err
	}
	c.DetruireSalon = func(h [16]byte, id string) error {
		err := m.DetruireDuCompte(h, id)
		if errors.Is(err, salon.ErrNotFound) {
			return compte.ErrEtape
		}
		return err
	}
}
