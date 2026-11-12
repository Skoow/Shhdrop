package salon

import (
	"math"
	"slices"
	"sort"
	"time"
)

// Relais et stockage des trames (plan C-2 Task 8, « Protocole ») : chaque trame reçue prend
// le rang suivant du salon, sous son verrou. Une trame non volatile est écrite dans la
// conversation (chiffrée, sans rang, siège, heure ni drapeau en clair) et indexée en mémoire ;
// une volatile n'est ni écrite ni indexée (son rang est consommé : trou normal). La diffusion
// aux connexions en direct vient à la Task 9.

// entree : trame non volatile rangée, 24 octets (plan, point 10 ; TestTailleEntree).
// recuMs : heure de réception du serveur (ms Unix), jamais lue dans la trame ni écrite sur
// disque. emplacement : numéro dans la conversation, ou effaceMarque une fois l'emplacement
// écrasé (retrait, règle). attendus : lecteurs attendus d'une trame « instantané » (sièges
// occupés à la réception, moins l'expéditeur ; plan, point 8), 0 sinon. La pièce liée d'une
// trame est rangée à part (salon.pieces, Task 13).
type entree struct {
	seq         uint64
	recuMs      int64
	emplacement uint32
	attendus    uint16
	siege       uint8
	drapeaux    uint8
}

// effaceMarque : jamais un numéro d'emplacement (Conversation.Ajouter s'arrête à
// math.MaxUint32 − 1, ErrPleine).
const effaceMarque = math.MaxUint32

func (e entree) efface() bool { return e.emplacement == effaceMarque }

// membreLocked : mb désigne toujours le titulaire actuel de son siège (même rang d'émission,
// unique dans le salon), dans un salon ni fini ni échu. Un jeton remplacé (reprise), oublié
// (départ) ou d'un salon détruit ne vaut plus rien. Appelé sous s.mu.
func (s *salon) membreLocked(mb Membre, now time.Time) bool {
	if s.fini || !now.Before(s.expires) || mb.siege >= nbSieges {
		return false
	}
	x := s.sieges[mb.siege]
	return x != nil && x.emis == mb.emis
}

