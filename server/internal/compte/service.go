package compte

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"database/sql"
	"errors"
	"fmt"
	"net/netip"
	"strings"
	"sync"
	"time"

	"github.com/skoow/shhdrop/server/internal/courriel"
	"github.com/skoow/shhdrop/server/internal/limits"
)

// Service : inscription par code e-mail, connexion, sessions, pseudo, coffres (plan du compte,
// lot 4 ; conception §8, §21). Le serveur ne reçoit jamais le mot de passe (A_auth seulement,
// tiré d'Argon2id sur l'appareil), ne garde aucune adresse sur disque (empreintes à clé), et
// ne dit jamais, avant le code juste reçu par e-mail, si une adresse a un compte.
//
// Mémoire seulement : étapes (etapes.go) et activité des sessions (sessions.go), perdues au
// redémarrage. Disque : comptes.db (base.go), dates au jour ou au mois.
type Service struct {
	db   *sql.DB
	cles Cles
	post Postier
	lim  *limits.Limiter
	now  func() time.Time
	max  int
	// cleCode : clé tirée au démarrage ; les codes e-mail en mémoire n'y sont qu'en HMAC.
	cleCode [32]byte

	mu  sync.Mutex
	et  etapes
	act activites
}

// Postier : la file d'e-mails (courriel.Envoyeur ; un faux dans les tests).
type Postier interface {
	Mettre(courriel.Message) error
}

// Config : base ouverte par OuvrirBase, sous-clés de K_serveur, file d'e-mails, limites (le
// même limiteur que l'API), horloge, SHH_COMPTES_MAX.
type Config struct {
	DB       *sql.DB
	Cles     Cles
	Courriel Postier
	Limites  *limits.Limiter
	Now      func() time.Time
	Max      int
}

// NewService : rien n'est lu ni écrit ; la clé des codes est tirée ici.
func NewService(c Config) (*Service, error) {
	if c.DB == nil || c.Courriel == nil || c.Limites == nil || c.Max < 1 {
		return nil, errors.New("compte : configuration incomplète")
	}
	if c.Now == nil {
		c.Now = time.Now
	}
	s := &Service{db: c.DB, cles: c.Cles, post: c.Courriel, lim: c.Limites, now: c.Now, max: c.Max}
	rand.Read(s.cleCode[:]) // crypto/rand ne renvoie pas d'erreur sous Linux
	s.et.m = map[[32]byte]*etape{}
	s.act.m, s.act.debut = map[[32]byte]activite{}, c.Now()
	return s, nil
}

// Erreurs fixes (conception §8.6, §21.6.2) ; l'API les traduit en codes HTTP. Aucune ne cite
// une adresse, un pseudo ni une valeur reçue.
var (
	ErrRequete       = errors.New("bad_request")
	ErrAdresse       = errors.New("adresse_invalide")
	ErrJetable       = errors.New("jetable")
	ErrIdentifiants  = errors.New("identifiants")
	ErrPreuveRequise = errors.New("preuve_requise")
	ErrTOTPRequis    = errors.New("totp_requis")
	ErrRecent        = errors.New("recent")
	ErrEtape         = errors.New("not_found")
	ErrSession       = errors.New("session")
	ErrBusy          = errors.New("busy")
	ErrDejaInscrit   = errors.New("deja_inscrit")
	ErrPseudoPris    = errors.New("pseudo_pris")
)

// ErrCodeFaux : code e-mail faux ; Restants essais (0 : l'étape est morte).
type ErrCodeFaux struct{ Restants int }

func (e ErrCodeFaux) Error() string { return "code_faux" }

// ErrLimit : limite atteinte, à réessayer après Retry.
type ErrLimit struct{ Retry time.Duration }

func (e ErrLimit) Error() string { return "limit" }

// ErrBanni : adresse bannie jusqu'au jour Jusqu (« 2029-11-14 »), dit seulement après le code
// juste (conception §21.3).
type ErrBanni struct{ Jusqu string }

