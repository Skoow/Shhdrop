package api

// Audit de sécurité du 13 novembre, D1 (tests offensifs rapatriés de l'audit, inversés) : un
// jeton d'envoi reste signé 6 h après finalize ; putSegment prenait une place et lisait tout le
// corps AVANT de vérifier l'état du partage, et limits.Receive ignorait un envoi inconnu.
// Seize jetons « morts » de 8 adresses prenaient les 64 places d'envoi du serveur, et un seul
// lisait 6,64 Gio sans jamais toucher au quota du jour.

import (
	"fmt"
	"io"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/skoow/shhdrop/server/internal/share"
)

// corpsSansFin : corps qui ne finit jamais (un octet toutes les 10 ms) ; lus compte les
// octets que le serveur en a tirés.
type corpsSansFin struct {
	stop chan struct{}
	lus  *atomic.Int64
}

func (c corpsSansFin) Read(b []byte) (int, error) {
	select {
	case <-c.stop:
		return 0, io.EOF
	case <-time.After(10 * time.Millisecond):
		if c.lus != nil {
			c.lus.Add(1)
		}
		b[0] = 0
		return 1, nil
	}
}

func TestJetonFinaliseNePrendAucunePlace(t *testing.T) {
	e := newEnv(t, false, nil)
	// 8 adresses IPv4 × 2 partages finalisés (1 segment chacun) = 16 jetons « morts ».
	var toks []string
	for a := 1; a <= 8; a++ {
		ip := fmt.Sprintf("198.51.100.%d:1", a)
		for range 2 {
			c := e.create(t, ip, newKeys(), 1, 1)
			c.opens = 1
			e.upload(t, c, 1)
			toks = append(toks, c.UploadToken)
		}
	}
	stop := make(chan struct{})
	defer close(stop)
	var lus atomic.Int64
	done := make(chan int, 64)
	for i, tok := range toks {
		ip := fmt.Sprintf("198.51.100.%d:1", i/2+1)
		for range 4 {
			go func() {
				r := httptest.NewRequest("PUT", "/api/shares/segments/0", corpsSansFin{stop, &lus})
				r.ContentLength = int64(maxSegmentLen)
				r.RemoteAddr = ip
				r.Header.Set("Authorization", "Bearer "+tok)
				w := httptest.NewRecorder()
				e.h.ServeHTTP(w, r)
				done <- w.Code
			}()
		}
	}
	// Chaque PUT d'un envoi fini répond tout de suite, sans place ni lecture du corps.
	for range 64 {
		select {
		case code := <-done:
			if code != 404 {
				t.Fatalf("PUT d'un jeton finalisé : %d, attendu 404", code)
			}
		case <-time.After(5 * time.Second):
			t.Fatalf("PUT d'un jeton finalisé encore en cours après 5 s (places prises : %d)", e.srv.xfer.ul.Len())
		}
	}
	if n := lus.Load(); n != 0 {
		t.Fatalf("%d octets lus pour des envois finalisés", n)
	}
	victime := "192.0.2.50:1"
	c := e.create(t, victime, newKeys(), 1, 1)
	w := e.do(req{method: "PUT", path: "/api/shares/segments/0", body: rnd(share.SegmentSize(1, 0)),
		hdr: auth(c.UploadToken), remote: victime})
	expect(t, w, 204, "")
}

func TestOctetsApresFinalizeRefuses(t *testing.T) {
	e := newEnv(t, false, nil)
	ip := "198.51.100.77:1"
	c := e.create(t, ip, newKeys(), 1, 1)
	c.opens = 1
	e.upload(t, c, 1)
	w := e.do(req{method: "PUT", path: "/api/shares/segments/0", body: rnd(maxSegmentLen), hdr: auth(c.UploadToken), remote: ip})
	expect(t, w, 404, notFound)
	if w.Header().Get("Connection") != "close" {
		t.Fatal("PUT refusé sans lire le corps : Connection: close attendu, reçu", w.Header().Get("Connection"))
	}
}

// Pièce du salon finalisée : même refus, avant toute place et toute lecture.
func TestPieceFinaliseeNePrendAucunePlace(t *testing.T) {
	e, _ := salonEnv(t)
	j := salonMembres(t, e, 2)
	// Un vocal suit le même chemin (PieceEnvoi) ; sa création exige une présence en ligne
	// (TestQuotasPieces) : seul le fichier est essayé ici.
	for _, vocal := range []bool{false} {
		id, tok := e.pieceCreee(t, j[0], 1, vocal)
		expect(t, e.putPiece(tok, 0, rnd(share.SegmentSize(1, 0))), 204, "")
		expect(t, e.finaliserPiece(tok, 0, 0), 200, `{}`)
		_ = id
		stop := make(chan struct{})
		var lus atomic.Int64
		r := httptest.NewRequest("PUT", "/api/salons/pieces/segments/0", corpsSansFin{stop, &lus})
		r.ContentLength = int64(maxSegmentLen)
		r.RemoteAddr = "192.0.2.1:1"
		r.Header.Set("Authorization", "Bearer "+tok)
		w := httptest.NewRecorder()
		fin := make(chan struct{})
		go func() { e.h.ServeHTTP(w, r); close(fin) }()
		select {
		case <-fin:
		case <-time.After(3 * time.Second):
			close(stop)
			<-fin
			t.Fatalf("vocal=%v : PUT d'une pièce finalisée encore en cours après 3 s", vocal)
		}
		close(stop)
		expect(t, w, 404, notFound)
		if lus.Load() != 0 || e.srv.xfer.ul.Len() != 0 {
			t.Fatalf("vocal=%v : %d octets lus, %d places", vocal, lus.Load(), e.srv.xfer.ul.Len())
		}
	}
}
