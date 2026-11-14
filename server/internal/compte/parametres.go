package compte

import (
	"crypto/subtle"
	"database/sql"
	"errors"
	"net/netip"
	"time"
)

// Paramètres du compte (conception §8.6, §12.4, §21.3, §21.6.2, R21 ; plan lot 5) : état,
// mot de passe, adresse, export. Toujours par une session ; les changements sensibles par une
// session récente (mot de passe, et code de l'application si actif, depuis moins de 5 min).

// Limites : ce qu'un palier permet (conception §11) : salons vivants à la fois, places
// (max_members, créateur compris), heures au plus.
type Limites struct{ Salons, Places, Heures int }

var (
	limitesNeuf     = Limites{Salons: 1, Places: 4, Heures: 24}
	limitesConfirme = Limites{Salons: 3, Places: 10, Heures: 24}
)

// joursPalier : un compte est « confirmé » 7 jours pleins après compte_des (§11).
const joursPalier = 7

// palier : nom, limites et, pour un compte neuf, le jour où il sera confirmé.
func palier(compteDes int64, now time.Time) (string, Limites, string) {
	j := compteDes + joursPalier*jourS
	if jourDe(now) >= j {
		return "confirme", limitesConfirme, ""
	}
	return "neuf", limitesNeuf, dateJour(j)
}

// Etat : GET /api/compte (§8.6, §21.6.2). Une chaîne vide vaut « aucune » (null en JSON) ;
// BanniMotif 0 : aucun.
type Etat struct {
	H                                     [16]byte
	CreeLe, Palier, ConfirmeLe            string
	Limites                               Limites
	SalonsActifs                          int
	TOTP, Banni                           bool
	RecupJusqu, RetraitTOTPLe, BanniJusqu string
	BanniMotif                            uint8
}

// ligneEtat : ce que l'état et l'export lisent du compte.
type ligneEtat struct {
	canon                  []byte
	cree, des, vuMois      int64
	totp                   bool
	retrait, recup         sql.NullInt64
	banniJusqu, banniMotif int64
	banni                  bool
}

func (s *Service) lireEtat(h [16]byte, now time.Time) (ligneEtat, error) {
	var l ligneEtat
	err := s.db.QueryRow(`SELECT e_canon, cree_jour, compte_des, vu_mois, totp IS NOT NULL, totp_retrait_jour, recup_jour
		FROM comptes WHERE h=?`, h[:]).Scan(&l.canon, &l.cree, &l.des, &l.vuMois, &l.totp, &l.retrait, &l.recup)
	if errors.Is(err, sql.ErrNoRows) {
		return l, ErrSession
	}
	if err != nil {
		return l, err
	}
	// Banni : un bannissement actif et non échu de l'adresse (suspendu : non).
	err = s.db.QueryRow(`SELECT jusqu_jour, motif FROM bannis WHERE e_canon=? AND actif=1 AND jusqu_jour>?`,
		l.canon, jourDe(now)).Scan(&l.banniJusqu, &l.banniMotif)
	switch {
	case err == nil:
		l.banni = true
	case !errors.Is(err, sql.ErrNoRows):
		return l, err
	}
	return l, nil
}

func dateOu(v sql.NullInt64) string {
	if !v.Valid {
		return ""
	}
	return dateJour(v.Int64)
}

func (s *Service) nSalonsActifs(h [16]byte) (int, error) {
	if s.salonsActifs == nil {
		return 0, nil
	}
	return s.salonsActifs(h)
}

// Etat : état du compte de la session.
func (s *Service) Etat(c Courante) (Etat, error) {
	now := s.now()
	l, err := s.lireEtat(c.H, now)
	if err != nil {
		return Etat{}, err
	}
	n, err := s.nSalonsActifs(c.H)
	if err != nil {
		return Etat{}, err
	}
	et := Etat{H: c.H, CreeLe: dateJour(l.cree), SalonsActifs: n, TOTP: l.totp, Banni: l.banni,
		RetraitTOTPLe: dateOu(l.retrait)}
	et.Palier, et.Limites, et.ConfirmeLe = palier(l.des, now)
	if err := attente(l.recup, now); err != nil {
		et.RecupJusqu = err.(ErrAttente).Jusqu
	}
	if l.banni {
		et.BanniJusqu, et.BanniMotif = dateJour(l.banniJusqu), uint8(l.banniMotif)
	}
	return et, nil
}

