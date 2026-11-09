// Package api expose l'API HTTP de Shhdrop (spec §8) et pose les en-têtes de sécurité (§10).
//
// Aucun journal d'accès : rien de la requête (adresse, chemin, en-têtes, corps) n'est
// jamais écrit. Les secrets arrivent en base64url sans bourrage, dans des en-têtes ou le
// corps, jamais dans l'URL. Toute clé inconnue, partage expiré, détruit ou inexistant
// donne la même réponse 404 {"error":"not_found"}.
package api

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"math"
	"net/http"
	"net/netip"
	"reflect"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/skoow/shhdrop/server/internal/captcha"
	"github.com/skoow/shhdrop/server/internal/limits"
	"github.com/skoow/shhdrop/server/internal/share"
	"github.com/skoow/shhdrop/server/internal/token"
)

const (
	maxJSON = 4 << 10
	// maxFinalizeJSON : finalize d'un brouillon, avec le manifeste chiffré (65 552 octets en
	// base64url, 87 403 caractères) et l'en-tête.
	maxFinalizeJSON = 96 << 10
	captchaTTL      = 2 * time.Minute // durée du jeton shown_at (= celle du défi ALTCHA)
	uploadTTL       = 6 * time.Hour   // = share.uploadWindow (spec §24, §41.2)
	// downloadTTL : durée du jeton de téléchargement, qui n'est plus plafonnée à expires_at :
	// elle borne la grâce d'une ouverture active après l'échéance (spec §41.8).
	downloadTTL   = 6 * time.Hour
	maxSegmentLen = share.Header + share.SegChunks*share.ChunkCT
)

// Transferts de segments simultanés (audit E1) : un GET se sert en flux (quelques dizaines
// de Kio de mémoire), un PUT garde son corps entier (≤ 4 Mio) jusqu'à l'écriture, d'où
// une borne plus basse. Au-delà : 429 (connexion ou /48) ou 503 (serveur), avec Retry-After.
const (
	dlTotal, dlPer64, dlPer48 = 256, 16, 64
	ulTotal, ulPer64, ulPer48 = 64, 8, 32
	// Échéance d'un transfert : xferBase + taille / xferMinRate. Un lecteur plus lent que
	// 32 Kio/s est coupé (segment de 4 Mio : 138 s au lieu des 300 s du serveur).
	xferBase    = 10 * time.Second
	xferMinRate = 32 << 10 // octets par seconde
	slotRetry   = 5 * time.Second
	// budgetRetry : Retry-After d'une ouverture qui a lu tout son budget (share.ReadBudget).
	// Le budget ne se recharge pas : seul un nouveau déverrouillage rouvre la lecture.
	budgetRetry = 60 * time.Second
	// Surveillances tenues (GET /api/shares/watch, spec §41.8) : 25 s au plus, 2 par
	// connexion, 256 au total (pas de borne propre au /48 : la spécification n'en fixe pas).
	watchHold                       = 25 * time.Second
	watchTotal, watchPer64, watch48 = 256, 2, 256
	// reportsAlert : signalements dans l'heure à partir desquels /healthz lève l'alerte (§15.2).
	reportsAlert = 5
)

// transfers : places et échéances des segments (réglables par les tests).
type transfers struct {
	dl, ul  *limits.Slots
	base    time.Duration
	minRate int64 // octets par seconde
}

func defaultTransfers() transfers {
	return transfers{dl: limits.NewSlots(dlTotal, dlPer64, dlPer48), ul: limits.NewSlots(ulTotal, ulPer64, ulPer48),
		base: xferBase, minRate: xferMinRate}
}

// deadline : durée accordée pour transférer size octets.
func (t transfers) deadline(size int64) time.Duration {
	return t.base + time.Duration(size)*time.Second/time.Duration(t.minRate)
}

var b64 = base64.RawURLEncoding.Strict()

