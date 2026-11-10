package api

import (
	"bytes"
	"io"
	"net/http/httptest"
	"runtime"
	"testing"

	"github.com/skoow/shhdrop/server/internal/share"
)

// putRaw : PUT d'un segment avec une longueur annoncée choisie (−1 : inconnue, envoi par blocs).
func (e *env) putRaw(tok string, n int, body io.Reader, contentLength int64) *httptest.ResponseRecorder {
	hr := httptest.NewRequest("PUT", "/api/shares/segments/"+string(rune('0'+n)), body)
	hr.ContentLength = contentLength
	hr.RemoteAddr = "203.0.113.7:4444"
	hr.Header.Set("Authorization", "Bearer "+tok)
	w := httptest.NewRecorder()
	e.h.ServeHTTP(w, hr)
	return w
}

// Revue B8 : le corps d'un segment est lu dans un tampon de la taille annoncée
// (Content-Length), sans les copies de croissance d'io.ReadAll ; longueur inconnue : comme
// avant. Un corps plus court que l'annonce reste refusé, et rien n'est écrit.
func TestPutSegmentBodyRead(t *testing.T) {
	e := newEnv(t, false, nil)
	k := newKeys()
	c := e.create(t, "", k, 80, 1)
	seg0 := rnd(share.SegmentSize(80, 0))
	seg1 := rnd(share.SegmentSize(80, 1))

	// Longueur inconnue : accepté, octets identiques sur le disque.
	expect(t, e.putRaw(c.UploadToken, 1, struct{ io.Reader }{bytes.NewReader(seg1)}, -1), 204, "")
	// Corps plus court que l'annonce : 400.
	expect(t, e.putRaw(c.UploadToken, 0, bytes.NewReader(seg0[:1000]), int64(len(seg0))), 400, badRequest)
	// Annonce au-delà du plus grand segment : 400 avant toute lecture.
	expect(t, e.putRaw(c.UploadToken, 0, bytes.NewReader(nil), maxSegmentLen+1), 400, badRequest)

	hr := httptest.NewRequest("PUT", "/api/shares/segments/0", bytes.NewReader(seg0))
	hr.RemoteAddr = "203.0.113.7:4444"
	hr.Header.Set("Authorization", "Bearer "+c.UploadToken)
	w := httptest.NewRecorder()
	var before, after runtime.MemStats
	runtime.ReadMemStats(&before)
	e.h.ServeHTTP(w, hr)
	runtime.ReadMemStats(&after)
	expect(t, w, 204, "")
	// Un seul tampon de la taille du segment (4,2 Mio), plus les à-côtés de la requête.
	if got, limit := after.TotalAlloc-before.TotalAlloc, uint64(len(seg0))*3/2; got > limit {
		t.Fatalf("PUT d'un segment de %d octets : %d octets alloués (> %d)", len(seg0), got, limit)
	}

	expect(t, e.do(req{method: "POST", path: "/api/shares/finalize", hdr: auth(c.UploadToken),
		body: mustJSON(k.finBody(1, 1))}), 200, "")
	tok, _ := e.unlock(t, c.ID, k)
	for n, want := range [][]byte{seg0, seg1} {
		got := e.do(req{method: "GET", path: "/api/shares/segments/" + string(rune('0'+n)), hdr: auth(tok)})
		if got.Code != 200 || !bytes.Equal(got.Body.Bytes(), want) {
			t.Fatal("segment", n, got.Code)
		}
	}
}
