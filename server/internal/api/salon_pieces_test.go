package api

import (
	"bufio"
	"bytes"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"os"
	"path/filepath"
	"strconv"
	"testing"
	"time"

	"github.com/skoow/shhdrop/server/internal/limits"
	"github.com/skoow/shhdrop/server/internal/share"
)

// ---- Pièces jointes et vocaux du salon (plan C-2 Task 13, spec §39.3.9) ----

// salonMembres : salon de n membres (le premier est le créateur) ; rend leurs jetons.
func salonMembres(t *testing.T, e *env, n int) []string {
	t.Helper()
	k := newKeys()
	e.creerSalon(t, k, max(n, 2))
	var out []string
	for i := range n {
		w := e.rejoindre(k, i == 0)
		expect(t, w, 200, "")
		out = append(out, jsonOf(t, w)["member_token"].(string))
	}
	return out
}

func membreHdr(jeton string) map[string]string { return map[string]string{"X-Shh-Membre": jeton} }

func pieceHdr(jeton, id string) map[string]string {
	return map[string]string{"X-Shh-Membre": jeton, "X-Shh-Piece": id}
}

// creerPieceHTTP : POST /api/salons/pieces ; rend la réponse.
func (e *env) creerPieceHTTP(jeton string, bucket int, vocal bool) *httptest.ResponseRecorder {
	return e.do(req{method: "POST", path: "/api/salons/pieces", hdr: membreHdr(jeton),
		body: mustJSON(map[string]any{"bucket": bucket, "vocal": vocal})})
}

// pieceCreee : création réussie (201) ; rend l'identifiant et le jeton d'envoi.
func (e *env) pieceCreee(t *testing.T, jeton string, bucket int, vocal bool) (id, tok string) {
	t.Helper()
	w := e.creerPieceHTTP(jeton, bucket, vocal)
	expect(t, w, 201, "")
	r := jsonOf(t, w)
	if got := clesDe(r); len(got) != 2 || got[0] != "piece" || got[1] != "upload_token" {
		t.Fatal("clés de la réponse :", got)
	}
	id, tok = r["piece"].(string), r["upload_token"].(string)
	if b, err := enc.DecodeString(id); err != nil || len(b) != 16 || len(id) != 22 {
		t.Fatal("identifiant de pièce :", id)
	}
	return id, tok
}

func (e *env) putPiece(tok string, n int, body []byte) *httptest.ResponseRecorder {
	return e.do(req{method: "PUT", path: "/api/salons/pieces/segments/" + strconv.Itoa(n), hdr: auth(tok), body: body})
}

func (e *env) finaliserPiece(tok string, from, to int) *httptest.ResponseRecorder {
	return e.do(req{method: "POST", path: "/api/salons/pieces/finalize", hdr: auth(tok),
		body: mustJSON(map[string]int{"fill_from": from, "fill_to": to})})
}

func (e *env) getPiece(jeton, id string, n int) *httptest.ResponseRecorder {
	return e.do(req{method: "GET", path: "/api/salons/pieces/segments/" + strconv.Itoa(n), hdr: pieceHdr(jeton, id)})
}

// envoyerPiece : tous les segments d'un palier (aléatoires), finalisés sans bourrage.
func (e *env) envoyerPiece(t *testing.T, jeton string, bucket int) (id string, segs [][]byte) {
	t.Helper()
	id, tok := e.pieceCreee(t, jeton, bucket, false)
	for n := range share.SegmentCount(bucket) {
		segs = append(segs, rnd(share.SegmentSize(bucket, n)))
		expect(t, e.putPiece(tok, n, segs[n]), 204, "")
	}
	expect(t, e.finaliserPiece(tok, 0, 0), 200, `{}`)
	return id, segs
}

