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

func TestServe(t *testing.T) {
	dir := t.TempDir()
	static := filepath.Join(dir, "dist")
	os.Mkdir(static, 0o700)
	os.WriteFile(filepath.Join(static, "app.js"), []byte("console.log(1)"), 0o600)

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
			if res.StatusCode != 200 || !strings.Contains(body, "Shhdrop") ||
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
