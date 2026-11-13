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
	"github.com/skoow/shhdrop/server/internal/salon"
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
// Totaux (dlTotal, ulTotal) : valeurs par défaut des tests et sans configuration ; en
// production, Capacity (config.Capacity, calculée d'après la machine ou réglée par SHH_*).
// Places par connexion et par /48 : limites anti-abus, fixes.
const (
	dlTotal, dlPer64, dlPer48 = 256, 16, 64
	ulTotal, ulPer64, ulPer48 = 64, 8, 32
	// Par envoi (jeton d'envoi) et par ouverture (partage, n° d'ouverture) : audit I3, M4.
	// Le site envoie un segment à la fois par brouillon (web/src/transfer/draft.ts, pump) et
	// lit un segment à la fois par ouverture (client.ts, lecture en flux du moteur) : 4 laissent
	// la place d'un nouvel essai pendant qu'une requête coupée finit côté serveur. Une même
	// ouverture ou un même envoi ne prend donc jamais toutes les places d'une connexion.
	ulPerUpload, dlPerOpen = 4, 4
	// Débit minimal d'un transfert (audit I3, M4), mesuré en continu : au moins xferMinRate ×
	// xferWindow octets (160 Kio) par tranche de xferWindow, sinon la connexion est coupée et
	// rend sa place. L'ancienne échéance absolue (138 s par segment de 4 Mio) laissait un client
	// qui envoie 1 octet tenir sa place jusqu'au bout. Un segment de 4 Mio prend au plus
	// 4 Mio / 32 Kio/s + 5 s ≈ 133 s, comme avant.
	xferWindow  = 5 * time.Second
	xferMinRate = 32 << 10 // octets par seconde
	slotRetry   = 5 * time.Second
	// budgetRetry : Retry-After d'une ouverture qui a lu tout son budget (share.ReadBudget).
	// Le budget ne se recharge pas : seul un nouveau déverrouillage rouvre la lecture.
	budgetRetry = 60 * time.Second
	// Surveillances tenues (GET /api/shares/watch, spec §41.8) : 25 s au plus, 2 par
	// connexion, 256 au total par défaut (Capacity.Watches ; pas de borne propre au /48 : la
	// spécification n'en fixe pas).
	watchHold              = 25 * time.Second
	watchTotal, watchPer64 = 256, 2
	// reportsAlert : signalements dans l'heure à partir desquels /healthz lève l'alerte (§15.2).
	reportsAlert = 5
)

// transfers : places et débit minimal des segments (réglables par les tests).
type transfers struct {
	dl, ul         *limits.Slots
	perOpen, perUp *limits.Keyed
	window         time.Duration // tranche de mesure du débit
	minRate        int64         // octets par seconde
	// now : horloge du débit minimal (nil : time.Now ; remplacée par les tests pour fixer
	// l'instant où la première tranche commence, après avoir constaté la place prise).
	now func() time.Time
}

// start : instant présent pour le débit minimal.
func (t transfers) start() time.Time {
	if t.now != nil {
		return t.now()
	}
	return time.Now()
}

func defaultTransfers() transfers { return transfersFor(Capacity{}) }

// transfersFor : places de transfert d'après c (valeur nulle : dlTotal, ulTotal).
func transfersFor(c Capacity) transfers {
	c = c.withDefaults()
	return transfers{dl: limits.NewSlots(c.Downloads, dlPer64, dlPer48), ul: limits.NewSlots(c.Uploads, ulPer64, ulPer48),
		perOpen: limits.NewKeyed(dlPerOpen), perUp: limits.NewKeyed(ulPerUpload),
		window: xferWindow, minRate: xferMinRate}
}

// Capacity : places du serveur (config.Capacity). Une valeur nulle prend la valeur par défaut
// (dlTotal, ulTotal, watchTotal, wsTotal).
type Capacity struct {
	Uploads, Downloads, Watches, WebSockets int
}

func (c Capacity) withDefaults() Capacity {
	def := func(v, d int) int {
		if v > 0 {
			return v
		}
		return d
	}
	return Capacity{Uploads: def(c.Uploads, ulTotal), Downloads: def(c.Downloads, dlTotal),
		Watches: def(c.Watches, watchTotal), WebSockets: def(c.WebSockets, wsTotal)}
}

// perWindow : octets exigés par tranche (au moins 1).
func (t transfers) perWindow() int64 {
	return max(1, t.minRate*int64(t.window)/int64(time.Second))
}

// pacer : débit minimal d'un transfert. Chaque tranche de window doit transférer au moins min
// octets : l'échéance de la connexion (lecture ou écriture) est repoussée d'une tranche à
// chaque fois que min octets sont passés ; sinon elle tombe et la connexion est coupée.
// stop pose une échéance définitive (révocation), que plus rien ne repousse.
type pacer struct {
	set    func(time.Time) error
	now    func() time.Time
	window time.Duration
	min    int64

	mu      sync.Mutex
	got     int64
	stopped bool
}

