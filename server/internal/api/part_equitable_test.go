package api

// Audit de sécurité du 13 novembre, D2 : les plafonds globaux étaient communs à tous ; 8
// adresses IPv4, avec 2 envois vivants chacune et 4 PUT lents par envoi, prenaient les 64
// places d'envoi du serveur. Part équitable (limits.NewFairSlots) : une adresse ou un /48 prend
// au plus 1/8 des places, et le dernier quart va aux nouveaux venus.

import (
	"fmt"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/skoow/shhdrop/server/internal/share"
)

func TestHuitAdressesNePriventPlusLesAutres(t *testing.T) {
	e := newEnv(t, false, nil)
	stop := make(chan struct{})
	defer close(stop)
	for a := 1; a <= 8; a++ {
		ip := fmt.Sprintf("198.51.100.%d:1", a)
		for range 2 { // PendingPer64 : 2 envois non finalisés
			c := e.create(t, ip, newKeys(), 1, 1)
			for range 4 { // ulPerUpload
				go func() {
					r := httptest.NewRequest("PUT", "/api/shares/segments/0", corpsSansFin{stop: stop})
					r.ContentLength = int64(share.SegmentSize(1, 0))
					r.RemoteAddr = ip
					r.Header.Set("Authorization", "Bearer "+c.UploadToken)
					e.h.ServeHTTP(httptest.NewRecorder(), r)
				}()
			}
		}
	}
	// 6 adresses × 8 places (part partagée, 48), puis 1 place de réserve pour chacune des
	// deux dernières : 50 places, jamais 64.
	deadline := time.Now().Add(5 * time.Second)
	for e.srv.xfer.ul.Len() < 50 && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	time.Sleep(100 * time.Millisecond)
	if n := e.srv.xfer.ul.Len(); n != 50 {
		t.Fatalf("places prises par 8 adresses : %d, attendu 50", n)
	}
	victime := "192.0.2.50:1"
	c := e.create(t, victime, newKeys(), 1, 1)
	w := e.do(req{method: "PUT", path: "/api/shares/segments/0", body: rnd(share.SegmentSize(1, 0)),
		hdr: auth(c.UploadToken), remote: victime})
	expect(t, w, 204, "")
}