func (e ErrBanni) Error() string { return "banni" }

// ErrConflit : if_gen périmé ; Gen est celui du serveur (409 conflict).
type ErrConflit struct{ Gen uint64 }

func (e ErrConflit) Error() string { return "conflict" }

// Donnees : ce que l'appareil envoie à inscription/fin (§21.6.2). Ni mot de passe, ni
// K_compte, ni clé du coffre privé (TestSequestreSeulementProfil).
type Donnees struct {
	AAuth      [32]byte
	EnvMdp     [60]byte
	SProfil    [32]byte // séquestré (exception R-D1, validée le 14 novembre)
	PCanon     []byte
	BlobProfil []byte
	BlobPrive  []byte
}

// OptionsSession : « Rester connecté » et nom d'appareil chiffré par le client (64 octets ou
// rien).
type OptionsSession struct {
	Persistante bool
	Etiquette   []byte
}

func (o OptionsSession) valide() bool { return o.Etiquette == nil || len(o.Etiquette) == 64 }

// Ouverture : réponse d'une connexion. Double authentification active : seule Etape est
// remplie (aucune session n'existe encore, lot 5).
type Ouverture struct {
	Jeton      [32]byte
	H          [16]byte
	EnvMdp     [60]byte
	SProfil    [32]byte
	BlobProfil []byte
	GenProfil  uint64
	BlobPrive  []byte
	GenPrive   uint64
	Etape      *[32]byte
}

// Dates de comptes.db : jour (minuit UTC) ou mois (premier du mois, minuit UTC).
const jourS = 86400

func jourDe(t time.Time) int64 { u := t.Unix(); return u - ((u%jourS)+jourS)%jourS }

func moisDe(t time.Time) int64 {
	t = t.UTC()
	return time.Date(t.Year(), t.Month(), 1, 0, 0, 0, 0, time.UTC).Unix()
}

func dateJour(j int64) string { return time.Unix(j, 0).UTC().Format("2006-01-02") }

// heureSuivante : délai jusqu'à l'heure UTC suivante (fenêtres des limites à l'heure).
func heureSuivante(t time.Time) time.Duration { return t.Truncate(time.Hour).Add(time.Hour).Sub(t) }

// jourSuivant : délai jusqu'au jour UTC suivant (fenêtres des limites au jour).
func jourSuivant(t time.Time) time.Duration { return time.Unix(jourDe(t)+jourS, 0).Sub(t) }

// hmacMdp : v_mdp = HMAC-SHA-256(K_poivre, h ‖ A_auth) (§5.2). Variable : les tests comptent
// ses appels (même calcul pour une adresse inconnue).
var hmacMdp = func(cle *[32]byte, h *[16]byte, a *[32]byte) [32]byte {
	m := hmac.New(sha256.New, cle[:])
	m.Write(h[:])
	m.Write(a[:])
	return [32]byte(m.Sum(nil))
}

// adresse : normalisation (§5.1) ; toute erreur de forme est adresse_invalide.
func adresse(email string) (Adresse, error) {
	a, err := Normaliser(email)
	if err != nil {
		return Adresse{}, ErrAdresse
	}
	return a, nil
}

func domaine(a Adresse) string { _, d, _ := strings.Cut(a.Canon, "@"); return d }

func langueOK(l string) bool { return l == "fr" || l == "en" }