func newPacer(set func(time.Time) error, x transfers) *pacer {
	return &pacer{set: set, now: x.start, window: x.window, min: x.perWindow()}
}

// arm ouvre la première tranche. Hors connexion réelle (tests en mémoire) : sans effet.
func (p *pacer) arm() error {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.setLocked(p.now().Add(p.window))
}

func (p *pacer) setLocked(t time.Time) error {
	if err := p.set(t); err != nil && !errors.Is(err, http.ErrNotSupported) {
		return err
	}
	return nil
}

// add compte n octets transférés ; min octets atteints : nouvelle tranche.
func (p *pacer) add(n int) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.stopped {
		return nil
	}
	if p.got += int64(n); p.got < p.min {
		return nil
	}
	p.got = 0
	return p.setLocked(p.now().Add(p.window))
}

// stop : échéance définitive t (dans le passé : coupure immédiate).
func (p *pacer) stop(t time.Time) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.stopped = true
	p.setLocked(t)
}

// paceReader : lecture du corps sous débit minimal.
type paceReader struct {
	r io.Reader
	p *pacer
}

func (r paceReader) Read(b []byte) (int, error) {
	n, err := r.r.Read(b)
	if n > 0 {
		if e := r.p.add(n); e != nil && err == nil {
			err = e
		}
	}
	return n, err
}

// paceWriter : écriture de la réponse sous débit minimal, par morceaux d'au plus min octets
// (un Write plus long devrait sinon finir dans une seule tranche, au-delà du débit minimal).
type paceWriter struct {
	w io.Writer
	p *pacer
}

func (w paceWriter) Write(b []byte) (int, error) {
	total := 0
	for len(b) > 0 {
		k := int(min(int64(len(b)), w.p.min))
		n, err := w.w.Write(b[:k])
		total += n
		if err != nil {
			return total, err
		}
		if err := w.p.add(n); err != nil {
			return total, err
		}
		b = b[k:]
	}
	return total, nil
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
	wsSlots     *limits.Slots // WebSocket du salon ouverts
	// salons : gestionnaire du salon (nil : salon désactivé), pour validSegmentToken.
	salons *salon.Manager
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
	return newServerCap(svc, sig, lim, capt, behindProxy, proxies, Capacity{})
}

func newServerCap(svc *share.Service, sig *token.Signer, lim *limits.Limiter, capt *captcha.Captcha,
	behindProxy bool, proxies []netip.Prefix, c Capacity) *server {
	c = c.withDefaults()
	return &server{svc: svc, sig: sig, lim: lim, cap: capt, behindProxy: behindProxy, proxies: proxies,
		xfer: transfersFor(c), dlTTL: downloadTTL, watchSlots: limits.NewSlots(c.Watches, watchPer64, c.Watches),
		wsSlots: limits.NewSlots(c.WebSockets, wsPer64, wsPer48),
		wait:    timerWait}
}

type ctxIP struct{}

// New construit le gestionnaire HTTP complet : /api/* puis le site statique.
// behindProxy (SHH_BEHIND_PROXY) : une requête d'un pair qui n'est pas un proxy de
// confiance (boucle locale ou proxies, SHH_TRUSTED_PROXY), ou sans X-Shh-Client-IP
// valide, reçoit 500 au lieu de partager les limites du proxy (échec fermé).
// sal : réglages du salon ; valeur zéro = salon désactivé. capa : places du serveur.
func New(svc *share.Service, sig *token.Signer, lim *limits.Limiter, capt *captcha.Captcha,
	static http.Handler, behindProxy bool, proxies []netip.Prefix, sal Salons, capa Capacity) http.Handler {
	return newHandler(newServerCap(svc, sig, lim, capt, behindProxy, proxies, capa), static, sal)
}

// Salons : réglages du salon. Valeur zéro : salon désactivé (aucune route, CSP inchangée).
// Origin : origine publique du site (config.Config.Origin), donnée seulement si SHH_SALONS=1.
// M : gestionnaire des salons ; nil → aucune route /api/salons/* (même 404 qu'une route
// inconnue). Les quotas du salon restent dans cette couche (limiteur lim passé à New).
type Salons struct {
	Origin string
	M      *salon.Manager
}

func newHandler(s *server, static http.Handler, sal Salons) http.Handler {
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
	api.HandleFunc("/api/shares/segments/{n}", methodNotAllowed)
	api.HandleFunc("POST /api/shares/done", s.done)
	api.HandleFunc("POST /api/shares/destroy", s.destroy)
	api.HandleFunc("GET /api/shares/watch", s.watch)
	api.HandleFunc("GET /api/manage/status", s.manageStatus)
	api.HandleFunc("POST /api/manage/destroy", s.manageDestroy)
	// Salon (SHH_SALONS=1) : sans gestionnaire, aucune route /api/salons/* (404 uniforme).
	s.salons = sal.M
	if sal.M != nil {
		salonAPI{server: s, m: sal.M, origin: sal.Origin}.routes(api)
	}
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
	return withHeaders(cspFor(sal.Origin), recoverPanic(root))
}

