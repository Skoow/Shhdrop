package share

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"
)

// Envoi dès l'ajout (spec §41.14, D41-19) : agrandissement de la réservation, effacement des
// segments d'un élément retiré, signe de vie, finalisation qui ramène au palier final.

func fileBytes(t *testing.T, s *Service, id string) []byte {
	t.Helper()
	b, err := os.ReadFile(filepath.Join(s.Blobs.Dir, id))
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func draftFin(id string, bucket int) FinalizeReq {
	r := fin(id)
	r.Bucket = bucket
	r.Header = bytes.Repeat([]byte{0xAB}, Header)
	r.Tail = bytes.Repeat([]byte{0xCD}, ChunkCT)
	return r
}

func TestGrowExtendsReservationAndKeepsSegments(t *testing.T) {
	s, _ := newSvc(t)
	id, _, err := s.Create(newKeys().req(80, 1, 1))
	if err != nil {
		t.Fatal(err)
	}
	if err := s.PutSegment(id, 0, segBody(80, 0, 7)); err != nil {
		t.Fatal(err)
	}
	for _, b := range []int{80, 16, 81, 0} {
		if err := s.Grow(id, b); !errors.Is(err, ErrBadRequest) {
			t.Fatalf("Grow(%d) : %v", b, err)
		}
	}
	if err := s.Grow(id, 160); err != nil {
		t.Fatal(err)
	}
	if got := int64(len(fileBytes(t, s, id))); got != totalSize(160) {
		t.Fatal("taille", got)
	}
	var bucket int
	var mask []byte
	if err := s.DB.QueryRow(`SELECT bucket, segments_mask FROM shares WHERE id=?`, id).Scan(&bucket, &mask); err != nil {
		t.Fatal(err)
	}
	if bucket != 160 || len(mask) != 1 || mask[0] != 1 {
		t.Fatal("palier ou masque", bucket, mask)
	}
	// Le segment 1 est désormais plein (64 morceaux) : accepté au nouveau palier.
	if err := s.PutSegment(id, 1, segBody(160, 1, 8)); err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(fileBytes(t, s, id)[:SegmentSize(160, 0)], segBody(160, 0, 7)) {
		t.Fatal("segment 0 perdu par l'agrandissement")
	}
}

func TestGrowRefusedWhenStorageFull(t *testing.T) {
	s, _ := newSvc(t)
	id, _, err := s.Create(newKeys().req(80, 1, 1))
	if err != nil {
		t.Fatal(err)
	}
	s.StorageMax = totalSize(80) + 10
	if err := s.Grow(id, 160); !errors.Is(err, ErrFull) {
		t.Fatal(err)
	}
	if got := int64(len(fileBytes(t, s, id))); got != totalSize(80) {
		t.Fatal("réservation changée malgré le refus", got)
	}
}

func TestEraseWipesSegmentsOnDisk(t *testing.T) {
	s, _ := newSvc(t)
	id, _, err := s.Create(newKeys().req(400, 1, 1)) // 7 segments
	if err != nil {
		t.Fatal(err)
	}
	for n := 0; n < 4; n++ {
		if err := s.PutSegment(id, n, segBody(400, n, byte(n+1))); err != nil {
			t.Fatal(err)
		}
	}
	if err := s.Erase(id, 1, 3); err != nil {
		t.Fatal(err)
	}
	b := fileBytes(t, s, id)
	lo, hi := segOffset(400, 1), segOffset(400, 3)
	if !bytes.Equal(b[lo:hi], make([]byte, hi-lo)) {
		t.Fatal("segments effacés encore lisibles sur le disque")
	}
	if !bytes.Equal(b[:SegmentSize(400, 0)], segBody(400, 0, 1)) || b[hi] != 4 {
		t.Fatal("voisins touchés par l'effacement")
	}
	var mask []byte
	if err := s.DB.QueryRow(`SELECT segments_mask FROM shares WHERE id=?`, id).Scan(&mask); err != nil {
		t.Fatal(err)
	}
	if mask[0] != 0b1001 {
		t.Fatalf("masque %08b", mask[0])
	}
	// La place est réutilisable : un nouvel élément y est envoyé.
	if err := s.PutSegment(id, 1, segBody(400, 1, 9)); err != nil {
		t.Fatal(err)
	}
	for _, r := range [][2]int{{-1, 1}, {2, 2}, {3, 2}, {0, 8}} {
		if err := s.Erase(id, r[0], r[1]); !errors.Is(err, ErrBadRequest) {
			t.Fatal(r, err)
		}
	}
}

func TestEraseAfterFinalizeIsNotFound(t *testing.T) {
	s, _ := newSvc(t)
	id := ready(t, s, newKeys(), 80, 1, 1)
	if err := s.Erase(id, 0, 1); !errors.Is(err, ErrNotFound) {
		t.Fatal(err)
	}
	if err := s.Grow(id, 160); !errors.Is(err, ErrNotFound) {
		t.Fatal(err)
	}
	if err := s.Keep(id); !errors.Is(err, ErrNotFound) {
		t.Fatal(err)
	}
}

func TestEraseRefusedDuringFinalize(t *testing.T) {
	s, _ := newSvc(t)
	id, _, err := s.Create(newKeys().req(80, 1, 1))
	if err != nil {
		t.Fatal(err)
	}
	if !s.claimFinalize(id) {
		t.Fatal("claim")
	}
	defer s.releaseFinalize(id)
	if err := s.Erase(id, 0, 1); !errors.Is(err, ErrBusy) {
		t.Fatal(err)
	}
	if err := s.Grow(id, 160); !errors.Is(err, ErrBusy) {
		t.Fatal(err)
	}
}

func TestKeepPreventsStallSweep(t *testing.T) {
	s, c := newSvc(t)
	id, _, err := s.Create(newKeys().req(80, 1, 1))
	if err != nil {
		t.Fatal(err)
	}
	if err := s.PutSegment(id, 0, segBody(80, 0, 1)); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 4; i++ { // 40 min de composition, un signe de vie toutes les 10 min
		c.Add(10 * time.Minute)
		if err := s.Keep(id); err != nil {
			t.Fatal(err)
		}
		if _, err := s.Sweep(); err != nil {
			t.Fatal(err)
		}
	}
	if rowCount(t, s, id) != 1 {
		t.Fatal("brouillon vivant effacé")
	}
	c.Add(16 * time.Minute)
	if _, err := s.Sweep(); err != nil {
		t.Fatal(err)
	}
	gone(t, s, id)
}

func TestFinalizeDraftShrinksFillsAndWritesHeaderAndTail(t *testing.T) {
	s, _ := newSvc(t)
	id, _, err := s.Create(newKeys().req(160, 1, 1)) // réservation : 3 segments
	if err != nil {
		t.Fatal(err)
	}
	// Un élément de 72 morceaux, envoyé en segments pleins 0 et 1 ; segment 2 jamais envoyé.
	if err := s.PutSegment(id, 0, segBody(160, 0, 1)); err != nil {
		t.Fatal(err)
	}
	if err := s.PutSegment(id, 1, segBody(160, 1, 2)); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Finalize(id, draftFin(id, 400)); !errors.Is(err, ErrBadRequest) {
		t.Fatal("palier final au-delà de la réservation", err)
	}
	bad := draftFin(id, 80)
	bad.Tail = bad.Tail[:10]
	if _, err := s.Finalize(id, bad); !errors.Is(err, ErrBadRequest) {
		t.Fatal(err)
	}
	if _, err := s.Finalize(id, draftFin(id, 80)); err != nil {
		t.Fatal(err)
	}
	b := fileBytes(t, s, id)
	if int64(len(b)) != totalSize(80) {
		t.Fatal("taille finale", len(b))
	}
	if !bytes.Equal(b[:Header], bytes.Repeat([]byte{0xAB}, Header)) {
		t.Fatal("en-tête")
	}
	tail := int64(Header) + 79*ChunkCT
	if !bytes.Equal(b[tail:], bytes.Repeat([]byte{0xCD}, ChunkCT)) {
		t.Fatal("manifeste")
	}
	if b[Header] != 1 || b[segOffset(80, 1)-1] != 1 {
		t.Fatal("données du segment 0")
	}
	if b[segOffset(80, 1)] != 2 {
		t.Fatal("données du segment 1 gardées")
	}
	var bucket int
	var mask []byte
	var state string
	if err := s.DB.QueryRow(`SELECT state, bucket, segments_mask FROM shares WHERE id=?`, id).Scan(&state, &bucket, &mask); err != nil {
		t.Fatal(err)
	}
	if state != "ready" || bucket != 80 || !bytes.Equal(mask, fullMask(2)) {
		t.Fatal(state, bucket, mask)
	}
}

func TestFinalizeDraftFillsHolesWithRandom(t *testing.T) {
	s, _ := newSvc(t)
	id, _, err := s.Create(newKeys().req(400, 1, 1))
	if err != nil {
		t.Fatal(err)
	}
	for n := 0; n < 3; n++ {
		if err := s.PutSegment(id, n, segBody(400, n, 5)); err != nil {
			t.Fatal(err)
		}
	}
	if err := s.Erase(id, 1, 2); err != nil { // élément retiré au milieu
		t.Fatal(err)
	}
	if _, err := s.Finalize(id, draftFin(id, 400)); err != nil {
		t.Fatal(err)
	}
	b := fileBytes(t, s, id)
	hole := b[segOffset(400, 1):segOffset(400, 2)]
	if bytes.Count(hole, []byte{0}) > len(hole)/100 {
		t.Fatal("trou non rempli d'aléa")
	}
	if b[segOffset(400, 2)] != 5 {
		t.Fatal("segment gardé écrasé")
	}
}

// Audit H1 : la réservation ne dépasse jamais les segments reçus de plus de growMargin.
func TestGrowBoundedByReceivedSegments(t *testing.T) {
	s, _ := newSvc(t)
	id, _, err := s.Create(newKeys().req(80, 1, 1))
	if err != nil {
		t.Fatal(err)
	}
	if err := s.Grow(id, 400); !errors.Is(err, ErrBadRequest) {
		t.Fatal("réservation sans segment reçu", err)
	}
	if err := s.Grow(id, 160); err != nil {
		t.Fatal(err)
	}
	for n := 0; n < 2; n++ {
		if err := s.PutSegment(id, n, segBody(160, n, 1)); err != nil {
			t.Fatal(err)
		}
	}
	if err := s.Grow(id, 800); !errors.Is(err, ErrBadRequest) {
		t.Fatal(err)
	}
	if err := s.Grow(id, 400); err != nil {
		t.Fatal(err)
	}
}