// Recevoir range la trame de mb et rend son rang. En-tête invalide (taille, marque, bit
// réservé) ou pièce donnée (jusqu'à la Task 13) : ErrBadRequest, aucun rang consommé. Membre
// périmé : ErrNotFound. Erreur d'écriture de la conversation (ErrES, fixe) : trame non rangée,
// aucun rang consommé. L'écriture se fait sous le verrou du salon : l'ordre des emplacements
// est celui des rangs.
func (m *Manager) Recevoir(mb Membre, trame []byte, piece *[16]byte) (uint64, error) {
	s := mb.salon
	if s == nil {
		return 0, ErrNotFound
	}
	if piece != nil {
		return 0, ErrBadRequest
	}
	h, err := LireEnTete(trame)
	if err != nil {
		return 0, ErrBadRequest
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	// Heure lue sous le verrou : recuMs ne décroît jamais quand seq croît (TestHeureMonotone).
	now := m.cfg.Now()
	if !s.membreLocked(mb, now) {
		return 0, ErrNotFound
	}
	if h.Volatile {
		s.seq++
		return s.seq, nil
	}
	e, err := s.conv.Ajouter(trame)
	if err != nil {
		return 0, err
	}
	var attendus uint16
	if h.Regle == Instantane {
		attendus = uint16(s.occupesLocked() - 1) // l'expéditeur occupe son siège (membreLocked)
	}
	s.seq++
	s.index = append(s.index, entree{seq: s.seq, emplacement: e, recuMs: now.UnixMilli(), siege: mb.siege,
		drapeaux: trame[len(marque)], attendus: attendus})
	return s.seq, nil
}

// Retirer écrase la trame non volatile de rang seq si mb en est l'auteur (décision du
// propriétaire, 12 novembre) : même siège et rang postérieur à l'arrivée (0x02) de
// l'occupant actuel, qu'une reprise (0x0A) ne change pas ; au siège 0, toujours le créateur,
// tout depuis la création. Une trame d'un ancien titulaire d'un siège invité n'est pas à lui.
// Toute autre trame (autre auteur, volatile, rang inconnu, déjà effacée) : ignorée sans
// erreur. Membre périmé : ErrNotFound.
func (m *Manager) Retirer(mb Membre, seq uint64) error {
	s := mb.salon
	if s == nil {
		return ErrNotFound
	}
	now := m.cfg.Now()
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.membreLocked(mb, now) {
		return ErrNotFound
	}
	i := sort.Search(len(s.index), func(i int) bool { return s.index[i].seq >= seq })
	if i == len(s.index) || s.index[i].seq != seq {
		return nil
	}
	e := &s.index[i]
	var borne uint64 // siège 0 : depuis la création
	if mb.siege != 0 {
		borne = s.sieges[mb.siege].arrivee // occupé : membreLocked
	}
	if e.efface() || e.siege != mb.siege || e.seq <= borne {
		return nil
	}
	if err := s.conv.Effacer(e.emplacement); err != nil {
		return err
	}
	e.emplacement = effaceMarque
	return nil
}

// Quitter : départ de mb (0x03 au journal, diffusé à la Task 9), jeton oublié, siège libéré.
// Membre périmé : ErrNotFound.
func (m *Manager) Quitter(mb Membre) error {
	s := mb.salon
	if s == nil {
		return ErrNotFound
	}
	now := m.cfg.Now()
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.membreLocked(mb, now) {
		return ErrNotFound
	}
	m.departLocked(s, mb.siege)
	return nil
}

// etatAu : sièges occupés et leurs nonces au rang seq (enregistrement 0x0D), refaits depuis
// le journal (complet depuis le rang 1), par siège croissant ; nil si aucun.
func (s *salon) etatAu(seq uint64) []Annonce {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.etatAuLocked(seq)
}

func (s *salon) etatAuLocked(seq uint64) []Annonce {
	var occupe [nbSieges]bool
	var nonces [nbSieges][16]byte
	for _, ev := range s.journal {
		if ev.seq > seq {
			break
		}
		n := ev.enr[9]
		if n >= nbSieges {
			continue // 0x09 sans exclu (SansExclu)
		}
		switch ev.enr[0] {
		case 0x02, 0x0A:
			occupe[n] = true
			copy(nonces[n][:], ev.enr[10:26])
		case 0x03, 0x09:
			occupe[n] = false
		}
	}
	var l []Annonce
	for n := range occupe {
		if occupe[n] {
			l = append(l, Annonce{Siege: uint8(n), Nonce: nonces[n]})
		}
	}
	return l
}

// suite : au plus max enregistrements de rang > apres, dans l'ordre seq : trames non
// volatiles non effacées (lues sur disque, avec leur siège et leur heure de réception) et
// annonces du journal, fusionnées. Une trame illisible (emplacement qui ne s'authentifie
// plus, erreur de lecture) n'est pas servie. Les enregistrements rendus sont des copies.
func (s *salon) suite(apres uint64, max int) [][]byte {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.suiteLocked(apres, max)
}

func (s *salon) suiteLocked(apres uint64, max int) [][]byte {
	if max <= 0 {
		return nil
	}
	i := sort.Search(len(s.index), func(k int) bool { return s.index[k].seq > apres })
	j := sort.Search(len(s.journal), func(k int) bool { return s.journal[k].seq > apres })
	var out [][]byte
	for len(out) < max && (i < len(s.index) || j < len(s.journal)) {
		if j == len(s.journal) || (i < len(s.index) && s.index[i].seq < s.journal[j].seq) {
			e := s.index[i]
			i++
			if e.efface() {
				continue
			}
			trame, err := s.conv.Lire(e.emplacement)
			if err != nil {
				continue
			}
			out = append(out, EnrTrame(e.seq, e.siege, e.recuMs, trame))
			continue
		}
		out = append(out, slices.Clone(s.journal[j].enr))
		j++
	}
	return out
}
