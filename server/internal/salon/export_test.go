package salon

import "github.com/skoow/shhdrop/server/internal/share"

// Aides des tests seulement (revue finale C-2, mineur g) : retirées du code de production, où
// rien ne les appelait.

// suite : au plus max enregistrements de rang > apres (refsLocked), lus sous le verrou du
// salon, comme le dernier lot du rattrapage (connexion.prochainLot), trames échues effacées
// d'abord ; une trame illisible arrête la suite avec une erreur (lireRefs).
func (s *salon) suite(apres uint64, max int) ([][]byte, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.effacerEchuesLocked(s.now().UnixMilli())
	return s.lireRefs(s.refsLocked(apres, max), nil)
}

// etatAu : etatAuLocked sous le verrou du salon.
func (s *salon) etatAu(seq uint64) []Annonce {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.etatAuLocked(seq)
}

// CreerPiece : CreerPieceID avec un identifiant tiré ici.
func (m *Manager) CreerPiece(mb Membre, bucket int, vocal bool) (string, error) {
	id := share.NewID()
	return id, m.CreerPieceID(mb, id, bucket, vocal)
}

// Taille : octets du fichier (emplacements effacés compris) ; 0 après Detruire. Une
// conversation inutilisable compte la borne haute de son fichier. Sans verrou (atomique).
func (c *Conversation) Taille() int64 { return c.taille.Load() }
