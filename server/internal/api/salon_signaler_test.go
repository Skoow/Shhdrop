package api

import (
	"encoding/binary"
	"net/netip"
	"testing"
	"time"

	"github.com/coder/websocket"
)

// ---- Quitter et signaler (spec §39.5, §39.3.9 ; décision de l'équipe, plan C-2 Task 17) ----

func (e *env) signaler(hdr map[string]string, body string) *httpResp {
	w := e.do(req{method: "POST", path: "/api/salons/signaler", hdr: hdr, body: []byte(body)})
	return &httpResp{w.Code, w.Body.String()}
}

type httpResp struct {
	code int
	body string
}

func (e *env) signalements() int {
	e.srv.reports.mu.Lock()
	defer e.srv.reports.mu.Unlock()
	return e.srv.reports.n
}

// Le membre signale : +1 au compteur horaire, départ 0x03 de son siège chez les autres, son
// WebSocket fermé en 1000, son jeton oublié (un second signalement : 404, non compté).
func TestSignalerHTTP(t *testing.T) {
	b := nouveauWS(t, nil)
	js := b.membres(t, 2)
	a, z := b.entrer(t, js[0]), b.entrer(t, js[1])
	lireJusqua(t, a, 0x0D)
	lireJusqua(t, z, 0x0D)

	r := b.e.signaler(map[string]string{"X-Shh-Membre": js[1]}, `{}`)
	if r.code != 200 || r.body != "{}\n" && r.body != "{}" {
		t.Fatalf("signaler : %d %q", r.code, r.body)
	}
	if n := b.e.signalements(); n != 1 {
		t.Fatal("compteur :", n)
	}
	dep := lireJusqua(t, a, 0x03)
	if len(dep) != 10 || dep[9] != 1 || binary.BigEndian.Uint64(dep[1:9]) == 0 {
		t.Fatalf("départ : %x", dep)
	}
	if code := codeFermeture(t, z); code != websocket.StatusNormalClosure {
		t.Fatalf("code %d, attendu 1000", code)
	}
	// Jeton oublié : un second signalement est un jeton inconnu, non compté.
	if r := b.e.signaler(map[string]string{"X-Shh-Membre": js[1]}, `{}`); r.code != 404 || r.body != notFound+"\n" && r.body != notFound {
		t.Fatalf("second signalement : %d %q", r.code, r.body)
	}
	if n := b.e.signalements(); n != 1 {
		t.Fatal("second signalement compté :", n)
	}
	// Le jeton ne sert plus à rien d'autre (pièces).
	if w := b.e.do(req{method: "POST", path: "/api/salons/pieces", hdr: map[string]string{"X-Shh-Membre": js[1]},
		body: []byte(`{"bucket":1,"vocal":false}`)}); w.Code != 404 {
		t.Fatal("jeton encore valable :", w.Code)
	}
	// Le salon continue pour les autres.
	envoyer(t, a, append([]byte{0x01}, trameWS()...))
	lireJusqua(t, a, 0x01)

	// Aucune adresse gardée, ni dans le compteur ni dans le gestionnaire (une fois tout fermé).
	ip := netip.MustParseAddr("127.0.0.1")
	b.m.FermerTout()
	codeFermeture(t, a)
	attendre(t, 20*time.Second, func() bool { return b.e.srv.wsSlots.Len() == 0 })
	parcourirSansAdresse(t, "gestionnaire", b.m, ip)
	b.e.srv.reports.mu.Lock()
	cpt := struct {
		h int64
		n int
	}{b.e.srv.reports.hour, b.e.srv.reports.n}
	b.e.srv.reports.mu.Unlock()
	if cpt.n != 1 || cpt.h != b.e.clk.Now().Unix()/3600 {
		t.Fatalf("compteur : %+v", cpt)
	}
}

// Sans WebSocket ouvert : même effet (départ, jeton oublié, compté).
func TestSignalerHorsLigne(t *testing.T) {
	e, _ := salonEnv(t)
	k := newKeys()
	ms := salonExclusion(t, e, k, 4, 1)
	if r := e.signaler(map[string]string{"X-Shh-Membre": ms[1].jeton}, `{}`); r.code != 200 {
		t.Fatalf("signaler : %d %q", r.code, r.body)
	}
	if n := e.signalements(); n != 1 {
		t.Fatal("compteur :", n)
	}
	if g := jsonOf(t, e.do(req{method: "GET", path: "/api/salons/gestion", hdr: manage(k)})); g["present"].(float64) != 1 {
		t.Fatalf("présents : %v", g)
	}
}

