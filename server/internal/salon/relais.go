package salon

import (
	"errors"
	"math"
	"sort"
	"syscall"
	"time"
)

// Relais et stockage des trames (plan C-2 Task 8, « Protocole ») : chaque trame reçue prend
// le rang suivant du salon, sous son verrou. Une trame non volatile est écrite dans la
// conversation (chiffrée, sans rang, siège, heure ni drapeau en clair) et indexée en mémoire ;
// une volatile n'est ni écrite ni indexée (son rang est consommé : trou normal). La diffusion
// aux connexions en direct, rangée ou non, se fait sous ce même verrou (connexion.go).

// entree : trame non volatile rangée, 24 octets (plan, point 10 ; TestTailleEntree).
// recuMs : heure de réception du serveur (ms Unix), jamais lue dans la trame ni écrite sur
// disque. emplacement : numéro dans la conversation, ou effaceMarque une fois l'emplacement
// écrasé (retrait, règle). attendus : lecteurs attendus d'une trame des règles 1 à 3, un bit
// par siège (bitSiege ; sièges occupés à la réception, moins l'expéditeur ; plan, point 8),
// retirés à chaque lecture, départ ou reprise (effacement.go) ; 0 pour les autres règles. La
// pièce liée d'une trame est rangée à part (salon.pieces, Task 13).
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

// perimeLocked : erreur d'un membre qui ne l'est plus (membreLocked faux) : ErrExcluded pour
// un jeton révoqué par une exclusion (son siège est pourtant libéré ; relecture de l'audit du
// 12 novembre), ErrNotFound sinon (salon fini ou échu, jeton remplacé ou oublié). Appelé sous
// s.mu.
func (s *salon) perimeLocked(mb Membre, now time.Time) error {
	if !s.fini && now.Before(s.expires) {
		if _, ok := s.revoques[mb.jetonV]; ok {
			return ErrExcluded
		}
	}
	return ErrNotFound
}

