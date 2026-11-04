// Package api expose l'API HTTP de Shhdrop (spec §8) et pose les en-têtes de sécurité (§10).
//
// Aucun journal d'accès : rien de la requête (adresse, chemin, en-têtes, corps) n'est
// jamais écrit. Les secrets arrivent en base64url sans bourrage, dans des en-têtes ou le
// corps, jamais dans l'URL. Toute clé inconnue, partage expiré, détruit ou inexistant
// donne la même réponse 404 {"error":"not_found"}.
package api

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"math"
	"net/http"
	"net/netip"
	"strings"
	"time"

	"github.com/skoow/shhdrop/server/internal/captcha"
	"github.com/skoow/shhdrop/server/internal/limits"
	"github.com/skoow/shhdrop/server/internal/share"
	"github.com/skoow/shhdrop/server/internal/token"
)

const (
	maxJSON       = 4 << 10
	captchaTTL    = 2 * time.Minute // durée du jeton shown_at (= celle du défi ALTCHA)
	uploadTTL     = time.Hour
	downloadTTL   = time.Hour
	captchaTokID  = "captcha"
	maxSegmentLen = share.Header + share.SegChunks*share.ChunkCT
)

var b64 = base64.RawURLEncoding.Strict()

type server struct {
	svc         *share.Service
	sig         *token.Signer
	lim         *limits.Limiter
	cap         *captcha.Captcha
	behindProxy bool
}

type ctxIP struct{}

// New construit le gestionnaire HTTP complet : /api/* puis le site statique.
// behindProxy (SHH_BEHIND_PROXY) : une requête locale sans X-Shh-Client-IP valide
// reçoit 500 au lieu de partager les limites de l'adresse locale (échec fermé).
func New(svc *share.Service, sig *token.Signer, lim *limits.Limiter, capt *captcha.Captcha,
	static http.Handler, behindProxy bool) http.Handler {
	s := &server{svc: svc, sig: sig, lim: lim, cap: capt, behindProxy: behindProxy}
	api := http.NewServeMux()
	api.HandleFunc("GET /api/captcha", s.captcha)
	api.HandleFunc("POST /api/shares", s.create)
	api.HandleFunc("PUT /api/shares/{id}/segments/{n}", s.putSegment)
	api.HandleFunc("POST /api/shares/{id}/finalize", s.finalize)
	api.HandleFunc("GET /api/shares/{id}/meta", s.meta)
	api.HandleFunc("POST /api/shares/{id}/unlock", s.unlock)
	api.HandleFunc("GET /api/shares/{id}/segments/{n}", s.getSegment)
	api.HandleFunc("POST /api/shares/{id}/done", s.done)
	api.HandleFunc("POST /api/shares/{id}/destroy", s.destroy)
	api.HandleFunc("GET /api/shares/{id}/status", s.status)
	api.HandleFunc("/api/", func(w http.ResponseWriter, r *http.Request) { writeErr(w, http.StatusNotFound, "not_found") })

	root := http.NewServeMux()
	root.Handle("/api/", s.guard(api))
	root.Handle("/", static)
	return withHeaders(recoverPanic(root))
}

// guard : adresse du client (de confiance) puis limite de débit, pour tout /api/*.
func (s *server) guard(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ip, trusted := clientIP(r)
		if s.behindProxy && !trusted {
			writeErr(w, http.StatusInternalServerError, "internal")
			return
		}
		if !s.lim.AllowRequest(ip) {
			// Fenêtre fixe alignée sur la minute (limits.AllowRequest).
			writeLimit(w, time.Duration(60-s.svc.Now().Unix()%60)*time.Second)
			return
		}
		r.Header.Del("X-Shh-Client-IP") // plus aucune lecture en aval
		next.ServeHTTP(w, withIP(r, ip))
	})
}

// recoverPanic : 500 sans détail ; rien n'est journalisé (pas même la pile).
func recoverPanic(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if v := recover(); v != nil {
				writeErr(w, http.StatusInternalServerError, "internal")
			}
		}()
		next.ServeHTTP(w, r)
	})
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	b, err := json.Marshal(v)
	if err != nil {
		code, b = http.StatusInternalServerError, []byte(`{"error":"internal"}`)
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	w.Write(b)
}

