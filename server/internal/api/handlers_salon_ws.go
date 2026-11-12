package api

import (
	"context"
	"encoding/base64"
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
// navigateur d'un membre). Puis poignée de main vérifiée ici (poigneeWS : 400 bad_request
// fixe, sans rien recopier de la requête, quand Accept aurait refusé avec un texte qui la
// cite ; aucun corps admis ; refus de version : Sec-WebSocket-Version: 13 en plus). Puis
// place (429 limit, 503 busy) ; échéances HTTP de la connexion (ReadTimeout, WriteTimeout)
// effacées seulement alors, juste avant la mise à niveau : une
// requête refusée garde ses délais (un corps envoyé au goutte-à-goutte est coupé). Le
// WebSocket vit tant que les pings passent (le salon ferme un client muet après 45 s).
// Compression coupée (trames chiffrées, incompressibles ; pas d'attaque par compression ni de
// mémoire par connexion). Rien de la requête n'est journalisé ni gardé ; l'adresse ne sert
// qu'aux limites (clés HMAC).
func (a salonAPI) salonWS(w http.ResponseWriter, r *http.Request) {
	o := r.Header.Values("Origin")
	hote := origineHote(a.origin)
	if len(o) != 1 || o[0] != a.origin || hote == "" {
		writeErr(w, http.StatusForbidden, "forbidden")
		return
	}
	if ok, version := poigneeWS(r); !ok {
		if version {
			// RFC 6455 §4.2.2 (MUST) : versions comprises par le serveur ; constante, rien
			// n'est recopié de la requête.
			w.Header().Set("Sec-WebSocket-Version", "13")
		}
		writeErr(w, http.StatusBadRequest, "bad_request")
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
		// Inatteignable après poigneeWS (HTTP/2 y est déjà refusé), sauf ResponseWriter
		// enveloppé sans Hijack ou Hijack qui échoue : réponse déjà écrite par Accept ; la
		// connexion est coupée au lieu de rester sans échéance.
		_ = rc.SetReadDeadline(time.Now())
		return
	}
	c.SetReadLimit(salon.LimiteLecture)
	_ = a.m.Servir(r.Context(), wsLien{c}, ipOf(r), a.lim.AllowFrame)
}

// poigneeWS : poignée de main WebSocket (RFC 6455 §4.2.1) au moins aussi stricte que celle
// d'Accept, qui ne refuse donc jamais après elle : HTTP/1.1 ou plus en HTTP/1 (Hijack), GET,
// aucun corps, Upgrade contenant websocket et Connection contenant upgrade (jetons, sans
// tenir compte de la casse), Sec-WebSocket-Version 13 une seule fois, Sec-WebSocket-Key une
// seule fois, 24 caractères base64 standard canoniques pour 16 octets. version : le refus
// vient de Sec-WebSocket-Version (absent, en double ou autre que 13).
func poigneeWS(r *http.Request) (ok, version bool) {
	if r.ProtoMajor != 1 || r.ProtoMinor < 1 || r.Method != http.MethodGet ||
		r.ContentLength != 0 || len(r.TransferEncoding) > 0 {
		return false, false
	}
	if !jeton(r.Header.Values("Upgrade"), "websocket") || !jeton(r.Header.Values("Connection"), "upgrade") {
		return false, false
	}
	if v := r.Header.Values("Sec-WebSocket-Version"); len(v) != 1 || v[0] != "13" {
		return false, true
	}
	k := r.Header.Values("Sec-WebSocket-Key")
	if len(k) != 1 || len(k[0]) != 24 {
		return false, false
	}
	b, err := base64.StdEncoding.Strict().DecodeString(k[0])
	return err == nil && len(b) == 16, false
}

// jeton : un des jetons (listes séparées par des virgules) de vs vaut t, casse ignorée.
func jeton(vs []string, t string) bool {
	for _, v := range vs {
		for x := range strings.SplitSeq(v, ",") {
			if strings.EqualFold(strings.TrimSpace(x), t) {
				return true
			}
		}
	}
	return false
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
