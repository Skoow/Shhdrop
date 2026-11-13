package config

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"strings"
	"testing"
)

// jetonTest : jeton d'administration valide (64 caractères hexadécimaux), pour les tests.
const jetonTest = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"

// Désactivé par défaut : sans SHH_ADMIN_LISTEN, rien, et le jeton n'est pas même lu.
func TestAdminDesactiveParDefaut(t *testing.T) {
	t.Setenv("SHH_DATA_DIR", "/d")
	t.Setenv("SHH_ADMIN_LISTEN", "")
	t.Setenv("SHH_ADMIN_TOKEN", "court")
	c, err := FromEnv()
	if err != nil || c.AdminListen != "" || c.AdminTokenHash != [32]byte{} {
		t.Fatalf("attendu désactivé : %q %v", c.AdminListen, err)
	}
}

func TestAdminActive(t *testing.T) {
	t.Setenv("SHH_DATA_DIR", "/d")
	t.Setenv("SHH_ADMIN_LISTEN", "127.0.0.1:9191")
	t.Setenv("SHH_ADMIN_TOKEN", jetonTest)
	c, err := FromEnv()
	if err != nil || c.AdminListen != "127.0.0.1:9191" || c.AdminTokenHash != sha256.Sum256([]byte(jetonTest)) {
		t.Fatalf("%+v %v", c.AdminListen, err)
	}
}

// Jeton absent, trop court, hors alphabet ou sans variété : refus au démarrage, et le
// message ne reprend jamais la valeur.
func TestAdminJetonRefuse(t *testing.T) {
	t.Setenv("SHH_DATA_DIR", "/d")
	t.Setenv("SHH_ADMIN_LISTEN", "127.0.0.1:9191")
	for _, tok := range []string{"", "court", jetonTest[:42], strings.Repeat("a", 64), jetonTest + " ",
		jetonTest[:60] + "é", strings.Repeat("ab", 300)} {
		t.Setenv("SHH_ADMIN_TOKEN", tok)
		_, err := FromEnv()
		if err == nil {
			t.Fatalf("jeton %q accepté", tok)
		}
		if tok != "" && strings.Contains(err.Error(), tok) {
			t.Fatalf("le message reprend le jeton : %v", err)
		}
	}
}

// Adresse : boucle locale seulement sans proxy déclaré ; jamais le port public.
func TestAdminAdresse(t *testing.T) {
	t.Setenv("SHH_DATA_DIR", "/d")
	t.Setenv("SHH_ADMIN_TOKEN", jetonTest)
	for _, l := range []string{"0.0.0.0:9191", "192.168.1.2:9191", "9191", "127.0.0.1:8080", "localhost:8080"} {
		t.Setenv("SHH_ADMIN_LISTEN", l)
		if _, err := FromEnv(); err == nil {
			t.Fatalf("SHH_ADMIN_LISTEN %q accepté", l)
		}
	}
	// Derrière le proxy déclaré (conteneur de production) : l'adresse du réseau interne passe.
	t.Setenv("SHH_BEHIND_PROXY", "1")
	t.Setenv("SHH_TRUSTED_PROXY", "172.30.53.1/32")
	t.Setenv("SHH_LISTEN", "0.0.0.0:8080")
	t.Setenv("SHH_ADMIN_LISTEN", "172.30.53.2:9191")
	if c, err := FromEnv(); err != nil || c.AdminListen != "172.30.53.2:9191" {
		t.Fatal(err)
	}
}

// Audit adverse 3, F1 : tout jeton tiré par la commande documentée (openssl rand -hex 32)
// doit être accepté. 2 000 tirages : aucun refus.
func TestAdminJetonHexAleatoireAccepte(t *testing.T) {
	b := make([]byte, 32)
	for i := 0; i < 2000; i++ {
		if _, err := rand.Read(b); err != nil {
			t.Fatal(err)
		}
		if tok := hex.EncodeToString(b); !adminTokenOK(tok) {
			t.Fatal("jeton hexadécimal aléatoire refusé")
		}
	}
	// Jeton hexadécimal sans le symbole « f » : accepté (c'était le cas refusé).
	if !adminTokenOK("0123456789abcde0123456789abcde0123456789abcde0123456789abcde0123") {
		t.Fatal("jeton à 15 symboles refusé")
	}
}
