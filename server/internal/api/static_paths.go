package api

import "net/http"

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
//   - CSP propre (pdfFrameCSP) et Permissions-Policy fermée sur /pdf-frame.html seulement.
//
// pdfFramePermissions : le cadre PDF n'a jamais besoin du micro, de la caméra ni de la position.
const pdfFramePermissions = "microphone=(), camera=(), " + deniedFeatures

// pdfFrameCSP : CSP du cadre PDF, fermée. Il ne charge que pdf-frame.js et pdf-frame.css,
// dessine des <canvas> (images blob: et data:) et ne se connecte à rien : pdf.js y tourne sur
// le fil principal (aucun Worker), sans WebAssembly (useWasm: false) ni police téléchargée.
// frame-ancestors 'self' : seule la page de l'application l'embarque (cadre sandbox).
const pdfFrameCSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src blob: data:; " +
	"connect-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'self'"

func pathHeaders(h http.Header, p string) {
	if pdfFrameFiles[p] {
		h.Set("Cross-Origin-Resource-Policy", "cross-origin")
	}
	if p == pdfFramePage {
		h.Set("Content-Security-Policy", pdfFrameCSP)
		h.Set("Permissions-Policy", pdfFramePermissions)
	}
}
