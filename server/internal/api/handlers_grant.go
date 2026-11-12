package api

import (
	"net/http"

	"github.com/skoow/shhdrop/server/internal/share"
)

// Octroi d'ouverture (spec §41.4, D42-22) : en-tête X-Shh-Grant de meta et unlock. Plus de
// renouvellement (regrant) ni de « je pars » (leave) : l'octroi vaut jusqu'à l'échéance.

// grantHeader : X-Shh-Grant absent (""), ou présent une fois avec 54 caractères base64url
// (sa validité est vérifiée par le service) ; autrement 400.
func grantHeader(r *http.Request) (string, error) {
	v := r.Header.Values("X-Shh-Grant")
	switch {
	case len(v) == 0:
		return "", nil
	case len(v) > 1:
		return "", errBadRequest
	}
	if _, err := share.DecodeB64(v[0], 40); err != nil {
		return "", errBadRequest
	}
	return v[0], nil
}
