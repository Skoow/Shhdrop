package api

import (
	"bytes"
	"errors"
	"fmt"
	"net/http/httptest"
	"net/netip"
	"os"
	"path/filepath"
	"runtime"
	"sync"
	"testing"

	"github.com/skoow/shhdrop/server/internal/limits"
	"github.com/skoow/shhdrop/server/internal/share"
)

// Envoi dès l'ajout (spec §41.14) : grow, erase, keep et finalize d'un brouillon, par le
// jeton d'envoi seulement ; corps JSON stricts.
func TestDraftRoutes(t *testing.T) {
	e := newEnv(t, false, nil)
	k := newKeys()
	c := e.create(t, "", k, 80, 1)
	post := func(path string, body any, tok string) int {
		var b []byte
		if body != nil {
			b = mustJSON(body)
		}
		return e.do(req{method: "POST", path: path, body: b, hdr: auth(tok)}).Code
	}
	put := func(n, bucket int, fill byte) {
		expect(t, e.do(req{method: "PUT", path: fmt.Sprintf("/api/shares/segments/%d", n),
			body: bytes.Repeat([]byte{fill}, share.SegmentSize(bucket, n)), hdr: auth(c.UploadToken)}), 204, "")
	}
	put(0, 80, 1)
	if code := post("/api/shares/grow", map[string]any{"bucket": 160}, "jeton-faux"); code != 401 && code != 404 {
		t.Fatal("grow sans jeton valide", code)
	}
	for _, body := range []any{map[string]any{"bucket": 16}, map[string]any{"bucket": 160, "x": 1}, nil} {
		if code := post("/api/shares/grow", body, c.UploadToken); code != 400 {
			t.Fatal("grow invalide", body, code)
		}
	}
	if code := post("/api/shares/grow", map[string]any{"bucket": 400}, c.UploadToken); code != 204 {
		t.Fatal("grow", code)
	}
	put(1, 400, 2)
	put(2, 400, 3)
	// Plages de morceaux (audit H-2) : ?from=c, segment 3 partagé ; from invalide → 400.
	putFrom := func(n int, from string, k int, code int) {
		w := e.do(req{method: "PUT", path: fmt.Sprintf("/api/shares/segments/%d?from=%s", n, from),
			body: bytes.Repeat([]byte{4}, k*share.ChunkCT), hdr: auth(c.UploadToken)})
		if w.Code != code {
			t.Fatal("PUT ?from", n, from, k, w.Code)
		}
	}
	putFrom(3, "2", 3, 204)
	putFrom(3, "5", 1, 204)
	putFrom(3, "-1", 1, 400)
	putFrom(3, "01", 1, 400)
	putFrom(3, "63", 2, 400)
	if code := post("/api/shares/erase", map[string]any{"from": 1, "to": 9}, c.UploadToken); code != 400 {
		t.Fatal("erase hors palier", code)
	}
	if code := post("/api/shares/erase", map[string]any{"from": 1, "to": 2}, c.UploadToken); code != 204 {
		t.Fatal("erase", code)
	}
	raw, _ := os.ReadFile(filepath.Join(e.dir, "blobs", c.ID))
	seg1 := raw[48+64*65552 : 48+128*65552]
	if !bytes.Equal(seg1, make([]byte, len(seg1))) {
		t.Fatal("segment effacé encore sur le disque")
	}
	if code := post("/api/shares/keep", nil, c.UploadToken); code != 204 {
		t.Fatal("keep", code)
	}
	fin := k.finBody(1, 1)
	delete(fin, "fill_from")
	delete(fin, "fill_to")
	fin["bucket"] = 400
	fin["header"] = enc.EncodeToString(rnd(48))
	fin["tail"] = enc.EncodeToString(rnd(65552)[:100])
	if code := post("/api/shares/finalize", fin, c.UploadToken); code != 400 {
		t.Fatal("tail trop court", code)
	}
	fin["tail"] = enc.EncodeToString(rnd(65552))
	fin["fill_from"], fin["fill_to"] = 0, 0
	if code := post("/api/shares/finalize", fin, c.UploadToken); code != 400 {
		t.Fatal("bucket et fill_* ensemble", code)
	}
	delete(fin, "fill_from")
	delete(fin, "fill_to")
	fin["void"] = [][2]int{{0, 400}}
	if code := post("/api/shares/finalize", fin, c.UploadToken); code != 400 {
		t.Fatal("void hors palier", code)
	}
	fin["void"] = [][2]int{{3*64 + 5, 3*64 + 6}}
	if code := post("/api/shares/finalize", fin, c.UploadToken); code != 200 {
		t.Fatal("finalize", code)
	}
	if code := post("/api/shares/keep", nil, c.UploadToken); code != 404 {
		t.Fatal("keep après finalize", code)
	}
	dl, segs := e.unlock(t, c.ID, k)
	if segs != 7 {
		t.Fatal("segments", segs)
	}
	w := e.do(req{method: "GET", path: "/api/shares/segments/2", hdr: auth(dl)})
	expect(t, w, 200, "")
	if w.Body.Bytes()[0] != 3 {
		t.Fatal("segment gardé")
	}
	w = e.do(req{method: "GET", path: "/api/shares/segments/3", hdr: auth(dl)})
	expect(t, w, 200, "")
	got := w.Body.Bytes()
	if got[2*share.ChunkCT] != 4 || bytes.Equal(got[5*share.ChunkCT:6*share.ChunkCT], bytes.Repeat([]byte{4}, share.ChunkCT)) {
		t.Fatal("plage gardée ou morceau retiré non remplacé")
	}
}

