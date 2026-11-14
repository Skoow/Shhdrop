package api

import (
	"bytes"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha1"
	"encoding/base32"
	"encoding/binary"
	"fmt"
	"go/ast"
	"path/filepath"
	"sort"
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

func (p *postier) Plein() bool { return false }

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
	rand.Read(c.TOTP[:])
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
	// Lot 5.
	{"POST", "/api/compte/connexion/totp"}, {"POST", "/api/compte/oubli/debut"}, {"POST", "/api/compte/oubli/renvoyer"},
	{"POST", "/api/compte/oubli/verifier"}, {"POST", "/api/compte/oubli/fin"}, {"GET", "/api/compte"},
	{"POST", "/api/compte/mdp"}, {"POST", "/api/compte/email/debut"}, {"POST", "/api/compte/email/renvoyer"},
	{"POST", "/api/compte/email/fin"}, {"POST", "/api/compte/totp/debut"}, {"POST", "/api/compte/totp/fin"},
	{"POST", "/api/compte/totp/retirer"}, {"POST", "/api/compte/totp/annuler-retrait"}, {"GET", "/api/compte/export"},
	{"POST", "/api/compte/supprimer"},
	// Lot 6.
	{"GET", "/api/compte/salons"}, {"POST", "/api/compte/salons/detruire"},
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

// Lot 5 : récupération, double authentification, paramètres, suppression, par HTTP.

// totpCode : RFC 6238 (SHA-1, 6 chiffres, 30 s), pour les tests de l'API (le paquet compte a
// ses propres vecteurs de la RFC).
func totpCode(secret []byte, t time.Time) string {
	var c [8]byte
	binary.BigEndian.PutUint64(c[:], uint64(t.Unix()/30))
	m := hmac.New(sha1.New, secret)
	m.Write(c[:])
	s := m.Sum(nil)
	o := s[19] & 15
	return fmt.Sprintf("%06d", (binary.BigEndian.Uint32(s[o:o+4])&0x7fffffff)%1000000)
}

func cles(m map[string]any) string {
	var k []string
	for x := range m {
		k = append(k, x)
	}
	sort.Strings(k)
	return strings.Join(k, ",")
}

// oubli/debut : même réponse (forme, statut) pour une adresse inconnue, une variante et
// l'adresse exacte ; oubli/verifier d'un code faux : même corps.
func TestOubliHTTPIdentique(t *testing.T) {
	e := newEnvCompte(t)
	e.inscrire(t, "203.0.113.40:1", "lea.dupont@gmail.com", "lea")
	n := len(e.post.msgs)
	var corps []string
	for i, a := range []string{"inconnue@exemple.fr", "leadupont@gmail.com", "lea.dupont@gmail.com"} {
		remote := fmt.Sprintf("203.0.113.%d:1", 41+i)
		alt, shown := e.captchaFor(t, remote)
		w := e.do(req{method: "POST", path: "/api/compte/oubli/debut", remote: remote,
			body: mustJSON(map[string]any{"email": a, "langue": "fr", "altcha": alt, "hp": "", "shown_at": shown})})
		d := jsonOf(t, w)
		if w.Code != 200 || cles(d) != "etape" || len(d["etape"].(string)) != 43 {
			t.Fatalf("%s : %d %q", a, w.Code, w.Body.String())
		}
		w = e.do(req{method: "POST", path: "/api/compte/oubli/verifier", remote: remote,
			body: mustJSON(map[string]any{"etape": d["etape"], "code": "000000", "totp": "", "totp_perdu": false})})
		corps = append(corps, fmt.Sprint(w.Code, w.Body.String()))
	}
	if corps[0] != corps[1] || corps[1] != corps[2] || corps[0] != `403{"error":"code_faux","attempts_left":4}` {
		// (le code juste de l'adresse exacte est tiré au hasard : 000000 n'a qu'une chance sur un million)
		t.Fatal(corps)
	}
	if len(e.post.msgs) != n+1 || e.post.msgs[n].A != "lea.dupont@gmail.com" {
		t.Fatal("e-mails :", len(e.post.msgs)-n)
	}
	// Sans preuve anti-robot : refus.
	w := e.do(req{method: "POST", path: "/api/compte/oubli/debut", remote: "203.0.113.49:1",
		body: mustJSON(map[string]any{"email": "lea.dupont@gmail.com", "langue": "fr", "altcha": "x", "hp": "", "shown_at": "x"})})
	expect(t, w, 400, badRequest)
}

func TestParcoursLot5HTTP(t *testing.T) {
	e := newEnvCompte(t)
	const ip = "203.0.113.50:1"
	a := e.inscrire(t, ip, "lea@exemple.fr", "lea")
	S := sess(a.session)
	// État.
	w := e.do(req{method: "GET", path: "/api/compte", hdr: S})
	expect(t, w, 200, "")
	et := jsonOf(t, w)
	if cles(et) != "banni,banni_jusqu,banni_motif,confirme_le,cree_le,h,limites,palier,recup_jusqu,retrait_totp_le,salons_actifs,totp" ||
		et["h"] != a.h || et["palier"] != "neuf" || et["totp"] != false || et["recup_jusqu"] != nil || et["banni_motif"] != nil ||
		fmt.Sprint(et["limites"]) != "map[heures:24 places:4 salons:1]" {
		t.Fatal(w.Body.String())
	}
	// Double authentification.
	w = e.do(req{method: "POST", path: "/api/compte/totp/debut", hdr: S, body: []byte(`{}`)})
	expect(t, w, 200, "")
	td := jsonOf(t, w)
	sec, err := base32.StdEncoding.DecodeString(td["secret"].(string))
	if err != nil || len(sec) != 20 || cles(td) != "etape,secret" {
		t.Fatal(w.Body.String())
	}
	expect(t, e.do(req{method: "POST", path: "/api/compte/totp/fin", hdr: S,
		body: mustJSON(map[string]any{"etape": td["etape"], "code": totpCode(sec, e.clk.Now())})}), 200, `{}`)
	e.clk.Add(30 * time.Second)
	w = e.do(req{method: "POST", path: "/api/compte/connexion", remote: ip,
		body: mustJSON(map[string]any{"email": "lea@exemple.fr", "a_auth": a.aAuth, "persistante": false, "etiquette": ""})})
	expect(t, w, 200, "")
	c := jsonOf(t, w)
	if cles(c) != "etape,totp_requis" || c["totp_requis"] != true {
		t.Fatal(w.Body.String())
	}
	expect(t, e.do(req{method: "POST", path: "/api/compte/connexion/totp", remote: ip,
		body: mustJSON(map[string]any{"etape": c["etape"], "code": "000000"})}), 403, `{"error":"totp_faux"}`)
	w = e.do(req{method: "POST", path: "/api/compte/connexion/totp", remote: ip,
		body: mustJSON(map[string]any{"etape": c["etape"], "code": totpCode(sec, e.clk.Now())})})
	expect(t, w, 200, "")
	if cles(jsonOf(t, w)) != "blob_prive,blob_profil,env_mdp,gen_prive,gen_profil,h,s_profil,session" {
		t.Fatal(w.Body.String())
	}
	// Rejeu du même code : refusé.
	w = e.do(req{method: "POST", path: "/api/compte/connexion", remote: ip,
		body: mustJSON(map[string]any{"email": "lea@exemple.fr", "a_auth": a.aAuth, "persistante": false, "etiquette": ""})})
	c = jsonOf(t, w)
	expect(t, e.do(req{method: "POST", path: "/api/compte/connexion/totp", remote: ip,
		body: mustJSON(map[string]any{"etape": c["etape"], "code": totpCode(sec, e.clk.Now())})}), 403, `{"error":"totp_rejoue"}`)
	// Récupération : le code de l'application est exigé ; « Je n'ai plus mon application » : attente.
	alt, shown := e.captchaFor(t, ip)
	w = e.do(req{method: "POST", path: "/api/compte/oubli/debut", remote: ip,
		body: mustJSON(map[string]any{"email": "lea@exemple.fr", "langue": "fr", "altcha": alt, "hp": "", "shown_at": shown})})
	expect(t, w, 200, "")
	et2 := jsonOf(t, w)["etape"]
	code := e.post.code(t)
	expect(t, e.do(req{method: "POST", path: "/api/compte/oubli/renvoyer", remote: ip,
		body: mustJSON(map[string]any{"etape": et2, "email": "lea@exemple.fr"})}), 429, "")
	expect(t, e.do(req{method: "POST", path: "/api/compte/oubli/verifier", remote: ip,
		body: mustJSON(map[string]any{"etape": et2, "code": code, "totp": "", "totp_perdu": false})}), 403, `{"error":"totp_requis"}`)
	e.clk.Add(30 * time.Second)
	w = e.do(req{method: "POST", path: "/api/compte/oubli/verifier", remote: ip,
		body: mustJSON(map[string]any{"etape": et2, "code": code, "totp": totpCode(sec, e.clk.Now()), "totp_perdu": false})})
	expect(t, w, 200, `{"h":"`+a.h+`"}`)
	nouveau := enc.EncodeToString(rnd(32))
	w = e.do(req{method: "POST", path: "/api/compte/oubli/fin", remote: ip, body: mustJSON(map[string]any{
		"etape": et2, "a_auth": nouveau, "env_mdp": enc.EncodeToString(rnd(60)), "blob_prive": coffreB64("SHH-ACCT1", 2),
		"persistante": false, "etiquette": ""})})
	expect(t, w, 200, "")
	f := jsonOf(t, w)
	if cles(f) != "blob_profil,gen_prive,gen_profil,h,s_profil,session" || f["gen_prive"] != float64(2) || f["h"] != a.h {
		t.Fatal(w.Body.String())
	}
	expect(t, e.do(req{method: "GET", path: "/api/compte", hdr: S}), 401, `{"error":"session"}`)
	S = sess(f["session"].(string))
	jusqu := e.clk.Now().UTC().AddDate(0, 0, 7).Format("2006-01-02")
	w = e.do(req{method: "GET", path: "/api/compte", hdr: S})
	if et = jsonOf(t, w); et["recup_jusqu"] != jusqu || et["totp"] != true {
		t.Fatal(w.Body.String())
	}
	// Attente de 7 jours : adresse et suppression refusées.
	expect(t, e.do(req{method: "POST", path: "/api/compte/email/debut", hdr: S, remote: ip, body: mustJSON(map[string]any{
		"email_actuel": "lea@exemple.fr", "email_nouveau": "lea@ailleurs.fr", "langue": "fr"})}), 403,
		`{"error":"attente","jusqu":"`+jusqu+`"}`)
	expect(t, e.do(req{method: "POST", path: "/api/compte/supprimer", hdr: S, body: []byte(`{}`)}), 403,
		`{"error":"attente","jusqu":"`+jusqu+`"}`)
	// Mot de passe ; export ; annulation d'une demande de retrait ; retrait.
	expect(t, e.do(req{method: "POST", path: "/api/compte/mdp", hdr: S, body: mustJSON(map[string]any{
		"a_auth": nouveau, "env_mdp": enc.EncodeToString(rnd(60))})}), 200, `{}`)
	w = e.do(req{method: "GET", path: "/api/compte/export", hdr: S})
	expect(t, w, 200, "")
	if x := jsonOf(t, w); cles(x) != "anciennete_depuis,banni_jusqu,banni_motif,cree_le,recup_jusqu,retrait_totp_le,salons_actifs,sessions,totp,vu_mois" ||
		strings.Contains(w.Body.String(), "lea") {
		t.Fatal(w.Body.String())
	}
	expect(t, e.do(req{method: "POST", path: "/api/compte/totp/annuler-retrait", hdr: S, body: []byte(`{}`)}), 200, `{}`)
	expect(t, e.do(req{method: "POST", path: "/api/compte/totp/retirer", hdr: S, body: []byte(`{}`)}), 200, `{}`)
	// Après 7 jours : changement d'adresse puis suppression.
	e.clk.Add(7 * 24 * time.Hour)
	w = e.do(req{method: "POST", path: "/api/compte/connexion", remote: ip,
		body: mustJSON(map[string]any{"email": "lea@exemple.fr", "a_auth": nouveau, "persistante": false, "etiquette": ""})})
	expect(t, w, 200, "")
	S = sess(jsonOf(t, w)["session"].(string))
	expect(t, e.do(req{method: "POST", path: "/api/compte/email/debut", hdr: S, remote: ip, body: mustJSON(map[string]any{
		"email_actuel": "lea@exemple.fr", "email_nouveau": "x@mailinator.com", "langue": "fr"})}), 400, `{"error":"jetable"}`)
	w = e.do(req{method: "POST", path: "/api/compte/email/debut", hdr: S, remote: ip, body: mustJSON(map[string]any{
		"email_actuel": "lea@exemple.fr", "email_nouveau": "lea@ailleurs.fr", "langue": "fr"})})
	expect(t, w, 200, "")
	ee := jsonOf(t, w)
	if cles(ee) != "etape" || e.post.msgs[len(e.post.msgs)-1].A != "lea@ailleurs.fr" {
		t.Fatal(w.Body.String())
	}
	expect(t, e.do(req{method: "POST", path: "/api/compte/email/fin", hdr: S, body: mustJSON(map[string]any{
		"etape": ee["etape"], "code": e.post.code(t), "a_auth": enc.EncodeToString(rnd(32)), "env_mdp": enc.EncodeToString(rnd(60)),
		"totp": ""})}), 200, `{}`)
	expect(t, e.do(req{method: "POST", path: "/api/compte/supprimer", hdr: S, body: []byte(`{}`)}), 200, `{"salons_fermes":0}`)
	expect(t, e.do(req{method: "GET", path: "/api/compte", hdr: S}), 401, `{"error":"session"}`)
}