func TestPieceEnvoiLecture(t *testing.T) {
	e, m := salonEnv(t)
	j := salonMembres(t, e, 2)
	const p = 160 // 3 segments
	id, tok := e.pieceCreee(t, j[0], p, false)
	// Jeton d'envoi signé SalonPiece, valable au plus 6 h (ici, jusqu'à la fin du salon).
	// Salon d'une heure (échéance 11:15:00) : le jeton s'arrête à la fin du salon.
	if got, _, exp, err := e.sig.SubjectExp(tok, 'p'); err != nil || got != id ||
		!exp.Equal(time.Date(2026, 11, 4, 11, 15, 0, 0, time.UTC)) {
		t.Fatal("jeton d'envoi :", got, exp, err)
	}
	if _, _, err := e.sig.Subject(tok, 'u'); err == nil {
		t.Fatal("jeton de pièce accepté comme jeton d'envoi d'un partage")
	}
	s0, s2 := rnd(share.SegmentSize(p, 0)), rnd(share.SegmentSize(p, 2))
	expect(t, e.putPiece(tok, 0, s0), 204, "")
	expect(t, e.putPiece(tok, 2, s2), 204, "")
	// Lecture avant la finalisation : introuvable.
	expect(t, e.getPiece(j[1], id, 0), 404, notFound)
	expect(t, e.finaliserPiece(tok, 1, 2), 200, `{}`)
	for n, want := range map[int][]byte{0: s0, 2: s2} {
		w := e.getPiece(j[1], id, n)
		expect(t, w, 200, "")
		if !bytes.Equal(w.Body.Bytes(), want) || w.Header().Get("Content-Type") != "application/octet-stream" {
			t.Fatal("segment", n, "différent")
		}
	}
	w := e.getPiece(j[1], id, 1)
	expect(t, w, 200, "")
	if w.Body.Len() != share.SegmentSize(p, 1) || bytes.Count(w.Body.Bytes(), []byte{0}) > w.Body.Len()/100 {
		t.Fatal("bourrage d'aléa")
	}
	expect(t, e.getPiece(j[1], id, 3), 400, badRequest)
	// Rejouée : introuvable ; segment après la finalisation : introuvable.
	expect(t, e.finaliserPiece(tok, 1, 2), 404, notFound)
	expect(t, e.putPiece(tok, 0, s0), 404, notFound)
	// En-têtes mal formés.
	expect(t, e.getPiece(j[1], id[:21], 0), 400, badRequest)
	expect(t, e.getPiece("court", id, 0), 400, badRequest)
	expect(t, e.do(req{method: "GET", path: "/api/salons/pieces/segments/0", hdr: membreHdr(j[1])}), 400, badRequest)
	expect(t, e.creerPieceHTTP("court", 1, false), 400, badRequest)
	for _, b := range []string{`{"bucket":1}`, `{"vocal":false}`, `{"bucket":1,"vocal":false,"x":1}`, `{"bucket":1,"vocal":null}`} {
		expect(t, e.do(req{method: "POST", path: "/api/salons/pieces", hdr: membreHdr(j[0]), body: []byte(b)}), 400, badRequest)
	}
	expect(t, e.creerPieceHTTP(j[0], 16385, false), 400, badRequest)
	expect(t, e.creerPieceHTTP(j[0], 160, true), 400, badRequest)
	expect(t, e.finaliserPiece("x.y", 0, 0), 404, notFound)
	expect(t, e.do(req{method: "POST", path: "/api/salons/pieces/finalize", hdr: auth(tok), body: []byte(`{"fill_from":0}`)}),
		400, badRequest)
	// Membre inconnu : 404 uniforme.
	expect(t, e.creerPieceHTTP(enc.EncodeToString(rnd(32)), 1, false), 404, notFound)
	expect(t, e.getPiece(enc.EncodeToString(rnd(32)), id, 0), 404, notFound)
	// Aucune lecture en cours : plus aucun flux inscrit.
	if m.Flux().Len() != 0 {
		t.Fatal("flux encore inscrits :", m.Flux().Len())
	}
}

