package main

import (
	"bufio"
	"context"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/skoow/shhdrop/server/internal/api"
	"github.com/skoow/shhdrop/server/internal/config"
)

func TestServe(t *testing.T) {
	dir := t.TempDir()
	static := filepath.Join(dir, "dist")
	os.Mkdir(static, 0o700)
	os.WriteFile(filepath.Join(static, "app.js"), []byte("console.log(1)"), 0o600)
	os.WriteFile(filepath.Join(static, "index.html"), []byte("<!doctype html>"), 0o600)

	for _, staticDir := range []string{"", static} {
		cfg := config.Config{DataDir: filepath.Join(dir, "data"), Listen: "127.0.0.1:0",
			StorageMaxBytes: 1 << 30, StaticDir: staticDir, Now: time.Now}
		ctx, cancel := context.WithCancel(context.Background())
		pr, pw := io.Pipe()
		errc := make(chan error, 1)
		go func() { errc <- serve(ctx, cfg, pw); pw.Close() }()

		sc := bufio.NewScanner(pr)
		if !sc.Scan() {
			t.Fatal("aucune ligne sur stdout")
		}
		addr, ok := strings.CutPrefix(sc.Text(), "SHH_LISTENING ")
		if !ok || strings.HasSuffix(addr, ":0") {
			t.Fatalf("ligne inattendue %q", sc.Text())
		}
		get := func(path string) (*http.Response, string) {
			t.Helper()
			res, err := http.Get("http://" + addr + path)
			if err != nil {
				t.Fatal(err)
			}
			b, _ := io.ReadAll(res.Body)
			res.Body.Close()
			return res, string(b)
		}
		if staticDir == "" {
			res, body := get("/")
			if res.StatusCode != 200 || !strings.Contains(body, "Shhgone") ||
				!strings.HasPrefix(res.Header.Get("Content-Type"), "text/html") ||
				res.Header.Get("Content-Security-Policy") == "" || res.Header.Get("Cache-Control") != "no-store" {
				t.Fatalf("/ : %d %q %v", res.StatusCode, body, res.Header)
			}
		} else {
			res, body := get("/app.js")
			if res.StatusCode != 200 || body != "console.log(1)" || res.Header.Get("X-Content-Type-Options") != "nosniff" {
				t.Fatalf("/app.js : %d %q", res.StatusCode, body)
			}
		}
		if res, _ := get("/api/captcha"); res.StatusCode != 200 {
			t.Fatalf("/api/captcha : %d", res.StatusCode)
		}
		cancel()
		select {
		case err := <-errc:
			if err != nil {
				t.Fatal(err)
			}
		case <-time.After(10 * time.Second):
			t.Fatal("arrêt trop long")
		}
		if sc.Scan() {
			t.Fatalf("ligne de trop sur stdout : %q", sc.Text())
		}
	}
	for _, p := range []string{"data/shares.db"} {
		if _, err := os.Stat(filepath.Join(dir, p)); err != nil {
			t.Fatal(err)
		}
	}
}

func TestHTTPServerLimits(t *testing.T) {
	s := newHTTPServer(http.NotFoundHandler())
	if s.ReadHeaderTimeout != 10*time.Second || s.ReadTimeout != 300*time.Second ||
		s.WriteTimeout != 300*time.Second || s.IdleTimeout != 60*time.Second || s.MaxHeaderBytes != 16<<10 ||
		s.ErrorLog == nil {
		t.Fatalf("%+v", s)
	}
}

// Une requête bloquée (corps jamais terminé) ne retient pas l'arrêt au-delà du délai :
// la connexion est fermée de force, puis serve rend la main.
func TestServeForcedShutdown(t *testing.T) {
	old := shutdownTimeout
	shutdownTimeout = 200 * time.Millisecond
	t.Cleanup(func() { shutdownTimeout = old })
	cfg := config.Config{DataDir: t.TempDir(), Listen: "127.0.0.1:0", StorageMaxBytes: 1 << 30, Now: time.Now}
	ctx, cancel := context.WithCancel(context.Background())
	pr, pw := io.Pipe()
	errc := make(chan error, 1)
	go func() { errc <- serve(ctx, cfg, pw); pw.Close() }()
	sc := bufio.NewScanner(pr)
	sc.Scan()
	addr := strings.TrimPrefix(sc.Text(), "SHH_LISTENING ")
	go io.Copy(io.Discard, pr)

	conn, err := net.Dial("tcp", addr)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	io.WriteString(conn, "POST /api/shares HTTP/1.1\r\nHost: x\r\nContent-Length: 1000\r\n\r\n{")
	time.Sleep(100 * time.Millisecond) // le gestionnaire attend la suite du corps
	start := time.Now()
	cancel()
	select {
	case err := <-errc:
		if err == nil || time.Since(start) > 3*time.Second {
			t.Fatalf("serve = %v après %v (attendu : erreur d'arrêt forcé)", err, time.Since(start))
		}
	case <-time.After(5 * time.Second):
		t.Fatal("arrêt bloqué par une requête en cours")
	}
}

// Au démarrage, les droits sont resserrés même si dossier, base et fichiers annexes
// existaient déjà avec des droits trop larges.
func TestServeTightensPermissions(t *testing.T) {
	data := filepath.Join(t.TempDir(), "data")
	blobs := filepath.Join(data, "blobs")
	if err := os.MkdirAll(blobs, 0o755); err != nil {
		t.Fatal(err)
	}
	db := filepath.Join(data, "shares.db")
	for _, p := range []string{db, db + "-wal", db + "-shm"} {
		if err := os.WriteFile(p, nil, 0o644); err != nil {
			t.Fatal(err)
		}
	}
	for _, p := range []string{data, blobs} {
		os.Chmod(p, 0o755)
	}
	cfg := config.Config{DataDir: data, Listen: "127.0.0.1:0", StorageMaxBytes: 1 << 30, Now: time.Now}
	ctx, cancel := context.WithCancel(context.Background())
	pr, pw := io.Pipe()
	errc := make(chan error, 1)
	go func() { errc <- serve(ctx, cfg, pw); pw.Close() }()
	sc := bufio.NewScanner(pr)
	if !sc.Scan() {
		t.Fatal("serve n'a pas démarré")
	}
	go io.Copy(io.Discard, pr)
	check := func() {
		t.Helper()
		for p, want := range map[string]os.FileMode{data: 0o700, blobs: 0o700, db: 0o600, db + "-wal": 0o600, db + "-shm": 0o600} {
			fi, err := os.Stat(p)
			if os.IsNotExist(err) && p != data && p != blobs && p != db {
				continue
			}
			if err != nil || fi.Mode().Perm() != want {
				t.Fatalf("%s : %v %v (attendu %v)", p, err, fi, want)
			}
		}
	}
	check()
	cancel()
	if err := <-errc; err != nil {
		t.Fatal(err)
	}
	check()
}

// Salon désactivé : l'API reçoit la valeur zéro, même avec SHH_ORIGIN posée.
func TestSalonsOf(t *testing.T) {
	if s := salonsOf(config.Config{Origin: "https://shhdrop.app"}, nil); s != (api.Salons{}) {
		t.Fatalf("salon désactivé : %+v", s)
	}
	if s := salonsOf(config.Config{Salons: true, Origin: "https://shhdrop.app"}, nil); s.Origin != "https://shhdrop.app" {
		t.Fatalf("salon actif : %+v", s)
	}
}
