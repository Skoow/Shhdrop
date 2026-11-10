package main

import (
	"bytes"
	"compress/gzip"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

// Vitesse (retours CLEAN2) : variantes précompressées servies selon Accept-Encoding, jamais
// sans elles ; cache longue durée seulement pour les fichiers à empreinte de /assets/.
func TestStaticPrecompressedAndImmutable(t *testing.T) {
	dir := t.TempDir()
	js := bytes.Repeat([]byte("console.log('shhdrop');\n"), 200)
	var gz bytes.Buffer
	zw := gzip.NewWriter(&gz)
	zw.Write(js)
	zw.Close()
	files := map[string][]byte{
		"index.html":                  []byte("<!doctype html><title>x</title>"),
		"assets/index-AbCd_123.js":    js,
		"assets/index-AbCd_123.js.gz": gz.Bytes(),
		"assets/index-AbCd_123.js.br": []byte("BROTLI"),
		"assets/aurora-ink.png":       []byte("png"),
		"assets/style-Zz9_Yy8x.css":   []byte("a{}"),
		"robots.txt":                  []byte("User-agent: *\n"),
	}
	for n, b := range files {
		p := filepath.Join(dir, n)
		os.MkdirAll(filepath.Dir(p), 0o755)
		if err := os.WriteFile(p, b, 0o644); err != nil {
			t.Fatal(err)
		}
	}
	h, err := staticHandler(dir)
	if err != nil {
		t.Fatal(err)
	}
	get := func(path, accept string) *http.Response {
		r := httptest.NewRequest(http.MethodGet, path, nil)
		if accept != "" {
			r.Header.Set("Accept-Encoding", accept)
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		return w.Result()
	}
	body := func(r *http.Response) []byte { b, _ := io.ReadAll(r.Body); return b }

	cases := []struct{ accept, enc string }{
		{"gzip, deflate, br, zstd", "br"},
		{"gzip", "gzip"},
		{"br;q=0, gzip", "gzip"},
		{"", ""},
		{"identity", ""},
		{"gzip;q=0", ""},
	}
	for _, c := range cases {
		r := get("/assets/index-AbCd_123.js", c.accept)
		if r.StatusCode != 200 || r.Header.Get("Content-Encoding") != c.enc {
			t.Errorf("%q : statut %d, encodage %q, attendu %q", c.accept, r.StatusCode, r.Header.Get("Content-Encoding"), c.enc)
		}
		if ct := r.Header.Get("Content-Type"); ct != "text/javascript; charset=utf-8" {
			t.Errorf("%q : Content-Type %q", c.accept, ct)
		}
		if r.Header.Get("Vary") != "Accept-Encoding" {
			t.Errorf("%q : Vary %q", c.accept, r.Header.Get("Vary"))
		}
		b := body(r)
		switch c.enc {
		case "gzip":
			zr, err := gzip.NewReader(bytes.NewReader(b))
			if err != nil {
				t.Fatal(err)
			}
			if d, _ := io.ReadAll(zr); !bytes.Equal(d, js) {
				t.Errorf("%q : gzip ne redonne pas le fichier", c.accept)
			}
		case "":
			if !bytes.Equal(b, js) {
				t.Errorf("%q : corps différent du fichier", c.accept)
			}
		}
	}
	// Sans variante : servi tel quel.
	if r := get("/robots.txt", "br, gzip"); r.Header.Get("Content-Encoding") != "" || string(body(r)) != "User-agent: *\n" {
		t.Errorf("robots.txt : encodage %q", r.Header.Get("Content-Encoding"))
	}
	// Images : jamais de Vary ni de variante.
	if r := get("/assets/aurora-ink.png", "br"); r.Header.Get("Vary") != "" {
		t.Errorf("png : Vary %q", r.Header.Get("Vary"))
	}
	// Cache : immuable pour les fichiers à empreinte seulement (le reste garde l'en-tête du
	// gestionnaire englobant, no-store, posé par api.New).
	for p, want := range map[string]bool{
		"/assets/index-AbCd_123.js":  true,
		"/assets/style-Zz9_Yy8x.css": true,
		"/assets/aurora-ink.png":     false,
		"/":                          false,
		"/robots.txt":                false,
	} {
		got := get(p, "").Header.Get("Cache-Control") == "public, max-age=31536000, immutable"
		if got != want {
			t.Errorf("%s : immuable = %v, attendu %v", p, got, want)
		}
	}
}

func TestAccepts(t *testing.T) {
	for h, want := range map[string]bool{"br": true, "BR": true, " gzip , br ;q=0.5": true, "br;q=0": false, "br; q=0.000": false, "brotli": false, "": false} {
		if accepts(h, "br") != want {
			t.Errorf("accepts(%q) != %v", h, want)
		}
	}
}
