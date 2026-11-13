package api

import (
	"net/http/httptest"
	"os"
	"strconv"
	"testing"
	"time"

	"github.com/skoow/shhdrop/server/internal/share"
)

// POST /api/salons/reglages (spec 2026-11-13, révision du 13 novembre) : places et
// renouvellement par le créateur.

func (e *env) reglages(hdr map[string]string, body map[string]any, remote string) *httptest.ResponseRecorder {
	return e.do(req{method: "POST", path: "/api/salons/reglages", hdr: hdr, body: mustJSON(body), remote: remote})
}

// renouveler : corps d'un renouvellement de h heures avec une preuve anti-robot neuve.
func (e *env) corpsRenouveler(t *testing.T, h int, remote string) map[string]any {
	t.Helper()
	alt, shown := e.captchaFor(t, remote)
	return map[string]any{"renouveler_h": h, "altcha": alt, "hp": "", "shown_at": shown}
}

func reponseReglages(places int, expiresIn int64, depuis uint64) string {
	return `{"max_members":` + strconv.Itoa(places) + `,"expires_in_s":` + strconv.FormatInt(expiresIn, 10) +
		`,"depuis":` + strconv.FormatUint(depuis, 10) + `}`
}

func TestReglagesPlacesHTTP(t *testing.T) {
	e, _ := salonEnv(t)
	k := newKeys()
	e.creerSalon(t, k, 2)
	expect(t, e.rejoindre(k, true), 200, "")
	expect(t, e.rejoindre(k, false), 200, "")
	expect(t, e.rejoindre(k, false), 409, `{"error":"full"}`)
	for _, b := range []map[string]any{
		{}, {"max_members": 1}, {"max_members": 0}, {"max_members": -3}, {"max_members": 11},
		{"max_members": "3"}, {"max_members": 3.5}, {"max_members": nil}, {"max_members": 3, "inconnu": 1},
		{"Max_members": 3}, {"max_members": 3, "hp": "x"}, {"max_members": 3, "altcha": "x"},
	} {
		expect(t, e.reglages(manage(k), b, ""), 400, badRequest)
	}
	expect(t, e.reglages(manage(k), map[string]any{"max_members": 3}, ""), 200, reponseReglages(3, 4377, 0))
	expect(t, e.rejoindre(k, false), 200, "")
	expect(t, e.reglages(manage(k), map[string]any{"max_members": 2}, ""), 409, `{"error":"occupied"}`)
	expect(t, e.reglages(manage(k), map[string]any{"max_members": 10}, ""), 200, reponseReglages(10, 4377, 0))
	w := e.rejoindre(k, false)
	expect(t, w, 200, "")
	if m := jsonOf(t, w); m["max_members"] != 10.0 {
		t.Fatal("rejoindre : max_members", m["max_members"])
	}
}

// Sans S_gestion valide : la même réponse fixe que gestion (400 absent ou mal formé, 404
// inconnu), et ni la preuve ni le quota ne sont consommés.
func TestReglagesSansGestionHTTP(t *testing.T) {
	e, _ := salonEnv(t)
	k := newKeys()
	e.creerSalon(t, k, 3)
	corps := e.corpsRenouveler(t, 1, "")
	for _, h := range []map[string]string{nil, {"X-Shh-Manage": "x"}, manage(newKeys()),
		{"X-Shh-Manage": enc.EncodeToString(k.acces)}} {
		g := e.do(req{method: "GET", path: "/api/salons/gestion", hdr: h})
		for _, b := range []map[string]any{{"max_members": 3}, corps} {
			w := e.reglages(h, b, "")
			if w.Code != g.Code || w.Body.String() != g.Body.String() {
				t.Fatalf("%v : %d %s, gestion %d %s", h, w.Code, w.Body.String(), g.Code, g.Body.String())
			}
		}
	}
	// Défi et quota intacts : le renouvellement passe avec la même preuve (2ᵉ opération du jour,
	// après la création), puis 2 autres.
	expect(t, e.reglages(manage(k), corps, ""), 200, "")
	for range 2 {
		expect(t, e.reglages(manage(k), e.corpsRenouveler(t, 1, ""), ""), 200, "")
	}
	// Places sous l'occupation avec un renouvellement : refus avant la preuve et le quota.
	expect(t, e.rejoindre(k, true), 200, "")
	expect(t, e.rejoindre(k, false), 200, "")
	expect(t, e.rejoindre(k, false), 200, "")
	b := e.corpsRenouveler(t, 1, "")
	b["max_members"] = 2
	expect(t, e.reglages(manage(k), b, ""), 409, `{"error":"occupied"}`)
	b["max_members"] = 3
	expect(t, e.reglages(manage(k), b, ""), 200, "") // même preuve : non consommée ; 5ᵉ du jour
	expect(t, e.reglages(manage(k), e.corpsRenouveler(t, 1, ""), ""), 429, "")
}

