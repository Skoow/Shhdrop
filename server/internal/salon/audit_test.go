package salon

// Tests offensifs des audits du 12 novembre (serveur du salon), repris du scratchpad et
// changés en assertions : chacun échouait avant sa correction.

import (
	"bytes"
	"errors"
	"testing"
	"time"

	"github.com/skoow/shhdrop/server/internal/blob"
	"github.com/skoow/shhdrop/server/internal/share"
)

// D1 de l'audit : amplification par le bourrage. Deux segments reçus ne font plus écrire
// 123 segments d'aléa au serveur : l'aléa est borné comme celui des partages (padAllowed,
// D42-17), au plus 4 × morceaux reçus + 512, sinon ErrBadRequest (400) sans rien écrire. La
// place reste réservée dès la création (budget honnête).
func TestAuditAmplificationBourrage(t *testing.T) {
	creux(t)
	var ecrits int64
	avant := remplir
	remplir = func(_ *blob.Store, _ string, _ int64, b []byte) error { ecrits += int64(len(b)); return nil }
	t.Cleanup(func() { remplir = avant })
	b := nouveauBanc(t, 200)
	c := b.creer(t, 3)
	_, mb := b.entrerMembre(t, c, true)
	id := b.creerPiece(t, mb, 8000, false)
	der := share.SegmentCount(8000) - 1
	for _, n := range []int{0, der} {
		if err := b.m.PutSegment(id, n, make([]byte, share.SegmentSize(8000, n))); err != nil {
			t.Fatal(err)
		}
	}
	if err := b.m.FinalizePiece(id, 1, der); !errors.Is(err, ErrBadRequest) {
		t.Fatal("finalisation avec 123 segments d'aléa pour 2 reçus :", err)
	}
	if ecrits != 0 {
		t.Fatal("aléa écrit malgré le refus :", ecrits)
	}
}

// Borne exacte du bourrage (padAllowed) : palier 1 600 (25 segments de 64 morceaux), trou
// [1, 1 + t) et tous les autres segments envoyés. t = 21 : 4 segments reçus (256 morceaux),
// 4 × 256 + 512 = 1 536 ≥ 21 × 64, permis ; t = 22 : 3 reçus, 1 280 < 22 × 64, refusé.
func TestBourrageBorneExacte(t *testing.T) {
	creux(t)
	var ecrits int64
	avant := remplir
	remplir = func(_ *blob.Store, _ string, _ int64, b []byte) error { ecrits += int64(len(b)); return nil }
	t.Cleanup(func() { remplir = avant })
	b := nouveauBanc(t, 200)
	c := b.creer(t, 3)
	_, mb := b.entrerMembre(t, c, true)
	essai := func(trou int) error {
		id := b.creerPiece(t, mb, 1600, false)
		for n := range share.SegmentCount(1600) {
			if n >= 1 && n < 1+trou {
				continue
			}
			if err := b.m.PutSegment(id, n, make([]byte, share.SegmentSize(1600, n))); err != nil {
				t.Fatal(n, err)
			}
		}
		return b.m.FinalizePiece(id, 1, 1+trou)
	}
	if err := essai(22); !errors.Is(err, ErrBadRequest) || ecrits != 0 {
		t.Fatal("22 segments d'aléa pour 3 reçus :", err, ecrits)
	}
	if err := essai(21); err != nil {
		t.Fatal("21 segments d'aléa pour 4 reçus :", err)
	}
	if ecrits != 21*64*share.ChunkCT {
		t.Fatal("aléa écrit :", ecrits)
	}
}

// D2 de l'audit : un segment réécrit sans fin (vocal hors de tout quota d'octets). Le total
// reçu par pièce, réécritures comprises, est plafonné à 2 × sa taille (une reprise complète
// après coupure reste possible) : au-delà, ErrTropEcrit (413), pour un vocal comme pour un
// fichier, sans rien écrire.
func TestAuditReecriturePlafonnee(t *testing.T) {
	for _, vocal := range []bool{true, false} {
		b := nouveauBanc(t, 200)
		c := b.creer(t, 3)
		_, mb := b.entrerMembre(t, c, true)
		fin := b.connecte(t, mb)
		b.h.avancer(30 * time.Minute) // réserve vocale : 7,2 Mo ≥ 5 244 208 o
		id := b.creerPiece(t, mb, 80, vocal)
		segs := segments(80, 1)
		// 2 × 4 195 376 o ≤ 2 × 5 244 208 o : la reprise du segment 0 passe.
		for i := range 2 {
			if err := b.m.PutSegment(id, 0, segs[0]); err != nil {
				t.Fatal(vocal, i, err)
			}
		}
		if err := b.m.PutSegment(id, 0, segs[0]); !errors.Is(err, ErrTropEcrit) {
			t.Fatal(vocal, "3ᵉ écriture du segment 0 :", err)
		}
		// Le refus n'a rien compté : le segment 1 (1 048 832 o) tient encore deux fois, la
		// seconde atteignant exactement 2 × 5 244 208 o.
		for i := range 2 {
			if err := b.m.PutSegment(id, 1, segs[1]); err != nil {
				t.Fatal(vocal, i, err)
			}
		}
		if err := b.m.PutSegment(id, 1, segs[1]); !errors.Is(err, ErrTropEcrit) {
			t.Fatal(vocal, "au-delà de 2 × la taille :", err)
		}
		if err := b.m.FinalizePiece(id, 0, 0); err != nil {
			t.Fatal(vocal, err)
		}
		if got, _ := b.lire(t, mb, id, 0); !bytes.Equal(got, segs[0]) {
			t.Fatal(vocal, "contenu")
		}
		fin()
	}
}
