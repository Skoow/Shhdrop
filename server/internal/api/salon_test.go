package api

import (
	"bytes"
	"errors"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/skoow/shhdrop/server/internal/blob"
	"github.com/skoow/shhdrop/server/internal/salon"
)

// cspActuelle : CSP commune d'avant le salon, recopiée telle quelle : sans salon elle ne doit
// pas changer d'un octet.
const cspActuelle = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; " +
	"img-src 'self' blob:; media-src 'self' blob:; connect-src 'self' blob:; worker-src 'self' blob:; frame-src 'self'; " +
	"object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; require-trusted-types-for 'script'; trusted-types svelte-trusted-html shhdrop"

func TestCSPWebSocket(t *testing.T) {
	if got := cspFor(""); got != cspActuelle {
		t.Fatalf("cspFor(\"\") =\n%s\nattendu\n%s", got, cspActuelle)
	}
	want := strings.Replace(cspActuelle, "connect-src 'self' blob:;", "connect-src 'self' blob: wss://shhdrop.app;", 1)
	if got := cspFor("https://shhdrop.app"); got != want {
		t.Fatalf("cspFor(https) =\n%s\nattendu\n%s", got, want)
	}
	if got := cspFor("http://127.0.0.1:8080"); !strings.Contains(got, "connect-src 'self' blob: ws://127.0.0.1:8080;") {
		t.Fatalf("cspFor(http) = %s", got)
	}

	// Sans salon (valeur zéro) : en-tête inchangé sur toutes les pages.
	e := newEnv(t, false, nil)
	for _, p := range []string{"/", "/s/x", "/api/health"} {
		if c := get(e, p)["Content-Security-Policy"]; len(c) != 1 || c[0] != cspActuelle {
			t.Errorf("sans salon, %s : CSP = %v", p, c)
		}
	}
	// Salon actif : la CSP calculée est posée partout, sauf sur le cadre PDF (connect-src 'none').
	e.h = newHandler(e.srv, htmlStatic(), Salons{Origin: "https://shhdrop.app"})
	for _, p := range []string{"/", "/s/x", "/api/health"} {
		c := get(e, p)["Content-Security-Policy"]
		if len(c) != 1 || c[0] != want || !strings.Contains(c[0], "connect-src 'self' blob: wss://shhdrop.app;") {
			t.Errorf("salon actif, %s : CSP = %v", p, c)
		}
	}
	if c := get(e, "/pdf-frame.html")["Content-Security-Policy"]; len(c) != 1 || !strings.Contains(c[0], "connect-src 'none'") {
		t.Errorf("salon actif, /pdf-frame.html : CSP = %v", c)
	}
}

// ---- Routes JSON du salon (plan C-2 Task 7) ----

// salonEnv : environnement de test avec le salon actif (gestionnaire sur la même base, la même
// horloge et le même limiteur que les partages).
func salonEnv(t *testing.T) (*env, *salon.Manager) {
	t.Helper()
	e := newEnv(t, false, nil)
	m, err := salon.NewManager(salon.Config{DB: e.db, Pieces: &blob.Store{Dir: filepath.Join(e.dir, "salon-pieces")},
		DossierConversations: filepath.Join(e.dir, "salons"), Now: e.clk.Now, Max: 200, StorageMax: 1 << 40,
		UsedPartages: e.svc.Blobs.UsedBytes, Limites: e.srv.lim})
	if err != nil {
		t.Fatal(err)
	}
	e.h = newHandler(e.srv, htmlStatic(), Salons{Origin: "https://shhdrop.app", M: m})
	return e, m
}

func (k keys) salonBody(maxMembers int, alt, shown string) map[string]any {
	return map[string]any{"ttl_hours": 1, "max_members": maxMembers, "members_can_destroy": false,
		"salt": enc.EncodeToString(rnd(16)), "kdf_ops": 3, "kdf_mem": 67108864, "proof_v": v(k.preuve),
		"altcha": alt, "hp": "", "shown_at": shown}
}

func acces(k keys) map[string]string {
	return map[string]string{"X-Shh-Access": enc.EncodeToString(k.acces)}
}

// creerSalon : création réussie (201) depuis remote.
func (e *env) creerSalon(t *testing.T, k keys, maxMembers int) *httptest.ResponseRecorder {
	t.Helper()
	alt, shown := e.captchaFor(t, "")
	w := e.do(req{method: "POST", path: "/api/salons", hdr: k.createHdr(), body: mustJSON(k.salonBody(maxMembers, alt, shown))})
	expect(t, w, 201, "")
	return w
}

