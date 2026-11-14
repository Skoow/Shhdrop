package api

import (
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"go/ast"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/skoow/shhdrop/server/internal/blob"
	"github.com/skoow/shhdrop/server/internal/compte"
	"github.com/skoow/shhdrop/server/internal/salon"
	"github.com/skoow/shhdrop/server/internal/share"
)

// Lot 6 du plan du compte : création de salon réservée aux comptes (SHH_COMPTES=1), paliers,
// salons du compte, suppression qui ferme les salons ; le jeton de session ne sert qu'à la
// création.

// envSalonCompte : salon et compte actifs, branchés comme dans cmd/shhdrop (brancherComptes).
type envSalonCompte struct {
	envCompte
	m   *salon.Manager
	svc *compte.Service
	cdb *sql.DB // comptes.db
}

func newEnvSalonCompte(t *testing.T) envSalonCompte {
	t.Helper()
	e := newEnv(t, false, nil)
	db, err := compte.OuvrirBase(filepath.Join(e.dir, "comptes.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	var c compte.Cles
	for _, k := range [][]byte{c.Email[:], c.Poivre[:], c.Sequestre[:], c.TOTP[:], c.Pseudo[:]} {
		rand.Read(k)
	}
	var svc *compte.Service
	m, err := salon.NewManager(salon.Config{DB: e.db, Pieces: &blob.Store{Dir: filepath.Join(e.dir, "salon-pieces")},
		DossierConversations: filepath.Join(e.dir, "salons"), Now: e.clk.Now, Max: 200, StorageMax: 1 << 40,
		UsedPartages: e.svc.Blobs.UsedBytes, OnAbandon: e.srv.lim.AbandonUpload, Palier: PalierDuCompte(&svc)})
	if err != nil {
		t.Fatal(err)
	}
	p := &postier{}
	cc := compte.Config{DB: db, Cles: c, Courriel: p, Limites: e.srv.lim, Now: e.clk.Now, Max: 100}
	BrancherSalonsDuCompte(&cc, m)
	if svc, err = compte.NewService(cc); err != nil {
		t.Fatal(err)
	}
	e.h = newHandler(e.srv, htmlStatic(), Salons{Origin: "https://shhdrop.app", M: m, Comptes: svc})
	return envSalonCompte{envCompte{e, p}, m, svc, db}
}

// creerAvec : POST /api/salons depuis remote, avec la session s ("" : sans en-tête).
func (e envSalonCompte) creerAvec(t *testing.T, k keys, s, remote string, max int) (int, string) {
	t.Helper()
	alt, shown := e.captchaFor(t, remote)
	h := k.createHdr()
	if s != "" {
		h["X-Shh-Session"] = s
	}
	w := e.do(req{method: "POST", path: "/api/salons", hdr: h, remote: remote, body: mustJSON(k.salonBody(max, alt, shown))})
	return w.Code, strings.TrimSpace(w.Body.String())
}

// reconnecter : nouvelle session (la session simple ne dure que 2 h sans usage).
func (e envSalonCompte) reconnecter(t *testing.T, in inscrit, email string) string {
	t.Helper()
	w := e.do(req{method: "POST", path: "/api/compte/connexion", remote: remoteA, body: mustJSON(map[string]any{
		"email": email, "a_auth": in.aAuth, "persistante": false, "etiquette": ""})})
	expect(t, w, 200, "")
	s, _ := jsonOf(t, w)["session"].(string)
	return s
}

const remoteA, remoteB = "198.51.100.1:1", "198.51.100.2:1"

// SHH_COMPTES=1 : sans session valable, 401 compte_requis, rien de créé ni de compté au quota.
func TestCreationSansSessionRefusee(t *testing.T) {
	e := newEnvSalonCompte(t)
	for _, s := range []string{"", enc.EncodeToString(rnd(32)), "court"} {
		if code, body := e.creerAvec(t, newKeys(), s, remoteA, 4); code != 401 || body != `{"error":"compte_requis"}` {
			t.Fatalf("session %q : %d %s", s, code, body)
		}
	}
	var n int
	if err := e.db.QueryRow(`SELECT count(*) FROM salons`).Scan(&n); err != nil || n != 0 {
		t.Fatal("salons :", n, err)
	}
	// Le quota du jour n'a pas été pris (5 créations par connexion) : 5 créations passent
	// encore pour cette connexion, une fois connecté (compte confirmé : 3 salons à la fois).
	in := e.inscrire(t, remoteA, "lea@exemple.fr", "lea")
	e.clk.Add(8 * 24 * time.Hour)
	s := e.reconnecter(t, in, "lea@exemple.fr")
	for i := range 3 {
		if code, body := e.creerAvec(t, newKeys(), s, remoteA, 4); code != 201 {
			t.Fatalf("création %d : %d %s", i, code, body)
		}
	}
}

// SHH_COMPTES=0 : création inchangée ; X-Shh-Session n'est pas lu (même réponse, colonne compte
// NULL).
func TestCreationSansComptesInchangee(t *testing.T) {
	e, _ := salonEnv(t)
	for _, s := range []string{"", enc.EncodeToString(rnd(32))} {
		k := newKeys()
		alt, shown := e.captchaFor(t, "")
		h := k.createHdr()
		if s != "" {
			h["X-Shh-Session"] = s
		}
		w := e.do(req{method: "POST", path: "/api/salons", hdr: h, body: mustJSON(k.salonBody(10, alt, shown))})
		expect(t, w, 201, "")
		var col []byte
		if err := e.db.QueryRow(`SELECT compte FROM salons WHERE access_v=?`, share.Verifier(k.acces)).Scan(&col); err != nil || col != nil {
			t.Fatal("colonne compte :", col, err)
		}
	}
}

// Palier neuf : 4 places au plus, un salon vivant ; refus 409 avec les limites.
func TestPalierNeufHTTP(t *testing.T) {
	e := newEnvSalonCompte(t)
	in := e.inscrire(t, remoteA, "lea@exemple.fr", "lea")
	const palier = `{"error":"palier","salons":1,"places":4,"heures":24}`
	if code, body := e.creerAvec(t, newKeys(), in.session, remoteA, 5); code != 409 || body != palier {
		t.Fatal("5 places :", code, body)
	}
	k := newKeys()
	if code, body := e.creerAvec(t, k, in.session, remoteA, 4); code != 201 {
		t.Fatal("4 places :", code, body)
	}
	if code, body := e.creerAvec(t, newKeys(), in.session, remoteA, 2); code != 409 || body != palier {
		t.Fatal("2e salon :", code, body)
	}
	var col []byte
	if err := e.db.QueryRow(`SELECT compte FROM salons WHERE access_v=?`, share.Verifier(k.acces)).Scan(&col); err != nil ||
		enc.EncodeToString(col) != in.h {
		t.Fatal("colonne compte :", col, err)
	}
	et := jsonOf(t, e.do(req{method: "GET", path: "/api/compte", hdr: sess(in.session)}))
	if et["salons_actifs"] != 1.0 || et["palier"] != "neuf" {
		t.Fatal(et)
	}
	// Réglages (sans session, lus par la ligne du salon) : 5 places refusées.
	w := e.do(req{method: "POST", path: "/api/salons/reglages", hdr: manage(k), body: []byte(`{"max_members":5}`)})
	expect(t, w, 409, palier)
}

// Palier confirmé (7 jours pleins) : 3 salons, 10 places ; le 4e refusé.
func TestPalierConfirmeHTTP(t *testing.T) {
	e := newEnvSalonCompte(t)
	in := e.inscrire(t, remoteA, "lea@exemple.fr", "lea")
	e.clk.Add(7 * 24 * time.Hour)
	s := e.reconnecter(t, in, "lea@exemple.fr")
	for i := range 3 {
		if code, body := e.creerAvec(t, newKeys(), s, remoteA, 10); code != 201 {
			t.Fatal(i, code, body)
		}
	}
	if code, body := e.creerAvec(t, newKeys(), s, remoteB, 10); code != 409 ||
		body != `{"error":"palier","salons":3,"places":10,"heures":24}` {
		t.Fatal("4e :", code, body)
	}
}

// Adresse bannie : 403 banni, avec l'échéance ; rien de créé.
func TestCreationBannieRefusee(t *testing.T) {
	e := newEnvSalonCompte(t)
	in := e.inscrire(t, remoteA, "lea@exemple.fr", "lea")
	h, _ := enc.DecodeString(in.h)
	jour := e.clk.Now().Unix() / 86400 * 86400
	if _, err := e.cdb.Exec(`INSERT INTO bannis SELECT ?, e_canon, ?, ?, 1, 6, 0 FROM comptes WHERE h=?`,
		rnd(8), jour, jour+30*86400, h); err != nil {
		t.Fatal(err)
	}
	code, body := e.creerAvec(t, newKeys(), in.session, remoteA, 4)
	want := `{"error":"banni","jusqu":"` + time.Unix(jour+30*86400, 0).UTC().Format("2006-01-02") + `"}`
	if code != 403 || body != want {
		t.Fatal(code, body)
	}
}

// Un signalement d'un salon du compte le remet au palier neuf.
func TestSignalementRemetAZeroHTTP(t *testing.T) {
	e := newEnvSalonCompte(t)
	in := e.inscrire(t, remoteA, "lea@exemple.fr", "lea")
	e.clk.Add(8 * 24 * time.Hour)
	in.session = e.reconnecter(t, in, "lea@exemple.fr")
	k := newKeys()
	if code, body := e.creerAvec(t, k, in.session, remoteA, 4); code != 201 {
		t.Fatal(code, body)
	}
	var ms []string
	for i := range 2 {
		w := e.rejoindre(k, i == 0)
		expect(t, w, 200, "")
		ms = append(ms, jsonOf(t, w)["member_token"].(string))
	}
	if r := e.signaler(map[string]string{"X-Shh-Membre": ms[1]}, `{"categorie":6}`); r.code != 200 {
		t.Fatal(r)
	}
	et := jsonOf(t, e.do(req{method: "GET", path: "/api/compte", hdr: sess(in.session)}))
	if et["palier"] != "neuf" || et["confirme_le"] == nil {
		t.Fatal(et)
	}
}

// Supprimer son compte ferme ses salons pour tous (salons_fermes).
func TestSuppressionFermeSalons(t *testing.T) {
	e := newEnvSalonCompte(t)
	in := e.inscrire(t, remoteA, "lea@exemple.fr", "lea")
	k := newKeys()
	if code, body := e.creerAvec(t, k, in.session, remoteA, 4); code != 201 {
		t.Fatal(code, body)
	}
	expect(t, e.rejoindre(k, true), 200, "")
	w := e.do(req{method: "POST", path: "/api/compte/supprimer", hdr: sess(in.session), body: []byte(`{}`)})
	expect(t, w, 200, `{"salons_fermes":1}`)
	expect(t, e.do(req{method: "GET", path: "/api/salons/meta", hdr: acces(k)}), 404, notFound)
}

// GET /api/compte/salons : une ref aléatoire par salon vivant du compte, l'échéance au quart
// d'heure, places et sièges ; aucune valeur de la ligne salons (id, access_v, manage_v,
// proof_v, sel) ; detruire par la ref : même effet que « Détruire » du créateur.
func TestSalonsDuCompteSansIdentifiant(t *testing.T) {
	e := newEnvSalonCompte(t)
	in := e.inscrire(t, remoteA, "lea@exemple.fr", "lea")
	k := newKeys()
	if code, body := e.creerAvec(t, k, in.session, remoteA, 4); code != 201 {
		t.Fatal(code, body)
	}
	expect(t, e.rejoindre(k, true), 200, "")
	w := e.do(req{method: "GET", path: "/api/compte/salons", hdr: sess(in.session)})
	expect(t, w, 200, "")
	corps := w.Body.String()
	var id string
	var av, mv, pv, sel []byte
	if err := e.db.QueryRow(`SELECT id, access_v, manage_v, proof_v, salt FROM salons`).Scan(&id, &av, &mv, &pv, &sel); err != nil {
		t.Fatal(err)
	}
	for _, x := range [][]byte{[]byte(id), av, mv, pv, sel} {
		for _, f := range []string{string(x), hex.EncodeToString(x), enc.EncodeToString(x), b64Std(x)} {
			if len(f) > 0 && strings.Contains(corps, f) {
				t.Fatalf("valeur de la ligne dans la réponse : %s", corps)
			}
		}
	}
	d := jsonOf(t, w)
	ls, _ := d["salons"].([]any)
	if len(d) != 1 || len(ls) != 1 {
		t.Fatal(corps)
	}
	l := ls[0].(map[string]any)
	ref, _ := l["ref"].(string)
	exp, _ := l["expire_vers"].(string)
	if cles(l) != "expire_vers,places,ref,sieges" || len(ref) != 22 || l["places"] != 4.0 || l["sieges"] != 1.0 {
		t.Fatal(corps)
	}
	if tm, err := time.Parse("2006-01-02T15:04Z", exp); err != nil || tm.Unix()%900 != 0 || !tm.After(e.clk.Now()) {
		t.Fatal("expire_vers :", exp, err)
	}
	// Un autre compte : 404, le salon reste.
	in2 := e.inscrire(t, remoteB, "leo@exemple.fr", "leo")
	expect(t, e.do(req{method: "POST", path: "/api/compte/salons/detruire", hdr: sess(in2.session),
		body: mustJSON(map[string]string{"ref": ref})}), 404, notFound)
	expect(t, e.do(req{method: "GET", path: "/api/salons/meta", hdr: acces(k)}), 200, "")
	// Corps strict.
	for _, b := range []string{`{}`, `{"ref":"court"}`, `{"ref":null}`, `{"ref":"` + ref + `","x":1}`} {
		expect(t, e.do(req{method: "POST", path: "/api/compte/salons/detruire", hdr: sess(in.session), body: []byte(b)}), 400, badRequest)
	}
	expect(t, e.do(req{method: "POST", path: "/api/compte/salons/detruire", hdr: sess(in.session),
		body: mustJSON(map[string]string{"ref": ref})}), 200, `{}`)
	expect(t, e.do(req{method: "GET", path: "/api/salons/meta", hdr: acces(k)}), 404, notFound)
	w = e.do(req{method: "GET", path: "/api/compte/salons", hdr: sess(in.session)})
	expect(t, w, 200, `{"salons":[]}`)
	// Sans session : 401.
	expect(t, e.do(req{method: "GET", path: "/api/compte/salons"}), 401, `{"error":"session"}`)
}

// Le jeton de session ne part que vers /api/compte/* et la création : sur toute autre route
// du salon, l'en-tête est ignoré (même réponse, octet pour octet).
func TestSessionJamaisLueAilleurs(t *testing.T) {
	e := newEnvSalonCompte(t)
	in := e.inscrire(t, remoteA, "lea@exemple.fr", "lea")
	k := newKeys()
	if code, body := e.creerAvec(t, k, in.session, remoteA, 4); code != 201 {
		t.Fatal(code, body)
	}
	inconnu := map[string]string{"X-Shh-Access": enc.EncodeToString(rnd(32)), "X-Shh-Manage": enc.EncodeToString(rnd(32)),
		"X-Shh-Membre": enc.EncodeToString(rnd(32)), "X-Shh-Piece": enc.EncodeToString(rnd(16))}
	routes := []struct{ method, path, body string }{
		{"GET", "/api/salons/meta", ""}, {"POST", "/api/salons/rejoindre", `{"proof":"` + enc.EncodeToString(rnd(32)) + `"}`},
		{"GET", "/api/salons/gestion", ""}, {"POST", "/api/salons/reglages", `{"max_members":3}`},
		{"POST", "/api/salons/exclure", `{}`}, {"POST", "/api/salons/detruire", `{}`},
		{"POST", "/api/salons/signaler", `{}`}, {"POST", "/api/salons/pieces", `{"bucket":1,"vocal":false}`},
		{"GET", "/api/salons/ws", ""},
	}
	for _, r := range routes {
		var rep [2]string
		for i, avec := range []bool{false, true} {
			h := map[string]string{}
			for n, v := range inconnu {
				h[n] = v
			}
			if avec {
				h["X-Shh-Session"] = in.session
			}
			e.clk.Add(time.Minute)
			w := e.do(req{method: r.method, path: r.path, hdr: h, body: []byte(r.body), remote: remoteB})
			rep[i] = w.Result().Status + w.Body.String()
		}
		if rep[0] != rep[1] {
			t.Errorf("%s %s : %q sans session, %q avec", r.method, r.path, rep[0], rep[1])
		}
	}
	// Sources : sessionCreation (seule lecture de X-Shh-Session hors de handlers_compte.go)
	// n'est appelée que par creer, dans handlers_salon.go.
	vu := 0
	for _, sf := range serverSources(t) {
		ast.Inspect(sf.f, func(n ast.Node) bool {
			if c, ok := n.(*ast.CallExpr); ok {
				if id, ok := c.Fun.(*ast.Ident); ok && id.Name == "sessionCreation" {
					vu++
					if filepath.Base(sf.path) != "handlers_salon.go" || enclosing(sf.f, c.Pos()) != "creer" {
						t.Errorf("%s : sessionCreation hors de la création de salon", sf.fset.Position(c.Pos()))
					}
				}
			}
			return true
		})
	}
	if vu != 1 {
		t.Fatal("appels de sessionCreation :", vu)
	}
}

func b64Std(b []byte) string { return base64.StdEncoding.EncodeToString(b) }
