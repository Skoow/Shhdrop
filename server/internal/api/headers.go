package api

import "net/http"

// securityHeaders : en-têtes de la spec §10, posés sur toutes les réponses
// (sans require-trusted-types-for à ce stade).
// Cache-Control: no-store partout : exigé pour /api/* et le HTML (bfcache, spec §21) ;
// l'appliquer aussi aux fichiers statiques reste du côté sûr et évite de trier par type.
var securityHeaders = [][2]string{
	{"Content-Security-Policy", "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; " +
		"img-src 'self' blob:; media-src 'self' blob:; connect-src 'self'; frame-src 'self'; object-src 'none'; " +
		"base-uri 'none'; form-action 'self'; frame-ancestors 'none'"},
	{"Referrer-Policy", "no-referrer"},
	{"X-Content-Type-Options", "nosniff"},
	{"Permissions-Policy", "microphone=(self), camera=(), geolocation=()"},
	{"Cross-Origin-Opener-Policy", "same-origin"},
	{"Cross-Origin-Resource-Policy", "same-origin"},
	{"Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload"},
	{"Cache-Control", "no-store"},
}

func withHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		for _, kv := range securityHeaders {
			h.Set(kv[0], kv[1])
		}
		next.ServeHTTP(w, r)
	})
}
