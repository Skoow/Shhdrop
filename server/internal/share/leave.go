package share

import (
	"database/sql"
	"errors"
)

// Suppression à la sortie (D41-28, spec §41.4, §41.8) : la personne qui détient la dernière
// ouverture permise (opens_left = 0, partage « draining ») quitte la page ; le client envoie
// « je pars » (POST /api/shares/leave, jeton de téléchargement) au pagehide. Le serveur arme
// un minuteur de LeaveDelay en mémoire seulement. Il est annulé par la page qui revient avec
// l'octroi (rechargement : MetaGrant, puis reopen ; autre onglet) ou un renouvellement d'octroi (Regrant : une
// autre page de la même ouverture vit encore). Un segment lu après le départ (téléchargement
// qui se termine en arrière-plan) repousse la destruction jusqu'à LeaveDelay sans lecture.
// À l'échéance : destruction avec grâce (retire), le même chemin que « Détruire ». Onglet
// tué sans pagehide : rien n'est armé, la purge existante s'applique.

// LeaveDelay : secondes entre « je pars » et la destruction (3 min, décision du propriétaire).
const LeaveDelay = 180

// leaveDelay : LeaveDelay, sauf dans le binaire des tests de bout en bout (étiquette e2etime,
// leave_e2etime.go), jamais livré.
var leaveDelay int64 = LeaveDelay

// Leave arme le minuteur de sortie de l'ouverture openN (venue d'un jeton signé). Sans effet
// (nil) si ce n'est pas la dernière ouverture permise, si elle est terminée ou sans octroi
// vivant : aucun oracle, aucun effet pour une ouverture non dernière. Partage disparu : nil.
func (s *Service) Leave(id string, openN int) error {
	if !validID(id) || openN < 1 || openN > maxOpenN {
		return ErrNotFound
	}
	now := s.now()
	var state string
	var issued, left int
	var doneMask int64
	err := s.DB.QueryRow(`SELECT state, opens_issued, opens_left, done_mask FROM shares
		WHERE id=? AND expires_at>? AND failed_attempts<?`, id, now, maxAttempts).Scan(&state, &issued, &left, &doneMask)
	if errors.Is(err, sql.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	if state != "draining" || left != 0 || openN != issued || doneMask&(int64(1)<<(openN-1)) != 0 {
		return nil
	}
	k := openKey{id, openN}
	s.gone.mu.Lock()
	defer s.gone.unlock()
	if s.liveGrantLocked(k) == nil || s.gone.dead[id] != nil {
		return nil
	}
	if s.gone.leaves == nil {
		s.gone.leaves = map[openKey]int64{}
	}
	s.gone.leaves[k] = now
	return nil
}

// cancelLeaveLocked : l'ouverture k sert encore (réouverture, renouvellement). Sous gone.mu.
func (s *Service) cancelLeaveLocked(k openKey) { delete(s.gone.leaves, k) }

// SweepLeaves détruit les partages dont la dernière ouverture est partie depuis LeaveDelay,
// sans réouverture ni lecture depuis. Appelé chaque seconde (janitor.Watch) ; rien à faire,
// aucune requête, tant qu'aucun départ n'est armé. Rend le nombre de partages détruits.
func (s *Service) SweepLeaves() (int, error) {
	now := s.now()
	s.gone.mu.Lock()
	var due []openKey
	for k, at := range s.gone.leaves {
		if now < at+leaveDelay {
			continue
		}
		if a := s.gone.active[k]; a != nil && (a.inflight > 0 || (a.last >= at && now-a.last < leaveDelay)) {
			continue // téléchargement en arrière-plan : attendre sa fin
		}
		due = append(due, k)
		delete(s.gone.leaves, k)
	}
	s.gone.unlock()
	n := 0
	var errs []error
	for _, k := range due {
		ok, err := s.retire(k.id, true, now)
		if err != nil {
			errs = append(errs, err)
		} else if ok {
			n++
		}
	}
	return n, errors.Join(errs...)
}

// LeaveCount : départs armés (tests).
func (s *Service) LeaveCount() int {
	s.gone.mu.Lock()
	defer s.gone.unlock()
	return len(s.gone.leaves)
}
