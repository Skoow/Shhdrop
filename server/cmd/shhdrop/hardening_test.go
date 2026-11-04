package main

import (
	"bufio"
	"context"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/skoow/shhdrop/server/internal/config"
)

// startServe lance serve et rend l'adresse ; arrêt à la fin du test.
func startServe(t *testing.T, cfg config.Config) string {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	pr, pw := io.Pipe()
	errc := make(chan error, 1)
	go func() { errc <- serve(ctx, cfg, pw); pw.Close() }()
	sc := bufio.NewScanner(pr)
	if !sc.Scan() {
		cancel()
		t.Fatalf("serve n'a pas démarré : %v", <-errc)
	}
	go io.Copy(io.Discard, pr)
	t.Cleanup(func() {
		cancel()
		if err := <-errc; err != nil {
			t.Error(err)
		}
	})
	return strings.TrimPrefix(sc.Text(), "SHH_LISTENING ")
}

func serveErr(t *testing.T, cfg config.Config) error {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	errc := make(chan error, 1)
	go func() { errc <- serve(ctx, cfg, io.Discard) }()
	select {
	case err := <-errc:
		return err
	case <-time.After(5 * time.Second):
		t.Fatal("serve a démarré au lieu de refuser")
		return nil
	}
}

func baseCfg(dir string) config.Config {
	return config.Config{DataDir: dir, Listen: "127.0.0.1:0", StorageMaxBytes: 1 << 30, Now: time.Now}
}

// Audit F5 : un dossier existant qui n'est pas celui de Shhdrop (/var, $HOME…) voyait ses
// droits forcés à 0700, et ses fichiers de blobs/ effacés par Reconcile.
func TestServeRefusesForeignDataDir(t *testing.T) {
	dir := t.TempDir()
	os.Chmod(dir, 0o755)
	os.WriteFile(filepath.Join(dir, "notes.txt"), []byte("à moi"), 0o644)
	err := serveErr(t, baseCfg(dir))
	if err == nil || !strings.Contains(err.Error(), "shares.db") {
		t.Fatalf("serve = %v", err)
	}
	fi, _ := os.Stat(dir)
	if fi.Mode().Perm() != 0o755 {
		t.Fatalf("droits modifiés : %v", fi.Mode())
	}
	if es, _ := os.ReadDir(dir); len(es) != 1 {
		t.Fatalf("dossier modifié : %v", es)
	}
	// Dossier inexistant ou vide : premier démarrage, accepté.
	startServe(t, baseCfg(filepath.Join(t.TempDir(), "neuf")))
	startServe(t, baseCfg(t.TempDir()))
}

// Audit F6 : SHH_STORAGE_MAX sans plafond réel.
func TestServeStorageMaxFitsDisk(t *testing.T) {
	orig := diskFree
	t.Cleanup(func() { diskFree = orig })
	diskFree = func(string) (uint64, error) { return 3 << 30, nil } // 3 Gio libres
	cfg := baseCfg(t.TempDir())
	cfg.StorageMaxBytes = 2<<30 + 1 // > 3 Gio − 1 Gio de marge
	err := serveErr(t, cfg)
	if err == nil || !strings.Contains(err.Error(), "SHH_STORAGE_MAX") {
		t.Fatalf("serve = %v", err)
	}
	cfg.StorageMaxBytes = 2 << 30
	startServe(t, cfg)
	diskFree = func(string) (uint64, error) { return 1 << 29, nil } // moins que la marge
	cfg = baseCfg(t.TempDir())
	cfg.StorageMaxBytes = 1
	if err := serveErr(t, cfg); err == nil {
		t.Fatal("accepté avec moins d'1 Gio libre")
	}
}

// Audit F7 : SHH_STATIC_DIR non vérifié ; liste des dossiers et fichiers cachés servis.
func TestServeStaticDir(t *testing.T) {
	data := t.TempDir()
	cfg := baseCfg(data)
	cfg.StaticDir = filepath.Join(t.TempDir(), "absent")
	if err := serveErr(t, cfg); err == nil {
		t.Fatal("SHH_STATIC_DIR inexistant accepté")
	}
	static := t.TempDir()
	cfg.StaticDir = static
	if err := serveErr(t, cfg); err == nil || !strings.Contains(err.Error(), "index.html") {
		t.Fatalf("SHH_STATIC_DIR sans index.html : %v", err)
	}
	os.WriteFile(filepath.Join(static, "index.html"), []byte("<!doctype html><title>Shhdrop</title>"), 0o600)
	os.WriteFile(filepath.Join(static, ".env"), []byte("SECRET=1"), 0o600)
	os.MkdirAll(filepath.Join(static, "assets"), 0o700)
	os.WriteFile(filepath.Join(static, "assets", "app.js"), []byte("console.log(1)"), 0o600)
	os.MkdirAll(filepath.Join(static, ".git"), 0o700)
	os.WriteFile(filepath.Join(static, ".git", "config"), []byte("[core]"), 0o600)
	os.MkdirAll(filepath.Join(static, "docs"), 0o700)
	os.WriteFile(filepath.Join(static, "docs", "index.html"), []byte("docs"), 0o600)
	os.Symlink("/etc/passwd", filepath.Join(static, "passwd"))
	addr := startServe(t, cfg)
	get := func(method, path string) (int, string, http.Header) {
		t.Helper()
		r, _ := http.NewRequest(method, "http://"+addr+path, nil)
		res, err := http.DefaultClient.Do(r)
		if err != nil {
			t.Fatal(err)
		}
		b, _ := io.ReadAll(res.Body)
		res.Body.Close()
		return res.StatusCode, string(b), res.Header
	}
	for _, p := range []string{"/.env", "/.git/config", "/assets/../.env", "/assets/", "/assets", "/passwd", "/assets/absent.js", "/.well-known/x"} {
		if code, body, _ := get("GET", p); code != 404 || strings.Contains(body, "app.js") || strings.Contains(body, "SECRET") || strings.Contains(body, "root:") {
			t.Fatalf("%s : %d %q", p, code, body)
		}
	}
	if code, body, h := get("GET", "/assets/app.js"); code != 200 || body != "console.log(1)" || h.Get("Content-Security-Policy") == "" ||
		!strings.HasPrefix(h.Get("Content-Type"), "text/javascript") {
		t.Fatalf("/assets/app.js : %d %q %v", code, body, h)
	}
	if code, body, _ := get("GET", "/docs/"); code != 200 || body != "docs" {
		t.Fatalf("/docs/ : %d %q", code, body)
	}
	// Repli de l'application monopage : /, /s/<id>, /m/<id> servent index.html, mêmes en-têtes.
	for _, p := range []string{"/", "/index.html", "/s/AAAAAAAAAAAAAAAAAAAAAA", "/m/AAAAAAAAAAAAAAAAAAAAAA"} {
		code, body, h := get("GET", p)
		if code != 200 || !strings.Contains(body, "<title>Shhdrop</title>") ||
			h.Get("Content-Security-Policy") == "" || h.Get("Cache-Control") != "no-store" || h.Get("X-Content-Type-Options") != "nosniff" ||
			!strings.HasPrefix(h.Get("Content-Type"), "text/html") {
			t.Fatalf("%s : %d %q %v", p, code, body, h)
		}
	}
	if code, _, _ := get("POST", "/s/AAAAAAAAAAAAAAAAAAAAAA"); code != 405 {
		t.Fatalf("POST statique : %d", code)
	}
	if code, _, _ := get("GET", "/api/inconnu"); code != 404 {
		t.Fatalf("/api/inconnu : %d", code)
	}
}
