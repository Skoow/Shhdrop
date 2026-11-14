package api

import (
	"bytes"
	"crypto/rand"
	"encoding/binary"
	"go/ast"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/skoow/shhdrop/server/internal/compte"
	"github.com/skoow/shhdrop/server/internal/courriel"
)

// Routes du compte (plan du compte, lot 4 ; conception §8.6, §21.6.2).

type postier struct {
	mu   sync.Mutex
	msgs []courriel.Message
}

func (p *postier) Mettre(m courriel.Message) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.msgs = append(p.msgs, m)
	return nil
}

func (p *postier) code(t *testing.T) string {
	t.Helper()
	p.mu.Lock()
	defer p.mu.Unlock()
	if len(p.msgs) == 0 {
		t.Fatal("aucun e-mail")
	}
	return p.msgs[len(p.msgs)-1].Code
}

type envCompte struct {
	*env
	post *postier
}

func newEnvCompte(t *testing.T) envCompte {
	t.Helper()
	e := newEnv(t, false, nil)
	db, err := compte.OuvrirBase(filepath.Join(e.dir, "comptes.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	var c compte.Cles
	rand.Read(c.Email[:])
	rand.Read(c.Poivre[:])
	rand.Read(c.Sequestre[:])
	rand.Read(c.Pseudo[:])
	p := &postier{}
	s, err := compte.NewService(compte.Config{DB: db, Cles: c, Courriel: p, Limites: e.srv.lim, Now: e.clk.Now, Max: 100})
	if err != nil {
		t.Fatal(err)
	}
	e.h = newHandler(e.srv, htmlStatic(), Salons{Comptes: s})
	return envCompte{e, p}
}

func coffreB64(magic string, gen uint64) string {
	b := make([]byte, 4096+45)
	rand.Read(b)
	copy(b, magic)
	binary.BigEndian.PutUint64(b[9:], gen)
	return enc.EncodeToString(b)
}

type inscrit struct {
	h, session, aAuth string
}

// inscrire : debut (avec ALTCHA) puis fin, par HTTP.
func (e envCompte) inscrire(t *testing.T, remote, email, pseudo string) inscrit {
	t.Helper()
	alt, shown := e.captchaFor(t, remote)
	w := e.do(req{method: "POST", path: "/api/compte/inscription/debut", remote: remote,
		body: mustJSON(map[string]any{"email": email, "langue": "fr", "altcha": alt, "hp": "", "shown_at": shown})})
	expect(t, w, 200, "")
	d := jsonOf(t, w)
	h, _ := d["h"].(string)
	etape, _ := d["etape"].(string)
	if len(h) != 22 || len(etape) != 43 || len(d) != 2 {
		t.Fatalf("debut : %q", w.Body.String())
	}
	a := enc.EncodeToString(rnd(32))
	w = e.do(req{method: "POST", path: "/api/compte/inscription/fin", remote: remote, body: mustJSON(map[string]any{
		"etape": etape, "code": e.post.code(t), "a_auth": a, "env_mdp": enc.EncodeToString(rnd(60)),
		"s_profil": enc.EncodeToString(rnd(32)), "p_canon": pseudo, "blob_profil": coffreB64("SHH-PROF1", 1),
		"blob_prive": coffreB64("SHH-ACCT1", 1), "persistante": false, "etiquette": ""})})
	expect(t, w, 201, "")
	f := jsonOf(t, w)
	s, _ := f["session"].(string)
	if len(s) != 43 || len(f) != 1 {
		t.Fatalf("fin : %q", w.Body.String())
	}
	return inscrit{h, s, a}
}

func sess(s string) map[string]string { return map[string]string{"X-Shh-Session": s} }

// SHH_COMPTES=0 : aucune route /api/compte/* ; la même 404 qu'une route inconnue.
func TestRoutesCompteAbsentes(t *testing.T) {
	e := newEnv(t, false, nil)
	ref := e.do(req{method: "GET", path: "/api/inconnue"})
	for _, r := range routesCompte {
		w := e.do(req{method: r[0], path: r[1], body: []byte(`{}`), hdr: sess(enc.EncodeToString(rnd(32)))})
		if w.Code != ref.Code || w.Body.String() != ref.Body.String() {
			t.Fatalf("%s %s : %d %q", r[0], r[1], w.Code, w.Body.String())
		}
	}
}

var routesCompte = [][2]string{
	{"POST", "/api/compte/inscription/debut"}, {"POST", "/api/compte/inscription/renvoyer"},
	{"POST", "/api/compte/inscription/fin"}, {"POST", "/api/compte/connexion"}, {"POST", "/api/compte/reauth"},
	{"GET", "/api/compte/sessions"}, {"POST", "/api/compte/sessions/fermer"}, {"POST", "/api/compte/deconnexion"},
	{"GET", "/api/compte/coffre/profil"}, {"PUT", "/api/compte/coffre/profil"}, {"GET", "/api/compte/coffre/prive"},
	{"PUT", "/api/compte/coffre/prive"}, {"POST", "/api/compte/pseudo/verifier"}, {"POST", "/api/compte/pseudo"},
}

// Parcours complet par HTTP : inscription, coffres, sessions, connexion, déconnexion ; réponses
// uniformes (adresse prise : même forme à debut ; adresse inconnue et mot de passe faux : même
// corps à connexion).
func TestParcoursCompteHTTP(t *testing.T) {
	e := newEnvCompte(t)
	const ip = "203.0.113.20:1"
	a := e.inscrire(t, ip, "Lea@Exemple.fr", "lea")
	// Adresse déjà prise : debut a la même forme.
	alt, shown := e.captchaFor(t, "203.0.113.21:1")
	w := e.do(req{method: "POST", path: "/api/compte/inscription/debut", remote: "203.0.113.21:1",
		body: mustJSON(map[string]any{"email": "lea@exemple.fr", "langue": "fr", "altcha": alt, "hp": "", "shown_at": shown})})
	if d := jsonOf(t, w); w.Code != 200 || len(d) != 2 || len(d["h"].(string)) != 22 || len(d["etape"].(string)) != 43 {
		t.Fatal(w.Body.String())
	}
	// Sans session, session inconnue ou mal formée : 401.
	for _, h := range []map[string]string{nil, sess(enc.EncodeToString(rnd(32))), sess("court")} {
		w := e.do(req{method: "GET", path: "/api/compte/coffre/profil", hdr: h})
		expect(t, w, 401, `{"error":"session"}`)
	}
	w = e.do(req{method: "GET", path: "/api/compte/coffre/prive", hdr: sess(a.session)})
	expect(t, w, 200, "")
	if d := jsonOf(t, w); d["gen"] != float64(1) || len(d["blob"].(string)) < 5000 {
		t.Fatal(w.Body.String())
	}
	w = e.do(req{method: "PUT", path: "/api/compte/coffre/prive", hdr: sess(a.session),
		body: mustJSON(map[string]any{"if_gen": 1, "blob": coffreB64("SHH-ACCT1", 2)})})
	expect(t, w, 200, `{"gen":2}`)
	w = e.do(req{method: "PUT", path: "/api/compte/coffre/prive", hdr: sess(a.session),
		body: mustJSON(map[string]any{"if_gen": 1, "blob": coffreB64("SHH-ACCT1", 2)})})
	expect(t, w, 409, `{"error":"conflict","gen":2}`)
	// Connexion : adresse inconnue et mot de passe faux, même corps.
	var corps []string
	for _, x := range [][2]string{{"inconnue@exemple.fr", a.aAuth}, {"lea@exemple.fr", enc.EncodeToString(rnd(32))}} {
		w := e.do(req{method: "POST", path: "/api/compte/connexion", remote: "203.0.113.30:1",
			body: mustJSON(map[string]any{"email": x[0], "a_auth": x[1], "persistante": false, "etiquette": ""})})
		corps = append(corps, w.Body.String())
		expect(t, w, 403, `{"error":"identifiants"}`)
	}
	w = e.do(req{method: "POST", path: "/api/compte/connexion", remote: "203.0.113.30:1",
		body: mustJSON(map[string]any{"email": "LEA+x@exemple.fr", "a_auth": a.aAuth, "persistante": true,
			"etiquette": enc.EncodeToString(rnd(64))})})
	expect(t, w, 200, "")
	o := jsonOf(t, w)
	for k, n := range map[string]int{"session": 43, "h": 22, "env_mdp": 80, "s_profil": 43} {
		if s, _ := o[k].(string); len(s) != n {
			t.Fatalf("%s : %q", k, o[k])
		}
	}
	if o["h"] != a.h || o["gen_profil"] != float64(1) || o["gen_prive"] != float64(2) || len(o) != 8 {
		t.Fatal(w.Body.String())
	}
	s2 := o["session"].(string)
	w = e.do(req{method: "GET", path: "/api/compte/sessions", hdr: sess(s2)})
	expect(t, w, 200, "")
	if !strings.Contains(w.Body.String(), `"courante":true`) || strings.Count(w.Body.String(), `"sid"`) != 2 {
		t.Fatal(w.Body.String())
	}
	// Session non récente : reauth.
	e.clk.Add(6 * time.Minute)
	expect(t, e.do(req{method: "POST", path: "/api/compte/reauth", hdr: sess(s2),
		body: mustJSON(map[string]any{"a_auth": enc.EncodeToString(rnd(32)), "totp": ""})}), 403, `{"error":"identifiants"}`)
	expect(t, e.do(req{method: "POST", path: "/api/compte/reauth", hdr: sess(s2),
		body: mustJSON(map[string]any{"a_auth": a.aAuth, "totp": ""})}), 200, `{}`)
	// Pseudo.
	expect(t, e.do(req{method: "POST", path: "/api/compte/pseudo/verifier", hdr: sess(s2),
		body: []byte(`{"p_canon":"lea"}`)}), 200, `{"libre":false}`)
	expect(t, e.do(req{method: "POST", path: "/api/compte/pseudo/verifier", hdr: sess(s2),
		body: []byte(`{"p_canon":"connard"}`)}), 200, `{"libre":false}`)
	expect(t, e.do(req{method: "POST", path: "/api/compte/pseudo/verifier", hdr: sess(s2),
		body: []byte(`{"p_canon":"leo"}`)}), 200, `{"libre":true}`)
	expect(t, e.do(req{method: "POST", path: "/api/compte/pseudo", hdr: sess(s2),
		body: []byte(`{"p_canon":"leo"}`)}), 429, "")
	// Fermer les autres, puis se déconnecter.
	expect(t, e.do(req{method: "POST", path: "/api/compte/sessions/fermer", hdr: sess(s2),
		body: []byte(`{"autres":true}`)}), 200, `{}`)
	expect(t, e.do(req{method: "GET", path: "/api/compte/sessions", hdr: sess(a.session)}), 401, `{"error":"session"}`)
	expect(t, e.do(req{method: "POST", path: "/api/compte/deconnexion", hdr: sess(s2), body: []byte(`{}`)}), 200, `{}`)
	expect(t, e.do(req{method: "GET", path: "/api/compte/sessions", hdr: sess(s2)}), 401, `{"error":"session"}`)
}

// JSON strict (§8.6) : clé inconnue, doublon, casse, longueur fausse, null → 400.
func TestJSONStrictCompte(t *testing.T) {
	e := newEnvCompte(t)
	a := enc.EncodeToString(rnd(32))
	for i, b := range []string{
		`{"email":"a@b.fr","a_auth":"` + a + `","persistante":false,"etiquette":"","x":1}`,
		`{"email":"a@b.fr","a_auth":"` + a + `","a_auth":"` + a + `","persistante":false,"etiquette":""}`,
		`{"Email":"a@b.fr","a_auth":"` + a + `","persistante":false,"etiquette":""}`,
		`{"email":"a@b.fr","a_auth":"` + a[:42] + `","persistante":false,"etiquette":""}`,
		`{"email":"a@b.fr","a_auth":null,"persistante":false,"etiquette":""}`,
		`{"email":"a@b.fr","a_auth":"` + a + `","persistante":null,"etiquette":""}`,
		`{"email":"a@b.fr","a_auth":"` + a + `","etiquette":""}`,
		`{"email":"a@b.fr","a_auth":"` + a + `","persistante":false,"etiquette":"court"}`,
		`{"email":"a@b.fr","a_auth":"` + a + `","persistante":false,"etiquette":"","altcha":"x"}`,
		`null`, `[]`, ``,
	} {
		w := e.do(req{method: "POST", path: "/api/compte/connexion", body: []byte(b)})
		if w.Code != 400 || w.Body.String() != badRequest {
			t.Fatalf("cas %d : %d %q", i, w.Code, w.Body.String())
		}
	}
	// Corps de coffre au-delà du plafond : 400.
	big := bytes.Repeat([]byte("A"), 2<<20)
	w := e.do(req{method: "POST", path: "/api/compte/inscription/fin", body: big})
	expect(t, w, 400, badRequest)
}

// Le jeton de session n'est lu que par handlers_compte.go (minimize : liste par fichier), et
// son nom n'apparaît dans aucune autre source du serveur.
func TestEnTeteSessionSeulementIci(t *testing.T) {
	if !headerAllowed("internal/api/handlers_compte.go", "X-Shh-Session") {
		t.Fatal("X-Shh-Session refusé dans handlers_compte.go")
	}
	for _, p := range []string{"internal/api/handlers_share.go", "internal/api/handlers_salon.go", "internal/api/api.go"} {
		if headerAllowed(p, "X-Shh-Session") {
			t.Fatalf("X-Shh-Session permis dans %s", p)
		}
	}
	vu := false
	for _, sf := range serverSources(t) {
		ast.Inspect(sf.f, func(n ast.Node) bool {
			if s, ok := strLit(asExpr(n)); ok && strings.Contains(s, "X-Shh-Session") {
				if filepath.Base(sf.path) != "handlers_compte.go" {
					t.Errorf("%s : X-Shh-Session hors de handlers_compte.go", sf.fset.Position(n.Pos()))
				}
				vu = true
			}
			return true
		})
	}
	if !vu {
		t.Fatal("X-Shh-Session introuvable")
	}
}

func asExpr(n ast.Node) ast.Expr {
	if e, ok := n.(ast.Expr); ok {
		return e
	}
	return nil
}
