package api

import (
	"strings"
	"testing"
)

// cspActuelle : CSP commune d'avant le salon, recopiée telle quelle : sans salon elle ne doit
// pas changer d'un octet.
const cspActuelle = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; " +
	"img-src 'self' blob:; media-src 'self' blob:; connect-src 'self' blob:; worker-src 'self' blob:; frame-src 'self'; " +
	"object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; require-trusted-types-for 'script'; trusted-types svelte-trusted-html shhdrop"

func TestCSPWebSocket(t *testing.T) {
	if got := cspFor(""); got != cspActuelle {
		t.Fatalf("cspFor(\"\") =\n%s\nattendu\n%s", got, cspActuelle)
	}
	want := strings.Replace(cspActuelle, "connect-src 'self' blob:;", "connect-src 'self' blob: wss://shhdrop.app;", 1)
	if got := cspFor("https://shhdrop.app"); got != want {
		t.Fatalf("cspFor(https) =\n%s\nattendu\n%s", got, want)
	}
	if got := cspFor("http://127.0.0.1:8080"); !strings.Contains(got, "connect-src 'self' blob: ws://127.0.0.1:8080;") {
		t.Fatalf("cspFor(http) = %s", got)
	}

	// Sans salon (valeur zéro) : en-tête inchangé sur toutes les pages.
	e := newEnv(t, false, nil)
	for _, p := range []string{"/", "/s/x", "/api/health"} {
		if c := get(e, p)["Content-Security-Policy"]; len(c) != 1 || c[0] != cspActuelle {
			t.Errorf("sans salon, %s : CSP = %v", p, c)
		}
	}
	// Salon actif : la CSP calculée est posée partout, sauf sur le cadre PDF (connect-src 'none').
	e.h = newHandler(e.srv, htmlStatic(), Salons{Origin: "https://shhdrop.app"})
	for _, p := range []string{"/", "/s/x", "/api/health"} {
		c := get(e, p)["Content-Security-Policy"]
		if len(c) != 1 || c[0] != want || !strings.Contains(c[0], "connect-src 'self' blob: wss://shhdrop.app;") {
			t.Errorf("salon actif, %s : CSP = %v", p, c)
		}
	}
	if c := get(e, "/pdf-frame.html")["Content-Security-Policy"]; len(c) != 1 || !strings.Contains(c[0], "connect-src 'none'") {
		t.Errorf("salon actif, /pdf-frame.html : CSP = %v", c)
	}
}