// rejoindre : POST /api/salons/rejoindre avec la preuve de k ; createur ajoute X-Shh-Manage.
func (e *env) rejoindre(k keys, createur bool) *httptest.ResponseRecorder {
	h := acces(k)
	if createur {
		h["X-Shh-Manage"] = enc.EncodeToString(k.gestion)
	}
	return e.do(req{method: "POST", path: "/api/salons/rejoindre", hdr: h,
		body: mustJSON(map[string]string{"proof": enc.EncodeToString(k.preuve)})})
}

func clesDe(m map[string]any) []string {
	var ks []string
	for k := range m {
		ks = append(ks, k)
	}
	sort.Strings(ks)
	return ks
}

// Salon désactivé (SHH_SALONS=0) : aucune route /api/salons/*, réponse identique octet pour
// octet (code, en-têtes, corps) à celle d'une route inconnue.
func TestRoutesSalonAbsentes(t *testing.T) {
	for _, sal := range []Salons{{}, {Origin: "https://shhdrop.app"}} {
		e := newEnv(t, false, nil)
		e.h = newHandler(e.srv, htmlStatic(), sal)
		ref := e.do(req{method: "GET", path: "/api/inconnu"})
		expect(t, ref, 404, notFound)
		k := newKeys()
		for _, r := range []req{
			{method: "POST", path: "/api/salons", hdr: k.createHdr(), body: mustJSON(k.salonBody(2, "a", "b"))},
			{method: "GET", path: "/api/salons/ws"},
			{method: "GET", path: "/api/salons/meta", hdr: acces(k)},
			{method: "POST", path: "/api/salons/rejoindre", hdr: acces(k), body: []byte(`{"proof":"x"}`)},
			{method: "GET", path: "/api/salons/gestion", hdr: manage(k)},
		} {
			w := e.do(r)
			if w.Code != ref.Code || !bytes.Equal(w.Body.Bytes(), ref.Body.Bytes()) || !reflect.DeepEqual(w.Header(), ref.Header()) {
				t.Errorf("%+v %s %s : %d %q %v ; attendu %d %q %v", sal, r.method, r.path, w.Code, w.Body.String(), w.Header(),
					ref.Code, ref.Body.String(), ref.Header())
			}
		}
	}
	// Salon actif : une route inconnue sous /api/salons/ reste la 404 uniforme.
	e, _ := salonEnv(t)
	expect(t, e.do(req{method: "GET", path: "/api/salons/inconnu"}), 404, notFound)
	expect(t, e.do(req{method: "DELETE", path: "/api/salons"}), 404, notFound)
}

func TestCreerSalonHTTP(t *testing.T) {
	e, _ := salonEnv(t)
	k := newKeys()
	alt, shown := e.captchaFor(t, "")
	body := k.salonBody(3, alt, shown)
	w := e.do(req{method: "POST", path: "/api/salons", hdr: k.createHdr(), body: mustJSON(body)})
	// 10:02:03 + 1 h = 11:02:03, arrondi au quart d'heure : 11:15:00, soit 4 377 s.
	expect(t, w, 201, `{"expires_in_s":4377}`)
	// Meta : exactement expires_in_s, salt (celui envoyé), kdf_ops, kdf_mem.
	mw := e.do(req{method: "GET", path: "/api/salons/meta", hdr: acces(k)})
	expect(t, mw, 200, "")
	m := jsonOf(t, mw)
	if got := clesDe(m); !reflect.DeepEqual(got, []string{"expires_in_s", "kdf_mem", "kdf_ops", "salt"}) {
		t.Fatalf("clés de meta : %v", got)
	}
	if m["salt"] != body["salt"] || m["kdf_ops"] != 3.0 || m["kdf_mem"] != 67108864.0 || m["expires_in_s"] != 4377.0 {
		t.Fatalf("meta : %v", m)
	}
	// Meta avec un en-tête mal formé : 400 (comme les partages).
	expect(t, e.do(req{method: "GET", path: "/api/salons/meta", hdr: map[string]string{"X-Shh-Access": "court"}}), 400, badRequest)
	expect(t, e.do(req{method: "GET", path: "/api/salons/meta"}), 400, badRequest)
}

