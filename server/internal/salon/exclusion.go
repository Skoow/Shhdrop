package salon

import (
	"database/sql"
	"errors"

	"github.com/skoow/shhdrop/server/internal/share"
)

// Exclusion d'un participant et rotation de l'invitation (plan C-2 Task 14, spec §39.13.1,
// §39.13.1b, §39.13.2). Partie serveur seulement : la distribution de K_maître_s' aux membres
// restants est l'affaire des clients (plan, point 16).

// ExclureReq : POST /api/salons/exclure. ManageV, AccessNewV, ProofV : SHA-256 de S_gestion,
// de la nouvelle K_accès_s' (calculés par la couche HTTP depuis les secrets reçus) et de la
// nouvelle K_preuve_s'. Siege et Nonce : siège à exclure et son nonce_arrivée, tous deux
// présents ou tous deux absents (rotation seule). R : numéro de rotation, croissant.
type ExclureReq struct {
	ManageV, AccessNewV, ProofV, Salt []byte
	KdfOps, KdfMem                    int
	Siege                             *uint8
	Nonce                             *[16]byte
	R                                 uint32
}

// valide : valeurs de la spécification (comme CreerReq.Valide) ; ManageV est vérifié à part
// (ErrForbidden).
func (r ExclureReq) valide() bool {
	if (r.Siege == nil) != (r.Nonce == nil) || r.Siege != nil && (*r.Siege == 0 || *r.Siege >= nbSieges) {
		return false
	}
	return r.KdfOps == kdfOps && r.KdfMem == kdfMem && len(r.Salt) == 16 && len(r.AccessNewV) == 32 &&
		len(r.ProofV) == 32 && share.NotEmptyHash(r.AccessNewV, r.ProofV) &&
		string(r.AccessNewV) != string(r.ManageV) && string(r.ProofV) != string(r.AccessNewV) &&
		string(r.ProofV) != string(r.ManageV)
}

// crochetExclure : tests seulement (appelé entre la vérification en mémoire et la
// transaction) ; nil en production. Ne pas paralléliser les tests qui le modifient.
var crochetExclure func()

// Exclure : exclusion du siège r.Siege (et rotation de l'invitation), ou rotation seule.
//
//   - S_gestion absent, mal formé ou d'aucun salon vivant : ErrForbidden (aucun salon trouvé,
//     rien n'est révélé) ; valeurs hors de la spécification, siège 0 (on ne s'exclut pas),
//     siège sans nonce ou l'inverse : ErrBadRequest ;
//   - sous essaiLock (aucune entrée ni autre rotation en même temps) : le siège ne porte pas
//     ce nonce_arrivée (réattribué, libre) ou R ≤ dernier r : ErrStale ; rotation seule avec
//     le journal des annonces plein : ErrLimit ;
//   - une transaction remplace access_v, proof_v, salt, kdf_* et remet failed_attempts à 0,
//     sur la ligne vivante seulement (failed_attempts<10 : une ligne bloquée ne revit jamais)
//     et exactement une ligne, sinon ErrNotFound ; nouvelle access_v déjà prise (n'importe
//     quel salon, celui-ci compris) : ErrConflict ; erreur de la base : ErrBase, rien changé ;
//   - puis, sous le verrou du salon : WebSocket de l'exclu fermé (0x05 raison 5, 4002 ; il ne
//     reçoit pas le 0x09), siège libéré par sortirLocked (0x09 au journal et diffusé, siège
//     plus attendu par aucune trame « instantané » : effacements et 0x0E, jeton révoqué et
//     gardé jusqu'à la fin du salon, lectures de pièces de ce jeton coupées). Les jetons émis
//     ensuite ont un plancher de pièces (rang de leur annonce) postérieur à ce 0x09.
//
// Entre la vérification et la transaction, l'exclu peut partir de lui-même (Quitter, 10 min
// hors ligne) ou reprendre son siège par WebSocket (nonce neuf, même titulaire) ; personne
// d'autre ne peut prendre le siège (essaiLock). La rotation faite, le 0x09 est émis dans tous
// les cas : le titulaire vérifié est exclu s'il est encore là. L'annonce ne peut alors plus
// échouer (annoncerLocked avec depart : au pire une annonce de plus que la borne du journal).
func (m *Manager) Exclure(r ExclureReq) error {
	if len(r.ManageV) != 32 {
		return ErrForbidden
	}
	if !r.valide() {
		return ErrBadRequest
	}
	now := m.cfg.Now()
	var id string
	var exp int64
	var maxMembers int
	if err := m.cfg.DB.QueryRow(`SELECT id, expires_at, max_members FROM salons WHERE manage_v=? AND expires_at>?
		AND failed_attempts<?`, r.ManageV, now.Unix(), maxEssais).Scan(&id, &exp, &maxMembers); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return ErrForbidden
		}
		return base(err)
	}
	mu := m.essaiLock(id)
	mu.Lock()
	defer mu.Unlock()
	s, err := m.etat(id, exp, maxMembers)
	if err != nil {
		return err
	}
	cible, err := s.verifierExclusion(r)
	if err != nil {
		return err
	}
	if crochetExclure != nil {
		crochetExclure()
	}
	if err := m.tourner(id, r, now.Unix()); err != nil {
		return err
	}
	defer m.purger(s) // pièces des trames effacées par le départ : fichier et ligne hors du verrou
	return m.appliquerExclusion(s, r, cible)
}

