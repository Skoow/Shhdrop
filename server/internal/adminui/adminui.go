// Package adminui : tableau de bord d'administration (conception du 13 novembre,
// docs/superpowers/specs/2026-11-13-tableau-de-bord-admin-design.md). Servi par un écouteur
// distinct du site public (SHH_ADMIN_LISTEN), jamais par Caddy. Il ne montre que des
// agrégats : aucun identifiant, aucune adresse, aucun contenu, aucune date de partage ; il
// n'écrit rien sur disque hors du fichier de gel, et ne garde rien (ni journal ni dernier
// accès). Pas d'effacement d'urgence ici : « wipe » reste en ligne de commande.
package adminui

import (
	"crypto/sha256"
	"crypto/subtle"
	"embed"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"net/netip"
	"strings"
	"time"
)

// Erreurs d'une destruction demandée depuis la page.
var (
	// ErrLienInvalide : ce qui a été collé n'est pas un lien de partage ou de salon.
	ErrLienInvalide = errors.New("adminui : lien invalide")
	// ErrIntrouvable : aucun partage ni salon pour ce lien (déjà détruit, expiré ou inconnu).
	ErrIntrouvable = errors.New("adminui : introuvable")
)

// Config : ce dont la page a besoin, fourni par cmd/shhdrop. Les fonctions sont celles de
// la ligne de commande (shhdrop admin freeze|unfreeze|destroy -), dans le processus en marche.
type Config struct {
	// TokenHash : SHA-256 du jeton d'administration (config.Config.AdminTokenHash).
	TokenHash [32]byte
	// Peers : pairs servis en plus de la boucle locale (SHH_TRUSTED_PROXY : dans le conteneur
	// de production, la machine elle-même, par où arrive le tunnel SSH).
	Peers []netip.Prefix
	// State : état agrégé, lu à chaque demande, jamais gardé.
	State func() (State, error)
	// Freeze, Unfreeze : gel et dégel des créations (fichier « frozen »).
	Freeze, Unfreeze func() error
	// Destroy : détruit le partage ou le salon du lien signalé ; rend « partage » ou « salon »,
	// ErrLienInvalide ou ErrIntrouvable. link est effacé par l'appelant au retour.
	Destroy func(link []byte) (string, error)
}

// maxLink : longueur maximale du lien signalé (comme maxStdinLink de la ligne de commande).
const maxLink = 4096

//go:embed page/index.html page/admin.css page/admin.js
var page embed.FS

// csp : politique propre à la page d'administration, plus stricte que celle du site : rien
// hors de cette origine, aucun style ni script en ligne, aucun cadre, aucun formulaire
// envoyé ; Trusted Types sans aucune politique (la page n'écrit que du texte).
const csp = "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; " +
	"base-uri 'none'; form-action 'none'; frame-ancestors 'none'; require-trusted-types-for 'script'; trusted-types 'none'"

var headers = [][2]string{
	{"Content-Security-Policy", csp},
	{"Cache-Control", "no-store"},
	{"X-Frame-Options", "DENY"},
	{"X-Content-Type-Options", "nosniff"},
	{"Referrer-Policy", "no-referrer"},
	{"Cross-Origin-Opener-Policy", "same-origin"},
	{"Cross-Origin-Resource-Policy", "same-origin"},
	{"Permissions-Policy", "geolocation=(), camera=(), microphone=(), display-capture=(), clipboard-read=(), payment=(), usb=()"},
}

type admin struct {
	c     Config
	files [3]file
}

type file struct {
	path, ctype string
	body        []byte
}

// New : gestionnaire de l'écouteur d'administration.
//
//	GET  /, /admin.css, /admin.js   la page (aucune donnée, aucun secret : servie sans jeton)
//	GET  /api/etat                  état agrégé (State)
//	POST /api/geler, /api/degeler   gel et dégel des créations
//	POST /api/detruire              lien signalé dans le CORPS (text/plain), jamais dans l'URL
//
// Tout /api/* exige « Authorization: Bearer <jeton> ». Jeton absent, faux, de mauvaise
// longueur, route inconnue, mauvaise méthode, pair hors boucle locale, requête relayée :
// la même réponse (refuse), sans rien qui les distingue.
func New(c Config) http.Handler {
	a := &admin{c: c}
	for i, f := range []file{
		{path: "/", ctype: "text/html; charset=utf-8"},
		{path: "/admin.css", ctype: "text/css; charset=utf-8"},
		{path: "/admin.js", ctype: "text/javascript; charset=utf-8"},
	} {
		name := "page" + f.path
		if f.path == "/" {
			name = "page/index.html"
		}
		b, err := page.ReadFile(name)
		if err != nil {
			panic(err) // fichiers embarqués à la compilation
		}
		f.body = b
		a.files[i] = f
	}
	return a
}

// Server : serveur HTTP de la page, délais courts (aucun transfert long ici), en-têtes
// plafonnés, messages internes de net/http jetés (ils peuvent contenir l'adresse du pair).
func Server(h http.Handler) *http.Server {
	return &http.Server{
		Handler:           h,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      20 * time.Second,
		IdleTimeout:       30 * time.Second,
		MaxHeaderBytes:    8 << 10,
		ErrorLog:          log.New(io.Discard, "", 0),
	}
}

func refuse(w http.ResponseWriter) {
	write(w, http.StatusNotFound, []byte(`{"error":"not_found"}`))
}

