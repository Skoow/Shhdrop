package adminui

import (
	"bytes"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"reflect"
	"strings"
	"testing"
)

const jeton = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"

// banc : gestionnaire de test, avec le compte des appels à chaque fonction.
type banc struct {
	h                              http.Handler
	etats, gels, degels, destructs int
	lien                           string // dernier lien reçu par Destroy (copie)
	corps                          []byte // tampon reçu par Destroy (doit être effacé ensuite)
	etat                           func() (State, error)
	detruire                       func([]byte) (string, error)
}

func nouveauBanc() *banc {
	b := &banc{}
	b.h = New(Config{
		TokenHash: sha256.Sum256([]byte(jeton)),
		Peers:     []netip.Prefix{netip.MustParsePrefix("172.30.53.1/32")},
		State: func() (State, error) {
			b.etats++
			if b.etat != nil {
				return b.etat()
			}
			return State{}, nil
		},
		Freeze:   func() error { b.gels++; return nil },
		Unfreeze: func() error { b.degels++; return nil },
		Destroy: func(l []byte) (string, error) {
			b.destructs++
			b.lien, b.corps = string(l), l
			if b.detruire != nil {
				return b.detruire(l)
			}
			return "partage", nil
		},
	})
	return b
}

type req struct {
	method, path, pair, corps string
	hdr                       [][2]string
}

func (b *banc) faire(q req) *httptest.ResponseRecorder {
	if q.pair == "" {
		q.pair = "127.0.0.1:40000"
	}
	r := httptest.NewRequest(q.method, q.path, strings.NewReader(q.corps))
	r.RemoteAddr = q.pair
	for _, kv := range q.hdr {
		r.Header.Add(kv[0], kv[1])
	}
	w := httptest.NewRecorder()
	b.h.ServeHTTP(w, r)
	return w
}

func bon() [2]string { return [2]string{"Authorization", "Bearer " + jeton} }

func (b *banc) appels() int { return b.etats + b.gels + b.degels + b.destructs }

// Jeton absent, faux, de mauvaise longueur, mal présenté ; route inconnue, mauvaise méthode,
// paramètre d'URL, pair hors boucle locale, requête relayée : exactement la même réponse
// (statut, en-têtes, corps), et aucune fonction appelée.
func TestRefusUniforme(t *testing.T) {
	b := nouveauBanc()
	ref := b.faire(req{method: "GET", path: "/api/nimporte"})
	if ref.Code != http.StatusNotFound {
		t.Fatalf("statut de référence %d", ref.Code)
	}
	cas := map[string]req{
		"sans jeton":              {method: "GET", path: "/api/etat"},
		"jeton faux":              {method: "GET", path: "/api/etat", hdr: [][2]string{{"Authorization", "Bearer " + strings.Repeat("f", 64)}}},
		"un caractère faux":       {method: "GET", path: "/api/etat", hdr: [][2]string{{"Authorization", "Bearer " + jeton[:63] + "0"}}},
		"trop court":              {method: "GET", path: "/api/etat", hdr: [][2]string{{"Authorization", "Bearer " + jeton[:10]}}},
		"trop long":               {method: "GET", path: "/api/etat", hdr: [][2]string{{"Authorization", "Bearer " + jeton + "0"}}},
		"vide":                    {method: "GET", path: "/api/etat", hdr: [][2]string{{"Authorization", "Bearer "}}},
		"sans Bearer":             {method: "GET", path: "/api/etat", hdr: [][2]string{{"Authorization", jeton}}},
		"Basic":                   {method: "GET", path: "/api/etat", hdr: [][2]string{{"Authorization", "Basic " + jeton}}},
		"deux en-têtes":           {method: "GET", path: "/api/etat", hdr: [][2]string{bon(), bon()}},
		"geler sans jeton":        {method: "POST", path: "/api/geler"},
		"détruire sans jeton":     {method: "POST", path: "/api/detruire", corps: "https://x/#abc"},
		"route inconnue":          {method: "GET", path: "/api/secret", hdr: [][2]string{bon()}},
		"mauvaise méthode":        {method: "GET", path: "/api/geler", hdr: [][2]string{bon()}},
		"mauvaise méthode 2":      {method: "POST", path: "/api/etat", hdr: [][2]string{bon()}},
		"paramètre d'URL":         {method: "GET", path: "/api/etat?x=1", hdr: [][2]string{bon()}},
		"jeton dans l'URL":        {method: "GET", path: "/api/etat?token=" + jeton},
		"pair distant":            {method: "GET", path: "/api/etat", pair: "203.0.113.7:5000", hdr: [][2]string{bon()}},
		"pair distant, page":      {method: "GET", path: "/", pair: "203.0.113.7:5000"},
		"pair IPv6 distant":       {method: "GET", path: "/api/etat", pair: "[2001:db8::1]:5000", hdr: [][2]string{bon()}},
		"relayée par Caddy, page": {method: "GET", path: "/", hdr: [][2]string{{"X-Shh-Client-IP", "203.0.113.7"}}},
		"relayée par Caddy":       {method: "GET", path: "/api/etat", hdr: [][2]string{bon(), {"X-Shh-Client-IP", "203.0.113.7"}}},
	}
	for nom, q := range cas {
		w := b.faire(q)
		if w.Code != ref.Code || !bytes.Equal(w.Body.Bytes(), ref.Body.Bytes()) || !reflect.DeepEqual(w.Header(), ref.Header()) {
			t.Errorf("%s : réponse distincte : %d %q %v", nom, w.Code, w.Body.String(), w.Header())
		}
	}
	if b.appels() != 0 {
		t.Fatalf("une fonction a été appelée malgré le refus : %+v", b)
	}
}

