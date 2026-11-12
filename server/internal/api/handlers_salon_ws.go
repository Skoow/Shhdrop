package api

import (
	"context"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/coder/websocket"

	"github.com/skoow/shhdrop/server/internal/salon"
)

// WebSocket du salon (plan C-2 Task 10, « Protocole », Review Focus 3) : GET /api/salons/ws.
// Aucun secret dans l'URL : le jeton de membre arrive dans le premier message (accueil).

// Places des WebSocket ouverts : 2 000 au total, 4 par connexion (/64 ou IPv4), 16 par /48.
const wsTotal, wsPer64, wsPer48 = 2000, 4, 16

// salonWS : Origin présent une seule fois et égal à SHH_ORIGIN octet pour octet, sinon 403
// forbidden avant toute mise à niveau (aucun autre site ne peut ouvrir le WebSocket avec le
// navigateur d'un membre). Puis place (429 limit, 503 busy) ; échéances HTTP de la connexion
// (ReadTimeout, WriteTimeout) effacées avant la mise à niveau : le WebSocket vit tant que les
// pings passent (le salon ferme un client muet après 45 s). Compression coupée (trames
// chiffrées, incompressibles ; pas d'attaque par compression ni de mémoire par connexion).
// Rien de la requête n'est journalisé ; l'adresse ne sert qu'aux limites (clés HMAC).
func (a salonAPI) salonWS(w http.ResponseWriter, r *http.Request) {
	o := r.Header.Values("Origin")
	hote := origineHote(a.origin)
	if len(o) != 1 || o[0] != a.origin || hote == "" {
		writeErr(w, http.StatusForbidden, "forbidden")
		return
	}
	release, ok := a.slot(w, r, a.wsSlots)
	if !ok {
		return
	}
	defer release()
	// net/http efface déjà les échéances au Hijack (net/http/server.go, hijackLocked) : ce
	// double ne dépend pas de ce détail de la bibliothèque standard.
	rc := http.NewResponseController(w)
	if rc.SetReadDeadline(time.Time{}) != nil || rc.SetWriteDeadline(time.Time{}) != nil {
		writeErr(w, http.StatusInternalServerError, "internal")
		return
	}
	c, err := websocket.Accept(w, r, &websocket.AcceptOptions{
		CompressionMode: websocket.CompressionDisabled,
		OriginPatterns:  []string{hote},
	})
	if err != nil {
		return // réponse d'erreur déjà écrite par Accept
	}
	c.SetReadLimit(salon.LimiteLecture)
	_ = a.m.Servir(r.Context(), wsLien{c}, ipOf(r), a.lim.AllowFrame)
}

// origineHote : hôte (avec port) de l'origine publique, motif de OriginPatterns ; vide si
// elle est illisible ou porte un caractère de motif (path.Match), le salon étant alors fermé
// (403 partout). config.originOK n'admet déjà que des noms DNS : aucun motif invalide, donc
// jamais le log.Printf de coder/websocket (accept.go, path.ErrBadPattern).
func origineHote(origin string) string {
	u, err := url.Parse(origin)
	if err != nil || (u.Scheme != "https" && u.Scheme != "http") || u.Host == "" ||
		strings.ContainsAny(u.Host, `*?[]\`) {
		return ""
	}
	return u.Host
}

// wsLien : salon.Lien sur coder/websocket.
type wsLien struct{ c *websocket.Conn }

// Lire : message binaire suivant ; un message texte rend salon.ErrProtocole (4003).
func (l wsLien) Lire(ctx context.Context) ([]byte, error) {
	t, b, err := l.c.Read(ctx)
	if err != nil {
		return nil, err
	}
	if t != websocket.MessageBinary {
		return nil, salon.ErrProtocole
	}
	return b, nil
}

func (l wsLien) Ecrire(ctx context.Context, b []byte) error {
	return l.c.Write(ctx, websocket.MessageBinary, b)
}

func (l wsLien) Ping(ctx context.Context) error { return l.c.Ping(ctx) }

// Fermer : poignée de fermeture (au plus quelques secondes), puis la connexion est fermée et
// tout Read, Write ou Ping en cours rend une erreur.
func (l wsLien) Fermer(code int, raison string) error {
	return l.c.Close(websocket.StatusCode(code), raison)
}
