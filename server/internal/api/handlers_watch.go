package api

import (
	"net/http"

	"github.com/skoow/shhdrop/server/internal/token"
)

// GET /api/shares/watch (spec §41.8) : surveillance de la disparition d'un partage ouvert,
// avec le jeton de téléchargement. Tenue 25 s au plus (raccourcie à l'échéance du partage) :
// 204 si rien, 410 « gone » dès la disparition (suppression, échéance, signalement,
// administrateur), en moins d'une seconde. 2 par connexion (la 3ᵉ → 429), 256 au total
// (→ 503), hors des 60 requêtes par minute (compte dans les requêtes de segments). Rien
// n'est journalisé ni gardé après la réponse (coût dit en spec §36 S60).
func (s *server) watch(w http.ResponseWriter, r *http.Request) {
	id, openN, err := s.checkToken(r, token.Download)
	if err != nil {
		fail(w, err)
		return
	}
	release, ok := s.slot(w, r, s.watchSlots)
	if !ok {
		return
	}
	defer release()
	wt, err := s.svc.Watch(id, openN)
	if err != nil {
		fail(w, err)
		return
	}
	defer wt.Stop()
	hold := min(watchHold, wt.Expires.Sub(s.svc.Now()))
	c, stop := s.wait(max(hold, 0))
	defer stop()
	select {
	case <-wt.Gone:
		writeErr(w, http.StatusGone, "gone")
	case <-c:
		if !s.svc.Now().Before(wt.Expires) {
			writeErr(w, http.StatusGone, "gone")
			return
		}
		w.WriteHeader(http.StatusNoContent)
	case <-r.Context().Done():
	}
}
