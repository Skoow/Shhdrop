package main

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/skoow/shhdrop/server/internal/config"
	"github.com/skoow/shhdrop/server/internal/limits"
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

// Mot de passe SMTP : lu sans son saut de ligne final ; vide : refus, message avec le chemin.
func TestLireMdpSMTP(t *testing.T) {
	dir := t.TempDir()
	for _, c := range []struct{ contenu, want string }{
		{"secret\n", "secret"}, {"secret\r\n", "secret"}, {"secret", "secret"}, {"se cret\n\n", "se cret\n"},
	} {
		p := filepath.Join(dir, "mdp")
		os.WriteFile(p, []byte(c.contenu), 0o600)
		got, err := lireMdpSMTP(p)
		if err != nil || string(got) != c.want {
			t.Fatalf("%q : %q %v", c.contenu, got, err)
		}
	}
	p := filepath.Join(dir, "vide")
	os.WriteFile(p, []byte("\n"), 0o600)
	if _, err := lireMdpSMTP(p); err == nil || !strings.Contains(publicMessage(err), p) {
		t.Fatal(err)
	}
}

// SHH_COMPTES=0 : ni envoyeur, ni service, ni routes du compte.
func TestBrancherComptesDesactive(t *testing.T) {
	if err := brancherComptes(config.Config{}, nil, nil); err != nil {
		t.Fatal(err)
	}
	if s := salonsOf(config.Config{Salons: true}, nil, &comptes{}); s.Comptes != nil {
		t.Fatal("service du compte sans SHH_COMPTES")
	}
}

// SHH_COMPTES=1 : envoyeur et service créés, routes servies (salonsOf les donne à l'API).
func TestBrancherComptesActive(t *testing.T) {
	dir, secrets := t.TempDir(), t.TempDir()
	cle, mdp := filepath.Join(secrets, "cle"), filepath.Join(secrets, "mdp")
	os.WriteFile(cle, bytes.Repeat([]byte{9}, 32), 0o400)
	os.WriteFile(mdp, []byte("secret\n"), 0o600)
	cfg := config.Config{DataDir: dir, Salons: true, Comptes: true, ComptesCleFile: cle, ComptesMax: 10,
		SMTP: config.SMTP{Host: "127.0.0.1", Port: 2525, User: "u", PasswordFile: mdp, From: "Shhgone <a@exemple.fr>"}}
	cpt, err := setupComptes(cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer cpt.db.Close()
	if err := brancherComptes(cfg, cpt, limits.New(time.Now)); err != nil || cpt.svc == nil || cpt.env == nil {
		t.Fatal(err)
	}
	if s := salonsOf(cfg, nil, cpt); s.Comptes != cpt.svc {
		t.Fatal("service non donné à l'API")
	}
	cfg.SMTP.PasswordFile = filepath.Join(secrets, "absent")
	if err := brancherComptes(cfg, cpt, limits.New(time.Now)); err == nil {
		t.Fatal("mot de passe SMTP absent accepté")
	}
}
