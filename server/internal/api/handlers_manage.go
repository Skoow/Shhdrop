package api

import (
	"io"
	"net/http"
)

// Gestion par l'expéditeur (spec §32, §33) : le lien de gestion ne porte que S_gestion ; le
// partage est trouvé par V_gestion = SHA-256(S_gestion) (index unique). Toute erreur
// (secret mal formé, faux, partage mort) → 404 uniforme ou 400 de format, jamais un détail.

// manageSecret lit S_gestion (X-Shh-Manage, une seule fois, 43 caractères base64url) et
// exige un corps vide : rien d'autre ne transite par ces routes.
func manageSecret(w http.ResponseWriter, r *http.Request) ([]byte, error) {
	if _, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 0)); err != nil {
		return nil, errBadRequest
	}
	return headerSecret(r, "X-Shh-Manage")
}

// GET /api/manage/status : ouvertures utilisées, maximum, secondes restantes, état.
func (s *server) manageStatus(w http.ResponseWriter, r *http.Request) {
	sg, err := manageSecret(w, r)
	if err != nil {
		fail(w, err)
		return
	}
	st, err := s.svc.Status(sg)
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, struct {
		OpensUsed int    `json:"opens_used"`
		MaxOpens  int    `json:"max_opens"`
		ExpiresIn int64  `json:"expires_in_s"`
		State     string `json:"state"`
	}{st.OpensUsed, st.MaxOpens, secs(st.ExpiresIn), st.State})
}

// POST /api/manage/destroy : destruction par l'expéditeur (aussi l'abandon d'un envoi,
// en keepalive).
func (s *server) manageDestroy(w http.ResponseWriter, r *http.Request) {
	sg, err := manageSecret(w, r)
	if err != nil {
		fail(w, err)
		return
	}
	if err := s.svc.DestroyManaged(sg); err != nil {
		fail(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