func TestRenouvelerHTTP(t *testing.T) {
	e, _ := salonEnv(t)
	k := newKeys()
	e.creerSalon(t, k, 4)
	w := e.rejoindre(k, true)
	expect(t, w, 200, "")
	seq := uint64(jsonOf(t, w)["seq"].(float64))
	// Format : durée hors de {1, 6, 12, 24}, preuve absente ou fausse : 400.
	for _, h := range []any{2, 0, -1, 48, "6", nil} {
		b := e.corpsRenouveler(t, 6, "")
		b["renouveler_h"] = h
		expect(t, e.reglages(manage(k), b, ""), 400, badRequest)
	}
	expect(t, e.reglages(manage(k), map[string]any{"renouveler_h": 6}, ""), 400, badRequest)
	b := e.corpsRenouveler(t, 6, "")
	b["hp"] = "robot"
	expect(t, e.reglages(manage(k), b, ""), 400, badRequest)
	// Gel : 503 frozen, rien de consommé.
	b = e.corpsRenouveler(t, 6, "")
	if err := os.WriteFile(e.svc.FrozenFile, nil, 0o600); err != nil {
		t.Fatal(err)
	}
	expect(t, e.reglages(manage(k), b, ""), 503, `{"error":"frozen"}`)
	os.Remove(e.svc.FrozenFile)
	now := e.clk.Now().Unix()
	exp := share.Ceil15(now + 6*3600)
	expect(t, e.reglages(manage(k), b, ""), 200, reponseReglages(4, exp-now, seq))
	gw := e.do(req{method: "GET", path: "/api/salons/gestion", hdr: manage(k)})
	expect(t, gw, 200, `{"expires_in_s":`+strconv.FormatInt(exp-now, 10)+`,"present":1}`)
	// Même preuve rejouée : refusée (consommée par le succès).
	expect(t, e.reglages(manage(k), b, ""), 400, badRequest)
}

// Quota : un renouvellement compte comme une création (5 par jour et par connexion) : la 6ᵉ
// opération du jour, renouvellement ou création, est refusée en 429 jusqu'à minuit UTC.
func TestRenouvelerQuotaHTTP(t *testing.T) {
	e, _ := salonEnv(t)
	k := newKeys()
	e.creerSalon(t, k, 2) // 1
	for range 4 {         // 2 à 5
		expect(t, e.reglages(manage(k), e.corpsRenouveler(t, 24, ""), ""), 200, "")
	}
	now := e.clk.Now()
	minuit := time.Date(now.Year(), now.Month(), now.Day()+1, 0, 0, 0, 0, time.UTC)
	limite := func(w *httptest.ResponseRecorder) {
		t.Helper()
		secs := strconv.FormatInt(int64(minuit.Sub(e.clk.Now())/time.Second), 10)
		expect(t, w, 429, `{"error":"limit","retry_after_s":`+secs+`}`)
		if w.Header().Get("Retry-After") != secs {
			t.Fatal("Retry-After", w.Header().Get("Retry-After"))
		}
	}
	limite(e.reglages(manage(k), e.corpsRenouveler(t, 24, ""), ""))
	k2 := newKeys()
	alt, shown := e.captchaFor(t, "")
	limite(e.do(req{method: "POST", path: "/api/salons", hdr: k2.createHdr(), body: mustJSON(k2.salonBody(2, alt, shown))}))
	// Les places seules ne comptent pas.
	expect(t, e.reglages(manage(k), map[string]any{"max_members": 3}, ""), 200, "")
	// Une autre connexion : 5 renouvellements, puis 429 ; le lendemain, de nouveau permis.
	const autre = "198.51.100.20:1"
	for range 5 {
		expect(t, e.reglages(manage(k), e.corpsRenouveler(t, 24, autre), autre), 200, "")
	}
	expect(t, e.reglages(manage(k), e.corpsRenouveler(t, 24, autre), autre), 429, "")
	e.clk.Add(minuit.Sub(e.clk.Now()))
	expect(t, e.reglages(manage(k), e.corpsRenouveler(t, 24, autre), autre), 200, "")
}