type server struct {
	svc         *share.Service
	sig         *token.Signer
	lim         *limits.Limiter
	cap         *captcha.Captcha
	behindProxy bool
	proxies     []netip.Prefix
	xfer        transfers
	dlTTL       time.Duration // durée des jetons de téléchargement
	watchSlots  *limits.Slots // surveillances tenues
	// wait : attente d'une surveillance (minuterie ; remplacée par les tests) ; stop la libère.
	wait    func(time.Duration) (c <-chan time.Time, stop func() bool)
	reports reportCounter
}

// reportCounter : signalements de l'heure en cours, un seul entier sans identifiant, remis à
// zéro chaque heure (spec §9.5, §36 S21) ; exposé seulement en booléen sur /healthz local.
type reportCounter struct {
	mu   sync.Mutex
	hour int64
	n    int
}

func (c *reportCounter) add(now time.Time) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if h := now.Unix() / 3600; h != c.hour {
		c.hour, c.n = h, 0
	}
	c.n++
}

func (c *reportCounter) alert(now time.Time) bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	return now.Unix()/3600 == c.hour && c.n >= reportsAlert
}

func timerWait(d time.Duration) (<-chan time.Time, func() bool) {
	t := time.NewTimer(d)
	return t.C, t.Stop
}

func newServer(svc *share.Service, sig *token.Signer, lim *limits.Limiter, capt *captcha.Captcha,
	behindProxy bool, proxies []netip.Prefix) *server {
	return &server{svc: svc, sig: sig, lim: lim, cap: capt, behindProxy: behindProxy, proxies: proxies,
		xfer: defaultTransfers(), dlTTL: downloadTTL, watchSlots: limits.NewSlots(watchTotal, watchPer64, watch48),
		wait: timerWait}
}

type ctxIP struct{}

// New construit le gestionnaire HTTP complet : /api/* puis le site statique.
// behindProxy (SHH_BEHIND_PROXY) : une requête d'un pair qui n'est pas un proxy de
// confiance (boucle locale ou proxies, SHH_TRUSTED_PROXY), ou sans X-Shh-Client-IP
// valide, reçoit 500 au lieu de partager les limites du proxy (échec fermé).
func New(svc *share.Service, sig *token.Signer, lim *limits.Limiter, capt *captcha.Captcha,
	static http.Handler, behindProxy bool, proxies []netip.Prefix) http.Handler {
	return newHandler(newServer(svc, sig, lim, capt, behindProxy, proxies), static)
}

func newHandler(s *server, static http.Handler) http.Handler {
	api := http.NewServeMux()
	api.HandleFunc("GET /api/captcha", s.captcha)
	api.HandleFunc("POST /api/shares", s.create)
	// Aucun identifiant dans les chemins (spec §29.8, §32) : le partage est désigné par un
	// jeton signé (envoi, lecture), par K_accès (meta, unlock, destroy) ou par S_gestion.
	api.HandleFunc("PUT /api/shares/segments/{n}", s.putSegment)
	api.HandleFunc("POST /api/shares/finalize", s.finalize)
	api.HandleFunc("POST /api/shares/grow", s.grow)
	api.HandleFunc("POST /api/shares/erase", s.erase)
	api.HandleFunc("POST /api/shares/keep", s.keep)
	api.HandleFunc("GET /api/shares/meta", s.meta)
	api.HandleFunc("POST /api/shares/unlock", s.unlock)
	api.HandleFunc("GET /api/shares/segments/{n}", s.getSegment)
	api.HandleFunc("POST /api/shares/done", s.done)
	api.HandleFunc("POST /api/shares/regrant", s.regrant)
	api.HandleFunc("POST /api/shares/leave", s.leave)
	api.HandleFunc("POST /api/shares/destroy", s.destroy)
	api.HandleFunc("GET /api/shares/watch", s.watch)
	api.HandleFunc("GET /api/manage/status", s.manageStatus)
	api.HandleFunc("POST /api/manage/destroy", s.manageDestroy)
	api.HandleFunc("/api/", notFoundAPI)

	root := http.NewServeMux()
	root.HandleFunc("GET /healthz", s.healthz)
	root.Handle("/api/", s.guard(api))
	root.Handle("/api", s.guard(http.HandlerFunc(notFoundAPI))) // sans cela : 307 vers /api/
	// /API/x, /Api… : jamais le repli SPA (200 + index.html), la même 404 que /api/… (limites comprises).
	root.Handle("/", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if isAPIPath(r.URL.Path) {
			s.guard(http.HandlerFunc(notFoundAPI)).ServeHTTP(w, r)
			return
		}
		static.ServeHTTP(w, r)
	}))
	return withHeaders(recoverPanic(root))
}

