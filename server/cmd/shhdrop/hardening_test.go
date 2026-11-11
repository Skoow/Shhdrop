package main

import (
	"bufio"
	"context"
	"io"
	"maps"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
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

// Spec §41.2 : plafond par défaut de 200 Gio, donc 201 Gio libres exigés au démarrage.
func TestServeDefaultStorageNeeds201Gio(t *testing.T) {
	t.Setenv("SHH_DATA_DIR", t.TempDir())
	t.Setenv("SHH_STORAGE_MAX", "")
	c, err := config.FromEnv()
	if err != nil || c.StorageMaxBytes != 200<<30 {
		t.Fatal(c.StorageMaxBytes, err)
	}
	orig := diskFree
	t.Cleanup(func() { diskFree = orig })
	diskFree = func(string) (uint64, error) { return 200<<30 + 1<<29, nil } // 200,5 Gio libres
	if err := checkStorage(c.DataDir, c.StorageMaxBytes, 0); err == nil {
		t.Fatal("démarrage accepté avec moins de 201 Gio libres")
	}
	diskFree = func(string) (uint64, error) { return 201 << 30, nil }
	if err := checkStorage(c.DataDir, c.StorageMaxBytes, 0); err != nil {
		t.Fatal(err)
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
	// Repli de l'application monopage : /, et tout chemin sans extension, servent index.html,
	// mêmes en-têtes, sans X-Robots-Tag (spec §32 : les liens sont à la racine, « /#clé »).
	// Statut réel (audit de performance, point 5) : 200 pour les routes de l'application,
	// 404 pour tout autre chemin (le corps reste l'application, qui affiche « introuvable »).
	for _, c := range []struct {
		p    string
		want int
	}{{"/", 200}, {"/index.html", 200}, {"/securite", 200}, {"/confidentialite", 200}, {"/securite/", 404},
		{"/conditions", 200}, {"/mentions-legales", 200}, {"/signaler", 200}, {"/offres", 200}, {"/envoyer", 200}, {"/envoyer/", 404}, {"/envois", 200}, {"/mentions", 404},
		{"/s/AAAAAAAAAAAAAAAAAAAAAA", 404}, {"/m/x/y", 404}, {"/nope", 404}, {"/Securite", 404}} {
		p := c.p
		for _, m := range []string{"GET", "HEAD"} {
			code, body, h := get(m, p)
			if code != c.want || (m == "GET" && !strings.Contains(body, "<title>Shhdrop</title>")) ||
				h.Get("Content-Security-Policy") == "" || h.Get("Cache-Control") != "no-store" || h.Get("X-Content-Type-Options") != "nosniff" ||
				!strings.HasPrefix(h.Get("Content-Type"), "text/html") || len(h.Values("X-Robots-Tag")) != 0 {
				t.Fatalf("%s %s : %d %q %v", m, p, code, body, h)
			}
		}
	}
	// Plus de repli particulier sous /s/ et /m/ : un fichier absent avec extension → 404 partout.
	for _, p := range []string{"/assets/missing.js", "/s/AAAAAAAAAAAAAAAAAAAAAA.", "/m/x/y.png", "/s/a.js", "/sx/a.js", "/api/x.js"} {
		if code, body, _ := get("GET", p); code != 404 || strings.Contains(body, "<title>Shhdrop</title>") {
			t.Fatalf("%s : %d %q", p, code, body)
		}
	}
	// Ni remontée ni fichier caché par /s/ ou /m/ : 404, ou index.html (le client suit la
	// redirection du serveur vers le chemin nettoyé), jamais le fichier visé.
	for _, p := range []string{"/s/x/../../etc/passwd", "/s/x/../../etc", "/s/../.env", "/m/../passwd", "/s/.env", "/m/.git/config"} {
		code, body, _ := get("GET", p)
		if strings.Contains(body, "root:") || strings.Contains(body, "SECRET") || strings.Contains(body, "[core]") ||
			!(code == 404 || code == 200 && strings.Contains(body, "<title>Shhdrop</title>")) {
			t.Fatalf("%s : %d %q", p, code, body)
		}
	}
	if code, _, _ := get("POST", "/s/AAAAAAAAAAAAAAAAAAAAAA"); code != 405 {
		t.Fatalf("POST statique : %d", code)
	}
	if code, _, _ := get("GET", "/api/inconnu"); code != 404 {
		t.Fatalf("/api/inconnu : %d", code)
	}
}

// Tâche M, point 1 : un volume dédié contient lost+found (créé par mkfs ext4) ; il ne doit
// pas faire passer le dossier pour celui d'un autre programme.
func TestServeIgnoresLostAndFound(t *testing.T) {
	dir := t.TempDir()
	if err := os.Mkdir(filepath.Join(dir, "lost+found"), 0o700); err != nil {
		t.Fatal(err)
	}
	startServe(t, baseCfg(dir))
	// lost+found plus autre chose : toujours refusé.
	dir = t.TempDir()
	os.Mkdir(filepath.Join(dir, "lost+found"), 0o700)
	os.WriteFile(filepath.Join(dir, "notes.txt"), []byte("à moi"), 0o644)
	if err := serveErr(t, baseCfg(dir)); err == nil || !strings.Contains(err.Error(), "shares.db") {
		t.Fatalf("serve = %v", err)
	}
	// Un simple fichier nommé lost+found n'est pas le dossier de mkfs : refusé.
	dir = t.TempDir()
	os.WriteFile(filepath.Join(dir, "lost+found"), []byte("x"), 0o644)
	if err := serveErr(t, baseCfg(dir)); err == nil {
		t.Fatal("fichier lost+found accepté")
	}
}

// Tâche M, point 10 : une sonde laissée par un arrêt brutal est supprimée au démarrage ;
// rien d'autre n'est touché.
func TestServeRemovesLeftoverProbes(t *testing.T) {
	dir := t.TempDir()
	blobs := filepath.Join(dir, "blobs")
	if err := os.Mkdir(blobs, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "shares.db"), nil, 0o600); err != nil {
		t.Fatal(err)
	}
	probe := filepath.Join(blobs, ".sonde-123456789")
	other := filepath.Join(blobs, ".sonde-notes")
	for _, f := range []string{probe, other} {
		if err := os.WriteFile(f, make([]byte, 4096), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	startServe(t, baseCfg(dir))
	if _, err := os.Stat(probe); !os.IsNotExist(err) {
		t.Fatalf("sonde laissée : %v", err)
	}
	if _, err := os.Stat(other); err != nil {
		t.Fatalf("fichier étranger supprimé : %v", err)
	}
}

// Tâche M, point 6 : Statfs_t.Bsize n'est pas l'unité de Bavail sur tous les systèmes de
// fichiers ; Frsize l'est quand il est non nul.
func TestAvailBytes(t *testing.T) {
	if got := availBytes(1000, 4096, 512); got != 1000*512 {
		t.Fatal(got)
	}
	if got := availBytes(1000, 4096, 0); got != 1000*4096 {
		t.Fatal(got)
	}
}

// Les routes qui répondent 200 sont exactement celles du routeur du client (match()).
func TestAppRoutesMatchClientRouter(t *testing.T) {
	src, err := os.ReadFile(filepath.Join("..", "..", "..", "web", "src", "app", "router.svelte.ts"))
	if err != nil {
		t.Fatal(err)
	}
	got := map[string]bool{"/": true}
	for _, m := range regexp.MustCompile(`if \(p === "(/[a-z-]+)"\) return \{ name: "[a-z]+" \}`).FindAllStringSubmatch(string(src), -1) {
		got[m[1]] = true
	}
	// Pages d'information : table INFO_PATHS ("/chemin": "route").
	for _, m := range regexp.MustCompile(`(?m)^  "(/[a-z-]+)": "[a-z]+",$`).FindAllStringSubmatch(string(src), -1) {
		got[m[1]] = true
	}
	if len(got) < 3 || !maps.Equal(got, appRoutes) {
		t.Fatalf("routes du client %v, du serveur %v", got, appRoutes)
	}
}