// Recevoir range la trame de mb et rend son rang. En-tête invalide (taille, marque, bit
// réservé) : ErrBadRequest, aucun rang consommé. lien (facultatif, Task 13) : pièce
// « ready » de ce salon et de cet auteur, pas encore liée, pour une trame non volatile
// (pieceLiableLocked) ; elle suit ensuite la vie de la trame (retrait, règle, lectures, fin du
// salon). Trame volatile ou pièce d'un autre auteur : ErrBadRequest sans rang consommé ;
// pièce disparue, pas prête ou déjà liée : trame rangée sans lien (audit D6). Membre
// périmé : ErrNotFound ; exclu : ErrExcluded (perimeLocked, de même pour Retirer, Quitter et
// Lu). Erreur d'écriture de la conversation (ErrES, fixe) : trame non rangée,
// aucun rang consommé. L'écriture se fait sous le verrou du salon : l'ordre des emplacements
// est celui des rangs. Règles 1 à 3 (« vu par tous + délai », effacement.go) : lecteurs
// attendus rangés ; expéditeur seul : échéance rangée tout de suite (maintenant + délai).
//
// Garde-fous (Task 12), sans rang consommé ni jeton pris : trame non volatile alors que
// l'usage (partages, pièces, conversations) plus une trame dépasse StorageMax, ou usage
// illisible, ou salon qui a déjà TramesMax trames rangées (index, effacées comprises : leurs
// emplacements restent sur le disque) → ErrPlein (0x0C), avant les seaux ; seaux du siège vides (limites.go) →
// *Attente (0x0B). Les jetons sont pris avant l'écriture et rendus si Ajouter échoue :
// disque réellement plein (ENOSPC, EDQUOT) → ErrPlein ; toute autre erreur → rendue telle
// quelle (fermeture 1011). Ajouter ramène le fichier à sa taille d'avant ; si ce Truncate
// échoue, la conversation devient inutilisable (ErrInutilisable aux trames suivantes, 1011) :
// ErrPlein est rendu quand même pour cette trame, jamais écrite.
func (m *Manager) Recevoir(mb Membre, trame []byte, lien *[16]byte) (uint64, error) {
	s := mb.salon
	if s == nil {
		return 0, ErrNotFound
	}
	h, err := LireEnTete(trame)
	if err != nil || lien != nil && h.Volatile {
		return 0, ErrBadRequest
	}
	// Usage lu avant s.mu (Manager.plein) : des trames rangées en même temps dans d'autres
	// salons, ou des partages créés en même temps, peuvent dépasser StorageMax d'autant : au
	// plus une trame (4 168 o) par Recevoir simultané, environ 8 Mo pour 2 000 WebSocket.
	// Accepté (décision du 12 novembre) : la création d'un salon garde 2 Gio de marge.
	plein := !h.Volatile && m.plein(TailleEmplacement)
	s.mu.Lock()
	defer s.mu.Unlock()
	// Heure lue sous le verrou : recuMs ne décroît jamais quand seq croît (TestHeureMonotone).
	now := m.cfg.Now()
	if !s.membreLocked(mb, now) {
		return 0, s.perimeLocked(mb, now)
	}
	var p *piece // nil : trame sans lien (aucun, ou pièce disparue, pas prête, déjà liée)
	if lien != nil {
		if p, err = s.pieceLiableLocked(mb, *lien); err != nil {
			return 0, err
		}
	}
	// Plafond de trames rangées : par salon (audit D3) ET global, tous salons confondus (audit
	// adverse du 13 novembre, front serveur : sans plafond global, 200 salons pleins feraient
	// tuer le processus). 0x0C dans les deux cas ; les volatiles passent encore. Seul un
	// renouvellement (index vidé) rouvre l'écriture.
	if plein || !h.Volatile && (len(s.index) >= m.tramesMax() || s.globAtteint()) {
		return 0, ErrPlein
	}
	limite := !m.sansLimiteSiege
	if limite {
		if d := s.limites[mb.siege].prendre(now, !h.Volatile); d > 0 {
			return 0, &Attente{Retry: d}
		}
	}
	if h.Volatile {
		s.seq++
		s.relayerLocked(mb.siege, now.UnixMilli(), trame)
		return s.seq, nil
	}
	// Règles 1 à 3 : lecteurs attendus (sièges occupés, moins l'expéditeur) ; expéditeur seul :
	// personne à attendre, l'échéance part tout de suite (effacement.go).
	var attendus uint16
	_, avecDelai := delaiApresLecture(h.Regle)
	if avecDelai {
		attendus = s.attendusLocked(mb.siege)
	}
	e, err := s.conv.Ajouter(trame)
	if err != nil {
		if limite {
			s.limites[mb.siege].rendre(true) // trame non rangée : jetons rendus
		}
		if errors.Is(err, syscall.ENOSPC) || errors.Is(err, syscall.EDQUOT) {
			return 0, ErrPlein
		}
		return 0, err
	}
	s.seq++
	s.index = append(s.index, entree{seq: s.seq, emplacement: e, recuMs: now.UnixMilli(), siege: mb.siege,
		drapeaux: trame[len(marque)], attendus: attendus})
	s.globInc()
	if avecDelai && attendus == 0 {
		s.echeanceLocked(h.Regle, s.seq, now.UnixMilli())
	}
	s.relayerLocked(mb.siege, now.UnixMilli(), trame)
	if p != nil {
		s.lierLocked(p, s.seq)
	}
	return s.seq, nil
}

