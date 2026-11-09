package api

import (
	"io"
	"net/http"

	"github.com/skoow/shhdrop/server/internal/share"
	"github.com/skoow/shhdrop/server/internal/token"
)

// Octroi d'ouverture (spec §41.4) : en-tête X-Shh-Grant de meta et unlock, renouvellement.

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

// POST /api/shares/regrant (jeton de téléchargement) : octroi renouvelé de 30 min, jamais
// au-delà du jeton ni de l'échéance du partage. Ouverture terminée ou partage disparu : 410.
func (s *server) regrant(w http.ResponseWriter, r *http.Request) {
	tok, err := bearer(r)
	if err != nil {
		fail(w, err)
		return
	}
	id, openN, exp, err := s.sig.SubjectExp(tok, token.Download)
	if err != nil {
		fail(w, err)
		return
	}
	g, err := s.svc.Regrant(id, openN, exp)
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, struct {
		Grant string `json:"grant"`
	}{g})
}

// POST /api/shares/leave (D41-28) : « je pars », envoyé au pagehide de la dernière ouverture
// permise par fetch keepalive (même garantie de remise que sendBeacon, mot interdit par
// §35.1 ; et un en-tête Authorization possible). Jeton de téléchargement en Bearer, corps vide
// exigé (motif fermé). Arme la destruction dans 3 min (share.Leave) ; sans effet pour une
// ouverture non dernière. Réponse 204 vide, jamais d'écho.
func (s *server) leave(w http.ResponseWriter, r *http.Request) {
	if n, err := io.Copy(io.Discard, http.MaxBytesReader(w, r.Body, 1)); err != nil || n != 0 {
		fail(w, errBadRequest)
		return
	}
	id, openN, err := s.checkToken(r, token.Download)
	if err != nil {
		fail(w, err)
		return
	}
	if err := s.svc.Leave(id, openN); err != nil {
		fail(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
