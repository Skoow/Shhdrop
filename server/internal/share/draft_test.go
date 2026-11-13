package share

import (
	"bytes"
	"errors"
	"io"
	"os"
	"path/filepath"
	"sync"
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
	id, _, err := s.createAny(newKeys().req(80, 1, 1))
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
	id, _, err := s.createAny(newKeys().req(80, 1, 1))
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
	id, _, err := s.createAny(newKeys().req(400, 1, 1)) // 7 segments
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
	id, _, err := s.createAny(newKeys().req(80, 1, 1))
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
	id, _, err := s.createAny(newKeys().req(80, 1, 1))
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
	id, _, err := s.createAny(newKeys().req(160, 1, 1)) // réservation : 3 segments
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
	id, _, err := s.createAny(newKeys().req(400, 1, 1))
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
	id, _, err := s.createAny(newKeys().req(80, 1, 1))
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

// Audit H-2 (§41.14) : petits éléments empaquetés dans des segments partagés, envoyés par
// plages de morceaux (sans bourrage) ; le serveur remplit d'aléa, à finalize, les morceaux
// jamais reçus et ceux des petits éléments retirés (void).
func chunkBody(n, from, k int, fill byte) []byte {
	pre := 0
	if n == 0 && from == 0 {
		pre = Header
	}
	return bytes.Repeat([]byte{fill}, pre+k*ChunkCT)
}

func chunkAt(b []byte, bucket, n, c int) []byte {
	off := segOffset(bucket, n) + int64(c)*ChunkCT
	if n == 0 {
		off += Header
	}
	return b[off : off+ChunkCT]
}

func mostlyRandom(b []byte) bool { return bytes.Count(b, []byte{0}) < len(b)/100 }

func TestPutChunksPackedAndFinalizeFills(t *testing.T) {
	s, _ := newSvc(t)
	id, _, err := s.createAny(newKeys().req(160, 1, 1))
	if err != nil {
		t.Fatal(err)
	}
	if err := s.PutChunks(id, 0, 0, chunkBody(0, 0, 3, 1)); err != nil {
		t.Fatal(err)
	}
	if err := s.PutChunks(id, 0, 3, chunkBody(0, 3, 2, 2)); err != nil {
		t.Fatal(err)
	}
	if err := s.PutChunks(id, 1, 10, chunkBody(1, 10, 1, 3)); err != nil {
		t.Fatal(err)
	}
	for i, c := range []struct {
		n, from int
		body    []byte
	}{
		{0, 63, chunkBody(0, 63, 2, 9)}, // dépasse le segment
		{0, -1, chunkBody(0, 1, 1, 9)},  // début négatif
		{0, 1, chunkBody(0, 0, 1, 9)},   // en-tête hors du morceau 0
		{0, 5, make([]byte, ChunkCT+1)}, // pas un nombre entier de morceaux
		{0, 5, nil},                     // vide
		{2, 31, chunkBody(2, 31, 2, 9)}, // dernier segment du palier : 32 morceaux
		{3, 0, chunkBody(3, 0, 1, 9)},   // hors palier
		{1, 64, chunkBody(1, 64, 1, 9)}, // début hors segment
	} {
		if err := s.PutChunks(id, c.n, c.from, c.body); !errors.Is(err, ErrBadSegment) {
			t.Fatal(i, err)
		}
	}
	var mask []byte
	if err := s.DB.QueryRow(`SELECT segments_mask FROM shares WHERE id=?`, id).Scan(&mask); err != nil {
		t.Fatal(err)
	}
	if mask[0] != 0 {
		t.Fatal("segment partiel compté comme reçu", mask)
	}
	r := draftFin(id, 160)
	r.Void = [][2]int{{3, 4}} // petit élément retiré : son premier morceau remplacé
	if _, err := s.Finalize(id, r); err != nil {
		t.Fatal(err)
	}
	b := fileBytes(t, s, id)
	for c := 0; c < 3; c++ {
		if !bytes.Equal(chunkAt(b, 160, 0, c), bytes.Repeat([]byte{1}, ChunkCT)) {
			t.Fatal("morceau gardé", c)
		}
	}
	if !mostlyRandom(chunkAt(b, 160, 0, 3)) || bytes.Contains(chunkAt(b, 160, 0, 3), bytes.Repeat([]byte{2}, 64)) {
		t.Fatal("morceau retiré non remplacé")
	}
	if !bytes.Equal(chunkAt(b, 160, 0, 4), bytes.Repeat([]byte{2}, ChunkCT)) {
		t.Fatal("morceau 4 gardé")
	}
	if !bytes.Equal(chunkAt(b, 160, 1, 10), bytes.Repeat([]byte{3}, ChunkCT)) {
		t.Fatal("morceau du segment 1 gardé")
	}
	for _, x := range [][2]int{{0, 5}, {0, 63}, {1, 0}, {1, 9}, {1, 11}, {1, 63}, {2, 0}} {
		if !mostlyRandom(chunkAt(b, 160, x[0], x[1])) {
			t.Fatal("morceau jamais reçu non rempli", x)
		}
	}
}

func TestPutChunksCompletesSegment(t *testing.T) {
	s, _ := newSvc(t)
	id, _, err := s.createAny(newKeys().req(80, 1, 1))
	if err != nil {
		t.Fatal(err)
	}
	if err := s.PutChunks(id, 0, 0, chunkBody(0, 0, 40, 1)); err != nil {
		t.Fatal(err)
	}
	if err := s.PutChunks(id, 0, 40, chunkBody(0, 40, 24, 2)); err != nil {
		t.Fatal(err)
	}
	var mask []byte
	if err := s.DB.QueryRow(`SELECT segments_mask FROM shares WHERE id=?`, id).Scan(&mask); err != nil {
		t.Fatal(err)
	}
	if mask[0] != 1 {
		t.Fatal("segment complété par plages non compté", mask)
	}
}

func TestEraseClearsPartialSegment(t *testing.T) {
	s, _ := newSvc(t)
	id, _, err := s.createAny(newKeys().req(160, 1, 1))
	if err != nil {
		t.Fatal(err)
	}
	if err := s.PutChunks(id, 1, 0, chunkBody(1, 0, 5, 7)); err != nil {
		t.Fatal(err)
	}
	if err := s.Erase(id, 1, 2); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Finalize(id, draftFin(id, 160)); err != nil {
		t.Fatal(err)
	}
	if !mostlyRandom(chunkAt(fileBytes(t, s, id), 160, 1, 0)) {
		t.Fatal("plage effacée non remplie")
	}
}

func TestGrowCountsPartialSegments(t *testing.T) {
	s, _ := newSvc(t)
	id, _, err := s.createAny(newKeys().req(160, 1, 1))
	if err != nil {
		t.Fatal(err)
	}
	if err := s.PutChunks(id, 1, 0, chunkBody(1, 0, 1, 7)); err != nil {
		t.Fatal(err)
	}
	if err := s.Grow(id, 400); err != nil { // dernier reçu : segment 1 (partiel)
		t.Fatal(err)
	}
}

func TestFinalizeDraftVoidValidation(t *testing.T) {
	s, _ := newSvc(t)
	id, _, err := s.createAny(newKeys().req(80, 1, 1))
	if err != nil {
		t.Fatal(err)
	}
	for _, v := range [][][2]int{{{-1, 2}}, {{3, 3}}, {{5, 2}}, {{0, 80}}, {{70, 80}}, make([][2]int, maxVoid+1)} {
		r := draftFin(id, 80)
		r.Void = v
		if _, err := s.Finalize(id, r); !errors.Is(err, ErrBadRequest) {
			t.Fatal(v[:min(len(v), 2)], err)
		}
	}
	r := fin(id)
	r.Void = [][2]int{{0, 1}}
	if err := ValidateFinalize(r); !errors.Is(err, ErrBadRequest) {
		t.Fatal("void hors brouillon", err)
	}
}

// Audit F6 : pendant une finalisation (bourrage écrit hors du verrou de l'envoi), un segment ou
// une plage de morceaux du même envoi est refusé (ErrBusy) : sinon l'aléa du bourrage pouvait
// écraser des données reçues au même moment, ou l'inverse.
func TestPutRefusedDuringFinalize(t *testing.T) {
	for _, draft := range []bool{false, true} {
		t.Run(map[bool]string{false: "classique", true: "brouillon"}[draft], func(t *testing.T) {
			s, _ := newSvc(t)
			id, _, err := s.createAny(newKeys().req(160, 1, 1))
			if err != nil {
				t.Fatal(err)
			}
			for _, n := range []int{0, 2} {
				if err := s.PutSegment(id, n, segBody(160, n, 1)); err != nil {
					t.Fatal(err)
				}
			}
			started, release := make(chan struct{}), make(chan struct{})
			var once sync.Once
			orig := fillWrite
			fillWrite = func(w io.WriterAt, off int64, b []byte) error {
				once.Do(func() { close(started); <-release })
				return orig(w, off, b)
			}
			t.Cleanup(func() { fillWrite = orig })
			r := fin(id)
			if draft {
				r = draftFin(id, 160)
			} else {
				r.FillFrom, r.FillTo = 1, 2
			}
			done := make(chan error, 1)
			go func() { _, err := s.Finalize(id, r); done <- err }()
			<-started
			if err := s.PutSegment(id, 1, segBody(160, 1, 9)); !errors.Is(err, ErrBusy) {
				t.Error("segment accepté pendant la finalisation :", err)
			}
			if err := s.PutChunks(id, 1, 3, bytes.Repeat([]byte{9}, ChunkCT)); !errors.Is(err, ErrBusy) {
				t.Error("morceaux acceptés pendant la finalisation :", err)
			}
			close(release)
			if err := <-done; err != nil {
				t.Fatal(err)
			}
		})
	}
}

// Audit F6 : une finalisation refusée (envoi incomplet) rend la main : les segments manquants
// sont de nouveau acceptés.
func TestPutAcceptedAfterFailedFinalize(t *testing.T) {
	s, _ := newSvc(t)
	id, _, err := s.createAny(newKeys().req(160, 1, 1))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.Finalize(id, fin(id)); !errors.Is(err, ErrIncomplete) {
		t.Fatal(err)
	}
	if err := s.PutSegment(id, 0, segBody(160, 0, 1)); err != nil {
		t.Fatal(err)
	}
}