func TestCreerSalonSansCaptcha(t *testing.T) {
	e, _ := salonEnv(t)
	k := newKeys()
	post := func(b map[string]any) *httptest.ResponseRecorder {
		return e.do(req{method: "POST", path: "/api/salons", hdr: k.createHdr(), body: mustJSON(b)})
	}
	expect(t, post(k.salonBody(2, "", "")), 400, badRequest)
	alt, shown := e.captchaFor(t, "")
	expect(t, post(k.salonBody(2, alt, "")), 400, badRequest)
	b := k.salonBody(2, alt, shown)
	b["hp"] = "robot" // champ piège rempli
	expect(t, post(b), 400, badRequest)
	// Réponse trop rapide (moins de 3 s après l'affichage) : refusée.
	alt, shown = e.captchaFor(t, "")
	e.clk.Add(-3 * time.Second)
	expect(t, post(k.salonBody(2, alt, shown)), 400, badRequest)
}

// Format invalide et serveur gelé : ni le défi ni le quota ne sont consommés.
func TestCreerSalonGelEtFormat(t *testing.T) {
	e, _ := salonEnv(t)
	k := newKeys()
	alt, shown := e.captchaFor(t, "")
	if err := os.WriteFile(e.svc.FrozenFile, nil, 0o600); err != nil {
		t.Fatal(err)
	}
	expect(t, e.do(req{method: "POST", path: "/api/salons", hdr: k.createHdr(), body: mustJSON(k.salonBody(2, alt, shown))}),
		503, `{"error":"frozen"}`)
	os.Remove(e.svc.FrozenFile)
	for _, bad := range []func(map[string]any){
		func(b map[string]any) { b["ttl_hours"] = 2 },
		func(b map[string]any) { b["max_members"] = 11 },
		func(b map[string]any) { b["max_members"] = 1 },
		func(b map[string]any) { b["kdf_ops"] = 2 },
		func(b map[string]any) { b["kdf_mem"] = 33554432 },
		func(b map[string]any) { b["salt"] = enc.EncodeToString(rnd(15)) },
		func(b map[string]any) { b["proof_v"] = enc.EncodeToString(rnd(31)) },
		func(b map[string]any) { b["proof_v"] = v(nil) },
		func(b map[string]any) { delete(b, "members_can_destroy") },
		func(b map[string]any) { b["members_can_destroy"] = nil },
		func(b map[string]any) { b["members_can_destroy"] = 1 },
	} {
		b := k.salonBody(2, alt, shown)
		bad(b)
		expect(t, e.do(req{method: "POST", path: "/api/salons", hdr: k.createHdr(), body: mustJSON(b)}), 400, badRequest)
	}
	// X-Shh-Access = X-Shh-Manage, en-tête absent ou mal formé : 400.
	same := map[string]string{"X-Shh-Access": enc.EncodeToString(k.acces), "X-Shh-Manage": enc.EncodeToString(k.acces)}
	for _, h := range []map[string]string{same, acces(k), manage(k), {"X-Shh-Access": "x", "X-Shh-Manage": "y"}} {
		expect(t, e.do(req{method: "POST", path: "/api/salons", hdr: h, body: mustJSON(k.salonBody(2, alt, shown))}), 400, badRequest)
	}
	// Le défi sert encore : rien n'a été consommé.
	expect(t, e.do(req{method: "POST", path: "/api/salons", hdr: k.createHdr(), body: mustJSON(k.salonBody(2, alt, shown))}),
		201, `{"expires_in_s":4377}`)
	// Et une seule fois.
	k2 := newKeys()
	expect(t, e.do(req{method: "POST", path: "/api/salons", hdr: k2.createHdr(), body: mustJSON(k2.salonBody(2, alt, shown))}),
		400, badRequest)
}

