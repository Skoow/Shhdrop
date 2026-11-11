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

// Le cadre PDF a sa propre CSP, fermée (revue du 10 novembre) : il ne charge que son script
// et sa feuille de style, dessine des <canvas> (images blob: et data:), et n'ouvre aucune
// connexion, aucun cadre, aucun Worker, aucun WebAssembly (pdf.js y tourne sur le fil
// principal, useWasm: false). Seule la page de l'application peut l'embarquer. sandbox
// allow-scripts (audit du 11 novembre) : origine opaque même ouvert directement, hors du cadre
// sandbox de l'application (mêmes droits que l'attribut sandbox="allow-scripts" de PdfViewer).
func TestPdfFrameCSP(t *testing.T) {
	e := newEnv(t, false, nil)
	const want = "default-src 'none'; script-src 'self'; style-src 'self'; img-src blob: data:; " +
		"connect-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'self'; sandbox allow-scripts"
	csp := get(e, "/pdf-frame.html")["Content-Security-Policy"]
	if len(csp) != 1 || csp[0] != want {
		t.Fatalf("/pdf-frame.html : CSP = %v\nattendu %s", csp, want)
	}
	for _, p := range []string{"/", "/pdf-frame.js", "/pdf-frame.css", "/s/x", "/pdf-frame.html/x", "/api/health"} {
		c := get(e, p)["Content-Security-Policy"]
		if len(c) != 1 || c[0] != securityHeaders[0][1] || !strings.Contains(c[0], "frame-ancestors 'none'") ||
			strings.Contains(c[0], "frame-ancestors 'self'") {
			t.Errorf("%s : CSP = %v, attendu la CSP commune (frame-ancestors 'none')", p, c)
		}
	}
}

func TestFrameSrcDefault(t *testing.T) {
	e := newEnv(t, false, nil)
	for _, p := range []string{"/", "/s/x"} {
		c := get(e, p)["Content-Security-Policy"]
		if len(c) != 1 || !strings.Contains(c[0], "frame-src 'self'; object-src 'none'") {
			t.Errorf("%s : frame-src modifié : %v", p, c)
		}
	}
	// Le cadre PDF n'embarque lui-même aucun cadre (default-src 'none').
	if c := get(e, "/pdf-frame.html")["Content-Security-Policy"]; len(c) != 1 || strings.Contains(c[0], "frame-src") ||
		!strings.HasPrefix(c[0], "default-src 'none';") {
		t.Errorf("/pdf-frame.html : %v", c)
	}
}

// Workers (preuve de travail, chiffrement) : seulement ceux du site, dit explicitement.
func TestWorkerSrc(t *testing.T) {
	e := newEnv(t, false, nil)
	for _, p := range []string{"/", "/s/x", "/api/health"} {
		c := get(e, p)["Content-Security-Policy"]
		if len(c) != 1 || !strings.Contains(c[0], "; worker-src 'self' blob:;") {
			t.Errorf("%s : worker-src absent : %v", p, c)
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
	if got := get(e, "/")["Permissions-Policy"]; len(got) != 1 || got[0] != "microphone=(self), camera=(self), geolocation=(), display-capture=(), clipboard-read=(), usb=(), serial=(), hid=(), payment=(), gyroscope=(), accelerometer=(), magnetometer=(), midi=(), xr-spatial-tracking=(), browsing-topics=(), interest-cohort=()" {
		t.Errorf("/ : Permissions-Policy = %v", got)
	}
	for _, p := range []string{"/pdf-frame.html"} {
		if got := get(e, p)["Permissions-Policy"]; len(got) != 1 || got[0] != "microphone=(), camera=(), geolocation=(), display-capture=(), clipboard-read=(), usb=(), serial=(), hid=(), payment=(), gyroscope=(), accelerometer=(), magnetometer=(), midi=(), xr-spatial-tracking=(), browsing-topics=(), interest-cohort=()" {
			t.Errorf("%s : Permissions-Policy = %v", p, got)
		}
	}
}
