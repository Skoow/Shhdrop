package api

import (
	"testing"
)

// ---- Destruction du salon (plan C-2 Task 15, spec §39.3.9) ----

func (e *env) detruireSalon(hdr map[string]string, body string) int {
	return e.do(req{method: "POST", path: "/api/salons/detruire", hdr: hdr, body: []byte(body)}).Code
}

// creerSalonPermis : comme creerSalon, members_can_destroy = true.
func (e *env) creerSalonPermis(t *testing.T, k keys, maxMembers int) {
	t.Helper()
	alt, shown := e.captchaFor(t, "")
	b := k.salonBody(maxMembers, alt, shown)
	b["members_can_destroy"] = true
	expect(t, e.do(req{method: "POST", path: "/api/salons", hdr: k.createHdr(), body: mustJSON(b)}), 201, "")
}

// Créateur (X-Shh-Manage) : {} ; ensuite 404 not_found (salon détruit), meta aussi.
func TestDetruireCreateurHTTP(t *testing.T) {
	e, _ := salonEnv(t)
	k := newKeys()
	salonExclusion(t, e, k, 4, 1)
	expect(t, e.do(req{method: "POST", path: "/api/salons/detruire", hdr: manage(k), body: []byte(`{}`)}), 200, `{}`)
	expect(t, e.do(req{method: "POST", path: "/api/salons/detruire", hdr: manage(k), body: []byte(`{}`)}), 404, notFound)
	expect(t, e.do(req{method: "GET", path: "/api/salons/meta", hdr: acces(k)}), 404, notFound)
}

// Membre (X-Shh-Membre) : 403 forbidden sans members_can_destroy, {} avec ; ni l'un ni l'autre :
// 403 ; les deux à la fois, corps ou raison invalides : 400 ; jeton inconnu : 404.
func TestDetruireMembreHTTP(t *testing.T) {
	e, _ := salonEnv(t)
	k := newKeys()
	ms := salonExclusion(t, e, k, 4, 1)
	membre := map[string]string{"X-Shh-Membre": ms[1].jeton}
	expect(t, e.do(req{method: "POST", path: "/api/salons/detruire", hdr: membre, body: []byte(`{}`)}), 403,
		`{"error":"forbidden"}`)
	if c := e.detruireSalon(nil, `{}`); c != 403 {
		t.Fatal("sans authentification :", c)
	}
	deux := map[string]string{"X-Shh-Membre": ms[1].jeton, "X-Shh-Manage": manage(k)["X-Shh-Manage"]}
	for nom, c := range map[string]int{
		"deux en-têtes":   e.detruireSalon(deux, `{}`),
		"raison fausse":   e.detruireSalon(manage(k), `{"reason":"REPORT"}`),
		"raison nulle":    e.detruireSalon(manage(k), `{"reason":null}`),
		"clé inconnue":    e.detruireSalon(manage(k), `{"x":1}`),
		"jeton mal formé": e.detruireSalon(map[string]string{"X-Shh-Membre": "court"}, `{}`),
	} {
		if c != 400 {
			t.Errorf("%s : %d, attendu 400", nom, c)
		}
	}
	if c := e.detruireSalon(map[string]string{"X-Shh-Membre": enc.EncodeToString(rnd(32))}, `{}`); c != 404 {
		t.Fatal("jeton inconnu :", c)
	}
	expect(t, e.do(req{method: "GET", path: "/api/salons/meta", hdr: acces(k)}), 200, "")

	kp := newKeys()
	e.creerSalonPermis(t, kp, 4)
	var jetons []string
	for i := range 2 {
		w := e.rejoindre(kp, i == 0)
		expect(t, w, 200, "")
		jetons = append(jetons, jsonOf(t, w)["member_token"].(string))
	}
	expect(t, e.do(req{method: "POST", path: "/api/salons/detruire", hdr: map[string]string{"X-Shh-Membre": jetons[1]},
		body: []byte(`{}`)}), 200, `{}`)
	expect(t, e.do(req{method: "GET", path: "/api/salons/meta", hdr: acces(kp)}), 404, notFound)
}

// Signalement : le compteur horaire (entier sans identifiant, §9.5) prend +1 après une
// destruction réussie ; rien pour un refus.
func TestDetruireSignalement(t *testing.T) {
	e, _ := salonEnv(t)
	k := newKeys()
	ms := salonExclusion(t, e, k, 4, 1)
	n := func() int {
		e.srv.reports.mu.Lock()
		defer e.srv.reports.mu.Unlock()
		return e.srv.reports.n
	}
	if c := e.detruireSalon(map[string]string{"X-Shh-Membre": ms[1].jeton}, `{"reason":"report"}`); c != 403 || n() != 0 {
		t.Fatal("refus compté :", c, n())
	}
	if c := e.detruireSalon(manage(k), `{"reason":"report"}`); c != 200 || n() != 1 {
		t.Fatal("signalement :", c, n())
	}
}

// Revue finale C-2, mineur (d) : un seul signalement par salon, « Quitter et signaler » et
// « Détruire et signaler » confondus (même booléen signale) : le membre signale (+1), puis le
// créateur détruit en signalant : 200, toujours 1.
func TestDetruireSignalementUneFoisParSalon(t *testing.T) {
	e, _ := salonEnv(t)
	k := newKeys()
	ms := salonExclusion(t, e, k, 4, 1)
	if r := e.signaler(map[string]string{"X-Shh-Membre": ms[1].jeton}, `{}`); r.code != 200 || e.signalements() != 1 {
		t.Fatal("quitter et signaler :", r.code, e.signalements())
	}
	if c := e.detruireSalon(manage(k), `{"reason":"report"}`); c != 200 || e.signalements() != 1 {
		t.Fatal("second signalement du même salon compté :", c, e.signalements())
	}
}