func TestCreerSalonQuota(t *testing.T) {
	e, _ := salonEnv(t)
	for i := 0; i < 5; i++ {
		e.creerSalon(t, newKeys(), 2)
	}
	k := newKeys()
	alt, shown := e.captchaFor(t, "")
	w := e.do(req{method: "POST", path: "/api/salons", hdr: k.createHdr(), body: mustJSON(k.salonBody(2, alt, shown))})
	now := e.clk.Now()
	midnight := time.Date(now.Year(), now.Month(), now.Day()+1, 0, 0, 0, 0, time.UTC)
	secs := strconv.FormatInt(int64(midnight.Sub(now)/time.Second), 10)
	expect(t, w, 429, `{"error":"limit","retry_after_s":`+secs+`}`)
	if w.Header().Get("Retry-After") != secs {
		t.Fatalf("Retry-After = %q, attendu %s", w.Header().Get("Retry-After"), secs)
	}
	// Une autre connexion n'est pas touchée.
	alt, shown = e.captchaFor(t, "198.51.100.20:1")
	expect(t, e.do(req{method: "POST", path: "/api/salons", hdr: k.createHdr(), body: mustJSON(k.salonBody(2, alt, shown)),
		remote: "198.51.100.20:1"}), 201, "")
	// Le lendemain : de nouveau permis.
	e.clk.Add(midnight.Sub(e.clk.Now()))
	e.creerSalon(t, newKeys(), 2)
}

// Même X-Shh-Access (ou X-Shh-Manage) : 400 comme une création invalide, compté au quota.
func TestCreerSalonConflit(t *testing.T) {
	e, _ := salonEnv(t)
	k := newKeys()
	e.creerSalon(t, k, 2)
	for _, k2 := range []keys{{k.acces, rnd(32), rnd(32)}, {rnd(32), rnd(32), k.gestion}} {
		alt, shown := e.captchaFor(t, "")
		expect(t, e.do(req{method: "POST", path: "/api/salons", hdr: k2.createHdr(), body: mustJSON(k2.salonBody(2, alt, shown))}),
			400, badRequest)
	}
	// Le salon existant est intact.
	expect(t, e.do(req{method: "GET", path: "/api/salons/meta", hdr: acces(k)}), 200, "")
	// 1 + 2 conflits + 2 = 5 : la suivante est refusée.
	e.creerSalon(t, newKeys(), 2)
	e.creerSalon(t, newKeys(), 2)
	k3 := newKeys()
	alt, shown := e.captchaFor(t, "")
	w := e.do(req{method: "POST", path: "/api/salons", hdr: k3.createHdr(), body: mustJSON(k3.salonBody(2, alt, shown))})
	if w.Code != 429 || jsonOf(t, w)["error"] != "limit" {
		t.Fatalf("6e création : %d %q", w.Code, w.Body.String())
	}
}

func TestJSONStrict(t *testing.T) {
	e, _ := salonEnv(t)
	k := newKeys()
	alt, shown := e.captchaFor(t, "")
	good := mustJSON(k.salonBody(2, alt, shown))
	unknown := k.salonBody(2, alt, shown)
	unknown["extra"] = 1
	str := k.salonBody(2, alt, shown)
	str["ttl_hours"] = "1"
	casse := k.salonBody(2, alt, shown)
	delete(casse, "ttl_hours")
	casse["TTL_hours"] = 1
	big := k.salonBody(2, alt, shown)
	big["hp"] = strings.Repeat("a", 5000)
	for name, b := range map[string][]byte{
		"inconnue":    mustJSON(unknown),
		"doublon":     append([]byte(`{"ttl_hours":24,`), good[1:]...),
		"chaîne":      mustJSON(str),
		"casse":       mustJSON(casse),
		"> 4 Kio":     mustJSON(big),
		"deux objets": append(append([]byte{}, good...), good...),
		"tableau":     []byte(`[]`),
		"vide":        nil,
		"décimal":     bytes.Replace(good, []byte(`"max_members":2`), []byte(`"max_members":2.5`), 1),
		"énorme":      bytes.Replace(good, []byte(`"max_members":2`), []byte(`"max_members":99999999999999999999`), 1),
	} {
		if bytes.Equal(b, good) {
			t.Fatalf("%s : corps inchangé", name)
		}
		w := e.do(req{method: "POST", path: "/api/salons", hdr: k.createHdr(), body: b})
		if w.Code != 400 || strings.TrimSpace(w.Body.String()) != badRequest {
			t.Errorf("%s : %d %q", name, w.Code, w.Body.String())
		}
	}
	// Rejoindre : mêmes règles.
	for name, b := range map[string]string{
		"inconnue": `{"proof":"` + enc.EncodeToString(k.preuve) + `","x":1}`,
		"doublon":  `{"proof":"` + enc.EncodeToString(k.preuve) + `","proof":"` + enc.EncodeToString(k.preuve) + `"}`,
		"courte":   `{"proof":"` + enc.EncodeToString(k.preuve)[:42] + `"}`,
		"nombre":   `{"proof":1}`,
		"vide":     `{}`,
	} {
		w := e.do(req{method: "POST", path: "/api/salons/rejoindre", hdr: acces(k), body: []byte(b)})
		if w.Code != 400 || strings.TrimSpace(w.Body.String()) != badRequest {
			t.Errorf("rejoindre %s : %d %q", name, w.Code, w.Body.String())
		}
	}
	// Le corps correct passe encore (le défi n'a pas été consommé).
	expect(t, e.do(req{method: "POST", path: "/api/salons", hdr: k.createHdr(), body: good}), 201, "")
}