func notFoundAPI(w http.ResponseWriter, _ *http.Request) {
	writeErr(w, http.StatusNotFound, "not_found")
}

// isAPIPath : « /api » ou « /api/… », sans tenir compte de la casse.
func isAPIPath(p string) bool {
	return len(p) >= 4 && strings.EqualFold(p[:4], "/api") && (len(p) == 4 || p[4] == '/')
}

// guard : adresse du client (de confiance) puis limite de débit, pour tout /api/*.
func (s *server) guard(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ip, trusted, proxied := clientIP(r, s.proxies)
		// Derrière le proxy, seul Caddy (pair de confiance, avec X-Shh-Client-IP) doit parler
		// au serveur : tout autre pair ou en-tête absent révèle une erreur de configuration.
		if s.behindProxy && (!trusted || !proxied) {
			writeErr(w, http.StatusInternalServerError, "internal")
			return
		}
		allowed := false
		if s.validSegmentToken(r) {
			allowed = s.lim.AllowSegment(ip)
		} else {
			allowed = s.lim.AllowRequest(ip)
		}
		if !allowed {
			// Fenêtre fixe alignée sur la minute (limits.AllowRequest).
			writeLimit(w, time.Duration(60-s.svc.Now().Unix()%60)*time.Second)
			return
		}
		r.Header.Del("X-Shh-Client-IP") // plus aucune lecture en aval
		next.ServeHTTP(w, withIP(r, ip))
	})
}

// validSegmentToken : requête de segment (PUT avec jeton d'envoi, GET avec jeton de
// téléchargement) ou surveillance (GET /api/shares/watch, hors des 60 requêtes par minute,
// spec §41.8) dont le jeton est signé et non expiré. Ces requêtes ont leur propre limite
// (SegmentsPerMin) ; l'état du partage est revérifié ensuite.
func (s *server) validSegmentToken(r *http.Request) bool {
	var kind byte
	if r.URL.Path == "/api/shares/watch" && r.Method == http.MethodGet {
		kind = token.Download
	} else {
		n, ok := strings.CutPrefix(r.URL.Path, "/api/shares/segments/")
		if !ok || n == "" || strings.Contains(n, "/") {
			return false
		}
		switch r.Method {
		case http.MethodPut:
			kind = token.Upload
		case http.MethodGet:
			kind = token.Download
		default:
			return false
		}
	}
	tok, err := bearer(r)
	if err != nil {
		return false
	}
	_, _, err = s.sig.Subject(tok, kind)
	return err == nil
}

// healthz : santé, pour les appels locaux directs seulement (spec §8). Une requête
// relayée par Caddy (porteuse de X-Shh-Client-IP) ou distante reçoit 404. Non limité.
// reports_alert : au moins 5 signalements dans l'heure en cours (spec §15.2, §36 S21) ;
// aucun autre champ, aucun nombre ni identifiant.
func (s *server) healthz(w http.ResponseWriter, r *http.Request) {
	if !parse(r.RemoteAddr).IsLoopback() || len(r.Header.Values("X-Shh-Client-IP")) != 0 {
		writeErr(w, http.StatusNotFound, "not_found")
		return
	}
	writeJSON(w, http.StatusOK, struct {
		OK    bool `json:"ok"`
		Alert bool `json:"reports_alert"`
	}{true, s.reports.alert(s.svc.Now())})
}