// Aucune route d'effacement d'urgence, sous aucun nom ni méthode, même avec le bon jeton ;
// et le script de la page n'en appelle aucune.
func TestPasDeWipe(t *testing.T) {
	b := nouveauBanc()
	ref := b.faire(req{method: "GET", path: "/api/nimporte"})
	for _, p := range []string{"/api/wipe", "/api/effacer", "/api/tout-effacer", "/api/purger", "/wipe", "/api/admin/wipe"} {
		for _, m := range []string{"GET", "POST", "DELETE", "PUT"} {
			w := b.faire(req{method: m, path: p, hdr: [][2]string{bon()}})
			if w.Code != ref.Code || w.Body.String() != ref.Body.String() {
				t.Errorf("%s %s : %d %q", m, p, w.Code, w.Body.String())
			}
		}
	}
	js, _ := page.ReadFile("page/admin.js")
	if bytes.Contains(bytes.ToLower(js), []byte("wipe")) {
		t.Fatal("le script de la page parle de wipe")
	}
}

func TestEtatEtActions(t *testing.T) {
	b := nouveauBanc()
	b.etat = func() (State, error) { return State{Sante: Sante{Gele: true, Go: "go1.x"}}, nil }
	w := b.faire(req{method: "GET", path: "/api/etat", hdr: [][2]string{bon()}})
	var st State
	if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &st) != nil || !st.Sante.Gele || st.Salon != nil {
		t.Fatalf("état : %d %s", w.Code, w.Body.String())
	}
	// Pair de confiance (la machine, par où arrive le tunnel dans le conteneur de production).
	if w := b.faire(req{method: "GET", path: "/api/etat", pair: "172.30.53.1:999", hdr: [][2]string{bon()}}); w.Code != 200 {
		t.Fatalf("pair de confiance refusé : %d", w.Code)
	}
	if w := b.faire(req{method: "POST", path: "/api/geler", hdr: [][2]string{bon()}}); w.Code != 200 || b.gels != 1 {
		t.Fatalf("geler : %d %d", w.Code, b.gels)
	}
	if w := b.faire(req{method: "POST", path: "/api/degeler", hdr: [][2]string{bon()}}); w.Code != 200 || b.degels != 1 {
		t.Fatalf("dégeler : %d %d", w.Code, b.degels)
	}
	b.etat = func() (State, error) { return State{}, errors.New("base /data/blobs/IDSECRET illisible") }
	w = b.faire(req{method: "GET", path: "/api/etat", hdr: [][2]string{bon()}})
	if w.Code != 500 || strings.Contains(w.Body.String(), "IDSECRET") {
		t.Fatalf("erreur d'état : %d %s", w.Code, w.Body.String())
	}
}

// Le lien signalé : dans le corps seulement, jamais repris dans la réponse, tampon effacé.
func TestDetruire(t *testing.T) {
	b := nouveauBanc()
	lien := "https://shhgone.com/#AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
	// Dans l'URL : refusé comme une route inconnue, Destroy jamais appelé.
	for _, p := range []string{"/api/detruire?lien=" + lien[:20], "/api/detruire/" + lien[len(lien)-43:]} {
		if w := b.faire(req{method: "POST", path: p, hdr: [][2]string{bon()}}); w.Code != 404 || b.destructs != 0 {
			t.Fatalf("%s : %d, %d appels", p, w.Code, b.destructs)
		}
	}
	w := b.faire(req{method: "POST", path: "/api/detruire", corps: lien, hdr: [][2]string{bon()}})
	if w.Code != 200 || w.Body.String() != `{"detruit":"partage"}` || b.lien != lien {
		t.Fatalf("%d %s", w.Code, w.Body.String())
	}
	if !bytes.Equal(b.corps, make([]byte, len(lien))) {
		t.Fatal("le tampon du lien n'a pas été effacé")
	}
	for _, c := range []struct {
		kind string
		err  error
		code int
		body string
	}{
		{"salon", nil, 200, `{"detruit":"salon"}`},
		{"", ErrIntrouvable, 200, `{"detruit":"aucun"}`},
		{"", ErrLienInvalide, 400, `{"error":"lien_invalide"}`},
		{"", errors.New("fichier /data/salons/IDSECRET"), 500, `{"error":"internal"}`},
	} {
		b.detruire = func([]byte) (string, error) { return c.kind, c.err }
		w := b.faire(req{method: "POST", path: "/api/detruire", corps: lien, hdr: [][2]string{bon()}})
		if w.Code != c.code || w.Body.String() != c.body {
			t.Errorf("%v : %d %s", c.err, w.Code, w.Body.String())
		}
	}
	n := b.destructs
	w = b.faire(req{method: "POST", path: "/api/detruire", corps: strings.Repeat("a", maxLink+1), hdr: [][2]string{bon()}})
	if w.Code != 400 || b.destructs != n {
		t.Fatalf("corps trop long : %d", w.Code)
	}
}