func TestSegmentMauvaiseTaille(t *testing.T) {
	e, _ := salonEnv(t)
	j := salonMembres(t, e, 1)
	_, tok := e.pieceCreee(t, j[0], 16, false)
	expect(t, e.putPiece(tok, 0, rnd(share.SegmentSize(16, 0)-1)), 400, badRequest)
	expect(t, e.putPiece(tok, 0, rnd(share.SegmentSize(16, 0)+1)), 400, badRequest)
	expect(t, e.putPiece(tok, 1, rnd(share.SegmentSize(16, 0))), 400, badRequest)
	expect(t, e.do(req{method: "PUT", path: "/api/salons/pieces/segments/01", hdr: auth(tok), body: rnd(10)}), 400, badRequest)
	expect(t, e.putPiece("x.y", 0, rnd(share.SegmentSize(16, 0))), 404, notFound)
	expect(t, e.putPiece(tok, 0, rnd(share.SegmentSize(16, 0))), 204, "")
}

func TestLectureBudget(t *testing.T) {
	e, _ := salonEnv(t)
	j := salonMembres(t, e, 2)
	id, _ := e.envoyerPiece(t, j[0], 1)
	taille := int64(share.SegmentSize(1, 0))
	for lus := taille; lus <= share.ReadBudget(1); lus += taille {
		expect(t, e.getPiece(j[1], id, 0), 200, "")
	}
	w := e.getPiece(j[1], id, 0)
	expect(t, w, 429, "")
	if jsonOf(t, w)["error"] != "budget" || w.Header().Get("Retry-After") == "" {
		t.Fatal("refus du budget :", w.Body.String())
	}
	expect(t, e.getPiece(j[0], id, 0), 200, "")
}

func TestPieceRetirerAuteurSeul(t *testing.T) {
	e, _ := salonEnv(t)
	j := salonMembres(t, e, 2)
	id, _ := e.envoyerPiece(t, j[1], 1)
	retirer := func(jeton, id, body string) *httptest.ResponseRecorder {
		return e.do(req{method: "POST", path: "/api/salons/pieces/retirer", hdr: pieceHdr(jeton, id), body: []byte(body)})
	}
	expect(t, retirer(j[0], id, `{}`), 403, `{"error":"forbidden"}`)
	expect(t, e.getPiece(j[0], id, 0), 200, "")
	expect(t, retirer(j[1], id, `{"x":1}`), 400, badRequest)
	expect(t, retirer(j[1], id, `{}`), 200, `{}`)
	expect(t, e.getPiece(j[0], id, 0), 404, notFound)
	expect(t, retirer(j[1], id, `{}`), 404, notFound)
}

// slowGETPiece envoie un GET de segment de pièce et ne lit jamais la réponse.
func slowGETPiece(t *testing.T, srv *httptest.Server, jeton, id string, n int) net.Conn {
	t.Helper()
	cn, err := net.Dial("tcp", srv.Listener.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { cn.Close() })
	if tc, ok := cn.(*net.TCPConn); ok {
		tc.SetReadBuffer(4096)
	}
	fmt.Fprintf(cn, "GET /api/salons/pieces/segments/%d HTTP/1.1\r\nHost: x\r\nX-Shh-Membre: %s\r\nX-Shh-Piece: %s\r\n"+
		"X-Shh-Client-IP: 2001:db8::1\r\n\r\n", n, jeton, id)
	return cn
}

// Lecture lente en cours, la pièce est effacée (retrait par l'auteur) : connexion coupée avant
// la fin, plus aucun flux inscrit.
func TestCoupureLectureEnCours(t *testing.T) {
	e, m := salonEnv(t)
	j := salonMembres(t, e, 2)
	id, _ := e.envoyerPiece(t, j[0], 80)
	srv := prodServer(t, e.h)
	cn := slowGETPiece(t, srv, j[1], id, 0)
	resp, err := http.ReadResponse(bufio.NewReader(cn), nil)
	if err != nil || resp.StatusCode != 200 {
		t.Fatal(resp, err)
	}
	waitFor(t, "flux inscrit", func() bool { return m.Flux().Len() == 2 })
	expect(t, e.do(req{method: "POST", path: "/api/salons/pieces/retirer", hdr: pieceHdr(j[0], id), body: []byte(`{}`)}),
		200, `{}`)
	cn.SetReadDeadline(time.Now().Add(5 * time.Second))
	n, _ := io.Copy(io.Discard, resp.Body)
	if n >= int64(share.SegmentSize(80, 0)) {
		t.Fatal("flux non coupé", n)
	}
	waitFor(t, "flux désinscrits", func() bool { return m.Flux().Len() == 0 })
}

