package api

import (
	"net/http"
	"net/netip"
	"strings"
)

// ClientIP rend l'adresse du client (spec §8, « IP de confiance »).
//
// L'en-tête X-Shh-Client-IP n'est cru que si le pair TCP est un proxy de confiance : la
// boucle locale (127.0.0.0/8 ou ::1), ou un réseau de proxies (SHH_TRUSTED_PROXY, par
// exemple le réseau Docker de Caddy). X-Forwarded-For n'est jamais lu. Si l'en-tête manque
// ou est invalide, on rend l'adresse du proxy : toutes ces requêtes partagent alors les
// mêmes limites (échec du côté sûr). Rend une adresse invalide si RemoteAddr est illisible.
func ClientIP(r *http.Request, proxies []netip.Prefix) netip.Addr {
	a, _ := clientIP(r, proxies)
	return a
}

// isProxy : pair dont X-Shh-Client-IP est cru.
func isProxy(peer netip.Addr, proxies []netip.Prefix) bool {
	if peer.IsLoopback() {
		return true
	}
	for _, p := range proxies {
		if p.Contains(peer) {
			return true
		}
	}
	return false
}

// clientIP rend aussi trusted = faux pour une requête d'un proxy sans X-Shh-Client-IP
// valide (à refuser derrière le proxy : SHH_BEHIND_PROXY=1).
func clientIP(r *http.Request, proxies []netip.Prefix) (addr netip.Addr, trusted bool) {
	peer := parse(r.RemoteAddr)
	if !isProxy(peer, proxies) {
		return peer, true
	}
	if h := r.Header.Values("X-Shh-Client-IP"); len(h) == 1 {
		if a, err := netip.ParseAddr(strings.TrimSpace(h[0])); err == nil {
			return a.Unmap().WithZone(""), true
		}
	}
	return peer, false
}

func parse(remote string) netip.Addr {
	if ap, err := netip.ParseAddrPort(remote); err == nil {
		return ap.Addr().Unmap().WithZone("")
	}
	if a, err := netip.ParseAddr(remote); err == nil {
		return a.Unmap().WithZone("")
	}
	return netip.Addr{}
}