// SessionExport : un appareil, au mois, sans nom (le nom chiffré n'est lisible que par
// l'appareil, qui l'ajoute lui-même).
type SessionExport struct {
	Ajoutee     string
	Persistante bool
}

// Export : données du serveur sur ce compte (§12.4) : jours, mois, double authentification,
// appareils, salons, bannissement. Aucune adresse, empreinte, enveloppe, coffre ni séquestre :
// l'appareil y ajoute ce qu'il a déchiffré (profil, listes).
type Export struct {
	CreeLe, AncienneteDepuis, VuMois      string
	TOTP                                  bool
	RetraitTOTPLe, RecupJusqu, BanniJusqu string
	BanniMotif                            uint8
	SalonsActifs                          int
	Sessions                              []SessionExport
}

func (s *Service) Export(c Courante) (Export, error) {
	et, err := s.Etat(c)
	if err != nil {
		return Export{}, err
	}
	l, err := s.lireEtat(c.H, s.now())
	if err != nil {
		return Export{}, err
	}
	vs, err := s.Sessions(c)
	if err != nil {
		return Export{}, err
	}
	x := Export{CreeLe: et.CreeLe, AncienneteDepuis: dateJour(l.des), VuMois: time.Unix(l.vuMois, 0).UTC().Format("2006-01"),
		TOTP: et.TOTP, RetraitTOTPLe: et.RetraitTOTPLe, RecupJusqu: et.RecupJusqu, BanniJusqu: et.BanniJusqu,
		BanniMotif: et.BanniMotif, SalonsActifs: et.SalonsActifs, Sessions: []SessionExport{}}
	for _, v := range vs {
		x.Sessions = append(x.Sessions, SessionExport{v.Ajoutee, v.Persistante})
	}
	return x, nil
}

// ChangerMdp (session récente) : v_mdp et Env_mdp remplacés (K_compte et les coffres ne
// changent pas) ; toutes les autres sessions fermées. Écart signalé : §21.15.4 propose une case
// « Déconnecter mes autres appareils » ; le serveur les ferme toujours (§8.5, §8.6 : un voleur
// de session ne doit pas survivre au changement de mot de passe).
func (s *Service) ChangerMdp(c Courante, aAuth [32]byte, envMdp [60]byte) error {
	if !c.Recente {
		return ErrRecent
	}
	v := hmacMdp(&s.cles.Poivre, &c.H, &aAuth)
	var fermees [][32]byte
	err := s.tx(func(tx *sql.Tx) error {
		r, err := tx.Exec(`UPDATE comptes SET v_mdp=?, env_mdp=? WHERE h=?`, v[:], envMdp[:], c.H[:])
		if err != nil {
			return err
		}
		if n, _ := r.RowsAffected(); n != 1 {
			return ErrSession
		}
		fermees, err = fermerSessionsTx(tx, c.H, &c.tv)
		return err
	})
	for _, tv := range fermees {
		s.act.oublier(tv)
	}
	return err
}

// EmailDebut (session récente) : l'adresse actuelle doit être l'adresse exacte du compte
// (sinon identifiants, sans e-mail) ; la nouvelle : valide, non jetable (sous-domaines
// compris). Le code part à la nouvelle adresse seulement ; rien à l'ancienne (§21.3). Qu'elle
// soit prise ou bannie n'est dit qu'après le code juste (EmailFin). Refus pendant l'attente qui
// suit une récupération (R4).
func (s *Service) EmailDebut(c Courante, ip netip.Addr, actuel, nouveau, langue string) ([32]byte, error) {
	if !c.Recente {
		return [32]byte{}, ErrRecent
	}
	a, err := adresse(actuel)
	if err != nil {
		return [32]byte{}, ErrIdentifiants
	}
	n, err := adresse(nouveau)
	if err != nil {
		return [32]byte{}, err
	}
	if !langueOK(langue) {
		return [32]byte{}, ErrRequete
	}
	if Jetable(domaine(n)) {
		return [32]byte{}, ErrJetable
	}
	var eb []byte
	var recup sql.NullInt64
	if err := s.db.QueryRow(`SELECT e_envoi, recup_jour FROM comptes WHERE h=?`, c.H[:]).Scan(&eb, &recup); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return [32]byte{}, ErrSession
		}
		return [32]byte{}, err
	}
	_, envoiActuel := s.cles.Empreintes(a)
	if subtle.ConstantTimeCompare(envoiActuel[:], eb) != 1 {
		return [32]byte{}, ErrIdentifiants
	}
	now := s.now()
	if err := attente(recup, now); err != nil {
		return [32]byte{}, err
	}
	canon, envoi := s.cles.Empreintes(n)
	if !s.lim.AllowCourriel(ip, canon) {
		return [32]byte{}, ErrLimit{jourSuivant(now)}
	}
	e := &etape{sorte: etapeEmail, h: c.H, canon: canon, envoi: envoi, langue: langue, essaisTOTP: essaisCode}
	s.mu.Lock()
	defer s.mu.Unlock()
	jeton, err := s.nouvelleEtapeLocked(e, now)
	if err != nil {
		return [32]byte{}, err
	}
	if err := s.envoyerCodeLocked(e, n.Exacte, now); err != nil {
		s.et.retirer(jeton)
		return [32]byte{}, err
	}
	return jeton, nil
}