// Une panique d'un gestionnaire d'administration : 500 sans détail, et la suite répond.
func TestPaniqueContenue(t *testing.T) {
	b := nouveauBanc()
	b.etat = func() (State, error) { panic("boum IDSECRET") }
	w := b.faire(req{method: "GET", path: "/api/etat", hdr: [][2]string{bon()}})
	if w.Code != 500 || strings.Contains(w.Body.String(), "IDSECRET") {
		t.Fatalf("%d %s", w.Code, w.Body.String())
	}
	b.etat = nil
	if w := b.faire(req{method: "GET", path: "/api/etat", hdr: [][2]string{bon()}}); w.Code != 200 {
		t.Fatalf("après la panique : %d", w.Code)
	}
}

// La page : servie sans jeton (elle ne contient rien), en-têtes stricts, aucune ressource
// tierce, aucun stockage du jeton, aucun HTML écrit par le script.
func TestPage(t *testing.T) {
	b := nouveauBanc()
	for p, ct := range map[string]string{"/": "text/html", "/admin.css": "text/css", "/admin.js": "text/javascript"} {
		w := b.faire(req{method: "GET", path: p})
		if w.Code != 200 || !strings.HasPrefix(w.Header().Get("Content-Type"), ct) || w.Body.Len() == 0 {
			t.Fatalf("%s : %d %s", p, w.Code, w.Header().Get("Content-Type"))
		}
		h := w.Header()
		if h.Get("Content-Security-Policy") != csp || h.Get("Cache-Control") != "no-store" || h.Get("X-Frame-Options") != "DENY" ||
			h.Get("X-Content-Type-Options") != "nosniff" || h.Get("Referrer-Policy") != "no-referrer" {
			t.Fatalf("%s : en-têtes %v", p, h)
		}
		corps := strings.ToLower(w.Body.String())
		for _, interdit := range []string{"http://", "https://", "src=\"//", "url(", "@import", "innerhtml", "outerhtml",
			"insertadjacenthtml", "document.write", "eval(", "localstorage", "sessionstorage", "document.cookie", "indexeddb",
			"style=\"", "onclick", "<script>", "sendbeacon"} {
			if strings.Contains(corps, interdit) {
				t.Errorf("%s contient %q", p, interdit)
			}
		}
	}
	for _, d := range []string{"default-src 'none'", "script-src 'self'", "style-src 'self'", "frame-ancestors 'none'",
		"form-action 'none'", "base-uri 'none'", "require-trusted-types-for 'script'"} {
		if !strings.Contains(csp, d) {
			t.Errorf("CSP sans %q", d)
		}
	}
	if strings.Contains(csp, "unsafe") || strings.Contains(csp, "*") || strings.Contains(csp, "data:") {
		t.Fatalf("CSP trop large : %s", csp)
	}
	// La page elle-même ne reçoit pas de paramètres, et aucune autre méthode.
	if w := b.faire(req{method: "GET", path: "/?x=1"}); w.Code != 404 {
		t.Fatalf("/?x=1 : %d", w.Code)
	}
	if w := b.faire(req{method: "POST", path: "/"}); w.Code != 404 {
		t.Fatalf("POST / : %d", w.Code)
	}
}

// L'état ne porte que des nombres, des booléens et les trois chaînes de configuration : le
// type lui-même est vérifié, pour qu'un champ ajouté plus tard (liste, identifiant, date)
// fasse échouer ce test.
func TestEtatQueDesAgregats(t *testing.T) {
	chaines := map[string]bool{"Sante.Go": true, "Sante.Revision": true, "Sante.Origine": true}
	var voir func(chemin string, ty reflect.Type)
	voir = func(chemin string, ty reflect.Type) {
		switch ty.Kind() {
		case reflect.Struct:
			for i := 0; i < ty.NumField(); i++ {
				f := ty.Field(i)
				sous := f.Name
				if chemin != "" {
					sous = chemin + "." + f.Name
				}
				voir(sous, f.Type)
			}
		case reflect.Pointer:
			voir(chemin, ty.Elem())
		case reflect.Bool, reflect.Int, reflect.Int64, reflect.Uint32, reflect.Uint64:
		case reflect.String:
			if !chaines[chemin] {
				t.Errorf("chaîne non prévue dans l'état : %s", chemin)
			}
		default:
			t.Errorf("type non agrégé dans l'état : %s (%s)", chemin, ty.Kind())
		}
	}
	voir("", reflect.TypeOf(State{}))
}
