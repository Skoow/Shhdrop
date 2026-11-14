package api

import (
	"strings"
	"testing"
	"time"
)

// Lot 6 du plan du compte : signalements par catégorie (conception §21.10 ; codes 1 à 10, 10
// « Autre »), comptés en mémoire seulement (usage), jamais sur disque ; l'alerte de /healthz
// reste un booléen.

// Catégorie d'un signalement de salon : entier 1 à 10 ; absente ({}), comptée 10 ; 0, 11,
// texte, null, décimal : 400, rien de compté, le membre reste.
func TestCategorieBornesSalon(t *testing.T) {
	e, _ := salonEnv(t)
	k := newKeys()
	ms := salonExclusion(t, e, k, 6, 3)
	membre := map[string]string{"X-Shh-Membre": ms[1].jeton}
	for _, b := range []string{`{"categorie":0}`, `{"categorie":11}`, `{"categorie":"3"}`, `{"categorie":null}`,
		`{"categorie":1.0}`, `{"categorie":-1}`, `{"categorie":3,"reason":"report"}`, `{"categorie":[3]}`} {
		if r := e.signaler(membre, b); r.code != 400 || strings.TrimSpace(r.body) != badRequest {
			t.Errorf("%s : %d %q", b, r.code, r.body)
		}
	}
	if u := e.srv.usage.Snapshot(); u.SignalementsSalon != ([10]int64{}) || e.signalements() != 0 {
		t.Fatal("refus comptés :", u.SignalementsSalon)
	}
	if r := e.signaler(membre, `{"categorie":3}`); r.code != 200 {
		t.Fatal(r)
	}
	if r := e.signaler(map[string]string{"X-Shh-Membre": ms[2].jeton}, `{}`); r.code != 200 {
		t.Fatal(r)
	}
	if r := e.signaler(map[string]string{"X-Shh-Membre": ms[3].jeton}, `{"categorie":10}`); r.code != 200 {
		t.Fatal(r)
	}
	var want [10]int64
	want[2], want[9] = 1, 2
	if u := e.srv.usage.Snapshot(); u.SignalementsSalon != want || u.SignalementsPartage != ([10]int64{}) {
		t.Fatal(u.SignalementsSalon, u.SignalementsPartage)
	}
	if e.signalements() != 1 {
		t.Fatal("entier horaire : un par salon :", e.signalements())
	}
	// « Détruire et signaler » d'un salon : compté « Autre ».
	k2 := newKeys()
	salonExclusion(t, e, k2, 4, 0)
	expect(t, e.do(req{method: "POST", path: "/api/salons/detruire", hdr: manage(k2), body: []byte(`{"reason":"report"}`)}), 200, `{}`)
	want[9]++
	if u := e.srv.usage.Snapshot(); u.SignalementsSalon != want {
		t.Fatal(u.SignalementsSalon)
	}
}

// Catégorie d'un signalement de partage : seulement avec reason "report" (sinon 400) ; bornes
// comme pour le salon ; absente, comptée 10 ; un refus laisse le partage intact.
func TestCategorieBornesPartage(t *testing.T) {
	e := newEnv(t, false, nil)
	partage := func() keys {
		e.clk.Add(time.Minute)
		k := newKeys()
		c := e.create(t, "", k, 1, 1)
		e.upload(t, c, 1)
		return k
	}
	detruire := func(k keys, corps map[string]any) (int, string) {
		corps["proof"] = enc.EncodeToString(k.preuve)
		w := e.do(req{method: "POST", path: "/api/shares/destroy", hdr: access(k), body: mustJSON(corps)})
		return w.Code, strings.TrimSpace(w.Body.String())
	}
	k := partage()
	for _, c := range []map[string]any{{"categorie": 3}, {"reason": "report", "categorie": 0},
		{"reason": "report", "categorie": 11}, {"reason": "report", "categorie": "3"}, {"reason": "report", "categorie": nil},
		{"reason": "report", "categorie": 2.5}, {"reason": "report", "categorie": true}} {
		if code, body := detruire(k, c); code != 400 || body != badRequest {
			t.Errorf("%v : %d %s", c, code, body)
		}
	}
	expect(t, e.do(req{method: "GET", path: "/api/shares/meta", hdr: access(k)}), 200, "") // intact
	if code, _ := detruire(k, map[string]any{"reason": "report", "categorie": 9}); code != 204 {
		t.Fatal(code)
	}
	if code, _ := detruire(partage(), map[string]any{"reason": "report"}); code != 204 {
		t.Fatal(code)
	}
	if code, _ := detruire(partage(), map[string]any{}); code != 204 { // destruction simple : non comptée
		t.Fatal(code)
	}
	var want [10]int64
	want[8], want[9] = 1, 1
	u := e.srv.usage.Snapshot()
	if u.SignalementsPartage != want || u.SignalementsSalon != ([10]int64{}) || u.Destructions != 3 {
		t.Fatal(u.SignalementsPartage, u.Destructions)
	}
	if e.signalements() != 2 {
		t.Fatal("entier horaire :", e.signalements())
	}
}

// La catégorie n'est jamais écrite : aucune colonne ni table de plus dans shares.db, et le
// schéma ne change pas après des signalements.
func TestCategorieJamaisSurDisque(t *testing.T) {
	e, _ := salonEnv(t)
	schema := func() string {
		rows, err := e.db.Query(`SELECT coalesce(sql,'') FROM sqlite_master ORDER BY name`)
		if err != nil {
			t.Fatal(err)
		}
		defer rows.Close()
		var b strings.Builder
		for rows.Next() {
			var s string
			rows.Scan(&s)
			b.WriteString(s)
		}
		return b.String()
	}
	avant := schema()
	for _, mot := range []string{"categ", "motif", "report", "signal"} {
		if strings.Contains(strings.ToLower(avant), mot) {
			t.Fatalf("schéma : %q présent", mot)
		}
	}
	k := newKeys()
	c := e.create(t, "", k, 1, 1)
	e.upload(t, c, 1)
	w := e.do(req{method: "POST", path: "/api/shares/destroy", hdr: access(k),
		body: mustJSON(map[string]any{"proof": enc.EncodeToString(k.preuve), "reason": "report", "categorie": 7})})
	expect(t, w, 204, "")
	ks := newKeys()
	ms := salonExclusion(t, e, ks, 4, 1)
	if r := e.signaler(map[string]string{"X-Shh-Membre": ms[1].jeton}, `{"categorie":7}`); r.code != 200 {
		t.Fatal(r)
	}
	if schema() != avant {
		t.Fatal("schéma changé")
	}
	var n int
	if err := e.db.QueryRow(`SELECT count(*) FROM shares`).Scan(&n); err != nil || n != 0 {
		t.Fatal("partage gardé :", n, err)
	}
}