// verifierExclusion : siège et nonce, r, place au journal, sous le verrou du salon ; rend le
// titulaire à exclure (nil pour une rotation seule).
func (s *salon) verifierExclusion(r ExclureReq) (*siege, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.fini {
		return nil, ErrNotFound
	}
	var cible *siege
	if r.Siege != nil {
		cible = s.sieges[*r.Siege]
		if cible == nil || cible.nonce != *r.Nonce {
			return nil, ErrStale
		}
	}
	if r.R <= s.dernierR {
		return nil, ErrStale
	}
	if cible == nil && len(s.journal) >= journalMax-nbSieges {
		return nil, ErrLimit // même borne qu'annoncerLocked pour une annonce sans départ
	}
	return cible, nil
}

// tourner : rotation de l'invitation en base, en une transaction (tout ou rien).
func (m *Manager) tourner(id string, r ExclureReq, now int64) error {
	tx, err := m.cfg.DB.Begin()
	if err != nil {
		return base(err)
	}
	defer tx.Rollback()
	var un int
	switch err := tx.QueryRow(`SELECT 1 FROM salons WHERE access_v=? OR manage_v=?`, r.AccessNewV, r.AccessNewV).
		Scan(&un); {
	case err == nil:
		return ErrConflict
	case !errors.Is(err, sql.ErrNoRows):
		return base(err)
	}
	res, err := tx.Exec(`UPDATE salons SET access_v=?, proof_v=?, salt=?, kdf_ops=?, kdf_mem=?, failed_attempts=0
		WHERE id=? AND manage_v=? AND expires_at>? AND failed_attempts<?`,
		r.AccessNewV, r.ProofV, r.Salt, r.KdfOps, r.KdfMem, id, r.ManageV, now, maxEssais)
	if err != nil {
		return base(err)
	}
	if k, err := res.RowsAffected(); err != nil || k != 1 {
		if err != nil {
			return base(err)
		}
		return ErrNotFound
	}
	return base(tx.Commit())
}

// appliquerExclusion : partie mémoire, une fois la rotation écrite (sous le verrou du salon).
func (m *Manager) appliquerExclusion(s *salon, r ExclureReq, cible *siege) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.fini {
		return ErrNotFound // détruit entre-temps : plus rien à annoncer
	}
	s.dernierR = r.R
	n, nonce := SansExclu, [16]byte{}
	if r.Siege != nil {
		n, nonce = *r.Siege, *r.Nonce
	}
	enr := func(seq uint64) []byte { return EnrExclusion(seq, n, nonce, r.R) }
	if cible == nil || s.sieges[n] != cible {
		// Rotation seule, ou exclu parti de lui-même entre-temps : 0x09 quand même (les
		// membres restants y appliquent la rotation), sans siège à libérer.
		s.annoncerLocked(enr, true)
		return nil
	}
	if c := s.conns[n]; c != nil {
		// Avant l'annonce : la connexion arrêtée ne reçoit plus rien (ni 0x09 ni 0x0E).
		c.arreter(CodeRevoque, EnrFin(s.seq, RaisonExclu))
	}
	m.sortirLocked(s, n, enr, true)
	return nil
}
