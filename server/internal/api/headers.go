package api

import "net/http"

// securityHeaders : en-têtes de la spec §10, posés sur toutes les réponses
// Trusted Types (10 novembre) : toute chaîne brute donnée à un point d'injection de script
// est refusée ; seules deux politiques existent, celle des gabarits de Svelte et « shhdrop »
// (web/src/app/trusted.ts : nos fichiers de assets/ et les Blob de cette origine).
// Cache-Control: no-store par défaut : exigé pour /api/* et le HTML (bfcache, spec §21), gardé
// pour tout fichier du site dont le nom ne porte pas d'empreinte. Seule exception, posée par
// le gestionnaire des fichiers du site (cmd/shhdrop/static.go, immutableAsset) : les fichiers
// à empreinte de /assets/ (contenu fixe sous ce nom), en cache un an.
// worker-src … blob: : le Worker d'Argon2id est lancé depuis un Blob dont les octets viennent
// d'un fetch avec `integrity` (web/src/crypto/argon2-run.worker.ts) ; new Worker(url) n'a pas
// de contrôle d'intégrité (spec §28.3). Un Blob ne donne rien de plus à un script déjà exécuté.
var securityHeaders = [][2]string{
	{"Content-Security-Policy", "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; " +
		"img-src 'self' blob:; media-src 'self' blob:; connect-src 'self'; worker-src 'self' blob:; frame-src 'self'; " +
		"object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; require-trusted-types-for 'script'; trusted-types svelte-trusted-html shhdrop"},
	{"Referrer-Policy", "no-referrer"},
	{"X-Content-Type-Options", "nosniff"},
	// camera=(self) : photo et vidéo prises dans l'interface (Q-REC1 acceptée par le propriétaire,
	// spec §35.3) ; /pdf-frame.html n'a besoin ni du micro ni de la caméra (pathHeaders).
	// Le reste est refusé explicitement (audit F3) : fonctions puissantes inutilisées, qui
	// valent sinon « self » et serviraient à un script injecté (capture d'écran, lecture du
	// presse-papiers, périphériques, capteurs). clipboard-write, web-share, screen-wake-lock,
	// fullscreen et publickey-credentials-* restent à leur défaut (self) : utilisés ou prévus (§37.9).
	{"Permissions-Policy", "microphone=(self), camera=(self), " + deniedFeatures},
	{"Cross-Origin-Opener-Policy", "same-origin"},
	{"Cross-Origin-Resource-Policy", "same-origin"},
	{"Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload"},
	{"Cache-Control", "no-store"},
}

// deniedFeatures : fonctions refusées sur toutes les pages (spec §10, audit F3).
const deniedFeatures = "geolocation=(), display-capture=(), clipboard-read=(), usb=(), serial=(), hid=(), " +
	"payment=(), gyroscope=(), accelerometer=(), magnetometer=(), midi=(), " +
	"xr-spatial-tracking=(), browsing-topics=(), interest-cohort=()"

func withHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		for _, kv := range securityHeaders {
			h.Set(kv[0], kv[1])
		}
		pathHeaders(h, r.URL.Path)
		next.ServeHTTP(w, r)
	})
}