// InscriptionDebut (§8.6, §21.3) : envoie **toujours** un code à l'adresse exacte, que
// l'adresse soit libre, prise ou bannie ; rien n'est lu dans la base qui dépende de l'adresse.
// Refus (qui ne disent rien d'une personne) : adresse invalide, jetable (ou sous-domaine d'un
// jetable), limites, plafond des comptes, file pleine. L'anti-robot est vérifié avant, par
// l'API.
func (s *Service) InscriptionDebut(ip netip.Addr, email, langue string) (h [16]byte, jeton [32]byte, err error) {
	a, err := adresse(email)
	if err != nil {
		return h, jeton, err
	}
	if !langueOK(langue) {
		return h, jeton, ErrRequete
	}
	if Jetable(domaine(a)) {
		return h, jeton, ErrJetable
	}
	now := s.now()
	if !s.lim.AllowInscription(ip) {
		return h, jeton, ErrLimit{jourSuivant(now)}
	}
	n, err := s.nComptes()
	if err != nil {
		return h, jeton, err
	}
	if n >= s.max {
		return h, jeton, ErrBusy
	}
	canon, envoi := s.cles.Empreintes(a)
	if !s.lim.AllowCourriel(ip, canon) {
		return h, jeton, ErrLimit{jourSuivant(now)}
	}
	rand.Read(h[:])
	e := &etape{sorte: etapeInscription, h: h, canon: canon, envoi: envoi, langue: langue}
	s.mu.Lock()
	defer s.mu.Unlock()
	jeton, err = s.nouvelleEtapeLocked(e, now)
	if err != nil {
		return h, jeton, err
	}
	if err := s.envoyerCodeLocked(e, a.Exacte, now); err != nil {
		s.et.retirer(jeton)
		return [16]byte{}, [32]byte{}, err
	}
	return h, jeton, nil
}

// Renvoyer : nouveau code pour une étape d'inscription, 60 s au moins après le précédent, à
// l'adresse exacte de l'étape, retapée par le client. Écart au plan (§8.6 : `{ etape }`) : le
// serveur ne garde pas l'adresse en clair le temps de l'étape (15 min), seulement e_envoi ;
// le client renvoie l'adresse, comparée à e_envoi en temps constant. L'ancien code ne vaut
// plus ; les essais repartent à 5 (le nombre d'e-mails par adresse est borné à 3 par jour).
func (s *Service) Renvoyer(ip netip.Addr, jeton [32]byte, email string) error {
	a, err := adresse(email)
	if err != nil {
		return ErrEtape
	}
	canon, envoi := s.cles.Empreintes(a)
	now := s.now()
	s.mu.Lock()
	defer s.mu.Unlock()
	e := s.et.trouver(jeton, etapeInscription, now)
	if e == nil || subtle.ConstantTimeCompare(envoi[:], e.envoi[:]) != 1 {
		return ErrEtape
	}
	if d := e.envoye.Add(attenteRenvoi).Sub(now); d > 0 {
		return ErrLimit{d}
	}
	if !s.lim.AllowCourriel(ip, canon) {
		return ErrLimit{jourSuivant(now)}
	}
	return s.envoyerCodeLocked(e, a.Exacte, now)
}