// Fichier de la pièce sans date (mtime et atime à l'epoch), après envoi, finalisation et
// lecture.
func TestPieceSansDate(t *testing.T) {
	e, _ := salonEnv(t)
	j := salonMembres(t, e, 2)
	id, _ := e.envoyerPiece(t, j[0], 16)
	expect(t, e.getPiece(j[1], id, 0), 200, "")
	p := filepath.Join(e.dir, "salon-pieces", id)
	fi, err := os.Stat(p)
	if err != nil {
		t.Fatal(err)
	}
	if fi.ModTime().Unix() != 0 {
		t.Fatal("mtime", fi.ModTime())
	}
	if a, ok := atime(fi); ok && a.Unix() != 0 {
		t.Fatal("atime", a)
	}
	// Jamais dans le dossier des partages (janitor.Reconcile).
	if _, err := os.Stat(filepath.Join(e.dir, "blobs", id)); !os.IsNotExist(err) {
		t.Fatal("pièce dans blobs/ :", err)
	}
	// Dossiers sans date (audit D7) : ni la dernière création de pièce, de conversation ou de
	// partage, ni la dernière suppression.
	c := e.create(t, "203.0.113.7:1", newKeys(), 1, 1)
	e.upload(t, c, 1)
	expect(t, e.do(req{method: "POST", path: "/api/salons/pieces/retirer", hdr: pieceHdr(j[0], id), body: []byte(`{}`)}), 200, "")
	for _, d := range []string{"salon-pieces", "salons", "blobs"} {
		fi, err := os.Stat(filepath.Join(e.dir, d))
		if err != nil {
			t.Fatal(err)
		}
		if fi.ModTime().Unix() != 0 {
			t.Fatal("dossier", d, fi.ModTime())
		}
	}
}

// Quotas (plan, point 22) : un fichier passe par limits (2 envois non finalisés à la fois,
// octets utiles réservés à la création et gardés à la finalisation) ; un vocal n'y passe pas
// (seulement cadencé par la réserve du siège, qui se remplit WebSocket ouvert).
func TestQuotasPieces(t *testing.T) {
	b := nouveauWS(t, nil)
	e := b.e
	j := b.membres(t, 1)
	addr := netip.MustParseAddr("203.0.113.7") // adresse de e.do
	_, tok1 := e.pieceCreee(t, j[0], 16, false)
	e.pieceCreee(t, j[0], 1, false)
	w := e.creerPieceHTTP(j[0], 1, false)
	expect(t, w, 429, "")
	if jsonOf(t, w)["error"] != "limit" {
		t.Fatal(w.Body.String())
	}
	// Finalisée : place d'envoi rendue, octets utiles (15 Mio du palier 16) gardés.
	for n := range share.SegmentCount(16) {
		expect(t, e.putPiece(tok1, n, rnd(share.SegmentSize(16, n))), 204, "")
	}
	expect(t, e.finaliserPiece(tok1, 0, 0), 200, `{}`)
	reste := int64(limits.BytesPer64) - share.ContentBytes(16)
	if d, err := e.srv.lim.BeginUpload(addr, share.NewID(), reste+1); err == nil || d < time.Hour {
		t.Fatal("octets de la pièce non débités :", d, err)
	}
	sonde := share.NewID()
	if _, err := e.srv.lim.BeginUpload(addr, sonde, reste); err != nil {
		t.Fatal("place d'envoi non rendue ou octets en trop :", err)
	}
	e.srv.lim.CancelUpload(sonde)
	e.pieceCreee(t, j[0], 1, false)
	expect(t, e.creerPieceHTTP(j[0], 1, false), 429, "")
	// Vocaux : sans présence, refus (429 limit) ; WebSocket ouvert 40 s (160 000 o) : deux
	// vocaux du palier 1 passent alors que les deux envois de fichiers sont pris.
	w = e.creerPieceHTTP(j[0], 1, true)
	expect(t, w, 429, "")
	c := b.entrer(t, j[0])
	lireJusqua(t, c, 0x0D) // accueil fait : siège en ligne
	e.clk.Add(40 * time.Second)
	expect(t, e.creerPieceHTTP(j[0], 1, true), 201, "")
	_, vtok := e.pieceCreee(t, j[0], 1, true)
	// Segment d'un vocal : hors des quotas des envois (limits.Receive ne le connaît pas, et
	// refuse un envoi inconnu depuis l'audit du 13 novembre, D1) : accepté.
	expect(t, e.putPiece(vtok, 0, rnd(share.SegmentSize(1, 0))), 204, "")
	w = e.creerPieceHTTP(j[0], 1, true)
	expect(t, w, 429, "")
	// Reste 28 800 o : il manque 36 800 o, soit 9,2 s → 10 s.
	if w.Header().Get("Retry-After") != "10" {
		t.Fatal("Retry-After du vocal :", w.Header().Get("Retry-After"))
	}
}

