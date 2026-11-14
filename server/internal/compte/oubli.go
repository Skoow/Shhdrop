package compte

import (
	"crypto/subtle"
	"database/sql"
	"errors"
	"net/netip"
	"time"
)

// Mot de passe oublié, par e-mail, sans perte du profil (conception §21.2.3, §21.2.4, R3, R4 ;
// plan lot 5).
//
//   - oubli/debut : la même réponse (une étape), les mêmes limites (3 e-mails par jour et par
//     adresse, donc 3 par heure au plus ; 10 par connexion ; renvoi après 60 s) et le même
//     travail (une lecture indexée, un HMAC du code) que l'adresse ait un compte ou non ; l'e-mail
//     ne part que si l'adresse tapée est l'adresse **exacte** du compte (e_envoi, §5.1). Sinon
//     l'étape est « fantôme » : aucun code n'y est juste.
//   - oubli/verifier : le code (15 min, 5 essais), puis, double authentification active, le
//     code de l'application (5 essais), ou « Je n'ai plus mon application » : retrait dans 7
//     jours, annulé par tout code de l'application accepté entre-temps.
//   - oubli/fin : nouveau mot de passe (v_mdp, Env_mdp), nouveau coffre privé (gen qui
//     continue) ; profil, séquestre, pseudo, adresse et ancienneté gardés ; toutes les sessions
//     fermées ; recup_jour posé (7 jours sans changement d'adresse ni suppression).

// attenteJours : durée des deux attentes de sécurité (R3, R4).
const attenteJours = 7

// DonneesOubli : ce que l'appareil envoie à oubli/fin. Ni coffre de profil ni s_profil : ils
// sont gardés (le séquestre les rend).
type DonneesOubli struct {
	AAuth     [32]byte
	EnvMdp    [60]byte
	BlobPrive []byte // coffre privé vide, gen = gen_prive + 1
}

// OubliDebut : toujours une étape (sauf adresse invalide, langue, limites, file pleine).
func (s *Service) OubliDebut(ip netip.Addr, email, langue string) ([32]byte, error) {
	a, err := adresse(email)
	if err != nil {
		return [32]byte{}, err
	}
	if !langueOK(langue) {
		return [32]byte{}, ErrRequete
	}
	now := s.now()
	canon, envoi := s.cles.Empreintes(a)
	if !s.lim.AllowCourriel(ip, canon) {
		return [32]byte{}, ErrLimit{jourSuivant(now)}
	}
	var hb, eb []byte
	err = s.db.QueryRow(`SELECT h, e_envoi FROM comptes WHERE e_canon=?`, canon[:]).Scan(&hb, &eb)
	trouve := err == nil
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return [32]byte{}, err
	}
	ref := make([]byte, 32)
	copy(ref, eb)
	egal := subtle.ConstantTimeCompare(envoi[:], ref) & boolInt(trouve && len(hb) == 16)
	e := &etape{sorte: etapeOubli, canon: canon, envoi: envoi, langue: langue, essaisTOTP: essaisCode, fantome: egal != 1}
	if egal == 1 {
		copy(e.h[:], hb)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	jeton, err := s.nouvelleEtapeLocked(e, now)
	if err != nil {
		return [32]byte{}, err
	}
	if err := s.envoyerCodeLocked(e, a.Exacte, now); err != nil {
		s.et.retirer(jeton)
		return [32]byte{}, err
	}
	return jeton, nil
}

// RenvoyerOubli : nouveau code pour une récupération (règles de Renvoyer ; étape fantôme : la
// même réponse, rien en file).
func (s *Service) RenvoyerOubli(ip netip.Addr, jeton [32]byte, email string) error {
	return s.renvoyer(ip, jeton, email, etapeOubli, nil)
}

// OubliVerifier : rend h quand l'étape est vérifiée ; totpPerdu (double authentification
// active, retrait pas encore échu) : rend seulement la date du retrait, et l'étape a servi.
func (s *Service) OubliVerifier(jeton [32]byte, code, totp string, totpPerdu bool) ([16]byte, string, error) {
	now := s.now()
	s.mu.Lock()
	defer s.mu.Unlock()
	e := s.et.trouver(jeton, etapeOubli, now)
	if e == nil {
		return [16]byte{}, "", ErrEtape
	}
	if err := s.verifierCodeLocked(jeton, e, code); err != nil {
		return [16]byte{}, "", err
	}
	var eb, scelle []byte
	var retrait sql.NullInt64
	err := s.db.QueryRow(`SELECT e_envoi, totp, totp_retrait_jour FROM comptes WHERE h=?`, e.h[:]).Scan(&eb, &scelle, &retrait)
	if e.fantome || err != nil || subtle.ConstantTimeCompare(eb, e.envoi[:]) != 1 {
		s.et.retirer(jeton)
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return [16]byte{}, "", err
		}
		return [16]byte{}, "", ErrEtape // compte supprimé ou adresse changée entre-temps
	}
	aujourdhui := jourDe(now)
	switch {
	case scelle == nil:
	case retrait.Valid && retrait.Int64 <= aujourdhui:
		e.parRetrait = true
	case totpPerdu:
		j := aujourdhui + attenteJours*jourS
		if retrait.Valid {
			j = retrait.Int64 // une nouvelle demande ne recule pas la date
		} else if _, err := s.db.Exec(`UPDATE comptes SET totp_retrait_jour=? WHERE h=? AND totp_retrait_jour IS NULL`,
			j, e.h[:]); err != nil {
			return [16]byte{}, "", err
		}
		s.et.retirer(jeton)
		return [16]byte{}, dateJour(j), nil
	case totp == "":
		return [16]byte{}, "", ErrTOTPRequis
	default:
		if err := s.verifierTOTPLocked(e.h, scelle, totp, now); err != nil {
			return [16]byte{}, "", s.totpEchoue(jeton, e, err)
		}
		if err := annulerRetrait(s.db, e.h); err != nil {
			return [16]byte{}, "", err
		}
	}
	e.verifie = true
	return e.h, "", nil
}

