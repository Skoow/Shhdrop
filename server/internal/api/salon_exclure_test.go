package api

import (
	"bufio"
	"bytes"
	"database/sql"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"
	"time"

	"github.com/skoow/shhdrop/server/internal/share"
)

// ---- Exclusion et rotation de l'invitation (plan C-2 Task 14, spec §39.13) ----

// membreSalon : réponse de rejoindre utile à l'exclusion.
type membreSalon struct {
	jeton, nonce string
	siege        int
}

// salonExclusion : salon de k (max membres), créateur puis n invités entrés.
func salonExclusion(t *testing.T, e *env, k keys, max, n int) []membreSalon {
	t.Helper()
	e.creerSalon(t, k, max)
	var out []membreSalon
	for i := range n + 1 {
		w := e.rejoindre(k, i == 0)
		expect(t, w, 200, "")
		r := jsonOf(t, w)
		out = append(out, membreSalon{r["member_token"].(string), r["nonce_arrivee"].(string), int(r["seat"].(float64))})
	}
	return out
}

// corpsExclure : corps valide de rotation vers n, avec siège et nonce de m (nil : rotation seule).
func corpsExclure(n keys, m *membreSalon, r int) map[string]any {
	b := map[string]any{"r": r, "proof_v": v(n.preuve), "salt": enc.EncodeToString(rnd(16)), "kdf_ops": 3,
		"kdf_mem": 67108864}
	if m != nil {
		b["seat"], b["nonce_arrivee"] = m.siege, m.nonce
	}
	return b
}

func hdrExclure(gestion []byte, n keys) map[string]string {
	return map[string]string{"X-Shh-Manage": enc.EncodeToString(gestion), "X-Shh-Access-New": enc.EncodeToString(n.acces)}
}

func (e *env) exclure(hdr map[string]string, body []byte) *httptest.ResponseRecorder {
	return e.do(req{method: "POST", path: "/api/salons/exclure", hdr: hdr, body: body})
}

// invitationDe : nouvelle invitation (accès et preuve neufs, même gestion).
func invitationDe(k keys) keys { return keys{rnd(32), rnd(32), k.gestion} }

// colonnes : colonnes de la ligne du salon que la rotation remplace.
func colonnes(t *testing.T, db *sql.DB, gestion []byte) []any {
	t.Helper()
	var a, p, s []byte
	var ops, mem, essais int
	if err := db.QueryRow(`SELECT access_v, proof_v, salt, kdf_ops, kdf_mem, failed_attempts FROM salons WHERE manage_v=?`,
		share.Verifier(gestion)).Scan(&a, &p, &s, &ops, &mem, &essais); err != nil {
		t.Fatal(err)
	}
	return []any{a, p, s, ops, mem, essais}
}

func TestExclureHTTP(t *testing.T) {
	e, m := salonEnv(t)
	k := newKeys()
	ms := salonExclusion(t, e, k, 4, 2)
	n := invitationDe(k)
	expect(t, e.exclure(hdrExclure(k.gestion, n), mustJSON(corpsExclure(n, &ms[1], 1))), 200, `{}`)
	raw, _ := enc.DecodeString(ms[1].jeton)
	if _, err := m.Membre(raw); err == nil {
		t.Fatal("jeton de l'exclu encore valable")
	}
	// Même siège et même nonce (siège libre) : 409 stale ; r déjà vu : 409 stale.
	n2 := invitationDe(k)
	expect(t, e.exclure(hdrExclure(k.gestion, n2), mustJSON(corpsExclure(n2, &ms[1], 2))), 409, `{"error":"stale"}`)
	expect(t, e.exclure(hdrExclure(k.gestion, n2), mustJSON(corpsExclure(n2, &ms[2], 1))), 409, `{"error":"stale"}`)
	// Rotation seule : 200 ; ancienne invitation morte, nouvelle valable.
	expect(t, e.exclure(hdrExclure(k.gestion, n2), mustJSON(corpsExclure(n2, nil, 3))), 200, `{}`)
	expect(t, e.do(req{method: "GET", path: "/api/salons/meta", hdr: acces(n)}), 404, notFound)
	expect(t, e.do(req{method: "GET", path: "/api/salons/meta", hdr: acces(n2)}), 200, "")
	// Nouvelle access_v déjà prise (la sienne) : 400, comme une création en conflit.
	expect(t, e.exclure(hdrExclure(k.gestion, n2), mustJSON(corpsExclure(n2, nil, 4))), 400, badRequest)
}

