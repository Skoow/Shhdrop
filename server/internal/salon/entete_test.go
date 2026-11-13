package salon

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"testing"
)

// vecteurs : partie « trames » de engine/vectors/salon-v3.json (produite par le moteur Rust).
type vecteurs struct {
	Trames struct {
		Seal []struct {
			Label      string          `json:"label"`
			Seal       json.RawMessage `json:"seal"`
			ReadHeader json.RawMessage `json:"read_header"`
		} `json:"seal"`
		Reject []struct {
			Label    string `json:"label"`
			From     string `json:"from"`
			Mutation struct {
				Op   string `json:"op"`
				At   *int   `json:"at"`
				Mask *int   `json:"mask"`
				Len  *int   `json:"len"`
				Hex  string `json:"hex"`
			} `json:"mutation"`
			ReadHeader json.RawMessage `json:"read_header"`
		} `json:"reject"`
	} `json:"trames"`
}

// attendu : `read_header` du moteur, {"volatile","regle"} ou {"error":"en_tete_invalide"}.
type attendu struct {
	Volatile *bool  `json:"volatile"`
	Regle    *int   `json:"regle"`
	Error    string `json:"error"`
}

func compare(t *testing.T, label string, trame []byte, raw json.RawMessage) {
	t.Helper()
	var a attendu
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&a); err != nil {
		t.Fatalf("%s : read_header illisible : %v", label, err)
	}
	got, err := LireEnTete(trame)
	switch {
	case a.Error == "en_tete_invalide":
		if !errors.Is(err, ErrEnTete) {
			t.Errorf("%s : attendu ErrEnTete, obtenu %+v, %v", label, got, err)
		}
	case a.Error != "" || a.Volatile == nil || a.Regle == nil:
		t.Fatalf("%s : read_header inattendu : %s", label, raw)
	default:
		if err != nil || got.Volatile != *a.Volatile || int(got.Regle) != *a.Regle {
			t.Errorf("%s : obtenu %+v, %v ; attendu volatile=%v regle=%d", label, got, err, *a.Volatile, *a.Regle)
		}
	}
}

func TestEnTeteVecteurs(t *testing.T) {
	b, err := os.ReadFile("../../../engine/vectors/salon-v3.json")
	if err != nil {
		t.Fatal(err)
	}
	var v vecteurs
	if err := json.Unmarshal(b, &v); err != nil {
		t.Fatal(err)
	}
	trames := map[string][]byte{}
	nSeal, nReject := 0, 0
	for _, c := range v.Trames.Seal {
		var s struct {
			TrameHex string `json:"trame_hex"`
			Error    string `json:"error"`
		}
		if err := json.Unmarshal(c.Seal, &s); err != nil {
			t.Fatalf("%s : %v", c.Label, err)
		}
		if s.TrameHex == "" { // scellement refusé par le moteur (charge trop grande) : pas de trame
			if s.Error == "" || c.ReadHeader != nil {
				t.Fatalf("%s : cas sans trame inattendu", c.Label)
			}
			continue
		}
		tr, err := hex.DecodeString(s.TrameHex)
		if err != nil || len(tr) != TailleTrame {
			t.Fatalf("%s : trame_hex invalide (%d octets, %v)", c.Label, len(tr), err)
		}
		trames[c.Label] = tr
		compare(t, c.Label, tr, c.ReadHeader)
		nSeal++
	}
	for _, c := range v.Trames.Reject {
		src, ok := trames[c.From]
		if !ok {
			t.Fatalf("%s : trame source %q absente", c.Label, c.From)
		}
		tr := bytes.Clone(src)
		m := c.Mutation
		switch m.Op {
		case "xor":
			tr[*m.At] ^= byte(*m.Mask)
		case "truncate":
			tr = tr[:*m.Len]
		case "append":
			x, err := hex.DecodeString(m.Hex)
			if err != nil || len(x) == 0 {
				t.Fatalf("%s : append invalide", c.Label)
			}
			tr = append(tr, x...)
		case "autre_mdp": // mêmes octets, ouverts avec un autre mot de passe : l'en-tête ne change pas
		default:
			t.Fatalf("%s : mutation inconnue %q", c.Label, m.Op)
		}
		compare(t, c.Label, tr, c.ReadHeader)
		nReject++
	}
	if nSeal == 0 || nReject == 0 {
		t.Fatalf("vecteurs absents : %d seal, %d reject", nSeal, nReject)
	}
	// Les huit combinaisons (volatile, règle) sont couvertes par trames.seal.
	vues := map[EnTete]bool{}
	for _, tr := range trames {
		if e, err := LireEnTete(tr); err == nil {
			vues[e] = true
		}
	}
	if len(vues) != 8 {
		t.Errorf("%d combinaisons d'en-tête couvertes, 8 attendues", len(vues))
	}
}

// Chaque octet de drapeaux : accepté si et seulement si les bits 3 à 7 sont nuls.
func TestEnTeteDrapeaux(t *testing.T) {
	tr := make([]byte, TailleTrame)
	copy(tr, "SHC3")
	for f := 0; f < 256; f++ {
		tr[4] = byte(f)
		e, err := LireEnTete(tr)
		if f&^7 != 0 {
			if !errors.Is(err, ErrEnTete) {
				t.Errorf("drapeaux %#02x accepté", f)
			}
			continue
		}
		if err != nil || e.Volatile != (f&1 == 1) || e.Regle != Regle(f>>1) {
			t.Errorf("drapeaux %#02x : %+v, %v", f, e, err)
		}
	}
	if Desactive != 0 || UneMinute != 1 || CinqMinutes != 2 || UneHeure != 3 {
		t.Fatal("valeurs de Regle")
	}
	for _, m := range []string{"SHC2", "shc3", "SHC\x00", "\x00HC3"} {
		copy(tr, m)
		tr[4] = 0
		if _, err := LireEnTete(tr); !errors.Is(err, ErrEnTete) {
			t.Errorf("marque %q acceptée", m)
		}
	}
	if _, err := LireEnTete(nil); !errors.Is(err, ErrEnTete) {
		t.Error("nil accepté")
	}
}
