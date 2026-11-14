package compte

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"errors"
	"slices"
	"strings"
	"testing"
)

// Conception §21.5 : liste des pseudos réservés, sous leurs formes canoniques (squelette
// UTS #39 : « m » devient « rn »), exactement celles de constants.reserves de compte.json.
func TestPseudoReserve(t *testing.T) {
	v := lireVecteurs(t)
	var want []string
	for _, r := range v.Constants.Reserves {
		want = append(want, string(unhex(t, r.PCanonHex)))
	}
	if len(want) != 18 {
		t.Fatalf("%d réservés dans les vecteurs", len(want))
	}
	got := slices.Clone(reserves)
	slices.Sort(got)
	slices.Sort(want)
	if !slices.Equal(got, want) {
		t.Fatalf("reserves.txt = %q\nattendu       %q", got, want)
	}
	for _, w := range want {
		if _, err := clesTest(1).EmpreintePseudo([]byte(w)); !errors.Is(err, ErrPseudoReserve) {
			t.Errorf("%q : %v", w, err)
		}
	}
}

// Les p_canon des vecteurs pseudo sont acceptés (ou refusés comme réservés), et l'empreinte
// vaut HMAC-SHA-256(K_pseudo, « pseudo » ‖ 0 ‖ p_canon) ; même entrée, même empreinte.
func TestPseudoVecteurs(t *testing.T) {
	v := lireVecteurs(t)
	c := clesTest(3)
	n, plusLong := 0, 0
	for _, p := range v.Pseudo {
		if p.Error != "" {
			continue
		}
		n++
		pc := unhex(t, p.PCanonHex)
		plusLong = max(plusLong, len(pc))
		e, err := c.EmpreintePseudo(pc)
		if p.Reserve {
			if !errors.Is(err, ErrPseudoReserve) {
				t.Errorf("%s : réservé accepté (%v)", p.Label, err)
			}
			continue
		}
		if err != nil {
			t.Errorf("%s : %v", p.Label, err)
			continue
		}
		m := hmac.New(sha256.New, c.Pseudo[:])
		m.Write(append([]byte("pseudo\x00"), pc...))
		if !bytes.Equal(e[:], m.Sum(nil)) {
			t.Errorf("%s : empreinte", p.Label)
		}
		if e2, _ := c.EmpreintePseudo(pc); e2 != e {
			t.Errorf("%s : empreinte instable", p.Label)
		}
		if e3, _ := clesTest(4).EmpreintePseudo(pc); e3 == e {
			t.Errorf("%s : autre clé, même empreinte", p.Label)
		}
	}
	if n < 30 {
		t.Fatalf("%d cas valides seulement", n)
	}
	// Lot 1 : un p_canon valide peut faire 336 octets (24 graphèmes de 7 points de code) ;
	// la borne du serveur doit le laisser passer.
	if plusLong < 300 || plusLong > PseudoCanonMax {
		t.Fatalf("p_canon le plus long des vecteurs : %d octets (borne %d)", plusLong, PseudoCanonMax)
	}
}

func TestEmpreintePseudoRefus(t *testing.T) {
	c := clesTest(5)
	for nom, pc := range map[string][]byte{
		"vide":           {},
		"nil":            nil,
		"513 octets":     []byte(strings.Repeat("a", PseudoCanonMax+1)),
		"UTF-8 invalide": {'a', 0xff, 'b'},
		"UTF-8 tronqué":  []byte("l\xc3"),
	} {
		if _, err := c.EmpreintePseudo(pc); !errors.Is(err, ErrPseudoCanon) {
			t.Errorf("%s : %v", nom, err)
		}
	}
	if _, err := c.EmpreintePseudo([]byte(strings.Repeat("a", PseudoCanonMax))); err != nil {
		t.Errorf("%d octets refusés : %v", PseudoCanonMax, err)
	}
	if PseudoCanonMax != 512 {
		t.Fatal("borne", PseudoCanonMax)
	}
}