// Refus : jamais comptés. Jeton révoqué (exclu) : 403 excluded ; inconnu, ou salon détruit :
// 404 ; en-tête absent ou mal formé, corps autre que {} : 400 ; X-Shh-Manage seul : 400 (seul
// un membre quitte).
func TestSignalerRefus(t *testing.T) {
	e, _ := salonEnv(t)
	k := newKeys()
	ms := salonExclusion(t, e, k, 4, 2)
	exclu := ms[2]
	nk := invitationDe(k)
	expect(t, e.do(req{method: "POST", path: "/api/salons/exclure", hdr: hdrExclure(k.gestion, nk),
		body: mustJSON(corpsExclure(nk, &exclu, 1))}), 200, `{}`)
	membre := map[string]string{"X-Shh-Membre": ms[1].jeton}
	cas := []struct {
		nom   string
		hdr   map[string]string
		body  string
		code  int
		corps string
	}{
		{"exclu", map[string]string{"X-Shh-Membre": exclu.jeton}, `{}`, 403, `{"error":"excluded"}`},
		{"inconnu", map[string]string{"X-Shh-Membre": enc.EncodeToString(rnd(32))}, `{}`, 404, notFound},
		{"sans en-tête", nil, `{}`, 400, ""},
		{"mal formé", map[string]string{"X-Shh-Membre": "court"}, `{}`, 400, ""},
		{"gestion seule", manage(k), `{}`, 400, ""},
		{"clé inconnue", membre, `{"reason":"report"}`, 400, ""},
		{"corps vide", membre, ``, 400, ""},
		{"corps nul", membre, `null`, 400, ""},
	}
	for _, c := range cas {
		r := e.signaler(c.hdr, c.body)
		if r.code != c.code || c.corps != "" && r.body != c.corps && r.body != c.corps+"\n" {
			t.Errorf("%s : %d %q, attendu %d %s", c.nom, r.code, r.body, c.code, c.corps)
		}
	}
	if n := e.signalements(); n != 0 {
		t.Fatal("refus comptés :", n)
	}
	// Salon détruit : 404, non compté.
	expect(t, e.do(req{method: "POST", path: "/api/salons/detruire", hdr: manage(k), body: []byte(`{}`)}), 200, `{}`)
	if r := e.signaler(membre, `{}`); r.code != 404 {
		t.Fatal("salon détruit :", r.code, r.body)
	}
	if n := e.signalements(); n != 0 {
		t.Fatal("refus comptés :", n)
	}
}

// Un seul signalement compté par salon (relecture C-2 Task 17) : le second membre qui signale
// part aussi, mais l'entier horaire ne bouge plus ; un autre salon compte de nouveau.
func TestSignalerUneFoisParSalon(t *testing.T) {
	e, _ := salonEnv(t)
	k := newKeys()
	ms := salonExclusion(t, e, k, 4, 2)
	for i, m := range ms[1:] {
		if r := e.signaler(map[string]string{"X-Shh-Membre": m.jeton}, `{}`); r.code != 200 {
			t.Fatalf("signalement %d : %d %q", i, r.code, r.body)
		}
		if n := e.signalements(); n != 1 {
			t.Fatalf("après le signalement %d : compteur %d, attendu 1", i, n)
		}
	}
	if g := jsonOf(t, e.do(req{method: "GET", path: "/api/salons/gestion", hdr: manage(k)})); g["present"].(float64) != 1 {
		t.Fatalf("présents : %v", g)
	}
	k2 := newKeys()
	ms2 := salonExclusion(t, e, k2, 4, 1)
	if r := e.signaler(map[string]string{"X-Shh-Membre": ms2[1].jeton}, `{}`); r.code != 200 || e.signalements() != 2 {
		t.Fatalf("autre salon : %d, compteur %d", r.code, e.signalements())
	}
}
