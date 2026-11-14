package compte

import (
	"encoding/hex"
	"encoding/json"
	"os"
	"testing"
)

// vecteurs : engine/vectors/compte.json, produit par le moteur Rust (lot 1), rejoué ici en Go.
type vecteurs struct {
	Constants struct {
		Reserves []struct {
			Mot       string `json:"mot"`
			PCanonHex string `json:"p_canon_hex"`
		} `json:"reserves"`
	} `json:"constants"`
	Normaliser []struct {
		Label     string `json:"label"`
		EntreeHex string `json:"entree_hex"`
		Canon     string `json:"canon"`
		Exacte    string `json:"exacte"`
		Error     string `json:"error"`
	} `json:"normaliser"`
	Enveloppes []struct {
		Label   string `json:"label"`
		AD      string `json:"ad"`
		EnvMdp  string `json:"env_mdp"`
		H       string `json:"h"`
		KCompte string `json:"k_compte"`
		KEKMdp  string `json:"kek_mdp"`
		Nonce   string `json:"nonce"`
	} `json:"enveloppes"`
	Pseudo []struct {
		Label     string `json:"label"`
		PCanonHex string `json:"p_canon_hex"`
		Reserve   bool   `json:"reserve"`
		Error     string `json:"error"`
	} `json:"pseudo"`
}

func lireVecteurs(t *testing.T) vecteurs {
	t.Helper()
	b, err := os.ReadFile("../../../engine/vectors/compte.json")
	if err != nil {
		t.Fatal(err)
	}
	var v vecteurs
	if err := json.Unmarshal(b, &v); err != nil {
		t.Fatal(err)
	}
	return v
}

func unhex(t *testing.T, s string) []byte {
	t.Helper()
	b, err := hex.DecodeString(s)
	if err != nil {
		t.Fatal(err)
	}
	return b
}