// InscriptionFin : code juste → l'état de l'adresse est dit (§21.3) : bannie (ErrBanni),
// déjà inscrite (ErrDejaInscrit), pseudo pris ou interdit (ErrPseudoPris, l'étape reste
// valable), sinon le compte et une session sont créés dans une même transaction.
func (s *Service) InscriptionFin(jeton [32]byte, code string, d Donnees, o OptionsSession) ([32]byte, error) {
	now := s.now()
	s.mu.Lock()
	defer s.mu.Unlock()
	e := s.et.trouver(jeton, etapeInscription, now)
	if e == nil {
		return [32]byte{}, ErrEtape
	}
	if err := s.verifierCodeLocked(jeton, e, code); err != nil {
		return [32]byte{}, err
	}
	if !o.valide() || !coffreValide(Profil, d.BlobProfil, 1) || !coffreValide(Prive, d.BlobPrive, 1) {
		return [32]byte{}, ErrRequete
	}
	pe, err := s.cles.EmpreintePseudo(d.PCanon)
	switch {
	case errors.Is(err, ErrPseudoCanon):
		return [32]byte{}, ErrRequete
	case err != nil:
		pe = [32]byte{} // interdit : même réponse qu'un pseudo pris, après les mêmes contrôles
	}
	cle, err := sceller(&s.cles.Sequestre, e.h, d.SProfil)
	if err != nil {
		return [32]byte{}, err
	}
	var tok [32]byte
	err = s.tx(func(tx *sql.Tx) error {
		if j, banni, err := bannieTx(tx, e.canon, now); err != nil {
			return err
		} else if banni {
			return ErrBanni{dateJour(j)}
		}
		var x int
		switch err := tx.QueryRow(`SELECT 1 FROM comptes WHERE e_canon=?`, e.canon[:]).Scan(&x); {
		case err == nil:
			return ErrDejaInscrit
		case !errors.Is(err, sql.ErrNoRows):
			return err
		}
		if pris, err := pseudoPrisTx(tx, pe); err != nil {
			return err
		} else if pris || pe == [32]byte{} {
			return ErrPseudoPris
		}
		var n int
		if err := tx.QueryRow(`SELECT count(*) FROM comptes`).Scan(&n); err != nil {
			return err
		}
		if n >= s.max {
			return ErrBusy
		}
		v := hmacMdp(&s.cles.Poivre, &e.h, &d.AAuth)
		j := jourDe(now)
		if _, err := tx.Exec(`INSERT INTO comptes(h, e_canon, e_envoi, v_mdp, env_mdp, cle_profil, p_empreinte,
			pseudo_jour, blob_profil, gen_profil, blob_prive, gen_prive, totp, totp_retrait_jour, recup_jour,
			cree_jour, compte_des, vu_mois, banni) VALUES(?,?,?,?,?,?,?,?,?,1,?,1,NULL,NULL,NULL,?,?,?,0)`,
			e.h[:], e.canon[:], e.envoi[:], v[:], d.EnvMdp[:], cle[:], pe[:], j, d.BlobProfil, d.BlobPrive,
			j, j, moisDe(now)); err != nil {
			return err
		}
		tok, err = s.creerSessionTx(tx, e.h, o, now)
		return err
	})
	if !errors.Is(err, ErrPseudoPris) && !errors.Is(err, ErrBusy) {
		s.et.retirer(jeton) // succès, adresse prise ou bannie, erreur : l'étape a servi
	}
	if err != nil {
		return [32]byte{}, err
	}
	return tok, nil
}

// ligneConnexion : ce que la connexion lit d'un compte.
type ligneConnexion struct {
	h                     [16]byte
	vMdp                  [32]byte
	envMdp                [60]byte
	cleProfil             [60]byte
	blobProfil, blobPrive []byte
	genProfil, genPrive   uint64
	totp                  bool
	vuMois                int64
}

