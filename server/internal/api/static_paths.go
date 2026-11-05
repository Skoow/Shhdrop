package api

import (
	"net/http"
	"strings"
)

const pdfFramePage = "/pdf-frame.html"

// Fichiers du cadre PDF : liste fermée, embarqués par l'application elle-même
// depuis un document d'origine opaque (CORP cross-origin nécessaire).
var pdfFrameFiles = map[string]bool{
	pdfFramePage:     true,
	"/pdf-frame.js":  true,
	"/pdf-frame.css": true,
}

// pathHeaders pose les en-têtes qui dépendent du chemin, après les en-têtes communs :
//   - X-Robots-Tag: noindex sur /s/* et /m/* (liens de partage et de gestion) ;
//   - Cross-Origin-Resource-Policy: cross-origin sur les trois fichiers du cadre PDF ;
//   - frame-ancestors 'self' (au lieu de 'none') sur /pdf-frame.html seulement.
func pathHeaders(h http.Header, p string) {
	if strings.HasPrefix(p, "/s/") || strings.HasPrefix(p, "/m/") {
		h.Set("X-Robots-Tag", "noindex")
	}
	if pdfFrameFiles[p] {
		h.Set("Cross-Origin-Resource-Policy", "cross-origin")
	}
	if p == pdfFramePage {
		h.Set("Content-Security-Policy", strings.Replace(
			h.Get("Content-Security-Policy"), "frame-ancestors 'none'", "frame-ancestors 'self'", 1))
	}
}