// sentWriter retient si l'en-tête de réponse est déjà parti.
type sentWriter struct {
	http.ResponseWriter
	sent bool
}

func (w *sentWriter) WriteHeader(code int) { w.sent = true; w.ResponseWriter.WriteHeader(code) }
func (w *sentWriter) Write(b []byte) (int, error) {
	w.sent = true
	return w.ResponseWriter.Write(b)
}
func (w *sentWriter) Unwrap() http.ResponseWriter { return w.ResponseWriter }

// recoverPanic : 500 sans détail ; rien n'est journalisé (pas même la pile).
// Si la réponse a déjà commencé, rien n'y est ajouté : la connexion est coupée
// (http.ErrAbortHandler, que net/http ne journalise pas) pour qu'une réponse tronquée
// ne passe pas pour complète. Un http.ErrAbortHandler reçu est relancé tel quel.
func recoverPanic(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		sw := &sentWriter{ResponseWriter: w}
		defer func() {
			v := recover()
			if v == nil {
				return
			}
			if v == http.ErrAbortHandler || sw.sent {
				panic(http.ErrAbortHandler)
			}
			writeErr(w, http.StatusInternalServerError, "internal")
		}()
		next.ServeHTTP(sw, r)
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
	writeRetry(w, http.StatusTooManyRequests, "limit", retry)
}

// writeRetry : refus temporaire, délai dans Retry-After et dans retry_after_s.
func writeRetry(w http.ResponseWriter, code int, e string, retry time.Duration) {
	secs := max(1, int64(math.Ceil(retry.Seconds())))
	w.Header().Set("Retry-After", strconv.FormatInt(secs, 10))
	writeJSON(w, code, struct {
		Error string `json:"error"`
		Retry int64  `json:"retry_after_s"`
	}{e, secs})
}

// slot prend une place de transfert pour le client de r, ou répond 429/503 et rend false.
func (s *server) slot(w http.ResponseWriter, r *http.Request, sl *limits.Slots) (release func(), ok bool) {
	k64, k48 := s.lim.Key(ipOf(r))
	release, err := sl.Acquire(k64, k48)
	switch {
	case errors.Is(err, limits.ErrBusy):
		writeRetry(w, http.StatusServiceUnavailable, "busy", slotRetry)
	case err != nil:
		writeLimit(w, slotRetry)
	}
	return release, err == nil
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
	case errors.Is(err, share.ErrGone):
		// Seulement derrière un jeton signé valide (segment, done, watch) : spec §41.8.
		writeErr(w, http.StatusGone, "gone")
	case errors.As(err, &bp), errors.Is(err, share.ErrNotFound), errors.Is(err, token.ErrInvalid):
		// 5ᵉ essai faux : le partage est détruit, réponse « introuvable » uniforme.
		writeErr(w, http.StatusNotFound, "not_found")
	case errors.Is(err, share.ErrBadSegment), errors.Is(err, share.ErrBadRequest), errors.Is(err, errBadRequest),
		errors.Is(err, captcha.ErrInvalid):
		writeErr(w, http.StatusBadRequest, "bad_request")
	case errors.Is(err, share.ErrBusy):
		writeRetry(w, http.StatusServiceUnavailable, "busy", slotRetry)
	case errors.Is(err, share.ErrIncomplete):
		writeErr(w, http.StatusConflict, "incomplete")
	case errors.Is(err, share.ErrFull):
		writeErr(w, http.StatusInsufficientStorage, "full")
	case errors.Is(err, share.ErrGrantInvalid):
		writeErr(w, http.StatusConflict, "grant_invalid")
	case errors.Is(err, share.ErrReopenLimit):
		writeErr(w, http.StatusTooManyRequests, "reopen_limit")
	case errors.Is(err, share.ErrBudget):
		writeRetry(w, http.StatusTooManyRequests, "budget", budgetRetry)
	case errors.Is(err, share.ErrFrozen):
		writeErr(w, http.StatusServiceUnavailable, "frozen")
	default:
		writeErr(w, http.StatusInternalServerError, "internal")
	}
}