// En-tête secret présent deux fois : 400, jamais la première ou la dernière valeur.
func TestEnTetesDoubles(t *testing.T) {
	e, _ := salonEnv(t)
	k := newKeys()
	e.creerSalon(t, k, 2)
	for _, c := range []struct{ method, path, name, body string }{
		{"GET", "/api/salons/meta", "X-Shh-Access", ""},
		{"POST", "/api/salons/rejoindre", "X-Shh-Access", `{"proof":"` + enc.EncodeToString(k.preuve) + `"}`},
		{"POST", "/api/salons/rejoindre", "X-Shh-Manage", `{"proof":"` + enc.EncodeToString(k.preuve) + `"}`},
		{"GET", "/api/salons/gestion", "X-Shh-Manage", ""},
	} {
		hr := httptest.NewRequest(c.method, c.path, strings.NewReader(c.body))
		hr.RemoteAddr = "203.0.113.7:4444"
		hr.Header.Set("X-Shh-Access", enc.EncodeToString(k.acces))
		val := enc.EncodeToString(k.acces)
		if c.name == "X-Shh-Manage" {
			val = enc.EncodeToString(k.gestion)
		}
		hr.Header[c.name] = []string{val, val}
		w := httptest.NewRecorder()
		e.h.ServeHTTP(w, hr)
		expect(t, w, 400, badRequest)
	}
}

// Salon inconnu, échu ou détruit : même réponse, octet pour octet.
func TestMetaUniforme(t *testing.T) {
	e, _ := salonEnv(t)
	meta := func(k keys) *httptest.ResponseRecorder {
		return e.do(req{method: "GET", path: "/api/salons/meta", hdr: acces(k)})
	}
	inconnu := meta(newKeys())
	expect(t, inconnu, 404, notFound)
	detruit, echu := newKeys(), newKeys()
	e.creerSalon(t, detruit, 2)
	e.creerSalon(t, echu, 2)
	faux := detruit
	faux.preuve = rnd(32)
	for i := 0; i < 10; i++ {
		e.rejoindre(faux, false)
	}
	gone := meta(detruit)
	expect(t, meta(echu), 200, "")
	e.clk.Add(2 * time.Hour)
	expired := meta(echu)
	for name, w := range map[string]*httptest.ResponseRecorder{"détruit": gone, "échu": expired} {
		if w.Code != inconnu.Code || !bytes.Equal(w.Body.Bytes(), inconnu.Body.Bytes()) || !reflect.DeepEqual(w.Header(), inconnu.Header()) {
			t.Errorf("%s : %d %q %v ; inconnu : %d %q %v", name, w.Code, w.Body.String(), w.Header(), inconnu.Code,
				inconnu.Body.String(), inconnu.Header())
		}
	}
	// Rejoindre et gestion d'un salon détruit ou échu : même 404.
	expect(t, e.rejoindre(detruit, false), 404, notFound)
	expect(t, e.rejoindre(echu, true), 404, notFound)
	expect(t, e.do(req{method: "GET", path: "/api/salons/gestion", hdr: manage(echu)}), 404, notFound)
}