func write(w http.ResponseWriter, code int, body []byte) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	w.Write(body)
}

func writeJSON(w http.ResponseWriter, v any) {
	b, err := json.Marshal(v)
	if err != nil {
		write(w, http.StatusInternalServerError, []byte(`{"error":"internal"}`))
		return
	}
	write(w, http.StatusOK, b)
}

func (a *admin) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	h := w.Header()
	for _, kv := range headers {
		h.Set(kv[0], kv[1])
	}
	// Une panique d'un gestionnaire d'administration ne sort pas d'ici : 500 sans détail, rien
	// de journalisé ; le serveur public (autre écouteur) n'est pas touché.
	defer func() {
		if v := recover(); v != nil {
			if v == http.ErrAbortHandler {
				panic(v)
			}
			write(w, http.StatusInternalServerError, []byte(`{"error":"internal"}`))
		}
	}()
	if !a.peerOK(r) || relayed(r) {
		refuse(w)
		return
	}
	if r.Method == http.MethodGet && r.URL.RawQuery == "" {
		for _, f := range a.files {
			if r.URL.Path == f.path {
				h.Set("Content-Type", f.ctype)
				w.Write(f.body)
				return
			}
		}
	}
	// Le jeton est toujours vérifié, avant de regarder la route : une route inconnue et un
	// jeton faux prennent le même chemin.
	if !a.authorized(r) {
		refuse(w)
		return
	}
	// Aucun paramètre d'URL n'est accepté : rien de sensible ne doit pouvoir y être mis.
	if r.URL.RawQuery != "" {
		refuse(w)
		return
	}
	switch r.Method + " " + r.URL.Path {
	case "GET /api/etat":
		st, err := a.c.State()
		if err != nil {
			write(w, http.StatusInternalServerError, []byte(`{"error":"internal"}`))
			return
		}
		writeJSON(w, st)
	case "POST /api/geler":
		a.act(w, r, a.c.Freeze)
	case "POST /api/degeler":
		a.act(w, r, a.c.Unfreeze)
	case "POST /api/detruire":
		a.destroy(w, r)
	default:
		refuse(w)
	}
}

// peerOK : pair de la connexion en boucle locale, ou parmi Peers. Seul endroit du paquet qui
// lit l'adresse du pair ; elle n'est ni gardée, ni journalisée, ni recopiée (spec §36 S2).
func (a *admin) peerOK(r *http.Request) bool {
	ap, err := netip.ParseAddrPort(r.RemoteAddr)
	if err != nil {
		return false
	}
	ip := ap.Addr().Unmap()
	if ip.IsLoopback() {
		return true
	}
	for _, p := range a.c.Peers {
		if p.Contains(ip) {
			return true
		}
	}
	return false
}

// relayed : requête passée par Caddy (qui pose toujours X-Shh-Client-IP). La page ne se sert
// jamais à travers le proxy public : refusée comme une route inconnue.
func relayed(r *http.Request) bool { return len(r.Header.Values("X-Shh-Client-IP")) != 0 }

// authorized : « Authorization: Bearer <jeton> », comparé par empreinte SHA-256 en temps
// constant : ni la longueur ni le premier octet faux ne changent la durée. L'empreinte est
// calculée même sans en-tête.
func (a *admin) authorized(r *http.Request) bool {
	var tok string
	vs := r.Header.Values("Authorization")
	if len(vs) == 1 {
		tok, _ = strings.CutPrefix(vs[0], "Bearer ")
		if tok == vs[0] {
			tok = ""
		}
	}
	sum := sha256.Sum256([]byte(tok))
	return subtle.ConstantTimeCompare(sum[:], a.c.TokenHash[:]) == 1 && tok != ""
}

// act : gel ou dégel. Pas de contrôle d'origine en plus : une requête forgée par un autre
// site ne peut pas poser l'en-tête Authorization (il exige une autorisation CORS que ce
// serveur ne donne jamais), et le serveur ne lit aucun en-tête hors de sa liste blanche (§36 S2).
func (a *admin) act(w http.ResponseWriter, r *http.Request, f func() error) {
	if err := f(); err != nil {
		write(w, http.StatusInternalServerError, []byte(`{"error":"internal"}`))
		return
	}
	write(w, http.StatusOK, []byte(`{"ok":true}`))
}

// destroy : le lien signalé est lu dans le corps, borné, puis effacé de la mémoire. La
// réponse ne le reprend jamais, ni aucun identifiant : seulement ce qui a été détruit.
func (a *admin) destroy(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(io.LimitReader(r.Body, maxLink+1))
	defer clear(body)
	if err != nil || len(body) > maxLink {
		write(w, http.StatusBadRequest, []byte(`{"error":"lien_invalide"}`))
		return
	}
	kind, err := a.c.Destroy(body)
	switch {
	case errors.Is(err, ErrLienInvalide):
		write(w, http.StatusBadRequest, []byte(`{"error":"lien_invalide"}`))
	case errors.Is(err, ErrIntrouvable):
		write(w, http.StatusOK, []byte(`{"detruit":"aucun"}`))
	case err != nil:
		write(w, http.StatusInternalServerError, []byte(`{"error":"internal"}`))
	case kind == "salon":
		write(w, http.StatusOK, []byte(`{"detruit":"salon"}`))
	default:
		write(w, http.StatusOK, []byte(`{"detruit":"partage"}`))
	}
}