// D42-6 : un morceau par palier (au dernier segment plein de la réservation) fait grandir le
// brouillon par grow, mais finalize refuse d'écrire tout le palier en aléa pour si peu reçu :
// 409 « incomplete » (le client affiche une erreur d'envoi, pas « partage disparu »).
func TestDraftAmplificationRefused(t *testing.T) {
	e := newEnv(t, false, nil)
	k := newKeys()
	c := e.create(t, "", k, 160, 1)
	bucket := 160
	for _, next := range []int{400, 800, 1600} {
		n := (bucket-1)/64 - 1
		expect(t, e.do(req{method: "PUT", path: fmt.Sprintf("/api/shares/segments/%d?from=0", n),
			body: rnd(share.ChunkCT), hdr: auth(c.UploadToken)}), 204, "")
		expect(t, e.do(req{method: "POST", path: "/api/shares/grow", body: mustJSON(map[string]int{"bucket": next}),
			hdr: auth(c.UploadToken)}), 204, "")
		bucket = next
	}
	fin := k.finBody(1, 1)
	delete(fin, "fill_from")
	delete(fin, "fill_to")
	fin["bucket"] = 1600
	fin["header"] = enc.EncodeToString(rnd(48))
	fin["tail"] = enc.EncodeToString(rnd(65552))
	expect(t, e.do(req{method: "POST", path: "/api/shares/finalize", body: mustJSON(fin), hdr: auth(c.UploadToken)}),
		409, `{"error":"incomplete"}`)
	raw, err := os.ReadFile(filepath.Join(e.dir, "blobs", c.ID))
	if err != nil {
		t.Fatal(err)
	}
	if z := bytes.Count(raw, []byte{0}); z < len(raw)*9/10 {
		t.Fatalf("aléa écrit malgré le refus (%d octets non nuls sur %d)", len(raw)-z, len(raw))
	}
}