func writeErr(w http.ResponseWriter, code int, e string) {
	writeJSON(w, code, map[string]string{"error": e})
}

func writeLimit(w http.ResponseWriter, retry time.Duration) {
	writeJSON(w, http.StatusTooManyRequests, struct {
		Error string `json:"error"`
		Retry int64  `json:"retry_after_s"`
	}{"limit", max(1, int64(math.Ceil(retry.Seconds())))})
}

// fail traduit une erreur du service ; toute erreur inattendue → 500 sans détail.
func fail(w http.ResponseWriter, err error) {
	var bp *share.BadPassword
	switch {
	case errors.As(err, &bp) && bp.AttemptsLeft > 0:
		writeJSON(w, http.StatusForbidden, struct {
			Error string `json:"error"`
			Left  int    `json:"attempts_left"`
		}{"bad_password", bp.AttemptsLeft})
	case errors.As(err, &bp), errors.Is(err, share.ErrNotFound), errors.Is(err, token.ErrInvalid):
		// 5ᵉ essai faux : le partage est détruit, réponse « introuvable » uniforme.
		writeErr(w, http.StatusNotFound, "not_found")
	case errors.Is(err, share.ErrBadSegment), errors.Is(err, share.ErrBadRequest), errors.Is(err, errBadRequest),
		errors.Is(err, captcha.ErrInvalid):
		writeErr(w, http.StatusBadRequest, "bad_request")
	case errors.Is(err, share.ErrIncomplete):
		writeErr(w, http.StatusConflict, "incomplete")
	case errors.Is(err, share.ErrFull):
		writeErr(w, http.StatusInsufficientStorage, "full")
	case errors.Is(err, share.ErrFrozen):
		writeErr(w, http.StatusServiceUnavailable, "frozen")
	default:
		writeErr(w, http.StatusInternalServerError, "internal")
	}
}

var errBadRequest = errors.New("format invalide")

// secret décode strictement une valeur base64url sans bourrage de n octets.
func secret(s string, n int) ([]byte, error) {
	b, err := b64.DecodeString(s)
	if err != nil || len(b) != n {
		return nil, errBadRequest
	}
	return b, nil
}

// headerSecret lit un en-tête secret présent exactement une fois.
func headerSecret(r *http.Request, name string) ([]byte, error) {
	v := r.Header.Values(name)
	if len(v) != 1 {
		return nil, errBadRequest
	}
	return secret(v[0], 32)
}

// bearer lit « Authorization: Bearer <jeton> » ; un en-tête absent ou mal formé → 400.
func bearer(r *http.Request) (string, error) {
	v := r.Header.Values("Authorization")
	if len(v) != 1 {
		return "", errBadRequest
	}
	tok, ok := strings.CutPrefix(v[0], "Bearer ")
	if !ok || tok == "" {
		return "", errBadRequest
	}
	return tok, nil
}

// readJSON : corps ≤ 4 Kio, un seul objet, aucun champ inconnu.
func readJSON(w http.ResponseWriter, r *http.Request, v any) error {
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxJSON))
	dec.DisallowUnknownFields()
	if err := dec.Decode(v); err != nil {
		return errBadRequest
	}
	if _, err := dec.Token(); err != io.EOF {
		return errBadRequest
	}
	return nil
}

// segNum : numéro de segment en chiffres décimaux canoniques (pas de signe ni de zéro initial).
func segNum(s string) (int, error) {
	if len(s) == 0 || len(s) > 4 || (len(s) > 1 && s[0] == '0') {
		return 0, errBadRequest
	}
	n := 0
	for i := 0; i < len(s); i++ {
		if s[i] < '0' || s[i] > '9' {
			return 0, errBadRequest
		}
		n = n*10 + int(s[i]-'0')
	}
	return n, nil
}

func withIP(r *http.Request, ip netip.Addr) *http.Request {
	return r.WithContext(context.WithValue(r.Context(), ctxIP{}, ip))
}

func ipOf(r *http.Request) netip.Addr {
	ip, _ := r.Context().Value(ctxIP{}).(netip.Addr)
	return ip
}
