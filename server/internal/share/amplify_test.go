package share

import (
	"errors"
	"io"
	"testing"
)

// D42-6 (revue complète du 10 novembre) : un brouillon ne fait jamais écrire au serveur
// beaucoup plus d'aléa qu'il n'a reçu d'octets. Avant : un morceau par palier, envoyé au
// dernier segment plein de la réservation, suffisait à faire grandir le brouillon jusqu'à
// 2 Gio (Grow), puis finalize écrivait tout le palier en aléa pour quelques morceaux reçus.

// countFills compte les octets d'aléa écrits par Finalize (bourrage).
func countFills(t *testing.T) *int64 {
	t.Helper()
	var n int64
	orig := fillWrite
	fillWrite = func(w io.WriterAt, off int64, b []byte) error {
		n += int64(len(b))
		return orig(w, off, b)
	}
	t.Cleanup(func() { fillWrite = orig })
	return &n
}

// nextBucket : plus petit palier qui contient used segments pleins et le morceau du
// manifeste (reservationFor du client, web/src/crypto/elements.ts).
func nextBucket(used int) int {
	for _, b := range Buckets {
		if b >= used*SegChunks+1 {
			return b
		}
	}
	return 0
}

// sendLike envoie les morceaux [from, from+k) du segment n comme le client
// (web/src/transfer/draft.ts) : Grow avant tout segment au-delà de la réservation.
func sendLike(t *testing.T, s *Service, id string, bucket *int, n, from, k int) {
	t.Helper()
	if (n+1)*SegChunks+1 > *bucket {
		b := nextBucket(n + 1)
		if err := s.Grow(id, b); err != nil {
			t.Fatalf("Grow(%d) avant le segment %d : %v", b, n, err)
		}
		*bucket = b
	}
	var err error
	if from == 0 && k == SegChunks {
		err = s.PutSegment(id, n, segBody(*bucket, n, byte(n+1)))
	} else {
		err = s.PutChunks(id, n, from, chunkBody(n, from, k, byte(n+1)))
	}
	if err != nil {
		t.Fatalf("segment %d [%d, %d) : %v", n, from, from+k, err)
	}
}

// climb fait grandir le brouillon palier par palier avec un seul morceau par palier, au
// dernier segment plein de la réservation (l'attaque de D42-6), jusqu'à atteindre to.
func climb(t *testing.T, s *Service, id string, bucket *int, to int) {
	t.Helper()
	for *bucket < to {
		n := (*bucket-1)/SegChunks - 1
		if err := s.PutChunks(id, n, 0, chunkBody(n, 0, 1, 9)); err != nil {
			t.Fatal(n, err)
		}
		b := nextBucket(n + 1 + growMargin)
		if err := s.Grow(id, b); err != nil {
			t.Fatalf("Grow(%d) : %v", b, err)
		}
		*bucket = b
	}
}

func TestCreateTierCapped(t *testing.T) {
	s, _ := newSvc(t)
	for _, b := range []int{800, 1600, 32769} {
		r := newKeys().req(b, 1, 1)
		if err := Validate(r); !errors.Is(err, ErrBadRequest) {
			t.Errorf("Validate(palier %d) = %v, attendu %v", b, err, ErrBadRequest)
		}
		if _, _, err := s.Create(r); !errors.Is(err, ErrBadRequest) {
			t.Errorf("Create(palier %d) = %v, attendu %v", b, err, ErrBadRequest)
		}
	}
	// Jusqu'à 6 segments pleins et le morceau du manifeste (CREATE_SEGMENTS du client) : 400.
	for _, b := range []int{1, 16, 80, 160, 400} {
		if _, _, err := s.Create(newKeys().req(b, 1, 1)); err != nil {
			t.Errorf("Create(palier %d) : %v", b, err)
		}
	}
}

