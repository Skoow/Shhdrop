package share

import (
	"errors"
	"io"
	"reflect"
	"testing"
)

// Revue B3a : le débit du quota d'un agrandissement se fait dans Grow, sous la réservation
// de l'envoi (claimFinalize), avec l'ancien palier lu au même moment : jamais rendu à partir
// d'un palier lu plus tôt, jamais débité pour une demande refusée d'avance.
func TestGrowChargedChargesUnderClaim(t *testing.T) {
	newDraft := func(t *testing.T) (*Service, string) {
		s, _ := newSvc(t)
		id, _, err := s.createAny(newKeys().req(80, 1, 1))
		if err != nil {
			t.Fatal(err)
		}
		return s, id
	}
	bucketOf := func(t *testing.T, s *Service, id string) int {
		b, err := s.UploadBucket(id)
		if err != nil {
			t.Fatal(err)
		}
		return b
	}
	t.Run("accepté : un seul débit, au nouveau palier", func(t *testing.T) {
		s, id := newDraft(t)
		var calls []int
		err := s.GrowCharged(id, 160, func(b int) error { calls = append(calls, b); return nil })
		if err != nil || !reflect.DeepEqual(calls, []int{160}) || bucketOf(t, s, id) != 160 {
			t.Fatal(err, calls)
		}
	})
	t.Run("demande refusée d'avance : aucun débit", func(t *testing.T) {
		s, id := newDraft(t)
		for _, b := range []int{16, 80, 81, 400, 32769} { // plus petit, égal, hors paliers, au-delà de la marge
			calls := 0
			if err := s.GrowCharged(id, b, func(int) error { calls++; return nil }); !errors.Is(err, ErrBadRequest) || calls != 0 {
				t.Fatal(b, err, calls)
			}
		}
	})
	t.Run("quota refusé : rien ne change", func(t *testing.T) {
		s, id := newDraft(t)
		quota := errors.New("quota")
		if err := s.GrowCharged(id, 160, func(int) error { return quota }); !errors.Is(err, quota) {
			t.Fatal(err)
		}
		if bucketOf(t, s, id) != 80 || int64(len(fileBytes(t, s, id))) != totalSize(80) {
			t.Fatal("agrandi malgré le refus du quota")
		}
	})
	t.Run("échec après le débit : rendu à l'ancien palier", func(t *testing.T) {
		s, id := newDraft(t)
		s.StorageMax = totalSize(80) + 10
		var calls []int
		err := s.GrowCharged(id, 160, func(b int) error { calls = append(calls, b); return nil })
		if !errors.Is(err, ErrFull) || !reflect.DeepEqual(calls, []int{160, 80}) {
			t.Fatal(err, calls)
		}
	})
	t.Run("un autre agrandissement pendant le débit : ErrBusy, sans débit", func(t *testing.T) {
		s, id := newDraft(t)
		in, out := make(chan struct{}), make(chan struct{})
		done := make(chan error, 1)
		go func() {
			done <- s.GrowCharged(id, 160, func(int) error { close(in); <-out; return nil })
		}()
		<-in
		calls := 0
		for _, b := range []int{16, 160, 400} {
			if err := s.GrowCharged(id, b, func(int) error { calls++; return nil }); !errors.Is(err, ErrBusy) {
				t.Fatal(b, err)
			}
		}
		close(out)
		if err := <-done; err != nil || calls != 0 || bucketOf(t, s, id) != 160 {
			t.Fatal(err, calls)
		}
	})
}

// Revue M1 (reste) : un brouillon réservé d'emblée à un grand palier ne peut pas être finalisé
// à ce palier sans y avoir rien envoyé (le serveur écrirait jusqu'à 2 Gio d'aléa pour rien) :
// le palier final ne dépasse pas ce que les segments reçus justifient, avec la même marge que
// Grow (growLimit), et l'aléa ne dépasse pas padAllowed des morceaux reçus (D42-6). Le vrai
// client finalise au plus petit palier qui contient son dernier morceau envoyé, toujours sous
// ces bornes (amplify_test.go).
func TestFinalizeDraftBoundedByReceivedSegments(t *testing.T) {
	fills := func(t *testing.T) *int64 {
		var n int64
		orig := fillWrite
		fillWrite = func(w io.WriterAt, off int64, b []byte) error {
			n += int64(len(b))
			return orig(w, off, b)
		}
		t.Cleanup(func() { fillWrite = orig })
		return &n
	}
	t.Run("rien reçu : grand palier refusé, sans rien écrire", func(t *testing.T) {
		s, _ := newSvc(t)
		n := fills(t)
		id, _, err := s.createAny(newKeys().req(4000, 1, 1))
		if err != nil {
			t.Fatal(err)
		}
		for _, b := range []int{4000, 1600, 800, 400} {
			if _, err := s.Finalize(id, draftFin(id, b)); !errors.Is(err, ErrBadRequest) {
				t.Fatal(b, err)
			}
		}
		if *n != 0 || stateOf(t, s, id) != "uploading" {
			t.Fatal("aléa écrit pour une finalisation refusée :", *n)
		}
		// Sous la marge (2 segments au-delà du dernier reçu, ici aucun) : accepté.
		if _, err := s.Finalize(id, draftFin(id, 160)); err != nil {
			t.Fatal(err)
		}
	})
	t.Run("dernier morceau reçu seul : aléa borné par les morceaux reçus (D42-6)", func(t *testing.T) {
		s, _ := newSvc(t)
		n := fills(t)
		id, _, err := s.createAny(newKeys().req(4000, 1, 1))
		if err != nil {
			t.Fatal(err)
		}
		// Un petit élément au segment 20 (morceaux 1280 à 1282) : palier 1600 sous la marge de
		// Grow, mais 1 596 morceaux d'aléa pour 3 reçus.
		if err := s.PutChunks(id, 20, 0, chunkBody(20, 0, 3, 7)); err != nil {
			t.Fatal(err)
		}
		if _, err := s.Finalize(id, draftFin(id, 4000)); !errors.Is(err, ErrBadRequest) {
			t.Fatal("au-delà de la marge", err)
		}
		if _, err := s.Finalize(id, draftFin(id, 1600)); !errors.Is(err, ErrIncomplete) {
			t.Fatal("aléa au-delà de la borne", err)
		}
		if *n != 0 || stateOf(t, s, id) != "uploading" {
			t.Fatal("aléa écrit pour une finalisation refusée :", *n)
		}
	})
}
