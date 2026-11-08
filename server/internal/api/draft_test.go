package api

import (
	"bytes"
	"fmt"
	"net/http/httptest"
	"net/netip"
	"os"
	"path/filepath"
	"testing"

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
	if _, err := e.srv.lim.Receive(c.ID, 6<<30-2*int64(seg)+1); err != nil {
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
