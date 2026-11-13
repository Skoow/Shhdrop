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
// sandbox allow-scripts (audit du 11 novembre) : les mêmes droits que l'attribut
// sandbox="allow-scripts" de web/src/viewers/PdfViewer.svelte, posés par le serveur, donc
// valables aussi si la page est ouverte directement (onglet, cadre sans attribut) : origine
// opaque, ni formulaire, ni fenêtre, ni navigation du parent. postMessage marche toujours
// (cible « * », source vérifiée des deux côtés). Rien ne change pour le cadre de l'application :
// les deux listes de droits se combinent par intersection, et elles sont identiques.
const pdfFrameCSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src blob: data:; " +
	"connect-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'self'; sandbox allow-scripts"

func pathHeaders(h http.Header, p string) {
	if pdfFrameFiles[p] {
		h.Set("Cross-Origin-Resource-Policy", "cross-origin")
	}
	if p == pdfFramePage {
		h.Set("Content-Security-Policy", pdfFrameCSP)
		h.Set("Permissions-Policy", pdfFramePermissions)
		// Embarqué par l'application en même origine (frame-ancestors 'self') : DENY (en-tête
		// commun) le casserait sur un vieux navigateur sans CSP niveau 2 ; SAMEORIGIN l'y autorise.
		h.Set("X-Frame-Options", "SAMEORIGIN")
	}
}