// Sans S_gestion, ou avec un jeton de membre (ou une autre clé) à sa place : 403, rien changé.
func TestExclureSansGestionHTTP(t *testing.T) {
	e, _ := salonEnv(t)
	k := newKeys()
	ms := salonExclusion(t, e, k, 4, 1)
	avant := colonnes(t, e.db, k.gestion)
	n := invitationDe(k)
	corps := mustJSON(corpsExclure(n, &ms[1], 1))
	jeton, _ := enc.DecodeString(ms[1].jeton)
	for nom, hdr := range map[string]map[string]string{
		"rien":            {"X-Shh-Access-New": enc.EncodeToString(n.acces)},
		"jeton de membre": hdrExclure(jeton, n),
		"accès":           hdrExclure(k.acces, n),
		"mal formé":       {"X-Shh-Manage": "abc", "X-Shh-Access-New": enc.EncodeToString(n.acces)},
	} {
		if w := e.exclure(hdr, corps); w.Code != 403 || w.Body.String() != `{"error":"forbidden"}` {
			t.Errorf("%s : %d %q", nom, w.Code, w.Body.String())
		}
	}
	if !reflect.DeepEqual(avant, colonnes(t, e.db, k.gestion)) {
		t.Fatal("ligne changée par un refus")
	}
}

// Siège 0, siège sans nonce, corps non strict ou incomplet : 400, rien changé.
func TestExclureSoiMemeHTTP(t *testing.T) {
	e, _ := salonEnv(t)
	k := newKeys()
	ms := salonExclusion(t, e, k, 4, 1)
	avant := colonnes(t, e.db, k.gestion)
	n := invitationDe(k)
	mod := func(f func(b map[string]any)) []byte {
		b := corpsExclure(n, &ms[1], 1)
		f(b)
		return mustJSON(b)
	}
	cas := map[string][]byte{
		"siège 0":          mustJSON(corpsExclure(n, &ms[0], 1)),
		"siège sans nonce": mod(func(b map[string]any) { delete(b, "nonce_arrivee") }),
		"nonce sans siège": mod(func(b map[string]any) { delete(b, "seat") }),
		"siège négatif":    mod(func(b map[string]any) { b["seat"] = -1 }),
		"siège 256":        mod(func(b map[string]any) { b["seat"] = 256 }),
		"clé inconnue":     mod(func(b map[string]any) { b["x"] = 1 }),
		"sans r":           mod(func(b map[string]any) { delete(b, "r") }),
		"r négatif":        mod(func(b map[string]any) { b["r"] = -1 }),
		"r trop grand":     mod(func(b map[string]any) { b["r"] = 1 << 32 }),
		"sans kdf_ops":     mod(func(b map[string]any) { delete(b, "kdf_ops") }),
		"sel court":        mod(func(b map[string]any) { b["salt"] = enc.EncodeToString(rnd(15)) }),
		"nonce long":       mod(func(b map[string]any) { b["nonce_arrivee"] = enc.EncodeToString(rnd(17)) }),
	}
	for nom, corps := range cas {
		if w := e.exclure(hdrExclure(k.gestion, n), corps); w.Code != 400 {
			t.Errorf("%s : %d %q", nom, w.Code, w.Body.String())
		}
	}
	sansAcces := map[string]string{"X-Shh-Manage": enc.EncodeToString(k.gestion)}
	expect(t, e.exclure(sansAcces, mustJSON(corpsExclure(n, &ms[1], 1))), 400, badRequest)
	if !reflect.DeepEqual(avant, colonnes(t, e.db, k.gestion)) {
		t.Fatal("ligne changée par un refus")
	}
}

