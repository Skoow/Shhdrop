package salon

import (
	"container/heap"
	"slices"
	"sort"
)

// Effacement des trames par lectures puis délai (plan C-2 Task 11, v3 §5 ; règle « vu par tous
// + délai », décision du propriétaire du 13 novembre) :
//   - règle 0 « désactivé » : rien avant la fin ou le renouvellement du salon (sauf retrait) ;
//     trames de protocole (Commit, Welcome, KeyPackage, profil) et messages de fichier ;
//   - règles 1, 2, 3 (1 min, 5 min, 1 h) : lecteurs attendus = sièges occupés à la réception,
//     moins l'expéditeur (bits de entree.attendus) ; chacun envoie 0x05 lu ; un siège qui part
//     (Quitter, exclusion ; jamais pour une absence, revue finale C-2, I3 : un absent la lit à
//     son retour) ou reprend (0x0A, plan point 8) n'est plus attendu nulle part. Quand plus
//     personne n'est attendu (dernière lecture, dernier départ, ou expéditeur seul à la
//     réception), la trame entre dans le tas d'échéances à maintenant + son délai ; à
//     l'échéance (Tick, ou avant tout rattrapage), elle est effacée et 0x0E est diffusé à tous
//     (renvoyé à la reconnexion : drapeauLu). Le délai est compté depuis l'heure du serveur à
//     la dernière lecture, jamais depuis heure_ms (chiffrée, illisible).
// Le tas a au plus une échéance par entrée de l'index (posée une fois, au passage à zéro des
// attendus) ; la fin et le renouvellement du salon le vident.

// delais : délai en ms entre la dernière lecture attendue et l'effacement, par règle.
var delais = [4]int64{UneMinute: 60_000, CinqMinutes: 300_000, UneHeure: 3_600_000}

// delaiApresLecture : délai de la règle r ; ok = false pour la règle 0 (pas d'effacement).
func delaiApresLecture(r Regle) (ms int64, ok bool) {
	if r == Desactive || int(r) >= len(delais) {
		return 0, false
	}
	return delais[r], true
}

// regle : règle de la trame rangée (bits 1–2 de drapeaux).
func (e entree) regle() Regle { return Regle(e.drapeaux >> 1 & 0b11) }

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

// drapeauLu : bit 7 de entree.drapeaux, interne au serveur (les bits 3 à 7 d'une trame
// reçue sont nuls, LireEnTete) : trame effacée à son échéance après lecture par tous (règles 1
// à 3), dont le 0x0E est renvoyé à l'accueil d'une reconnexion (inscrire). Jamais posé pour un
// retrait.
const drapeauLu uint8 = 0x80

// marquerLocked : entrée i marquée effacée (plus jamais servie, plus aucun lecteur attendu),
// sa pièce liée aussi (flux coupés, fichier et ligne effacés ensuite par purger) ; rend son
// ancien emplacement à écraser (ok = false si déjà effacée). Appelé sous s.mu.
func (s *salon) marquerLocked(i int) (emplacement uint32, ok bool) {
	e := &s.index[i]
	e.attendus = 0
	if e.efface() {
		return 0, false
	}
	emplacement, e.emplacement = e.emplacement, effaceMarque
	s.pieceDeTrameLocked(e.seq) // la pièce liée suit sa trame (pieces.go)
	return emplacement, true
}

// effacerLocked : effacement d'un retrait de l'entrée i : entrée
// marquée effacée (sa pièce liée aussi, marquerLocked), emplacement écrasé de zéros. L'entrée est marquée effacée même si l'écriture des zéros échoue (erreur rendue) : la
// trame n'est plus jamais servie ; son emplacement, chiffré sous la clé du salon (en mémoire
// seulement), disparaît avec la conversation. Sans effet sur une entrée déjà effacée.
// Appelé sous s.mu.
func (s *salon) effacerLocked(i int) error {
	emplacement, ok := s.marquerLocked(i)
	if !ok {
		return nil
	}
	return s.conv.Effacer(emplacement)
}

