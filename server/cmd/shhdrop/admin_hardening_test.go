package main

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/skoow/shhdrop/server/internal/config"
	"github.com/skoow/shhdrop/server/internal/store"
)

func runIn(cfg config.Config, stdin string, args ...string) (int, string, string) {
	var o, e bytes.Buffer
	c := runAdmin(args, cfg, strings.NewReader(stdin), &o, &e)
	return c, o.String(), e.String()
}

// Audit M2 : sur un SHH_DATA_DIR mal orthographié, freeze et wipe répondaient 0 (et
// créaient une base vide) ; rien ne doit être créé, et le code de sortie doit être non nul.
func TestAdminRefusesWrongDataDir(t *testing.T) {
	parent := t.TempDir()
	empty := filepath.Join(parent, "vide")
	os.Mkdir(empty, 0o700)
	for _, dir := range []string{filepath.Join(parent, "typo"), empty, "relatif/data"} {
		cfg := config.Config{DataDir: dir, Now: time.Now, StorageMaxBytes: 1 << 40}
		for _, a := range [][]string{{"freeze"}, {"unfreeze"}, {"destroy", "AAAAAAAAAAAAAAAAAAAAAA"}, {"wipe", "--yes"}} {
			code, out, errOut := runIn(cfg, "", a...)
			if code != 1 || strings.Contains(out, "suspendues") || strings.Contains(out, "effacé") || !strings.Contains(errOut, "shares.db") {
				t.Fatalf("%s %v : code %d, %q %q", dir, a, code, out, errOut)
			}
		}
		if _, err := os.Stat(filepath.Join(parent, "typo")); !os.IsNotExist(err) {
			t.Fatal("dossier créé")
		}
		if es, _ := os.ReadDir(empty); len(es) != 0 {
			t.Fatalf("fichiers créés : %v", es)
		}
	}
}

func TestStoreOpenExistingDoesNotCreate(t *testing.T) {
	p := filepath.Join(t.TempDir(), "shares.db")
	if db, err := store.OpenExisting(p); err == nil {
		db.Close()
		t.Fatal("base absente ouverte")
	}
	if _, err := os.Stat(p); !os.IsNotExist(err) {
		t.Fatal("base créée")
	}
	// Fichier présent mais sans table shares : refusé aussi.
	os.WriteFile(p, nil, 0o600)
	if db, err := store.OpenExisting(p); err == nil {
		db.Close()
		t.Fatal("base sans table acceptée")
	}
}

// Les commandes affichent le chemin absolu et le nombre de partages touchés.
func TestAdminReportsPathAndCount(t *testing.T) {
	cfg, s := adminSetup(t)
	mk(t, s)
	mk(t, s)
	code, out, _ := runIn(cfg, "", "freeze")
	if code != 0 || !strings.Contains(out, cfg.DataDir) || !strings.Contains(out, "2 partages") {
		t.Fatalf("freeze : %d %q", code, out)
	}
	code, out, _ = runIn(cfg, "", "unfreeze")
	if code != 0 || !strings.Contains(out, cfg.DataDir) {
		t.Fatalf("unfreeze : %d %q", code, out)
	}
	id := mk(t, s)
	code, out, _ = runIn(cfg, "", "destroy", id)
	if code != 0 || !strings.Contains(out, cfg.DataDir) || !strings.Contains(out, "1 partage détruit") {
		t.Fatalf("destroy : %d %q", code, out)
	}
	code, out, _ = runIn(cfg, "", "wipe", "--yes")
	if code != 0 || !strings.Contains(out, cfg.DataDir) || !strings.Contains(out, "2 partages effacés") {
		t.Fatalf("wipe : %d %q", code, out)
	}
}

// Audit F11 : le lien entier (avec K_lien) atterrissait dans argv et l'historique du shell.
func TestAdminDestroyStdin(t *testing.T) {
	cfg, s := adminSetup(t)
	secret := "SECRETSECRETSECRET"
	id := mk(t, s)
	code, out, errOut := runIn(cfg, "https://exemple.org/s/"+id+"#"+secret+"\n", "destroy", "-")
	if code != 0 || count(t, s) != 0 || strings.Contains(out+errOut, secret) || strings.Contains(out+errOut, id) {
		t.Fatalf("destroy - : %d %q %q", code, out, errOut)
	}
	if strings.Contains(errOut, "historique") {
		t.Fatal("avertissement inutile pour l'entrée standard")
	}
	// Argument avec « # » : avertissement (la clé est exposée), même si la destruction réussit.
	id = mk(t, s)
	code, out, errOut = runIn(cfg, "", "destroy", "https://exemple.org/s/"+id+"#"+secret)
	if code != 0 || !strings.Contains(errOut, "historique") || strings.Contains(out+errOut, secret) {
		t.Fatalf("destroy lien : %d %q %q", code, out, errOut)
	}
	code, _, errOut = runIn(cfg, "", "destroy", "AAAAAAAAAAAAAAAAAAAAAA#"+secret)
	if code != 1 || !strings.Contains(errOut, "historique") || !strings.Contains(errOut, "introuvable") {
		t.Fatalf("destroy id#clé : %d %q", code, errOut)
	}
	// Entrée vide, plusieurs lignes ou trop longue : erreur d'usage.
	for _, in := range []string{"", "\n", id + "\n" + id + "\n", strings.Repeat("A", 5000)} {
		if code, _, _ := runIn(cfg, in, "destroy", "-"); code != 2 {
			t.Fatalf("%q : code %d", in, code)
		}
	}
}