// Ancienne K_accès_s : meta et rejoindre → 404 identique à un salon inconnu, octet pour octet.
func TestAncienAcces(t *testing.T) {
	e, _ := salonEnv(t)
	k := newKeys()
	salonExclusion(t, e, k, 4, 1)
	n := invitationDe(k)
	expect(t, e.exclure(hdrExclure(k.gestion, n), mustJSON(corpsExclure(n, nil, 1))), 200, `{}`)
	inconnu := newKeys()
	for nom, f := range map[string]func(keys) *httptest.ResponseRecorder{
		"meta": func(c keys) *httptest.ResponseRecorder {
			return e.do(req{method: "GET", path: "/api/salons/meta", hdr: acces(c)})
		},
		"rejoindre": func(c keys) *httptest.ResponseRecorder { return e.rejoindre(c, false) },
	} {
		w, ref := f(k), f(inconnu)
		if w.Code != 404 || w.Code != ref.Code || !bytes.Equal(w.Body.Bytes(), ref.Body.Bytes()) ||
			!reflect.DeepEqual(w.Header(), ref.Header()) {
			t.Errorf("%s : %d %q %v ; inconnu : %d %q %v", nom, w.Code, w.Body.String(), w.Header(), ref.Code,
				ref.Body.String(), ref.Header())
		}
	}
}

// Nouvelle K_accès_s', ancienne preuve : 403 bad_password, essai compté.
func TestAnciennePreuve(t *testing.T) {
	e, _ := salonEnv(t)
	k := newKeys()
	salonExclusion(t, e, k, 4, 1)
	n := invitationDe(k)
	expect(t, e.exclure(hdrExclure(k.gestion, n), mustJSON(corpsExclure(n, nil, 1))), 200, `{}`)
	melange := keys{n.acces, k.preuve, k.gestion}
	expect(t, e.rejoindre(melange, false), 403, `{"error":"bad_password","attempts_left":9}`)
	if c := colonnes(t, e.db, k.gestion); c[5] != 1 {
		t.Fatal("essai non compté", c[5])
	}
	expect(t, e.rejoindre(n, false), 200, "")
}

// Après l'exclusion, le jeton révoqué reçoit 403 excluded partout : création de pièce, PUT avec
// un jeton d'envoi encore valable, finalisation, lecture, retrait (relecture Task 13).
func TestPieceExclu(t *testing.T) {
	e, _ := salonEnv(t)
	k := newKeys()
	ms := salonExclusion(t, e, k, 4, 1)
	lisible, _ := e.envoyerPiece(t, ms[0].jeton, 1)
	id, tok := e.pieceCreee(t, ms[1].jeton, 1, false)
	expect(t, e.getPiece(ms[1].jeton, lisible, 0), 200, "")
	n := invitationDe(k)
	expect(t, e.exclure(hdrExclure(k.gestion, n), mustJSON(corpsExclure(n, &ms[1], 1))), 200, `{}`)
	const exclu = `{"error":"excluded"}`
	expect(t, e.creerPieceHTTP(ms[1].jeton, 1, false), 403, exclu)
	expect(t, e.putPiece(tok, 0, rnd(share.SegmentSize(1, 0))), 403, exclu)
	expect(t, e.finaliserPiece(tok, 0, 0), 403, exclu)
	expect(t, e.getPiece(ms[1].jeton, lisible, 0), 403, exclu)
	expect(t, e.do(req{method: "POST", path: "/api/salons/pieces/retirer", hdr: pieceHdr(ms[1].jeton, id),
		body: []byte(`{}`)}), 403, exclu)
	// Le créateur lit toujours.
	expect(t, e.getPiece(ms[0].jeton, lisible, 0), 200, "")
}