// Retirer écrase la trame non volatile de rang seq si mb en est l'auteur (décision du
// propriétaire, 12 novembre) : même siège et rang postérieur à l'arrivée (0x02) de
// l'occupant actuel, qu'une reprise (0x0A) ne change pas ; au siège 0, toujours le créateur,
// tout depuis la création. Une trame d'un ancien titulaire d'un siège invité n'est pas à lui.
// Toute autre trame (autre auteur, volatile, rang inconnu, déjà effacée) : ignorée sans
// erreur. Membre périmé : ErrNotFound. Effacement commun (effacerLocked), sans 0x0E : échec
// d'écriture des zéros → ErrES, la trame n'étant quand même plus servie.
func (m *Manager) Retirer(mb Membre, seq uint64) error {
	s := mb.salon
	if s == nil {
		return ErrNotFound
	}
	defer m.purger(s) // pièce liée : fichier et ligne effacés hors du verrou
	now := m.cfg.Now()
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.membreLocked(mb, now) {
		return s.perimeLocked(mb, now)
	}
	i := s.chercherLocked(seq)
	if i < 0 {
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
	return s.effacerLocked(i)
}

// Quitter : départ de mb (0x03 au journal, diffusé à la Task 9), jeton oublié, siège libéré,
// plus attendu par aucune trame des règles 1 à 3 (departLocked), puis son WebSocket, s'il en a
// un, fermé en 1000 (demande 0x03, ou POST /api/salons/signaler hors du WebSocket). Membre
// périmé : ErrNotFound ; exclu : ErrExcluded.
func (m *Manager) Quitter(mb Membre) error {
	_, err := m.quitter(mb, false)
	return err
}

// QuitterSignaler : « Quitter et signaler » (POST /api/salons/signaler, spec §39.5) : départ
// comme Quitter ; premier vaut vrai pour le premier signalement réussi de ce salon seulement
// (salon.signale), que l'appelant compte dans l'entier horaire des signalements.
func (m *Manager) QuitterSignaler(mb Membre) (premier bool, err error) {
	return m.quitter(mb, true)
}

func (m *Manager) quitter(mb Membre, signaler bool) (premier bool, err error) {
	s := mb.salon
	if s == nil {
		return false, ErrNotFound
	}
	defer m.purger(s)
	now := m.cfg.Now()
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.membreLocked(mb, now) {
		return false, s.perimeLocked(mb, now)
	}
	c := s.conns[mb.siege] // membreLocked : connexion de ce titulaire, s'il y en a une
	m.departLocked(s, mb.siege)
	if c != nil {
		c.arreter(CodeFin, nil)
	}
	if signaler && !s.signale {
		s.signale, premier = true, true
	}
	return premier, nil
}

// etatAuLocked : sièges occupés et leurs nonces au rang seq (enregistrement 0x0D), refaits
// depuis le journal (complet depuis le rang 1), par siège croissant ; nil si aucun. Appelé
// sous s.mu.
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

// ref : enregistrement à servir au rattrapage, copié sous le verrou du salon : annonce du
// journal (enr, jamais modifié une fois rangé) ou trame non volatile (lue ensuite dans la
// conversation, qui a son propre verrou).
type ref struct {
	seq         uint64
	recuMs      int64
	emplacement uint32
	siege       uint8
	enr         []byte // annonce ; nil pour une trame
}

// refsLocked : au plus max enregistrements de rang > apres, dans l'ordre seq : trames non
// volatiles non effacées et annonces du journal, fusionnées. Appelé sous s.mu.
func (s *salon) refsLocked(apres uint64, max int) []ref {
	if max <= 0 {
		return nil
	}
	i := sort.Search(len(s.index), func(k int) bool { return s.index[k].seq > apres })
	j := sort.Search(len(s.journal), func(k int) bool { return s.journal[k].seq > apres })
	var out []ref
	for len(out) < max && (i < len(s.index) || j < len(s.journal)) {
		if j == len(s.journal) || (i < len(s.index) && s.index[i].seq < s.journal[j].seq) {
			e := s.index[i]
			i++
			if !e.efface() {
				out = append(out, ref{seq: e.seq, recuMs: e.recuMs, emplacement: e.emplacement, siege: e.siege})
			}
			continue
		}
		out = append(out, ref{seq: s.journal[j].seq, enr: s.journal[j].enr})
		j++
	}
	return out
}

// lotRefs : refs et la conversation de leurs emplacements, prise sous le verrou du salon avec
// elles (un renouvellement remplace salon.conv ; reglages.go).
type lotRefs struct {
	conv *Conversation
	l    []ref
}

// lireRefs : enregistrements de refs, trames lues et déchiffrées dans conv. Avec
// efface non nil (lecture hors du verrou du salon), une trame qui ne se lit plus parce
// qu'elle a été effacée entre-temps (efface(seq)), ou parce que sa conversation a été
// détruite par un renouvellement ou une fin (ErrDetruite), est sautée. Toute autre trame illisible
// (emplacement qui ne s'authentifie plus, erreur d'entrée-sortie) arrête la lecture : les
// enregistrements d'avant sont rendus avec l'erreur (relecture Task 8 : une trame, peut-être
// un Commit MLS, n'est jamais sautée sans rien dire). Les enregistrements rendus ne doivent
// pas être modifiés.
func (s *salon) lireRefs(conv *Conversation, refs []ref, efface func(seq uint64) bool) ([][]byte, error) {
	if crochetLireRefs != nil {
		crochetLireRefs()
	}
	out := make([][]byte, 0, len(refs))
	for _, r := range refs {
		if r.enr != nil {
			out = append(out, r.enr)
			continue
		}
		trame, err := conv.Lire(r.emplacement)
		if err != nil {
			if efface != nil && (errors.Is(err, ErrEfface) || errors.Is(err, ErrDetruite)) && efface(r.seq) {
				continue
			}
			return out, err
		}
		out = append(out, EnrTrame(r.seq, r.siege, r.recuMs, trame))
	}
	return out, nil
}

// crochetLireRefs : tests seulement (panique injectée sous le verrou du salon) ; nil en
// production. Ne pas paralléliser les tests qui le modifient (t.Parallel interdit).
var crochetLireRefs func()

// effaceeDepuis : la trame de rang seq n'est plus servie (effacée, ou salon détruit).
func (s *salon) effaceeDepuis(seq uint64) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	i := sort.Search(len(s.index), func(k int) bool { return s.index[k].seq >= seq })
	return i == len(s.index) || s.index[i].seq != seq || s.index[i].efface()
}
