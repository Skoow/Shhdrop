package salon

import (
	"container/heap"
	"sort"
)

// Effacement des trames par règle et par lectures (plan C-2 Task 11, v3 §5) :
//   - « désactivé » : rien avant la fin du salon (sauf retrait) ;
//   - « 10 min », « 1 h » : échéance = heure de RÉCEPTION par le serveur (recuMs) + 600 000
//     ou 3 600 000 ms, jamais heure_ms (chiffrée, illisible) ; effacée par Tick, lue ou non,
//     sans 0x0E (chaque membre compte lui-même depuis l'heure de réception de 0x01) ;
//   - « instantané » : lecteurs attendus = sièges occupés à la réception, moins l'expéditeur
//     (bits de entree.attendus) ; chacun envoie 0x05 lu ; au dernier, la trame est effacée
//     pour tous (0x0E, expéditeur compris). Un siège qui part (Quitter, libération après
//     10 min hors ligne, exclusion à la Task 14) ou reprend (0x0A, plan point 8) n'est plus
//     attendu nulle part : effacements en chaîne, avec 0x0E.

const (
	dixMinutesMs = 600_000
	uneHeureMs   = 3_600_000
)

// echeance : trame de rang seq à effacer quand l'heure du serveur atteint ms.
type echeance struct {
	ms  int64
	seq uint64
}

// echeances : tas (la plus proche en tête), sous s.mu. Un tas et non une file : recuMs suit
// l'horloge murale, qui peut reculer (le rang, lui, croît toujours).
type echeances []echeance

func (h echeances) Len() int           { return len(h) }
func (h echeances) Less(i, j int) bool { return h[i].ms < h[j].ms }
func (h echeances) Swap(i, j int)      { h[i], h[j] = h[j], h[i] }
func (h *echeances) Push(x any)        { *h = append(*h, x.(echeance)) }
func (h *echeances) Pop() any {
	old := *h
	x := old[len(old)-1]
	*h = old[:len(old)-1]
	return x
}

// bitSiege : bit du siège n dans entree.attendus (nbSieges ≤ 16).
func bitSiege(n uint8) uint16 { return 1 << n }

// attendusLocked : sièges occupés sauf l'expéditeur. Appelé sous s.mu.
func (s *salon) attendusLocked(expediteur uint8) uint16 {
	var a uint16
	for n, x := range s.sieges {
		if x != nil && uint8(n) != expediteur {
			a |= bitSiege(uint8(n))
		}
	}
	return a
}

// chercherLocked : position de la trame de rang seq dans l'index, ou -1.
func (s *salon) chercherLocked(seq uint64) int {
	i := sort.Search(len(s.index), func(k int) bool { return s.index[k].seq >= seq })
	if i == len(s.index) || s.index[i].seq != seq {
		return -1
	}
	return i
}

// effacerLocked : effacement commun (retrait, règle, lectures) de l'entrée i : emplacement
// écrasé de zéros, entrée marquée effacée ; la pièce liée et ses flux suivront (Task 13).
// L'entrée est marquée effacée même si l'écriture des zéros échoue (erreur rendue) : la
// trame n'est plus jamais servie ; son emplacement, chiffré sous la clé du salon (en mémoire
// seulement), disparaît avec la conversation. Sans effet sur une entrée déjà effacée.
// Appelé sous s.mu.
func (s *salon) effacerLocked(i int) error {
	e := &s.index[i]
	if e.efface() {
		return nil
	}
	err := s.conv.Effacer(e.emplacement)
	e.emplacement = effaceMarque
	return err
}

// effacerLuLocked : trame « instantané » qui n'attend plus personne : effacée, puis 0x0E
// diffusé (connexions hors du direct : renvoyé au retour, diffuserLocked). Appelé sous s.mu.
func (s *salon) effacerLuLocked(i int) error {
	err := s.effacerLocked(i)
	s.diffuserLocked(EnrEfface(s.seq, s.index[i].seq), genreEfface, nil)
	return err
}

// plusAttenduLocked : le siège n n'est plus attendu par aucune trame (départ, libération,
// exclusion, reprise : au moment de l'appel, toutes les trames rangées sont d'un rang
// inférieur à l'annonce) ; celles qui n'attendaient plus que lui sont effacées (0x0E). Une
// erreur d'écriture des zéros est ignorée ici (trame quand même plus servie, effacerLocked) :
// l'annonce est déjà faite et ne peut pas échouer. Appelé sous s.mu.
func (s *salon) plusAttenduLocked(n uint8) {
	b := bitSiege(n)
	for i := range s.index {
		e := &s.index[i]
		if e.attendus&b == 0 {
			continue
		}
		e.attendus &^= b
		if e.attendus == 0 {
			_ = s.effacerLuLocked(i)
		}
	}
}

// Lu : 0x05 du siège de mb pour la trame de rang seq. Seulement une trame « instantané »
// rangée, non effacée, dont ce siège est attendu : le siège est retiré des attendus ; s'il
// était le dernier, la trame est effacée et 0x0E diffusé. Tout autre cas (expéditeur, siège
// arrivé ou repris après l'envoi, deuxième lecture, autre règle, volatile, rang inconnu) :
// ignoré sans erreur. Membre périmé : ErrNotFound. Échec d'écriture des zéros : ErrES (la
// trame n'est quand même plus servie).
func (m *Manager) Lu(mb Membre, seq uint64) error {
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
	i := s.chercherLocked(seq)
	if i < 0 {
		return nil
	}
	e := &s.index[i]
	b := bitSiege(mb.siege)
	if e.efface() || e.attendus&b == 0 {
		return nil // attendus n'est non nul que pour une trame « instantané »
	}
	e.attendus &^= b
	if e.attendus != 0 {
		return nil
	}
	return s.effacerLuLocked(i)
}

// echeanceLocked : range l'échéance d'une trame « 10 min » ou « 1 h » reçue à recuMs.
// Appelé sous s.mu.
func (s *salon) echeanceLocked(r Regle, seq uint64, recuMs int64) {
	d := int64(dixMinutesMs)
	switch r {
	case DixMinutes:
	case UneHeure:
		d = uneHeureMs
	default:
		return
	}
	heap.Push(&s.echeances, echeance{ms: recuMs + d, seq: seq})
}

// effacerEchuesLocked : efface (sans 0x0E) les trames dont l'échéance est atteinte à nowMs. Erreurs
// d'écriture ignorées (effacerLocked : trame quand même plus servie). Appelé sous s.mu.
func (s *salon) effacerEchuesLocked(nowMs int64) {
	for len(s.echeances) > 0 && s.echeances[0].ms <= nowMs {
		ech := heap.Pop(&s.echeances).(echeance)
		if i := s.chercherLocked(ech.seq); i >= 0 {
			_ = s.effacerLocked(i)
		}
	}
}