// Lecture de pièce en cours de l'exclu coupée à l'exclusion, celle d'un autre membre continue
// jusqu'au bout ; plus aucun flux inscrit ensuite (spec §39.13.6).
func TestCoupureTelechargementExclu(t *testing.T) {
	e, m := salonEnv(t)
	k := newKeys()
	ms := salonExclusion(t, e, k, 4, 2)
	id, _ := e.envoyerPiece(t, ms[0].jeton, 80)
	srv := prodServer(t, e.h)
	taille := int64(share.SegmentSize(80, 0))
	cb := slowGETPiece(t, srv, ms[1].jeton, id, 0)
	cc := slowGETPiece(t, srv, ms[2].jeton, id, 0)
	var corps []io.Reader
	for _, cn := range []net.Conn{cb, cc} {
		resp, err := http.ReadResponse(bufio.NewReader(cn), nil)
		if err != nil || resp.StatusCode != 200 {
			t.Fatal(resp, err)
		}
		corps = append(corps, resp.Body)
	}
	waitFor(t, "flux inscrits", func() bool { return m.Flux().Len() == 4 })
	n := invitationDe(k)
	expect(t, e.exclure(hdrExclure(k.gestion, n), mustJSON(corpsExclure(n, &ms[1], 1))), 200, `{}`)
	cb.SetReadDeadline(time.Now().Add(5 * time.Second))
	cc.SetReadDeadline(time.Now().Add(30 * time.Second))
	lus, _ := io.Copy(io.Discard, corps[0])
	if lus >= taille {
		t.Fatal("flux de l'exclu non coupé", lus)
	}
	// L'autre membre continue : bien plus que ce que les tampons (quelques Kio) gardaient
	// avant l'exclusion arrive encore, et son flux reste inscrit.
	lus, err := io.CopyN(io.Discard, corps[1], 256<<10)
	if err != nil || lus != 256<<10 {
		t.Fatal("flux de l'autre membre coupé :", lus, err)
	}
	if n := m.Flux().Len(); n != 2 {
		t.Fatal("flux inscrits après l'exclusion", n)
	}
	cc.Close()
	waitFor(t, "flux désinscrits", func() bool { return m.Flux().Len() == 0 })
}

// FuzzExclure : corps JSON muté ; aucune panique, aucune ligne changée hors d'un succès (200).
func FuzzExclure(f *testing.F) {
	n := keys{bytes.Repeat([]byte{1}, 32), bytes.Repeat([]byte{2}, 32), nil}
	valide := corpsExclure(n, &membreSalon{nonce: "AAAAAAAAAAAAAAAAAAAAAA", siege: 1}, 1)
	f.Add(mustJSON(valide))
	f.Add(mustJSON(corpsExclure(n, nil, 1)))
	f.Add([]byte(`{"r":1,"r":2}`))
	f.Add([]byte(`{"seat":null,"nonce_arrivee":null,"r":1,"proof_v":"","salt":"","kdf_ops":3,"kdf_mem":67108864}`))
	f.Add([]byte(`[`))
	f.Fuzz(func(t *testing.T, corps []byte) {
		e, _ := salonEnv(t)
		k := newKeys()
		ms := salonExclusion(t, e, k, 4, 1)
		// Le siège 1 et son vrai nonce : un corps muté peut réussir.
		corps = bytes.ReplaceAll(corps, []byte("AAAAAAAAAAAAAAAAAAAAAA"), []byte(ms[1].nonce))
		avant := colonnes(t, e.db, k.gestion)
		w := e.exclure(hdrExclure(k.gestion, keys{n.acces, n.preuve, k.gestion}), corps)
		switch w.Code {
		case 200:
			if reflect.DeepEqual(avant, colonnes(t, e.db, k.gestion)) {
				t.Fatal("200 sans rotation")
			}
		case 400, 403, 409:
			if !reflect.DeepEqual(avant, colonnes(t, e.db, k.gestion)) {
				t.Fatalf("ligne changée par un refus %d", w.Code)
			}
		default:
			t.Fatalf("code %d %q", w.Code, w.Body.String())
		}
	})
}