// OubliFin : nouveau mot de passe et coffre privé ; rend la session, s_profil et le coffre de
// profil (le coffre privé est celui que l'appareil vient d'envoyer).
func (s *Service) OubliFin(jeton [32]byte, d DonneesOubli, o OptionsSession) (Ouverture, error) {
	if !o.valide() {
		return Ouverture{}, ErrRequete
	}
	now := s.now()
	s.mu.Lock()
	defer s.mu.Unlock()
	e := s.et.trouver(jeton, etapeOubli, now)
	if e == nil || !e.verifie {
		return Ouverture{}, ErrEtape
	}
	var ov Ouverture
	var fermees [][32]byte
	err := s.tx(func(tx *sql.Tx) error {
		var eb, cp []byte
		var genPrive uint64
		var retrait sql.NullInt64
		if err := tx.QueryRow(`SELECT e_envoi, cle_profil, blob_profil, gen_profil, gen_prive, totp_retrait_jour
			FROM comptes WHERE h=?`, e.h[:]).Scan(&eb, &cp, &ov.BlobProfil, &ov.GenProfil, &genPrive, &retrait); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return ErrEtape
			}
			return err
		}
		if subtle.ConstantTimeCompare(eb, e.envoi[:]) != 1 {
			return ErrEtape
		}
		// Retrait de la double authentification : seulement s'il est toujours dû (une connexion
		// avec le code de l'application a pu l'annuler depuis oubli/verifier).
		if e.parRetrait && !(retrait.Valid && retrait.Int64 <= jourDe(now)) {
			return ErrEtape
		}
		if !coffreValide(Prive, d.BlobPrive, genPrive+1) {
			return ErrRequete
		}
		sp, err := ouvrirSequestre(&s.cles.Sequestre, e.h, [60]byte(cp))
		if err != nil {
			return err
		}
		ov.SProfil = sp
		v := hmacMdp(&s.cles.Poivre, &e.h, &d.AAuth)
		retirer := boolInt(e.parRetrait)
		if _, err := tx.Exec(`UPDATE comptes SET v_mdp=?, env_mdp=?, blob_prive=?, gen_prive=?, recup_jour=?, vu_mois=?,
			totp=CASE WHEN ?=1 THEN NULL ELSE totp END,
			totp_retrait_jour=CASE WHEN ?=1 THEN NULL ELSE totp_retrait_jour END WHERE h=?`,
			v[:], d.EnvMdp[:], d.BlobPrive, genPrive+1, jourDe(now), moisDe(now), retirer, retirer, e.h[:]); err != nil {
			return err
		}
		if fermees, err = fermerSessionsTx(tx, e.h, nil); err != nil {
			return err
		}
		ov.GenPrive = genPrive + 1
		ov.Jeton, err = s.creerSessionTx(tx, e.h, o, now)
		return err
	})
	if errors.Is(err, ErrRequete) {
		return Ouverture{}, err // l'étape reste : l'appareil peut renvoyer un coffre juste
	}
	s.et.retirer(jeton)
	if err != nil {
		return Ouverture{}, err
	}
	for _, tv := range fermees {
		s.act.oublier(tv)
	}
	s.vider()
	ov.H = e.h
	return ov, nil
}

// fermerSessionsTx : ferme les sessions du compte h, sauf sauf (nil : toutes) ; rend leurs t_v
// (activité à oublier après la transaction).
func fermerSessionsTx(tx *sql.Tx, h [16]byte, sauf *[32]byte) ([][32]byte, error) {
	rows, err := tx.Query(`SELECT t_v FROM sessions WHERE h=?`, h[:])
	if err != nil {
		return nil, err
	}
	var tvs [][32]byte
	for rows.Next() {
		var tv []byte
		if err := rows.Scan(&tv); err != nil || len(tv) != 32 {
			rows.Close()
			return nil, errors.Join(err, errors.New("compte : t_v"))
		}
		if sauf == nil || [32]byte(tv) != *sauf {
			tvs = append(tvs, [32]byte(tv))
		}
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	for _, tv := range tvs {
		if _, err := tx.Exec(`DELETE FROM sessions WHERE t_v=?`, tv[:]); err != nil {
			return nil, err
		}
	}
	return tvs, nil
}

// attente : ErrAttente pendant les 7 jours qui suivent recup_jour (R4).
func attente(recup sql.NullInt64, now time.Time) error {
	if recup.Valid {
		if j := recup.Int64 + attenteJours*jourS; jourDe(now) < j {
			return ErrAttente{dateJour(j)}
		}
	}
	return nil
}

// vider : WAL replié et ramené à zéro après un effacement (§8.2 : WAL vidé après chaque
// effacement ; secure_delete a déjà écrasé les pages libérées). Au mieux : une erreur (base
// occupée par la commande d'administration) laisse le travail au prochain point de reprise et
// à la passe quotidienne (Effacer).
func (s *Service) vider() {
	s.db.Exec(`PRAGMA wal_checkpoint(TRUNCATE)`)
}
