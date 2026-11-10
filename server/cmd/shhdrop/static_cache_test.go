package main

import (
	"io"
	"net/http"
	"os"
	"path/filepath"
	"testing"
)

// Revue du 10 novembre (remplace CLEAN4) : à travers tout le serveur (en-têtes de api.New
// compris), une seule valeur de Cache-Control par réponse : un an et immuable pour les
// fichiers à empreinte de /assets/ qui existent, no-store pour tout le reste (HTML, routes,
// cadre PDF, /api/*, fichiers sans empreinte, 404).
func TestCacheControlEndToEnd(t *testing.T) {
	static := t.TempDir()
	for n, b := range map[string]string{
		"index.html":                                  "<!doctype html><title>Shhdrop</title>",
		"assets/index-yRSR4HNN.js":                    "console.log(1)",
		"assets/index-yRSR4HNN.js.br":                 "BROTLI",
		"assets/index-eRPzjXIX.css":                   "a{}",
		"assets/pow.worker-CqXgVHIX.js":               "onmessage=null",
		"assets/aurora-ink.png":                       "png",
		"assets/grain.png":                            "png",
		"assets/motif.svg":                            "<svg/>",
		"fonts/mona-sans-latin-standard-normal.woff2": "woff2",
		"pdf-frame.html":                              "<!doctype html>",
		"pdf-frame.js":                                "1",
		"pdf-frame.css":                               "a{}",
		"robots.txt":                                  "User-agent: *\n",
		"sitemap.xml":                                 "<urlset/>",
		"manifest.webmanifest":                        "{}",
		"favicon.svg":                                 "<svg/>",
	} {
		p := filepath.Join(static, n)
		os.MkdirAll(filepath.Dir(p), 0o700)
		if err := os.WriteFile(p, []byte(b), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	cfg := baseCfg(t.TempDir())
	cfg.StaticDir = static
	addr := startServe(t, cfg)
	get := func(method, path, accept string) *http.Response {
		t.Helper()
		r, _ := http.NewRequest(method, "http://"+addr+path, nil)
		r.Header.Set("Accept-Encoding", accept)
		res, err := http.DefaultTransport.RoundTrip(r)
		if err != nil {
			t.Fatal(err)
		}
		io.Copy(io.Discard, res.Body)
		res.Body.Close()
		return res
	}
	const year, none = "public, max-age=31536000, immutable", "no-store"
	for _, c := range []struct {
		path string
		code int
		want string
	}{
		{"/assets/index-yRSR4HNN.js", 200, year},
		{"/assets/index-eRPzjXIX.css", 200, year},
		{"/assets/pow.worker-CqXgVHIX.js", 200, year},
		{"/assets/absent-AbCdEf12.js", 404, none}, // un 404 n'est jamais mis en cache un an
		{"/assets/aurora-ink.png", 200, none},
		{"/assets/grain.png", 200, none},
		{"/assets/motif.svg", 200, none},
		{"/fonts/mona-sans-latin-standard-normal.woff2", 200, none},
		{"/", 200, none},
		{"/index.html", 200, none},
		{"/securite", 200, none},
		{"/nope", 404, none},
		{"/pdf-frame.html", 200, none},
		{"/pdf-frame.js", 200, none},
		{"/pdf-frame.css", 200, none},
		{"/robots.txt", 200, none},
		{"/sitemap.xml", 200, none},
		{"/manifest.webmanifest", 200, none},
		{"/favicon.svg", 200, none},
		{"/api/captcha", 200, none},
		{"/api/assets/index-yRSR4HNN.js", 404, none},
	} {
		for _, m := range []string{"GET", "HEAD"} {
			if m == "HEAD" && c.path == "/api/captcha" {
				continue
			}
			res := get(m, c.path, "identity")
			if cc := res.Header.Values("Cache-Control"); res.StatusCode != c.code || len(cc) != 1 || cc[0] != c.want {
				t.Errorf("%s %s : %d, Cache-Control %q, attendu %d %q", m, c.path, res.StatusCode, cc, c.code, c.want)
			}
			if res.Header.Get("Content-Security-Policy") == "" || res.Header.Get("X-Content-Type-Options") != "nosniff" {
				t.Errorf("%s %s : en-têtes de sécurité absents", m, c.path)
			}
		}
	}
	// Variante précompressée : même cache, et Vary: Accept-Encoding gardé (un cache partagé
	// ne sert jamais du brotli à qui ne l'accepte pas).
	for accept, enc := range map[string]string{"br": "br", "identity": ""} {
		res := get("GET", "/assets/index-yRSR4HNN.js", accept)
		if res.Header.Get("Content-Encoding") != enc || res.Header.Get("Vary") != "Accept-Encoding" || res.Header.Get("Cache-Control") != year {
			t.Errorf("%q : encodage %q, Vary %q, Cache-Control %q", accept, res.Header.Get("Content-Encoding"), res.Header.Get("Vary"), res.Header.Get("Cache-Control"))
		}
	}
}
