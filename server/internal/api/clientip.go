package api

import (
	"net/http"
	"net/netip"
	"strings"
)

// ClientIP rend l'adresse du client (spec §8, « IP de confiance »).
//
// Le serveur n'écoute qu'en local derrière Caddy : l'en-tête X-Shh-Client-IP n'est cru
// que si le pair TCP est en boucle locale (127.0.0.0/8 ou ::1). X-Forwarded-For n'est
// jamais lu. Si l'en-tête manque ou est invalide, on rend l'adresse locale : toutes ces
// requêtes partagent alors les mêmes limites (échec du côté sûr).
// Rend une adresse invalide si RemoteAddr est illisible.
func ClientIP(r *http.Request) netip.Addr {
	peer := parse(r.RemoteAddr)
	if !peer.IsLoopback() {
		return peer
	}
	if h := r.Header.Values("X-Shh-Client-IP"); len(h) == 1 {
		if a, err := netip.ParseAddr(strings.TrimSpace(h[0])); err == nil {
			return a.Unmap().WithZone("")
		}
	}
	return peer
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
