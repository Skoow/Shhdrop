package api

// Tests offensifs des audits du 12 novembre (routes des pièces du salon), repris du
// scratchpad et changés en assertions : chacun échouait avant sa correction.

import (
	"testing"
	"time"

	"github.com/skoow/shhdrop/server/internal/share"
)

// D2 de l'audit : un vocal ne passe par aucun quota d'octets (réserve du siège) ; il se
// réécrivait sans fin (40 × 4 Mo en 204). Le total reçu par pièce est plafonné à 2 × sa
// taille : au-delà, 413 too_large (pièce à abandonner : 429 pousserait le client à réessayer
// la même requête, refusée pour toujours). Même plafond pour un fichier.
func TestAuditVocalReecritureHorsQuota(t *testing.T) {
	b := nouveauWS(t, nil)
	e := b.e
	j := b.membres(t, 1)
	c := b.entrer(t, j[0])
	lireJusqua(t, c, 0x0D)
	e.clk.Add(30 * time.Minute) // réserve vocale : 7,2 Mo ≥ 5 244 208 o
	for _, vocal := range []bool{true, false} {
		_, tok := e.pieceCreee(t, j[0], 80, vocal)
		seg := rnd(share.SegmentSize(80, 0))
		for i := range 2 { // 2 × 4 195 376 o ≤ 2 × 5 244 208 o
			if w := e.putPiece(tok, 0, seg); w.Code != 204 {
				t.Fatal(vocal, "PUT", i, w.Code, w.Body.String())
			}
		}
		for range 3 {
			expect(t, e.putPiece(tok, 0, seg), 413, `{"error":"too_large"}`)
		}
	}
}
