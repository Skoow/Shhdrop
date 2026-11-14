package main

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/skoow/shhdrop/server/internal/config"
)

// Compte désactivé : setupComptes ne lit rien et ne crée rien.
func TestSetupComptesDesactive(t *testing.T) {
	dir := t.TempDir()
	c, err := setupComptes(config.Config{DataDir: dir, ComptesCleFile: filepath.Join(dir, "absente")})
	if err != nil || c != nil {
		t.Fatalf("%v %v", c, err)
	}
	if es, _ := os.ReadDir(dir); len(es) != 0 {
		t.Fatalf("fichiers créés : %v", es)
	}
}

// Compte activé : clé du serveur lue (refus au démarrage si elle est fausse), comptes.db créée
// en 0600 dans SHH_DATA_DIR ; rien n'est encore servi (lot 4).
func TestSetupComptesActive(t *testing.T) {
	dir, secrets := t.TempDir(), t.TempDir()
	cle := filepath.Join(secrets, "cle")
	if err := os.WriteFile(cle, bytes.Repeat([]byte{9}, 32), 0o400); err != nil {
		t.Fatal(err)
	}
	cfg := config.Config{DataDir: dir, Comptes: true, ComptesCleFile: cle}
	c, err := setupComptes(cfg)
	if err != nil || c == nil || c.db == nil || c.cles.Email == [32]byte{} {
		t.Fatalf("%v %v", c, err)
	}
	c.db.Close()
	st, err := os.Stat(filepath.Join(dir, "comptes.db"))
	if err != nil || st.Mode().Perm() != 0o600 {
		t.Fatalf("comptes.db : %v %v", st, err)
	}
	if err := os.Chmod(cle, 0o644); err != nil {
		t.Fatal(err)
	}
	if c, err := setupComptes(cfg); err == nil {
		c.db.Close()
		t.Fatal("clé lisible par tous acceptée")
	} else if msg := publicMessage(err); !strings.Contains(msg, "SHH_COMPTES_CLE_FILE") {
		t.Fatal("message pour l'exploitant attendu :", msg)
	}
}