// Les octets reçus comptent au quota du jour (spec §41.14) : 429 jusqu'à minuit au-delà.
func TestDraftReceivedBytesQuota(t *testing.T) {
	e := newEnv(t, false, nil)
	c := e.create(t, "", newKeys(), 160, 1)
	seg := share.SegmentSize(160, 1)
	putSeg := func() *httptest.ResponseRecorder {
		return e.do(req{method: "PUT", path: "/api/shares/segments/1", body: make([]byte, seg), hdr: auth(c.UploadToken)})
	}
	expect(t, putSeg(), 204, "")
	// Octets comptés en données utiles (audit F1), morceau du manifeste non compté.
	if _, err := e.srv.lim.Receive(c.ID, 6<<30-2*share.PayloadBytes(int64(seg))+limits.ManifestChunk+1); err != nil {
		t.Fatal(err)
	}
	expect(t, e.do(req{method: "POST", path: "/api/shares/erase", body: mustJSON(map[string]int{"from": 1, "to": 2}), hdr: auth(c.UploadToken)}), 204, "")
	w := putSeg() // effacé : le premier envoi reste compté, le second dépasse
	expect(t, w, 429, "")
	if jsonOf(t, w)["retry_after_s"].(float64) <= 60 {
		t.Fatal("refus de débit, pas de quota")
	}
}

// Audit H1 : grow débite la place au quota du jour (429), et ne dépasse pas les segments
// reçus de plus de deux segments (400).
func TestDraftGrowDebitsQuota(t *testing.T) {
	e := newEnv(t, false, nil)
	c := e.create(t, "", newKeys(), 80, 1)
	grow := func(b int) *httptest.ResponseRecorder {
		return e.do(req{method: "POST", path: "/api/shares/grow", body: mustJSON(map[string]int{"bucket": b}), hdr: auth(c.UploadToken)})
	}
	expect(t, grow(400), 400, "") // aucun segment reçu : 160 au plus
	if _, err := e.srv.lim.BeginUpload(netip.MustParseAddr("203.0.113.7"), "autre", 6<<30-share.ContentBytes(160)+1); err != nil {
		t.Fatal(err)
	}
	w := grow(160)
	expect(t, w, 429, "")
	if jsonOf(t, w)["retry_after_s"].(float64) <= 60 {
		t.Fatal("refus de quota attendu")
	}
	if got, _ := e.svc.UploadBucket(c.ID); got != 80 {
		t.Fatal("réservation agrandie malgré le refus", got)
	}
}

// Revue B3a : des grow refusés (palier non supérieur, ou « busy ») en parallèle d'un grow
// accepté ne ramènent jamais la réservation du quota sous le palier réservé sur le disque.
// Sonde : une création de (6 Gio − palier 160 + 1 octet) doit être refusée par le quota.
func TestGrowQuotaNeverBelowDisk(t *testing.T) {
	e := newEnv(t, false, nil)
	for i := 0; i < 30; i++ {
		ip := fmt.Sprintf("198.51.100.%d", i+1)
		remote := ip + ":1000"
		c := e.create(t, remote, newKeys(), 16, 1)
		grow := func(b int, from string) int {
			return e.do(req{method: "POST", path: "/api/shares/grow", body: mustJSON(map[string]any{"bucket": b}),
				hdr: auth(c.UploadToken), remote: from}).Code
		}
		var wg sync.WaitGroup
		good := 0
		for j := 0; j < 8; j++ {
			wg.Add(1)
			go func() { defer wg.Done(); grow(16, remote) }()
			if j == 3 {
				wg.Add(1)
				go func() {
					defer wg.Done()
					// « busy » : nouvel essai, comme le client ; d'une autre adresse à chaque
					// fois (le quota suit l'envoi, la limite de débit suit l'adresse).
					for k := 0; ; k++ {
						if good = grow(160, fmt.Sprintf("203.0.%d.%d:1000", 100+i, k%250+1)); good != 503 {
							return
						}
						runtime.Gosched()
					}
				}()
			}
		}
		wg.Wait()
		if b, err := e.svc.UploadBucket(c.ID); err != nil || b != 160 || good != 204 {
			t.Fatal("palier", b, err, good)
		}
		probe := limits.BytesPer64 - share.ContentBytes(160) + 1
		if _, err := e.srv.lim.BeginUpload(netip.MustParseAddr(ip), fmt.Sprintf("sonde-%d", i), probe); !errors.Is(err, limits.ErrQuota) {
			t.Fatalf("essai %d : quota sous-débité (palier 160 sur le disque, sonde de %d octets acceptée : %v)", i, probe, err)
		}
	}
}