// plusAttenduLocked : le siège n n'est plus attendu par aucune trame (départ, exclusion,
// reprise : au moment de l'appel, toutes les trames rangées sont d'un rang inférieur à
// l'annonce) ; celles qui n'attendaient plus que lui entrent dans le tas d'échéances (délai
// de leur règle à partir de maintenant). Ne peut pas échouer. Appelé sous s.mu.
func (s *salon) plusAttenduLocked(n uint8) {
	b := bitSiege(n)
	nowMs := s.now().UnixMilli()
	for i := range s.index {
		e := &s.index[i]
		if e.efface() || e.attendus&b == 0 {
			continue
		}
		if e.attendus &^= b; e.attendus == 0 {
			s.echeanceLocked(e.regle(), e.seq, nowMs)
		}
	}
}

// effacesLusLocked : cibles des 0x0E des trames effacées après lecture par tous (drapeauLu)
// de rang dans (borne, point] : celles qu'une connexion qui se reconnecte a pu recevoir avant
// sa coupure (le rattrapage commence après point). borne : siege.borneEffaces (jamais
// plancher, borne des pièces). Appelé sous s.mu.
func (s *salon) effacesLusLocked(borne, point uint64) []uint64 {
	var out []uint64
	i := sort.Search(len(s.index), func(k int) bool { return s.index[k].seq > borne })
	for ; i < len(s.index) && s.index[i].seq <= point; i++ {
		if e := s.index[i]; e.efface() && e.drapeaux&drapeauLu != 0 {
			out = append(out, e.seq)
		}
	}
	return out
}

// Lu : 0x05 du siège de mb pour la trame de rang seq. Seulement une trame des règles 1 à 3
// rangée, non effacée, dont ce siège est attendu : le siège est retiré des attendus ; s'il
// était le dernier, la trame entre dans le tas d'échéances (maintenant + délai de sa règle).
// Tout autre cas (expéditeur, siège arrivé ou repris après l'envoi, deuxième lecture, règle 0,
// volatile, rang inconnu) : ignoré sans erreur. Membre périmé : ErrNotFound.
func (m *Manager) Lu(mb Membre, seq uint64) error {
	s := mb.salon
	if s == nil {
		return ErrNotFound
	}
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
	b := bitSiege(mb.siege)
	if e.efface() || e.attendus&b == 0 {
		return nil // attendus n'est non nul que pour les règles 1 à 3
	}
	if e.attendus &^= b; e.attendus == 0 {
		s.echeanceLocked(e.regle(), e.seq, now.UnixMilli())
	}
	return nil
}

// echeanceLocked : la trame de rang seq, de règle r, n'attend plus personne depuis nowMs :
// échéance rangée à nowMs + délai de r (rien pour la règle 0). Appelé sous s.mu.
func (s *salon) echeanceLocked(r Regle, seq uint64, nowMs int64) {
	if d, ok := delaiApresLecture(r); ok {
		heap.Push(&s.echeances, echeance{ms: nowMs + d, seq: seq})
	}
}

// effacerEchuesLocked : efface en un lot les trames dont l'échéance est atteinte à nowMs
// (drapeauLu : 0x0E renvoyé à une reconnexion), puis diffuse un 0x0E par trame. Appelé par
// Tick, et avant tout rattrapage (etapeLocked, suite) : une trame échue n'est jamais servie,
// même entre deux Tick. Erreurs d'écriture ignorées (marquerLocked : trames quand même plus
// servies). Appelé sous s.mu.
func (s *salon) effacerEchuesLocked(nowMs int64) {
	var emplacements []uint32
	var cibles []uint64
	for len(s.echeances) > 0 && s.echeances[0].ms <= nowMs {
		ech := heap.Pop(&s.echeances).(echeance)
		i := s.chercherLocked(ech.seq)
		if i < 0 {
			continue
		}
		if emplacement, ok := s.marquerLocked(i); ok { // déjà effacée (retrait) : aucun 0x0E
			s.index[i].drapeaux |= drapeauLu
			emplacements = append(emplacements, emplacement)
			cibles = append(cibles, ech.seq)
		}
	}
	if len(cibles) == 0 {
		return
	}
	_ = s.conv.EffacerPlusieurs(emplacements)
	slices.Sort(cibles) // même échéance : le tas ne garde pas l'ordre ; 0x0E dans l'ordre des rangs
	for _, cible := range cibles {
		s.diffuserLocked(EnrEfface(s.seq, cible), genreEfface, nil)
	}
}