func TestRejoindreHTTP(t *testing.T) {
	e, m := salonEnv(t)
	k := newKeys()
	e.creerSalon(t, k, 3)
	want := []string{"budget_left", "expires_in_s", "max_members", "member_token", "members_can_destroy", "nonce_arrivee", "seat", "seq"}
	var seqs []float64
	for i, createur := range []bool{true, false} {
		w := e.rejoindre(k, createur)
		expect(t, w, 200, "")
		r := jsonOf(t, w)
		if got := clesDe(r); !reflect.DeepEqual(got, want) {
			t.Fatalf("clés : %v", got)
		}
		tok, ok := r["member_token"].(string)
		if !ok || len(tok) != 43 {
			t.Fatalf("member_token : %v", r["member_token"])
		}
		raw, err := enc.DecodeString(tok)
		if err != nil || len(raw) != 32 {
			t.Fatalf("member_token : %v", err)
		}
		if _, err := m.Membre(raw); err != nil {
			t.Fatalf("jeton de membre inconnu du gestionnaire : %v", err)
		}
		nonce, ok := r["nonce_arrivee"].(string)
		if raw, err := enc.DecodeString(nonce); !ok || len(nonce) != 22 || err != nil || len(raw) != 16 {
			t.Fatalf("nonce_arrivee : %v", r["nonce_arrivee"])
		}
		// Aucune horloge avancée depuis la création : même échéance que sa réponse.
		if r["seat"] != float64(i) || r["max_members"] != 3.0 || r["members_can_destroy"] != false ||
			r["budget_left"] != 1073741824.0 || r["expires_in_s"] != 4377.0 {
			t.Fatalf("réponse : %v", r)
		}
		s, ok := r["seq"].(float64)
		if !ok || s < 1 {
			t.Fatalf("seq : %v", r["seq"])
		}
		seqs = append(seqs, s)
	}
	if seqs[1] <= seqs[0] {
		t.Fatalf("seq non croissant : %v", seqs)
	}
	// X-Shh-Manage faux (mais bien formé) : 400, aucun siège ; mal formé : 400.
	h := acces(k)
	h["X-Shh-Manage"] = enc.EncodeToString(rnd(32))
	body := mustJSON(map[string]string{"proof": enc.EncodeToString(k.preuve)})
	expect(t, e.do(req{method: "POST", path: "/api/salons/rejoindre", hdr: h, body: body}), 400, badRequest)
	h["X-Shh-Manage"] = "abc"
	expect(t, e.do(req{method: "POST", path: "/api/salons/rejoindre", hdr: h, body: body}), 400, badRequest)
	gw := e.do(req{method: "GET", path: "/api/salons/gestion", hdr: manage(k)})
	if jsonOf(t, gw)["present"] != 2.0 {
		t.Fatalf("gestion : %q", gw.Body.String())
	}
	// K_accès inconnue : 404 uniforme.
	expect(t, e.rejoindre(newKeys(), false), 404, notFound)
}

func TestRejoindreFaux(t *testing.T) {
	e, _ := salonEnv(t)
	k := newKeys()
	e.creerSalon(t, k, 2)
	faux := k
	faux.preuve = rnd(32)
	expect(t, e.rejoindre(faux, false), 403, `{"error":"bad_password","attempts_left":9}`)
	expect(t, e.rejoindre(faux, true), 403, `{"error":"bad_password","attempts_left":8}`)
	for n := 7; n >= 1; n-- {
		expect(t, e.rejoindre(faux, false), 403, `{"error":"bad_password","attempts_left":`+strconv.Itoa(n)+`}`)
	}
	// 10ᵉ : salon détruit, réponse introuvable uniforme, y compris avec la bonne preuve.
	expect(t, e.rejoindre(faux, false), 404, notFound)
	expect(t, e.rejoindre(k, false), 404, notFound)
}

func TestRejoindreLimite(t *testing.T) {
	e, _ := salonEnv(t)
	k := newKeys()
	for i := 0; i < 20; i++ {
		expect(t, e.rejoindre(k, false), 404, notFound)
	}
	w := e.rejoindre(k, false)
	now := e.clk.Now()
	secs := strconv.FormatInt(3600-now.Unix()%3600, 10)
	expect(t, w, 429, `{"error":"limit","retry_after_s":`+secs+`}`)
	if w.Header().Get("Retry-After") != secs {
		t.Fatalf("Retry-After = %q, attendu %s", w.Header().Get("Retry-After"), secs)
	}
	// Une requête mal formée n'est ni comptée ni limitée par le quota des entrées.
	expect(t, e.do(req{method: "POST", path: "/api/salons/rejoindre", hdr: acces(k), body: []byte(`{}`)}), 400, badRequest)
	// Autre connexion : permise ; heure suivante : de nouveau permis.
	expect(t, e.do(req{method: "POST", path: "/api/salons/rejoindre", hdr: acces(k), remote: "198.51.100.30:1",
		body: mustJSON(map[string]string{"proof": enc.EncodeToString(k.preuve)})}), 404, notFound)
	e.clk.Add(time.Duration(3600-now.Unix()%3600) * time.Second)
	expect(t, e.rejoindre(k, false), 404, notFound)
}

