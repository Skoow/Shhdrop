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

// pathHeaders pose les en-têtes qui dépendent du chemin, après les en-têtes communs
// (plus de X-Robots-Tag : les liens sont à la racine, le secret après « # », spec §32) :
//   - Cross-Origin-Resource-Policy: cross-origin sur les trois fichiers du cadre PDF ;
//   - frame-ancestors 'self' (au lieu de 'none') sur /pdf-frame.html seulement.
func pathHeaders(h http.Header, p string) {
	if pdfFrameFiles[p] {
		h.Set("Cross-Origin-Resource-Policy", "cross-origin")
	}
	if p == pdfFramePage {
		h.Set("Content-Security-Policy", strings.Replace(
			h.Get("Content-Security-Policy"), "frame-ancestors 'none'", "frame-ancestors 'self'", 1))
	}
}
