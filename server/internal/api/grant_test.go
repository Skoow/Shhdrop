package api

import (
	"testing"
	"time"
)

// Octroi d'ouverture par HTTP (spec §41.4, D42-22) : X-Shh-Grant, 409 grant_invalid, 429
// reopen_limit au 21ᵉ retour ; plus de regrant ni de leave ; ni adresse, ni cookie.
func TestGrantHTTP(t *testing.T) {
	e := newEnv(t, false, nil)
	k := newKeys()
	c := e.create(t, "", k, 1, 1) // une seule ouverture : « draining » après le déverrouillage
	e.upload(t, c, 1)
	unlock := func(g string, proof []byte) map[string]any {
		h := access(k)
		if g != "" {
			h["X-Shh-Grant"] = g
		}
		w := e.do(req{method: "POST", path: "/api/shares/unlock", hdr: h,
			body: mustJSON(map[string]string{"proof": enc.EncodeToString(proof)})})
		if w.Header().Get("Set-Cookie") != "" {
			t.Fatal("cookie")
		}
		m := jsonOf(t, w)
		m["code"] = float64(w.Code)
		return m
	}
	r := unlock("", k.preuve)
	g, _ := r["grant"].(string)
	dl0, _ := r["download_token"].(string)
	if r["code"] != 200.0 || len(g) != 54 || r["opens_left"] != 0.0 || r["last_open"] != 1.0 {
		t.Fatal(r)
	}
	// « draining » : meta sans octroi → 404 ; avec octroi → 200.
	expect(t, e.do(req{method: "GET", path: "/api/shares/meta", hdr: access(k)}), 404, "")
	h := access(k)
	h["X-Shh-Grant"] = g
	expect(t, e.do(req{method: "GET", path: "/api/shares/meta", hdr: h}), 200, "")
	h["X-Shh-Grant"] = "court"
	expect(t, e.do(req{method: "GET", path: "/api/shares/meta", hdr: h}), 400, "")
	// Mauvais mot de passe avec octroi : un essai.
	if r := unlock(g, rnd(32)); r["code"] != 403.0 || r["attempts_left"] != 4.0 {
		t.Fatal(r)
	}
	for i := 1; i <= 20; i++ {
		r := unlock(g, k.preuve)
		if r["code"] != 200.0 || r["opens_left"] != 0.0 {
			t.Fatal(i, r)
		}
		g = r["grant"].(string)
		e.clk.Add(time.Minute) // limite générale : 60 requêtes par minute
	}
	if r := unlock(g, k.preuve); r["code"] != 429.0 || r["error"] != "reopen_limit" {
		t.Fatal(r)
	}
	// D42-22 : regrant et leave n'existent plus (l'octroi vaut jusqu'à l'échéance).
	for _, p := range []string{"/api/shares/regrant", "/api/shares/leave"} {
		if w := e.do(req{method: "POST", path: p, hdr: auth(dl0)}); w.Code != 404 && w.Code != 405 {
			t.Fatal(p, w.Code)
		}
	}
	// Octroi falsifié sur un partage « ready » : 409 sans essai.
	k2 := newKeys()
	c2 := e.create(t, "", k2, 1, 3)
	e.upload(t, c2, 1)
	k = k2
	r2 := unlock("", k.preuve)
	if r2["last_open"] != 0.0 { // revue D42-22 : seulement la dernière ouverture permise
		t.Fatal(r2)
	}
	bad := []byte(r2["grant"].(string))
	if bad[10] == 'A' {
		bad[10] = 'B'
	} else {
		bad[10] = 'A'
	}
	if r := unlock(string(bad), rnd(32)); r["code"] != 409.0 || r["error"] != "grant_invalid" {
		t.Fatal(r)
	}
	// done explicite : l'octroi ne rouvre plus.
	dl2 := r2["download_token"].(string)
	expect(t, e.do(req{method: "POST", path: "/api/shares/done", hdr: auth(dl2)}), 204, "")
	if r := unlock(r2["grant"].(string), k.preuve); r["code"] != 409.0 {
		t.Fatal(r)
	}
	m := e.do(req{method: "GET", path: "/api/shares/meta", hdr: access(k)})
	if jsonOf(t, m)["opens_left"] != 2.0 {
		t.Fatal(m.Body.String())
	}
}