func notFoundAPI(w http.ResponseWriter, _ *http.Request) {
	writeErr(w, http.StatusNotFound, "not_found")
}

// methodNotAllowed : routes des segments (partages, pièces du salon) appelées par une autre
// méthode que GET ou PUT, HEAD compris (le motif « GET » de ServeMux l'accepte aussi) : 405,
// avant tout jeton ni budget de lecture (audit du 12 novembre, D4 : un HEAD consommait le
// budget sans rien servir).
func methodNotAllowed(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Allow", "GET, PUT")
	writeErr(w, http.StatusMethodNotAllowed, "method_not_allowed")
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
// spec §41.8) dont le jeton est signé et non expiré ; salon actif : segment de pièce (PUT avec
// jeton d'envoi de pièce, GET avec un X-Shh-Membre valable). Ces requêtes ont leur propre
// limite (SegmentsPerMin) ; l'état du partage ou de la pièce est revérifié ensuite.
func (s *server) validSegmentToken(r *http.Request) bool {
	if n, ok := strings.CutPrefix(r.URL.Path, "/api/salons/pieces/segments/"); ok {
		return s.validPieceSegment(r, n) // handlers_salon_pieces.go
	}
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

// xferSlot : place de la clé key (envoi ou ouverture, dans per), puis slot. Un refus par clé
// (429) ne prend aucune place du serveur.
func (s *server) xferSlot(w http.ResponseWriter, r *http.Request, per *limits.Keyed, key string, sl *limits.Slots) (release func(), ok bool) {
	relKey, err := per.Acquire(key)
	if err != nil {
		writeLimit(w, slotRetry)
		return nil, false
	}
	rel, ok := s.slot(w, r, sl)
	if !ok {
		relKey()
		return nil, false
	}
	return func() { rel(); relKey() }, true
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

// errInterne : erreur de programmation (readJSONMax sans pointeur) ; fail et failSalon la
// traduisent en 500 internal, sans détail.
var errInterne = errors.New("erreur interne")

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
	// v : pointeur non nul exigé par Decode ; autre chose est une erreur de programmation :
	// erreur interne (500 sans détail), jamais une panique (revue finale C-2, mineur h).
	if t := reflect.TypeOf(v); t == nil || t.Kind() != reflect.Pointer || reflect.ValueOf(v).IsNil() {
		return errInterne
	}
	// Échéance de lecture du corps (audit du 13 novembre, D5) : un corps de quelques Kio
	// envoyé au goutte-à-goutte tenait sinon sa connexion jusqu'à ReadTimeout (300 s). Sans
	// connexion réelle (tests en mémoire) : sans effet. net/http repose ses délais à la
	// requête suivante de la même connexion.
	rc := http.NewResponseController(w)
	if err := rc.SetReadDeadline(time.Now().Add(jsonReadTimeout)); err != nil && !errors.Is(err, http.ErrNotSupported) {
		return errBadRequest
	}
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, max))
	if err != nil {
		return errBadRequest
	}
	scan := json.NewDecoder(bytes.NewReader(body))
	if err := strictKeys(scan, reflect.TypeOf(v).Elem()); err != nil {
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

// jsonReadTimeout : temps laissé pour lire un corps JSON (4 Kio, 96 Kio pour finalize) ;
// variable pour les tests. 10 s : 96 Kio passent encore à 10 Kio/s (lien très lent).
var jsonReadTimeout = 10 * time.Second

var errKeys = errors.New("clés JSON invalides")

// strictKeys lit une valeur JSON et vérifie que chaque clé d'objet est exactement le nom
// JSON (balise `json`) d'un champ du type attendu, et n'apparaît qu'une fois, et qu'un tableau
// de taille fixe a exactement ce nombre d'éléments. Les types des valeurs sont vérifiés
// ensuite par Decode. `null` à la place d'un objet (structure qui n'est pas derrière un
// pointeur : le corps entier, ou un champ objet obligatoire) → errKeys (relecture C-2 Task 17 :
// sinon un corps `null` passait pour `{}`) ; un champ pointeur facultatif peut valoir `null`.
func strictKeys(dec *json.Decoder, t reflect.Type) error {
	nullable := t == nil || t.Kind() == reflect.Pointer
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
		n := 0
		for dec.More() {
			// Tableau de taille fixe ([2]int) : encoding/json ignore les éléments en trop et
			// complète par des zéros (audit F7) ; exactement t.Len() éléments ici.
			if n++; t.Kind() == reflect.Array && n > t.Len() {
				return errKeys
			}
			if err := strictKeys(dec, t.Elem()); err != nil {
				return err
			}
		}
		if t.Kind() == reflect.Array && n != t.Len() {
			return errKeys
		}
		_, err = dec.Token() // ']'
		return err
	}
	if tok == nil && !nullable && t.Kind() == reflect.Struct {
		return errKeys
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
