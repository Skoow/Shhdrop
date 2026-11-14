package compte

import (
	"database/sql"
	"errors"
	"time"
)

// Suppression et effacements (conception §8.5, §12.4, §21.12, §16 durées ; décision du
// propriétaire du 14 novembre : on supprime ce dont la personne est l'auteur ou l'admin ; plan
// lot 5).

// Supprimer (session récente ; refus pendant l'attente qui suit une récupération, R4) : ferme
// d'abord les salons créés par le compte (crochet du salon, lot 6 ; un échec arrête tout, le
// compte reste et la personne peut réessayer), puis efface dans une transaction la ligne du
// compte (empreintes, vérificateur, enveloppe, séquestre, empreinte du pseudo, deux coffres,
// secret TOTP) et ses sessions ; WAL vidé ensuite. La ligne bannis de l'adresse est gardée
// jusqu'à son échéance (§13). Les partages créés sont détruits par l'appareil avant cet appel
// (§21.12) : le serveur ne sait pas lesquels viennent du compte. Rend le nombre de salons
// fermés.
func (s *Service) Supprimer(c Courante) (int, error) {
	if !c.Recente {
		return 0, ErrRecent
	}
	var recup sql.NullInt64
	if err := s.db.QueryRow(`SELECT recup_jour FROM comptes WHERE h=?`, c.H[:]).Scan(&recup); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return 0, ErrSession
		}
		return 0, err
	}
	if err := attente(recup, s.now()); err != nil {
		return 0, err
	}
	n := 0
	if s.fermerSalons != nil {
		var err error
		if n, err = s.fermerSalons(c.H); err != nil {
			return 0, err
		}
	}
	var fermees [][32]byte
	err := s.tx(func(tx *sql.Tx) error {
		var err error
		if fermees, err = fermerSessionsTx(tx, c.H, nil); err != nil {
			return err
		}
		_, err = tx.Exec(`DELETE FROM comptes WHERE h=?`, c.H[:])
		return err
	})
	if err != nil {
		return 0, err
	}
	for _, tv := range fermees {
		s.act.oublier(tv)
	}
	s.mu.Lock()
	delete(s.pas, c.H)
	for k, e := range s.et.m {
		if e.h == c.H {
			delete(s.et.m, k)
		}
	}
	s.mu.Unlock()
	s.vider()
	return n, nil
}

// moisInactif : un compte est effacé au début du 14e mois qui suit le mois de son dernier
// usage (vu_mois, au mois) : jamais avant 13 mois pleins sans connexion, au plus 14.
const moisInactif = 14

// Effacer : passe quotidienne (janitor) : comptes sans usage depuis 13 mois (et leurs
// sessions), sessions échues, bannissements échus (suspendus compris) ; WAL vidé ensuite. Rend
// le nombre de comptes effacés (aucun identifiant n'en sort).
func (s *Service) Effacer(now time.Time) (int, error) {
	seuil := time.Unix(moisDe(now), 0).UTC().AddDate(0, -moisInactif, 0).Unix()
	var n int64
	err := s.tx(func(tx *sql.Tx) error {
		if _, err := tx.Exec(`DELETE FROM sessions WHERE h IN (SELECT h FROM comptes WHERE vu_mois<=?)`, seuil); err != nil {
			return err
		}
		r, err := tx.Exec(`DELETE FROM comptes WHERE vu_mois<=?`, seuil)
		if err != nil {
			return err
		}
		n, _ = r.RowsAffected()
		if _, err := tx.Exec(`DELETE FROM sessions WHERE expire_jour<=?`, now.Unix()); err != nil {
			return err
		}
		_, err = tx.Exec(`DELETE FROM bannis WHERE jusqu_jour<=?`, jourDe(now))
		return err
	})
	if err != nil {
		return 0, err
	}
	s.vider()
	return int(n), nil
}