// Connexion (§8.6, §8.7, §8.8) : adresse inconnue, mot de passe faux (compte banni compris)
// donnent la même erreur après le même calcul (un HMAC de v_mdp, sur un h nul si l'adresse est
// inconnue, comparé en temps constant). Au-delà de 5 échecs dans l'heure pour cette adresse
// (existante ou non), preuve ALTCHA exigée (preuve : vérifiée par l'API) ; jamais de
// verrouillage. Double authentification active : une étape, aucune session (lot 5). Un compte
// banni se connecte (export et suppression, §13).
func (s *Service) Connexion(ip netip.Addr, email string, aAuth [32]byte, o OptionsSession, preuve bool) (Ouverture, error) {
	a, err := adresse(email)
	if err != nil {
		return Ouverture{}, err
	}
	if !o.valide() {
		return Ouverture{}, ErrRequete
	}
	now := s.now()
	if !s.lim.AllowEchecConnexion(ip) {
		return Ouverture{}, ErrLimit{heureSuivante(now)}
	}
	canon, _ := s.cles.Empreintes(a)
	if !preuve && s.lim.PreuveRequise(canon) {
		return Ouverture{}, ErrPreuveRequise
	}
	var l ligneConnexion
	var vm, em, cp []byte
	var totp sql.NullInt64
	err = s.db.QueryRow(`SELECT h, v_mdp, env_mdp, cle_profil, blob_profil, gen_profil, blob_prive, gen_prive,
		totp IS NOT NULL, vu_mois FROM comptes WHERE e_canon=?`, canon[:]).Scan(
		(*octets16)(&l.h), &vm, &em, &cp, &l.blobProfil, &l.genProfil, &l.blobPrive, &l.genPrive, &totp, &l.vuMois)
	trouve := err == nil
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return Ouverture{}, err
	}
	if trouve {
		copy(l.vMdp[:], vm)
		copy(l.envMdp[:], em)
		copy(l.cleProfil[:], cp)
		l.totp = totp.Int64 == 1
	}
	v := hmacMdp(&s.cles.Poivre, &l.h, &aAuth)
	if subtle.ConstantTimeCompare(v[:], l.vMdp[:])&boolInt(trouve) != 1 {
		s.lim.NoterEchecConnexion(ip, canon)
		return Ouverture{}, ErrIdentifiants
	}
	if l.totp {
		e := &etape{sorte: etapeConnexionTOTP, h: l.h, options: o}
		s.mu.Lock()
		jeton, err := s.nouvelleEtapeLocked(e, now)
		s.mu.Unlock()
		if err != nil {
			return Ouverture{}, err
		}
		return Ouverture{Etape: &jeton}, nil
	}
	return s.ouvrir(l, o, now)
}

// ouvrir : séquestre ouvert, session créée, vu_mois mis à jour (une fois par mois).
func (s *Service) ouvrir(l ligneConnexion, o OptionsSession, now time.Time) (Ouverture, error) {
	sp, err := ouvrirSequestre(&s.cles.Sequestre, l.h, l.cleProfil)
	if err != nil {
		return Ouverture{}, fmt.Errorf("séquestre illisible : %w", err)
	}
	var tok [32]byte
	err = s.tx(func(tx *sql.Tx) error {
		if m := moisDe(now); l.vuMois != m {
			if _, err := tx.Exec(`UPDATE comptes SET vu_mois=? WHERE h=?`, m, l.h[:]); err != nil {
				return err
			}
		}
		var err error
		tok, err = s.creerSessionTx(tx, l.h, o, now)
		return err
	})
	if err != nil {
		return Ouverture{}, err
	}
	return Ouverture{Jeton: tok, H: l.h, EnvMdp: l.envMdp, SProfil: sp, BlobProfil: l.blobProfil,
		GenProfil: l.genProfil, BlobPrive: l.blobPrive, GenPrive: l.genPrive}, nil
}

func boolInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

// octets16 : lecture d'un BLOB de 16 octets exactement.
type octets16 [16]byte

func (o *octets16) Scan(v any) error {
	b, ok := v.([]byte)
	if !ok || len(b) != 16 {
		return errors.New("compte : BLOB(16) attendu")
	}
	copy(o[:], b)
	return nil
}

// bannieTx : un bannissement actif et non échu pour e_canon (suspendu ou échu : non) ; rend
// son échéance.
func bannieTx(tx *sql.Tx, canon [32]byte, now time.Time) (int64, bool, error) {
	var j int64
	err := tx.QueryRow(`SELECT jusqu_jour FROM bannis WHERE e_canon=? AND actif=1 AND jusqu_jour>?`,
		canon[:], jourDe(now)).Scan(&j)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, false, nil
	}
	return j, err == nil, err
}

func (s *Service) nComptes() (int, error) {
	var n int
	err := s.db.QueryRow(`SELECT count(*) FROM comptes`).Scan(&n)
	return n, err
}

// tx : f dans une transaction (validée si f ne rend pas d'erreur).
func (s *Service) tx(f func(*sql.Tx) error) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	if err := f(tx); err != nil {
		tx.Rollback()
		return err
	}
	return tx.Commit()
}