var errBadRequest = errors.New("format invalide")

// secret décode strictement une valeur base64url sans bourrage de n octets
// (longueur exacte en caractères, ni \r ni \n : share.DecodeB64).
func secret(s string, n int) ([]byte, error) {
	b, err := share.DecodeB64(s, n)
	if err != nil {
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

// readJSON : corps ≤ 4 Kio, un seul objet, aucun champ inconnu. encoding/json ignore la
// casse des clés et garde le dernier doublon (audit F2) : les clés sont d'abord vérifiées
// une à une (exactes, sensibles à la casse, sans doublon) par strictKeys.
func readJSON(w http.ResponseWriter, r *http.Request, v any) error {
	return readJSONMax(w, r, v, maxJSON)
}

// readJSONMax : readJSON avec un plafond de corps choisi (finalize d'un brouillon porte le
// morceau chiffré du manifeste, spec §41.14).
func readJSONMax(w http.ResponseWriter, r *http.Request, v any, max int64) error {
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, max))
	if err != nil {
		return errBadRequest
	}
	scan := json.NewDecoder(bytes.NewReader(body))
	if err := strictKeys(scan, reflect.TypeOf(v)); err != nil {
		return errBadRequest
	}
	if _, err := scan.Token(); err != io.EOF {
		return errBadRequest
	}
	dec := json.NewDecoder(bytes.NewReader(body))
	dec.DisallowUnknownFields()
	if err := dec.Decode(v); err != nil {
		return errBadRequest
	}
	return nil
}

var errKeys = errors.New("clés JSON invalides")

// strictKeys lit une valeur JSON et vérifie que chaque clé d'objet est exactement le nom
// JSON (balise `json`) d'un champ du type attendu, et n'apparaît qu'une fois. Les types
// des valeurs sont vérifiés ensuite par Decode.
func strictKeys(dec *json.Decoder, t reflect.Type) error {
	for t != nil && t.Kind() == reflect.Pointer {
		t = t.Elem()
	}
	tok, err := dec.Token()
	if err != nil {
		return err
	}
	switch tok {
	case json.Delim('{'):
		if t == nil || t.Kind() != reflect.Struct {
			return errKeys
		}
		fields := jsonFields(t)
		seen := map[string]bool{}
		for dec.More() {
			k, err := dec.Token()
			if err != nil {
				return err
			}
			name, _ := k.(string)
			ft, ok := fields[name]
			if !ok || seen[name] {
				return errKeys
			}
			seen[name] = true
			if err := strictKeys(dec, ft); err != nil {
				return err
			}
		}
		_, err = dec.Token() // '}'
		return err
	case json.Delim('['):
		if t == nil || (t.Kind() != reflect.Slice && t.Kind() != reflect.Array) {
			return errKeys
		}
		for dec.More() {
			if err := strictKeys(dec, t.Elem()); err != nil {
				return err
			}
		}
		_, err = dec.Token() // ']'
		return err
	}
	return nil // valeur simple
}

// jsonFields : nom JSON exact → type, pour les champs exportés d'une structure.
func jsonFields(t reflect.Type) map[string]reflect.Type {
	m := map[string]reflect.Type{}
	for i := 0; i < t.NumField(); i++ {
		f := t.Field(i)
		if !f.IsExported() {
			continue
		}
		name, _, _ := strings.Cut(f.Tag.Get("json"), ",")
		if name == "-" {
			continue
		}
		if name == "" {
			name = f.Name
		}
		m[name] = f.Type
	}
	return m
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
