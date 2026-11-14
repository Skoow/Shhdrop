package compte

import (
	"bytes"
	"crypto/hkdf"
	"crypto/sha256"
	"os"
	"path/filepath"
	"testing"
)

func ecrireCle(t *testing.T, contenu []byte, mode os.FileMode) string {
	t.Helper()
	p := filepath.Join(t.TempDir(), "cle")
	if err := os.WriteFile(p, contenu, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Chmod(p, mode); err != nil {
		t.Fatal(err)
	}
	return p
}

// Conception §5.2, §21.2.2 : cinq sous-clés HKDF-SHA-256 (sel vide) de K_serveur, deux à deux
// différentes, égales à hkdf.Key calculé ici avec les étiquettes du plan.
func TestLireClesDerivations(t *testing.T) {
	k := bytes.Repeat([]byte{0x42}, 32)
	for _, mode := range []os.FileMode{0o600, 0o400} {
		c, err := LireCles(ecrireCle(t, k, mode))
		if err != nil {
			t.Fatalf("droits %o : %v", mode, err)
		}
		got := map[string][32]byte{"email": c.Email, "mdp": c.Poivre, "totp": c.TOTP, "sequestre": c.Sequestre, "pseudo": c.Pseudo}
		vus := map[[32]byte]string{}
		for nom, v := range got {
			want, err := hkdf.Key(sha256.New, k, nil, "shhdrop/v2/serveur/compte/"+nom, 32)
			if err != nil {
				t.Fatal(err)
			}
			if !bytes.Equal(v[:], want) {
				t.Errorf("sous-clé %s fausse", nom)
			}
			if autre, ok := vus[v]; ok {
				t.Errorf("sous-clés %s et %s égales", nom, autre)
			}
			vus[v] = nom
		}
	}
}

func TestLireClesRefuse(t *testing.T) {
	cas := map[string]string{
		"31 octets": ecrireCle(t, make([]byte, 31), 0o600),
		"33 octets": ecrireCle(t, make([]byte, 33), 0o600),
		"0644":      ecrireCle(t, bytes.Repeat([]byte{1}, 32), 0o644),
		"0640":      ecrireCle(t, bytes.Repeat([]byte{1}, 32), 0o640),
		"0700":      ecrireCle(t, bytes.Repeat([]byte{1}, 32), 0o700),
		"absent":    filepath.Join(t.TempDir(), "absent"),
		"dossier":   t.TempDir(),
	}
	for nom, p := range cas {
		if _, err := LireCles(p); err == nil {
			t.Errorf("%s accepté", nom)
		}
	}
	// Une clé faite de zéros n'est pas une clé tirée au hasard.
	if _, err := LireCles(ecrireCle(t, make([]byte, 32), 0o600)); err == nil {
		t.Error("clé nulle acceptée")
	}
}
