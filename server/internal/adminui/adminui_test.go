package adminui

import (
	"bytes"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"os"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"
)

// Délai après un jeton faux : écourté pour toute la suite (TestFreinApresJetonFaux le règle
// lui-même).
func TestMain(m *testing.M) {
	delaiFaux, delaiFauxMax = time.Millisecond, 4*time.Millisecond
	os.Exit(m.Run())
}

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
		Host:      "172.30.53.2",
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
	hote                      string // en-tête Host ("" : localhost:9191, comme par le tunnel SSH)
	hdr                       [][2]string
}

func (b *banc) faire(q req) *httptest.ResponseRecorder {
	if q.pair == "" {
		q.pair = "127.0.0.1:40000"
	}
	r := httptest.NewRequest(q.method, q.path, strings.NewReader(q.corps))
	r.RemoteAddr = q.pair
	r.Host = "localhost:9191"
	if q.hote != "" {
		r.Host = q.hote
	}
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
		{"salon-reste", nil, 200, `{"detruit":"salon","reste":true}`},
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

// Audit adverse du 13 novembre, 3e campagne (tableau de bord H1, site F3) : l'en-tête Host est
// contrôlé. Seuls localhost, 127.0.0.1 et l'adresse d'écoute sont servis, sur n'importe quel
// port (le tunnel SSH choisit le port local) ; tout autre nom (un site qui fait pointer son nom
// vers la boucle locale, ou Caddy qui relaierait le nom public) reçoit le refus uniforme, page
// comprise, même avec le bon jeton.
func TestHoteControle(t *testing.T) {
	b := nouveauBanc()
	ref := b.faire(req{method: "GET", path: "/api/nimporte"})
	for _, h := range []string{"evil.example:9191", "evil.example", "shhgone.com", "localhost.evil.example:9191",
		"evil.example.localhost:9191", "LOCALHOST:9191", "127.0.0.2:9191", "127.1:9191", "[::1]:9191", "172.30.53.1:9191",
		"localhost:", "localhost:99999", "localhost:0x50", "localhost:9191:9191", "localhost:9191 ", " localhost:9191",
		"localhost.", "localhost:9191/", "user@localhost:9191", "0.0.0.0:9191"} {
		for _, q := range []req{{method: "GET", path: "/"}, {method: "GET", path: "/admin.js"},
			{method: "GET", path: "/api/etat", hdr: [][2]string{bon()}}, {method: "POST", path: "/api/geler", hdr: [][2]string{bon()}}} {
			q.hote = h
			w := b.faire(q)
			if w.Code != ref.Code || !bytes.Equal(w.Body.Bytes(), ref.Body.Bytes()) || !reflect.DeepEqual(w.Header(), ref.Header()) {
				t.Errorf("Host %q, %s %s : servi (%d, %d octets)", h, q.method, q.path, w.Code, w.Body.Len())
			}
		}
	}
	if b.appels() != 0 {
		t.Fatalf("une fonction a été appelée sous un hôte étranger : %+v", b)
	}
	for _, h := range []string{"localhost:9191", "localhost:8000", "localhost", "127.0.0.1:9191", "127.0.0.1:1", "127.0.0.1",
		"172.30.53.2:9191", "172.30.53.2:65535"} {
		if w := b.faire(req{method: "GET", path: "/", hote: h}); w.Code != 200 {
			t.Errorf("Host %q : page refusée (%d)", h, w.Code)
		}
		if w := b.faire(req{method: "GET", path: "/api/etat", hote: h, hdr: [][2]string{bon()}}); w.Code != 200 {
			t.Errorf("Host %q : état refusé (%d)", h, w.Code)
		}
	}
	// Écouteur en IPv6 : son adresse est servie entre crochets.
	b6 := New(Config{TokenHash: sha256.Sum256([]byte(jeton)), Host: "::1", State: func() (State, error) { return State{}, nil }})
	for h, code := range map[string]int{"[::1]:9191": 200, "[::1]": 200, "::1": 404, "[::2]:9191": 404} {
		r := httptest.NewRequest("GET", "/", nil)
		r.RemoteAddr, r.Host = "[::1]:40000", h
		w := httptest.NewRecorder()
		b6.ServeHTTP(w, r)
		if w.Code != code {
			t.Errorf("écouteur ::1, Host %q : %d, attendu %d", h, w.Code, code)
		}
	}
}

// Audit adverse du 13 novembre, 3e campagne, tableau de bord, F4 : aucun frein aux essais de
// jeton (26 900 par seconde mesurés). Un jeton faux pose maintenant un délai global (rien par
// adresse) : sa réponse, et celle de toute vérification arrivée entretemps, bonne ou fausse,
// n'est rendue qu'à la fin du délai ; chaque jeton faux le prolonge, jusqu'à un plafond.
// L'exploitant n'est jamais refusé : au pire il attend le plafond.
func TestFreinApresJetonFaux(t *testing.T) {
	const pas, plafond = 40 * time.Millisecond, 160 * time.Millisecond
	av, avMax := delaiFaux, delaiFauxMax
	delaiFaux, delaiFauxMax = pas, plafond
	defer func() { delaiFaux, delaiFauxMax = av, avMax }()
	faux := req{method: "GET", path: "/api/etat", hdr: [][2]string{{"Authorization", "Bearer " + strings.Repeat("f", 64)}}}
	juste := req{method: "GET", path: "/api/etat", hdr: [][2]string{bon()}}
	duree := func(b *banc, q req) (time.Duration, int) {
		t0 := time.Now()
		w := b.faire(q)
		return time.Since(t0), w.Code
	}

	// Sans jeton faux : aucune attente.
	b := nouveauBanc()
	if d, code := duree(b, juste); code != 200 || d > pas/2 {
		t.Fatalf("bon jeton, aucun essai faux : %d après %v", code, d)
	}
	// Essais faux à la suite : un pas chacun (force brute sur une connexion : 1 par pas au plus).
	t0 := time.Now()
	for range 4 {
		if _, code := duree(b, faux); code != 404 {
			t.Fatal("jeton faux accepté :", code)
		}
	}
	if d := time.Since(t0); d < 4*pas {
		t.Fatalf("FAIBLESSE F4 : 4 essais faux à la suite en %v (au moins %v attendu)", d, 4*pas)
	}
	// Le délai est écoulé : le bon jeton passe de nouveau sans attendre.
	if d, code := duree(b, juste); code != 200 || d > pas/2 {
		t.Fatalf("bon jeton après les essais faux : %d après %v", code, d)
	}

	// Rafale d'essais faux en même temps : le délai monte jusqu'au plafond, pas au-delà ; un bon
	// jeton arrivé pendant la rafale est servi (jamais refusé), au plus tard au plafond, et pas
	// avant la fin du délai en cours (sa réussite ne se voit pas plus tôt qu'un échec).
	b = nouveauBanc()
	var wg sync.WaitGroup
	debut := time.Now()
	var plusLong time.Duration
	var mu sync.Mutex
	for range 50 {
		wg.Go(func() {
			d, code := duree(b, faux)
			if code != 404 {
				t.Error("jeton faux accepté :", code)
			}
			mu.Lock()
			plusLong = max(plusLong, d)
			mu.Unlock()
		})
	}
	time.Sleep(pas / 4)
	d, code := duree(b, juste)
	wg.Wait()
	if code != 200 {
		t.Fatal("DÉNI DE SERVICE : bon jeton refusé pendant une rafale d'essais faux :", code)
	}
	if d < pas/2 {
		t.Fatalf("bon jeton servi en %v pendant une rafale : sa réussite se voit avant la fin du délai", d)
	}
	if d > plafond+pas || plusLong > plafond+pas || time.Since(debut) > 2*plafond+pas {
		t.Fatalf("attente au-delà du plafond : bon jeton %v, essai faux le plus long %v (plafond %v)", d, plusLong, plafond)
	}
	if b.etats != 1 {
		t.Fatal("appels à State :", b.etats)
	}
}

// Audit adverse du 13 novembre, 3e campagne, site F3 : après une coupure du tunnel, l'onglet
// renvoyait le jeton toutes les 5 s à quiconque répondait sur ce port. Le script oublie
// maintenant le jeton, arrête sa minuterie et revient à la saisie dès un refus (404) ou après
// trois lectures sans réponse de suite. Le comportement est prouvé hors de ce dépôt de tests Go
// par un essai du script (faux DOM, faux fetch) ; ici, garde-fou de structure seulement : les
// pièces de ce comportement sont dans le script servi.
func TestPageOublieLeJeton(t *testing.T) {
	js, err := page.ReadFile("page/admin.js")
	if err != nil {
		t.Fatal(err)
	}
	s := string(js)
	i := strings.Index(s, "function fermer(")
	if i < 0 {
		t.Fatal("le script n'a plus de fonction fermer")
	}
	corps := s[i:]
	corps = corps[:strings.Index(corps, "\n}\n")]
	for _, attendu := range []string{"jeton = ''", "clearInterval(minuterie)", "$('entree').hidden = false", "$('tableau').hidden = true"} {
		if !strings.Contains(corps, attendu) {
			t.Errorf("fermer ne fait plus %q", attendu)
		}
	}
	for _, attendu := range []string{"r.statut === 404 ? 'refus'", "++echecs >= 3", "addEventListener('pagehide'", "setInterval(relire, 5000)",
		"if (!jeton) throw"} {
		if !strings.Contains(s, attendu) {
			t.Errorf("le script n'a plus %q", attendu)
		}
	}
	if strings.Contains(s, "setInterval(rafraichir") {
		t.Error("la minuterie appelle rafraichir sans passer par relire (qui ferme la session)")
	}
}

// Audit adverse du 13 novembre, 3e campagne, tableau de bord, F6 : l'empreinte posée à la
// compilation (-ldflags -X main.buildID, deploy/Dockerfile) est celle affichée ; vide, repli
// sur l'empreinte vcs du binaire. Abrégée à 12 caractères, et rien d'autre que les caractères
// d'une empreinte ou d'une étiquette n'arrive dans l'état.
func TestEmpreinteDeCompilation(t *testing.T) {
	for id, want := range map[string]string{
		"0123abc": "0123abc", "0123456789abcdef0123": "0123456789ab", "v1.2-rc_3": "v1.2-rc_3",
		"<script>a</script>": "scriptascrip", "a\"b\nc": "abc",
	} {
		if g, r := Build(id); g == "" || r != want {
			t.Errorf("Build(%q) = %q, attendu %q", id, r, want)
		}
	}
	if _, r := Build(""); len(r) > 12 {
		t.Errorf("repli vcs : %q", r)
	}
}
