package main

import (
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// Audit adverse du 13 novembre, 2e passage, front « site, navigateur » (N1) : /pdf-frame.html/
// (barre finale) servait les octets de pdf-frame.html SANS la directive sandbox ni les en-têtes
// du cadre, parce que les en-têtes suivent le chemin exact alors que les fichiers étaient
// servis aussi à des chemins voisins. À travers tout le serveur : un fichier du site n'est
// servi qu'à son chemin exact. Pour toute variante de chemin, soit la réponse ne contient pas
// les octets de pdf-frame.html, soit elle porte la CSP du cadre (sandbox allow-scripts).
func TestCadrePdfCheminExact(t *testing.T) {
	static := t.TempDir()
	const cadre, script, style = "<!doctype html><title>cadre PDF</title><script src=\"pdf-frame.js\"></script>",
		"/* script du cadre PDF */", "/* style du cadre PDF */"
	for n, b := range map[string]string{
		"index.html":      "<!doctype html><title>Shhdrop</title>",
		"pdf-frame.html":  cadre,
		"pdf-frame.js":    script,
		"pdf-frame.css":   style,
		"docs/index.html": "<!doctype html><title>docs</title>",
		"docs/guide.txt":  "guide",
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
	// get : requête au chemin brut donné (ni nettoyé ni redirigé par le client).
	get := func(brut string) (int, http.Header, string) {
		t.Helper()
		chemin, requete, _ := strings.Cut(brut, "?")
		decode, err := url.PathUnescape(chemin)
		if err != nil {
			t.Fatal(brut, err)
		}
		r, _ := http.NewRequest("GET", "http://"+addr+"/", nil)
		r.URL.Path, r.URL.RawPath, r.URL.RawQuery = decode, chemin, requete
		res, err := http.DefaultTransport.RoundTrip(r)
		if err != nil {
			t.Fatal(brut, err)
		}
		defer res.Body.Close()
		corps, _ := io.ReadAll(res.Body)
		return res.StatusCode, res.Header, string(corps)
	}
	// Chemins exacts : servis, avec les en-têtes du cadre (encodage « %2e » compris : c'est le
	// même chemin une fois décodé, et les en-têtes suivent le chemin décodé).
	for _, p := range []string{"/pdf-frame.html", "/pdf-frame.html?x=1", "/pdf-frame%2ehtml", "/%70df-frame.html"} {
		code, h, corps := get(p)
		if code != 200 || corps != cadre || !strings.Contains(h.Get("Content-Security-Policy"), "sandbox allow-scripts") ||
			h.Get("X-Frame-Options") != "SAMEORIGIN" || h.Get("Cross-Origin-Resource-Policy") != "cross-origin" {
			t.Errorf("%s : %d, CSP %q, XFO %q", p, code, h.Get("Content-Security-Policy"), h.Get("X-Frame-Options"))
		}
	}
	for p, attendu := range map[string]string{"/pdf-frame.js": script, "/pdf-frame.css": style} {
		if code, h, corps := get(p); code != 200 || corps != attendu || h.Get("Cross-Origin-Resource-Policy") != "cross-origin" {
			t.Errorf("%s : %d", p, code)
		}
	}
	// Variantes : jamais les octets d'un fichier du cadre sans ses en-têtes.
	for _, p := range []string{
		"/pdf-frame.html/", "/pdf-frame.html//", "/pdf-frame.html%2f", "/pdf-frame.html%2F", "/pdf-frame.html/.",
		"/pdf-frame.html/index.html", "/pdf-frame.html/x", "//pdf-frame.html", "/./pdf-frame.html", "/%2e/pdf-frame.html",
		"/x/../pdf-frame.html", "/x/%2e%2e/pdf-frame.html", "/docs/../pdf-frame.html", "/PDF-FRAME.HTML", "/Pdf-Frame.html",
		"/pdf-frame.html%00", "/pdf-frame.html%20", "/pdf-frame.html.", "/pdf-frame", "/pdf-frame/", "/pdf-frame.htm",
		"/pdf-frame.js/", "//pdf-frame.js", "/./pdf-frame.js", "/pdf-frame.js%2f", "/PDF-FRAME.JS",
		"/pdf-frame.css/", "//pdf-frame.css", "/pdf-frame.css/.",
	} {
		code, h, corps := get(p)
		csp := h.Get("Content-Security-Policy")
		switch {
		case corps == cadre && !strings.Contains(csp, "sandbox allow-scripts"):
			t.Errorf("%s : octets de pdf-frame.html servis (%d) SANS sandbox : CSP %q", p, code, csp)
		case (corps == script || corps == style) && h.Get("Cross-Origin-Resource-Policy") != "cross-origin":
			t.Errorf("%s : fichier du cadre servi (%d) sans ses en-têtes", p, code)
		case code == 200 && (corps == cadre || corps == script || corps == style):
			t.Errorf("%s : fichier du cadre servi à un chemin non exact (200)", p)
		}
	}
	// Chemins de dossier : l'index d'un dossier reste servi à « /dossier/ » et à « /dossier »,
	// un fichier jamais avec une barre finale.
	for p, attendu := range map[string]int{"/": 200, "/index.html": 200, "/docs/": 200, "/docs": 200, "/docs/index.html": 200,
		"/docs/guide.txt": 200, "/docs/guide.txt/": 404, "/index.html/": 404, "/docs/index.html/": 404} {
		if code, _, _ := get(p); attendu != 0 && code != attendu {
			t.Errorf("%s : %d, attendu %d", p, code, attendu)
		}
	}
}