// RenvoyerEmail : nouveau code vers la nouvelle adresse (règles de Renvoyer), étape de ce
// compte seulement.
func (s *Service) RenvoyerEmail(c Courante, ip netip.Addr, jeton [32]byte, email string) error {
	return s.renvoyer(ip, jeton, email, etapeEmail, &c.H)
}

// EmailFin (session récente, étape de ce compte) : code juste, puis code de l'application si
// actif ; la nouvelle adresse bannie (ErrBanni) ou prise par un autre compte (ErrDejaInscrit) :
// rien ne change. Sinon e_canon, e_envoi, v_mdp et Env_mdp (le sel suit l'adresse : A_auth est
// recalculé par l'appareil) sont remplacés et les autres sessions fermées (le vérificateur du
// mot de passe change, comme pour ChangerMdp).
func (s *Service) EmailFin(c Courante, jeton [32]byte, code string, aAuth [32]byte, envMdp [60]byte, totp string) error {
	if !c.Recente {
		return ErrRecent
	}
	now := s.now()
	s.mu.Lock()
	defer s.mu.Unlock()
	e := s.et.trouver(jeton, etapeEmail, now)
	if e == nil || subtle.ConstantTimeCompare(e.h[:], c.H[:]) != 1 {
		return ErrEtape
	}
	var scelle []byte
	var recup sql.NullInt64
	if err := s.db.QueryRow(`SELECT totp, recup_jour FROM comptes WHERE h=?`, c.H[:]).Scan(&scelle, &recup); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return ErrSession
		}
		return err
	}
	if err := attente(recup, now); err != nil {
		return err
	}
	if err := s.verifierCodeLocked(jeton, e, code); err != nil {
		return err
	}
	if scelle != nil {
		if totp == "" {
			return ErrTOTPRequis
		}
		if err := s.verifierTOTPLocked(c.H, scelle, totp, now); err != nil {
			return s.totpEchoue(jeton, e, err)
		}
	}
	v := hmacMdp(&s.cles.Poivre, &c.H, &aAuth)
	var fermees [][32]byte
	err := s.tx(func(tx *sql.Tx) error {
		if j, banni, err := bannieTx(tx, e.canon, now); err != nil {
			return err
		} else if banni {
			return ErrBanni{dateJour(j)}
		}
		var x int
		switch err := tx.QueryRow(`SELECT 1 FROM comptes WHERE e_canon=? AND h<>?`, e.canon[:], c.H[:]).Scan(&x); {
		case err == nil:
			return ErrDejaInscrit
		case !errors.Is(err, sql.ErrNoRows):
			return err
		}
		if _, err := tx.Exec(`UPDATE comptes SET e_canon=?, e_envoi=?, v_mdp=?, env_mdp=? WHERE h=?`,
			e.canon[:], e.envoi[:], v[:], envMdp[:], c.H[:]); err != nil {
			return err
		}
		if scelle != nil {
			if err := annulerRetrait(tx, c.H); err != nil {
				return err
			}
		}
		var err error
		fermees, err = fermerSessionsTx(tx, c.H, &c.tv)
		return err
	})
	s.et.retirer(jeton) // succès, adresse prise ou bannie, erreur : l'étape a servi
	for _, tv := range fermees {
		s.act.oublier(tv)
	}
	return err
}
