package api

import (
	"strings"
	"testing"
)

func get(e *env, p string) map[string][]string {
	return e.do(req{method: "GET", path: p}).Header()
}

// Spec §32 : liens à la racine (« /#clé ») ; X-Robots-Tag n'a plus d'usage, nulle part.
func TestNoRobotsHeader(t *testing.T) {
	e := newEnv(t, false, nil)
	for _, p := range []string{"/", "/index.html", "/s/abc", "/m/abc", "/s/", "/m/x/y", "/api/health"} {
		if got := get(e, p)["X-Robots-Tag"]; len(got) != 0 {
			t.Errorf("%s : X-Robots-Tag inattendu %v", p, got)
		}
	}
}

func TestPdfFrameCORP(t *testing.T) {
	e := newEnv(t, false, nil)
	for _, p := range []string{"/pdf-frame.html", "/pdf-frame.js", "/pdf-frame.css"} {
		if got := get(e, p)["Cross-Origin-Resource-Policy"]; len(got) != 1 || got[0] != "cross-origin" {
			t.Errorf("%s : CORP = %v, attendu cross-origin", p, got)
		}
	}
	for _, p := range []string{"/", "/index.html", "/pdf-frame", "/pdf-frame.html/x", "/pdf-frame.map", "/assets/pdf-frame.js", "/s/pdf-frame.html", "/PDF-FRAME.HTML"} {
		if got := get(e, p)["Cross-Origin-Resource-Policy"]; len(got) != 1 || got[0] != "same-origin" {
			t.Errorf("%s : CORP = %v, attendu same-origin", p, got)
		}
	}
}

func TestPdfFrameAncestors(t *testing.T) {
	e := newEnv(t, false, nil)
	csp := get(e, "/pdf-frame.html")["Content-Security-Policy"]
	if len(csp) != 1 || !strings.Contains(csp[0], "frame-ancestors 'self'") {
		t.Fatalf("/pdf-frame.html : CSP = %v", csp)
	}
	if strings.Contains(csp[0], "frame-ancestors 'none'") {
		t.Fatalf("/pdf-frame.html garde frame-ancestors 'none' : %v", csp)
	}
	// Le reste de la CSP est identique : seul frame-ancestors change.
	want := strings.Replace(securityHeaders[0][1], "frame-ancestors 'none'", "frame-ancestors 'self'", 1)
	if csp[0] != want {
		t.Errorf("CSP du cadre PDF différente de la CSP par défaut hors frame-ancestors :\n%s\n%s", csp[0], want)
	}
	for _, p := range []string{"/", "/pdf-frame.js", "/pdf-frame.css", "/s/x", "/pdf-frame.html/x", "/api/health"} {
		c := get(e, p)["Content-Security-Policy"]
		if len(c) != 1 || !strings.Contains(c[0], "frame-ancestors 'none'") || strings.Contains(c[0], "frame-ancestors 'self'") {
			t.Errorf("%s : CSP = %v, attendu frame-ancestors 'none'", p, c)
		}
	}
}

func TestFrameSrcDefault(t *testing.T) {
	e := newEnv(t, false, nil)
	for _, p := range []string{"/", "/s/x", "/pdf-frame.html"} {
		c := get(e, p)["Content-Security-Policy"]
		if len(c) != 1 || !strings.Contains(c[0], "frame-src 'self'; object-src 'none'") {
			t.Errorf("%s : frame-src modifié : %v", p, c)
		}
	}
}

func TestSecurityHeadersKept(t *testing.T) {
	e := newEnv(t, false, nil)
	for _, p := range []string{"/", "/s/x", "/m/x", "/pdf-frame.html", "/pdf-frame.js", "/pdf-frame.css", "/api/health"} {
		h := get(e, p)
		for _, kv := range securityHeaders {
			got := h[kv[0]]
			if len(got) != 1 {
				t.Errorf("%s : %s absent ou en double : %v", p, kv[0], got)
				continue
			}
			switch {
			case kv[0] == "Content-Security-Policy" && p == "/pdf-frame.html":
			case kv[0] == "Permissions-Policy" && p == "/pdf-frame.html":
			case kv[0] == "Cross-Origin-Resource-Policy" && strings.HasPrefix(p, "/pdf-frame."):
			default:
				if got[0] != kv[1] {
					t.Errorf("%s : %s = %q, attendu %q", p, kv[0], got[0], kv[1])
				}
			}
		}
	}
}

// Caméra et micro : permis à la page (vocal, photo et vidéo prises dans l'interface), jamais au cadre PDF.
func TestPermissionsPolicy(t *testing.T) {
	e := newEnv(t, false, nil)
	if got := get(e, "/")["Permissions-Policy"]; len(got) != 1 || got[0] != "microphone=(self), camera=(self), geolocation=()" {
		t.Errorf("/ : Permissions-Policy = %v", got)
	}
	for _, p := range []string{"/pdf-frame.html"} {
		if got := get(e, p)["Permissions-Policy"]; len(got) != 1 || got[0] != "microphone=(), camera=(), geolocation=()" {
			t.Errorf("%s : Permissions-Policy = %v", p, got)
		}
	}
}