func TestCompletHTTP(t *testing.T) {
	e, _ := salonEnv(t)
	k := newKeys()
	e.creerSalon(t, k, 2)
	expect(t, e.rejoindre(k, false), 200, "")
	expect(t, e.rejoindre(k, false), 409, `{"error":"full"}`)
	// La place du créateur reste gardée.
	expect(t, e.rejoindre(k, true), 200, "")
}

func TestGestionHTTP(t *testing.T) {
	e, _ := salonEnv(t)
	k := newKeys()
	e.creerSalon(t, k, 4)
	g := func() *httptest.ResponseRecorder {
		return e.do(req{method: "GET", path: "/api/salons/gestion", hdr: manage(k)})
	}
	expect(t, g(), 200, `{"expires_in_s":4377,"present":0}`)
	expect(t, e.rejoindre(k, true), 200, "")
	expect(t, e.rejoindre(k, false), 200, "")
	expect(t, g(), 200, `{"expires_in_s":4377,"present":2}`)
	expect(t, e.do(req{method: "GET", path: "/api/salons/gestion", hdr: manage(newKeys())}), 404, notFound)
	// K_accès à la place de S_gestion : introuvable.
	expect(t, e.do(req{method: "GET", path: "/api/salons/gestion", hdr: map[string]string{"X-Shh-Manage": enc.EncodeToString(k.acces)}}),
		404, notFound)
	expect(t, e.do(req{method: "GET", path: "/api/salons/gestion", hdr: map[string]string{"X-Shh-Manage": "x"}}), 400, badRequest)
	expect(t, e.do(req{method: "GET", path: "/api/salons/gestion"}), 400, badRequest)
}

// failSalon : réponses fixes, sans détail de l'erreur reçue.
func TestFailSalon(t *testing.T) {
	cas := []struct {
		err   error
		code  int
		body  string
		retry string
	}{
		{salon.ErrNotFound, 404, notFound, ""},
		{&salon.BadPassword{AttemptsLeft: 3}, 403, `{"error":"bad_password","attempts_left":3}`, ""},
		{&salon.BadPassword{AttemptsLeft: 0}, 404, notFound, ""},
		{salon.ErrFull, 409, `{"error":"full"}`, ""},
		{salon.ErrBudget, 409, `{"error":"budget"}`, ""},
		{salon.ErrStale, 409, `{"error":"stale"}`, ""},
		{salon.ErrExcluded, 403, `{"error":"excluded"}`, ""},
		{salon.ErrForbidden, 403, `{"error":"forbidden"}`, ""},
		{&salon.Attente{Retry: 1500 * time.Millisecond}, 429, `{"error":"limit","retry_after_s":2}`, "2"},
		{&salon.Attente{Retry: -time.Second}, 429, `{"error":"limit","retry_after_s":1}`, "1"},
		{salon.ErrLimit, 429, `{"error":"limit","retry_after_s":60}`, "60"},
		{salon.ErrBusy, 503, `{"error":"busy"}`, ""},
		{salon.ErrBadRequest, 400, badRequest, ""},
		{salon.ErrConflict, 400, badRequest, ""},
		{errBadRequest, 400, badRequest, ""},
		{salon.ErrBase, 500, `{"error":"internal"}`, ""},
		{salon.ErrPlein, 500, `{"error":"internal"}`, ""},
		{errors.New("/chemin/secret"), 500, `{"error":"internal"}`, ""},
		{nil, 500, `{"error":"internal"}`, ""},
		// Pointeurs nuls typés : aucune panique.
		{(*salon.BadPassword)(nil), 404, notFound, ""},
		{(*salon.Attente)(nil), 500, `{"error":"internal"}`, ""},
	}
	for _, c := range cas {
		w := httptest.NewRecorder()
		failSalon(w, c.err)
		if w.Code != c.code || w.Body.String() != c.body || w.Header().Get("Retry-After") != c.retry {
			t.Errorf("%v : %d %q %q", c.err, w.Code, w.Body.String(), w.Header().Get("Retry-After"))
		}
	}
}