// Segments de pièces : compteur des segments (600 par minute), pas celui des requêtes (60) ;
// un jeton invalide ou un membre inconnu reste sous la limite ordinaire.
func TestSegmentsPiecesHorsLimite(t *testing.T) {
	e, _ := salonEnv(t)
	j := salonMembres(t, e, 2)
	id, tok := e.pieceCreee(t, j[0], 1, false)
	seg := rnd(share.SegmentSize(1, 0))
	// Au-delà de 2 écritures du segment (2 × la taille de la pièce) : 413, jamais 429 limit.
	for i := 0; i < limits.RequestsPerMin+10; i++ {
		if i < 2 {
			expect(t, e.putPiece(tok, 0, seg), 204, "")
		} else {
			expect(t, e.putPiece(tok, 0, seg), 413, `{"error":"too_large"}`)
		}
	}
	expect(t, e.finaliserPiece(tok, 0, 0), 200, `{}`)
	for i := 0; i < limits.RequestsPerMin+10; i++ {
		if w := e.getPiece(j[1], id, 0); w.Code != 200 && (w.Code != 429 || jsonOf(t, w)["error"] != "budget") {
			t.Fatal("lecture", i, w.Code, w.Body.String())
		}
	}
	e2, _ := salonEnv(t)
	for i := 0; i < limits.RequestsPerMin; i++ {
		e2.putPiece("x.y", 0, seg)
	}
	w := e2.putPiece("x.y", 0, seg)
	if w.Code != 429 || jsonOf(t, w)["error"] != "limit" {
		t.Fatal("jeton invalide hors limite :", w.Code, w.Body.String())
	}
}

// Une pièce n'est pas une création de partage (décision du 12 novembre) : 11 photos de suite
// passent, et les 10 créations de partage du jour restent entières ensuite ; au-delà de 120
// pièces dans l'heure pour un siège : 429 limit avec retry_after_s.
func TestOnzePieces(t *testing.T) {
	e, m := salonEnv(t)
	j := salonMembres(t, e, 1)
	for range 11 {
		e.envoyerPiece(t, j[0], 1)
	}
	addr := netip.MustParseAddr("203.0.113.7")
	for i := range limits.CreatesPer64 {
		id := share.NewID()
		if _, err := e.srv.lim.BeginUpload(addr, id, 0); err != nil {
			t.Fatal("création de partage", i+1, "refusée :", err)
		}
		e.srv.lim.FinishUpload(id, addr)
	}
	// Le reste de l'heure directement (60 requêtes par minute et par connexion).
	jeton, _ := enc.DecodeString(j[0])
	mb, err := m.Membre(jeton)
	if err != nil {
		t.Fatal(err)
	}
	for range 120 - 11 {
		if err := m.CreerPieceID(mb, share.NewID(), 1, false); err != nil {
			t.Fatal(err)
		}
	}
	w := e.creerPieceHTTP(j[0], 1, false)
	expect(t, w, 429, `{"error":"limit","retry_after_s":30}`)
	if w.Header().Get("Retry-After") != "30" {
		t.Fatal("Retry-After", w.Header().Get("Retry-After"))
	}
}