func TestFinalizePaddingBoundedByReceived(t *testing.T) {
	t.Run("brouillon : un morceau par palier, puis finalize au plus grand", func(t *testing.T) {
		s, _ := newSvc(t)
		n := countFills(t)
		id, _, err := s.Create(newKeys().req(160, 1, 1))
		if err != nil {
			t.Fatal(err)
		}
		bucket := 160
		climb(t, s, id, &bucket, 1600) // 3 morceaux reçus (segments 1, 5 et 11)
		if _, err := s.Finalize(id, draftFin(id, 1600)); !errors.Is(err, ErrIncomplete) {
			t.Errorf("Finalize = %v, attendu %v", err, ErrIncomplete)
		}
		if *n != 0 || stateOf(t, s, id) != "uploading" {
			t.Fatalf("aléa écrit : %d octets pour 3 morceaux reçus (état %s)", *n, stateOf(t, s, id))
		}
	})
	t.Run("ancien finalize (fill_from, fill_to) : même borne", func(t *testing.T) {
		s, _ := newSvc(t)
		n := countFills(t)
		id, _, err := s.Create(newKeys().req(160, 1, 1))
		if err != nil {
			t.Fatal(err)
		}
		if err := s.PutSegment(id, 0, segBody(160, 0, 1)); err != nil {
			t.Fatal(err)
		}
		bucket := 160
		climb(t, s, id, &bucket, 1600)
		if err := s.PutSegment(id, 24, segBody(1600, 24, 2)); err != nil { // dernier segment
			t.Fatal(err)
		}
		r := fin(id)
		r.FillFrom, r.FillTo = 1, 24 // 1 472 morceaux d'aléa pour 131 reçus
		if _, err := s.Finalize(id, r); !errors.Is(err, ErrIncomplete) {
			t.Errorf("Finalize = %v, attendu %v", err, ErrIncomplete)
		}
		if *n != 0 || stateOf(t, s, id) != "uploading" {
			t.Fatalf("aléa écrit : %d octets (état %s)", *n, stateOf(t, s, id))
		}
	})
}

// Pire disposition d'un vrai client (preuve du facteur 4 de padFactor) : des éléments de
// 4 Mio + 1 octet (un segment plein et un morceau, le reste de leur dernier segment jamais
// envoyé), juste au-delà du palier 1 600 : 845 morceaux reçus, 3 154 morceaux d'aléa au
// palier 4 000. Accepté.
func TestFinalizeWorstLegitLayoutAccepted(t *testing.T) {
	s, _ := newSvc(t)
	id, _, err := s.Create(newKeys().req(160, 1, 1))
	if err != nil {
		t.Fatal(err)
	}
	bucket := 160
	for i := 0; i < 13; i++ {
		sendLike(t, s, id, &bucket, 2*i, 0, SegChunks)
		sendLike(t, s, id, &bucket, 2*i+1, 0, 1)
	}
	if _, err := s.Finalize(id, draftFin(id, 4000)); err != nil {
		t.Fatal(err)
	}
}

// Éléments retirés : leurs octets reçus comptent (effacés ou remplacés par void), même s'ils
// ne sont plus là au moment de finalize.
func TestFinalizeCountsRemovedElements(t *testing.T) {
	s, _ := newSvc(t)
	id, _, err := s.Create(newKeys().req(160, 1, 1))
	if err != nil {
		t.Fatal(err)
	}
	bucket := 160
	sendLike(t, s, id, &bucket, 0, 0, SegChunks) // A : segment 0
	sendLike(t, s, id, &bucket, 1, 0, 1)         //     et un morceau du segment 1
	for n := 2; n < 25; n++ {                    // B : 23 segments, retiré
		sendLike(t, s, id, &bucket, n, 0, SegChunks)
	}
	sendLike(t, s, id, &bucket, 25, 0, 1) // C : petit élément gardé
	sendLike(t, s, id, &bucket, 25, 1, 3) // D : petit élément retiré (void)
	if err := s.Erase(id, 2, 25); err != nil {
		t.Fatal(err)
	}
	r := draftFin(id, 4000)
	r.Void = [][2]int{{25*SegChunks + 1, 25*SegChunks + 4}}
	if _, err := s.Finalize(id, r); err != nil {
		t.Fatal(err)
	}
}

// Plus grand palier envoyé en entier, comme le client : création à 160, Grow au fil de
// l'envoi, finalize à 32 769 sans autre aléa que le morceau du manifeste.
func TestFinalizeLargestBucketSentFully(t *testing.T) {
	if testing.Short() {
		t.Skip("écrit 2 Gio sur le disque")
	}
	s, _ := newSvc(t)
	id, _, err := s.Create(newKeys().req(160, 1, 1))
	if err != nil {
		t.Fatal(err)
	}
	bucket := 160
	body := segBody(32769, 1, 3) // segments pleins (hors segment 0) : même taille à tout palier
	for n := 0; n < 512; n++ {
		if (n+1)*SegChunks+1 > bucket {
			b := nextBucket(n + 1)
			if err := s.Grow(id, b); err != nil {
				t.Fatalf("Grow(%d) : %v", b, err)
			}
			bucket = b
		}
		seg := body
		if n == 0 {
			seg = segBody(bucket, 0, 3)
		}
		if err := s.PutSegment(id, n, seg); err != nil {
			t.Fatal(n, err)
		}
	}
	if bucket != 32769 {
		t.Fatal("réservation", bucket)
	}
	if _, err := s.Finalize(id, draftFin(id, 32769)); err != nil {
		t.Fatal(err)
	}
}

// createAny : Create sans le plafond du palier de création (tests de grands paliers qui ne
// portent pas sur l'envoi par Grow).
func (s *Service) createAny(r CreateReq) (string, int, error) { return s.create(r, validCreate) }