// pseudoPrisTx : un compte a déjà cette empreinte de pseudo (empreinte nulle : jamais).
func pseudoPrisTx(tx *sql.Tx, pe [32]byte) (bool, error) {
	var x int
	err := tx.QueryRow(`SELECT 1 FROM comptes WHERE p_empreinte=?`, pe[:]).Scan(&x)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	return err == nil, err
}

// pseudoLibre : p_canon libre ? Réservé ou interdit : pris (même réponse, même requête).
func (s *Service) pseudoLibre(pCanon []byte) (bool, error) {
	pe, err := s.cles.EmpreintePseudo(pCanon)
	switch {
	case errors.Is(err, ErrPseudoCanon):
		return false, ErrRequete
	case err != nil:
		pe = [32]byte{}
	}
	var pris bool
	err = s.tx(func(tx *sql.Tx) error {
		var err error
		pris, err = pseudoPrisTx(tx, pe)
		return err
	})
	return err == nil && !pris && pe != [32]byte{}, err
}

// PseudoVerifierEtape : pseudo/verifier pendant une inscription (étape vivante), 30 par heure
// et par étape (§21.5).
func (s *Service) PseudoVerifierEtape(jeton [32]byte, pCanon []byte) (bool, error) {
	if len(pCanon) == 0 {
		return false, ErrRequete
	}
	now := s.now()
	s.mu.Lock()
	e := s.et.trouver(jeton, etapeInscription, now)
	s.mu.Unlock()
	if e == nil {
		return false, ErrEtape
	}
	k := cleEtape(jeton)
	if !s.lim.AllowPseudoVerifier(k[:]) {
		return false, ErrLimit{heureSuivante(now)}
	}
	return s.pseudoLibre(pCanon)
}

// PseudoVerifier : pseudo/verifier avec une session, 30 par heure et par compte. Le pseudo du
// compte lui-même n'est pas « libre ».
func (s *Service) PseudoVerifier(c Courante, pCanon []byte) (bool, error) {
	if len(pCanon) == 0 {
		return false, ErrRequete
	}
	now := s.now()
	if !s.lim.AllowPseudoVerifier(c.H[:]) {
		return false, ErrLimit{heureSuivante(now)}
	}
	return s.pseudoLibre(pCanon)
}

// ChangerPseudo : une fois par jour UTC (le jour de l'inscription compte : « Vous pourrez
// changer de pseudo demain. ») ; l'ancien pseudo est libéré aussitôt (§21.5). Pris, réservé
// ou interdit : ErrPseudoPris. Le même pseudo que le sien : rien à faire.
func (s *Service) ChangerPseudo(c Courante, pCanon []byte) error {
	pe, err := s.cles.EmpreintePseudo(pCanon)
	switch {
	case errors.Is(err, ErrPseudoCanon):
		return ErrRequete
	case err != nil:
		pe = [32]byte{}
	}
	now := s.now()
	return s.tx(func(tx *sql.Tx) error {
		var pj int64
		var actuel []byte
		if err := tx.QueryRow(`SELECT pseudo_jour, p_empreinte FROM comptes WHERE h=?`, c.H[:]).Scan(&pj, &actuel); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return ErrSession
			}
			return err
		}
		if pj >= jourDe(now) {
			return ErrLimit{jourSuivant(now)}
		}
		if pe != [32]byte{} && subtle.ConstantTimeCompare(actuel, pe[:]) == 1 {
			return nil
		}
		if pris, err := pseudoPrisTx(tx, pe); err != nil {
			return err
		} else if pris || pe == [32]byte{} {
			return ErrPseudoPris
		}
		_, err := tx.Exec(`UPDATE comptes SET p_empreinte=?, pseudo_jour=? WHERE h=?`, pe[:], jourDe(now), c.H[:])
		return err
	})
}
