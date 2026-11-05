package main

import (
	"bytes"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/skoow/shhdrop/server/internal/blob"
	"github.com/skoow/shhdrop/server/internal/config"
	"github.com/skoow/shhdrop/server/internal/share"
	"github.com/skoow/shhdrop/server/internal/store"
)

func adminSetup(t *testing.T) (config.Config, *share.Service) {
	t.Helper()
	dir := t.TempDir()
	cfg := config.Config{DataDir: dir, Now: time.Now, StorageMaxBytes: 1 << 40}
	db, err := store.Open(filepath.Join(dir, "shares.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	s, err := share.NewService(share.Config{DB: db, Blobs: &blob.Store{Dir: filepath.Join(dir, "blobs")}, Now: time.Now,
		StorageMax: 1 << 40, FrozenFile: filepath.Join(dir, "frozen")})
	if err != nil {
		t.Fatal(err)
	}
	return cfg, s
}

func mk(t *testing.T, s *share.Service) string {
	t.Helper()
	h := func() []byte { b := make([]byte, 8); rand.Read(b); x := sha256.Sum256(b); return x[:] }
	raw := make([]byte, 16)
	rand.Read(raw)
	id, _, err := s.Create(share.CreateReq{ID: base64.RawURLEncoding.EncodeToString(raw), Bucket: 1, AccessV: h(), ManageV: h()})
	if err != nil {
		t.Fatal(err)
	}
	return id
}

func count(t *testing.T, s *share.Service) int {
	var n int
	if err := s.DB.QueryRow("SELECT count(*) FROM shares").Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func run(cfg config.Config, args ...string) (int, string, string) {
	var o, e bytes.Buffer
	c := runAdmin(args, cfg, strings.NewReader(""), &o, &e)
	return c, o.String(), e.String()
}

func TestAdminDestroy(t *testing.T) {
	cfg, s := adminSetup(t)
	secret := "SECRETSECRETSECRET"
	for _, form := range []func(id string) string{
		func(id string) string { return id },
		func(id string) string { return "https://exemple.org/s/" + id + "#" + secret },
		func(id string) string { return "https://exemple.org/m/" + id + "#" + secret },
	} {
		id := mk(t, s)
		code, out, errOut := run(cfg, "destroy", form(id))
		if code != 0 {
			t.Fatal(code, errOut)
		}
		if strings.Contains(out+errOut, secret) || strings.Contains(out+errOut, id) {
			t.Fatal("la sortie reprend l'argument")
		}
		if count(t, s) != 0 {
			t.Fatal("partage non détruit")
		}
		if _, err := os.Stat(filepath.Join(s.Blobs.Dir, id)); err == nil {
			t.Fatal("fichier présent")
		}
	}
	code, _, errOut := run(cfg, "destroy", "AAAAAAAAAAAAAAAAAAAAAA")
	if code != 1 || !strings.Contains(errOut, "introuvable") {
		t.Fatal(code, errOut)
	}
	for _, bad := range []string{"court", "https://exemple.org/x/AAAAAAAAAAAAAAAAAAAAAA#k", "../../etc/passwd"} {
		if code, _, _ := run(cfg, "destroy", bad); code != 2 {
			t.Fatalf("%q: code %d", bad, code)
		}
	}
	if code, _, _ := run(cfg, "destroy"); code != 2 {
		t.Fatal("usage attendu")
	}
}

func TestAdminWipe(t *testing.T) {
	cfg, s := adminSetup(t)
	id1, id2 := mk(t, s), mk(t, s)
	code, _, errOut := run(cfg, "wipe")
	if code != 2 || errOut == "" || count(t, s) != 2 {
		t.Fatal("wipe sans --yes doit refuser", code)
	}
	if _, err := os.Stat(filepath.Join(cfg.DataDir, "frozen")); err == nil {
		t.Fatal("wipe refusé ne doit pas geler")
	}
	code, out, e := run(cfg, "wipe", "--yes")
	if code != 0 {
		t.Fatal(code, e)
	}
	// Le gel est posé avant l'effacement et laissé en place : aucune création pendant
	// ni après le wipe, jusqu'à un unfreeze explicite.
	if fi, err := os.Stat(filepath.Join(cfg.DataDir, "frozen")); err != nil || fi.Mode().Perm() != 0o600 {
		t.Fatal("fichier de gel absent après wipe", err)
	}
	if !strings.Contains(out, "suspendues") || !strings.Contains(out, "unfreeze") {
		t.Fatalf("sortie : %q", out)
	}
	if _, _, err := s.Create(share.CreateReq{}); !errors.Is(err, share.ErrFrozen) {
		t.Fatal("création acceptée après wipe")
	}
	if count(t, s) != 0 {
		t.Fatal("lignes restantes")
	}
	for _, id := range []string{id1, id2} {
		if _, err := os.Stat(filepath.Join(s.Blobs.Dir, id)); err == nil {
			t.Fatal("fichier restant")
		}
	}
}

func TestAdminFreeze(t *testing.T) {
	cfg, _ := adminSetup(t)
	f := filepath.Join(cfg.DataDir, "frozen")
	if code, _, e := run(cfg, "freeze"); code != 0 {
		t.Fatal(code, e)
	}
	fi, err := os.Stat(f)
	if err != nil || fi.Mode().Perm() != 0o600 {
		t.Fatal(err, fi)
	}
	if code, _, _ := run(cfg, "freeze"); code != 0 {
		t.Fatal("freeze idempotent")
	}
	if code, _, e := run(cfg, "unfreeze"); code != 0 {
		t.Fatal(code, e)
	}
	if _, err := os.Stat(f); err == nil {
		t.Fatal("fichier encore là")
	}
	if code, _, _ := run(cfg, "unfreeze"); code != 0 {
		t.Fatal("unfreeze idempotent")
	}
}

func TestAdminUsage(t *testing.T) {
	cfg, _ := adminSetup(t)
	for _, a := range [][]string{{}, {"inconnu"}, {"freeze", "x"}, {"wipe", "--yes", "x"}} {
		if code, _, _ := run(cfg, a...); code != 2 {
			t.Fatalf("%v: code %d", a, code)
		}
	}
}
