package main

import (
	"crypto/rand"
	"crypto/sha256"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/skoow/shhdrop/server/internal/share"
)

// Revue B5 : « wipe --yes » annonçait tout effacé alors qu'un téléchargement commencé sur un
// partage déjà retiré (descripteur détaché, jusqu'à 2 h de grâce) continuait d'être servi par
// le serveur en marche. La commande demande au serveur de tout couper et dit ce qu'il en est.
func TestAdminWipeCutsDetachedReads(t *testing.T) {
	cfg, s := adminSetup(t)
	r := func(n int) []byte { b := make([]byte, n); rand.Read(b); return b }
	sum := func(b []byte) []byte { h := sha256.Sum256(b); return h[:] }
	ka, kp, sg := r(32), r(32), r(32)
	id, segs, err := s.Create(share.CreateReq{ID: share.NewID(), Bucket: 80, AccessV: sum(ka), ManageV: sum(sg)})
	if err != nil {
		t.Fatal(err)
	}
	for n := 0; n < segs; n++ {
		if err := s.PutSegment(id, n, r(share.SegmentSize(80, n))); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := s.Finalize(id, share.FinalizeReq{TTLHours: 1, MaxOpens: 2, KdfOps: 3, KdfMem: 64 << 20,
		Salt: r(16), ProofV: sum(kp), Envelope: r(share.EnvelopeLen)}); err != nil {
		t.Fatal(err)
	}
	open, _, err := s.Unlock(id, ka, kp)
	if err != nil {
		t.Fatal(err)
	}
	seg, err := s.OpenSegment(id, 0, open)
	if err != nil {
		t.Fatal(err)
	}
	defer seg.Close()
	// L'expéditeur supprime : l'ouverture active garde le droit de finir (descripteur détaché).
	if err := s.DestroyManaged(sg); err != nil {
		t.Fatal(err)
	}
	if again, err := s.OpenSegment(id, 1, open); err != nil {
		t.Fatal("grâce attendue", err)
	} else {
		again.Close()
	}

	// Serveur arrêté (personne ne répond) : la sortie le dit sans détour.
	code, out, e := run(cfg, "wipe", "--yes")
	if code != 0 || !strings.Contains(out, "redémarrer") || strings.Contains(out, "coupées") {
		t.Fatalf("wipe sans serveur : %d %q %q", code, out, e)
	}

	// Serveur en marche (janitor.Watch) : tout est coupé, et la sortie le confirme.
	stop, done := make(chan struct{}), make(chan struct{})
	go func() {
		defer close(done)
		for {
			select {
			case <-stop:
				return
			case <-time.After(20 * time.Millisecond):
				s.PollRemoved()
			}
		}
	}()
	defer func() { close(stop); <-done }()
	code, out, e = run(cfg, "wipe", "--yes")
	if code != 0 || !strings.Contains(out, "lectures en cours coupées") || strings.Contains(out, "redémarrer") {
		t.Fatalf("wipe avec serveur : %d %q %q", code, out, e)
	}
	if _, err := s.OpenSegment(id, 1, open); !errors.Is(err, share.ErrGone) {
		t.Fatal("partage détaché encore servi après wipe :", err)
	}
}
