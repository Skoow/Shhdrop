package compte

import (
	"bytes"
	"errors"
	"testing"
	"time"
)

// §21.6.2 : deux coffres, if_gen séparés, 60 écritures par heure pour les deux ensemble ;
// forme vérifiée (palier exact, en-tête de la bonne sorte, gen = if_gen + 1).
func TestDeuxCoffresIndependants(t *testing.T) {
	b := nouveauBanc(t)
	_, j, d := b.inscrire(t, ipA, "lea@exemple.fr", "lea")
	c, err := b.s.Session(j)
	if err != nil {
		t.Fatal(err)
	}
	for _, x := range []struct {
		sorte Coffre
		blob  []byte
	}{{Profil, d.BlobProfil}, {Prive, d.BlobPrive}} {
		blob, gen, err := b.s.LireCoffre(c, x.sorte)
		if err != nil || gen != 1 || !bytes.Equal(blob, x.blob) {
			t.Fatal(x.sorte, gen, err)
		}
	}
	p2 := coffreTest("SHH-PROF1", 2, 16384)
	if gen, err := b.s.EcrireCoffre(c, Profil, 1, p2); err != nil || gen != 2 {
		t.Fatal(gen, err)
	}
	if blob, gen, _ := b.s.LireCoffre(c, Profil); gen != 2 || !bytes.Equal(blob, p2) {
		t.Fatal("profil non écrit")
	}
	if blob, gen, _ := b.s.LireCoffre(c, Prive); gen != 1 || !bytes.Equal(blob, d.BlobPrive) {
		t.Fatal("privé touché")
	}
	var cf ErrConflit
	if _, err := b.s.EcrireCoffre(c, Profil, 1, p2); !errors.As(err, &cf) || cf.Gen != 2 {
		t.Fatal("if_gen périmé :", err)
	}
	if _, err := b.s.EcrireCoffre(c, Prive, 5, coffreTest("SHH-ACCT1", 6, 4096)); !errors.As(err, &cf) || cf.Gen != 1 {
		t.Fatal("if_gen en avance :", err)
	}
	for i, blob := range [][]byte{
		coffreTest("SHH-PROF1", 2, 4096),        // mauvaise sorte
		coffreTest("SHH-ACCT1", 3, 4096),        // gen ≠ if_gen + 1
		coffreTest("SHH-ACCT1", 2, 4096)[:4000], // hors palier
		coffreTest("SHH-ACCT1", 2, 524288),      // au-delà de 256 Kio
	} {
		if _, err := b.s.EcrireCoffre(c, Prive, 1, blob); !errors.Is(err, ErrRequete) {
			t.Fatal(i, err)
		}
	}
	// 60 écritures par heure, les deux coffres ensemble (les refus de forme ne comptent pas ;
	// les deux conflits ci-dessus comptent, comme toute écriture tentée).
	gp, gv := uint64(2), uint64(1)
	n := 2 + 1 // profil écrit + deux conflits
	for ; n < 60; n++ {
		var err error
		if n%2 == 0 {
			gp, err = b.s.EcrireCoffre(c, Profil, gp, coffreTest("SHH-PROF1", gp+1, 4096))
		} else {
			gv, err = b.s.EcrireCoffre(c, Prive, gv, coffreTest("SHH-ACCT1", gv+1, 4096))
		}
		if err != nil {
			t.Fatal(n, err)
		}
	}
	var lim ErrLimit
	if _, err := b.s.EcrireCoffre(c, Prive, gv, coffreTest("SHH-ACCT1", gv+1, 4096)); !errors.As(err, &lim) {
		t.Fatal("61e écriture :", err)
	}
	b.clk.Add(time.Hour)
	c, _ = b.s.Session(j)
	if _, err := b.s.EcrireCoffre(c, Prive, gv, coffreTest("SHH-ACCT1", gv+1, 4096)); err != nil {
		t.Fatal("heure suivante :", err)
	}
}

// Un compte ne lit ni n'écrit les coffres d'un autre : la session désigne le compte.
func TestCoffresParCompte(t *testing.T) {
	b := nouveauBanc(t)
	_, ja, _ := b.inscrire(t, ipN(1), "lea@exemple.fr", "lea")
	_, _, db := b.inscrire(t, ipN(2), "leo@exemple.fr", "leo")
	ca, _ := b.s.Session(ja)
	blob, _, err := b.s.LireCoffre(ca, Prive)
	if err != nil || bytes.Equal(blob, db.BlobPrive) {
		t.Fatal(err)
	}
}
