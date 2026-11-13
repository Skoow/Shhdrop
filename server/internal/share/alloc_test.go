package share

import (
	"io"
	"runtime"
	"testing"
)

// Revue B8 : remplir un seul morceau d'aléa (trou d'un petit élément retiré) n'alloue pas un
// tampon de 4 Mio ; le tampon est à la taille de la plage, plafonné à fillChunk.
func TestFillRangeAllocatesNoMoreThanRange(t *testing.T) {
	s, _ := newSvc(t)
	id, _, err := s.createAny(newKeys().req(160, 1, 1))
	if err != nil {
		t.Fatal(err)
	}
	var sizes []int
	orig := fillWrite
	fillWrite = func(w io.WriterAt, off int64, b []byte) error {
		sizes = append(sizes, len(b))
		return orig(w, off, b)
	}
	defer func() { fillWrite = orig }()
	var before, after runtime.MemStats
	runtime.ReadMemStats(&before)
	const rounds = 8
	for i := 0; i < rounds; i++ {
		if err := s.fillRange(id, Header, Header+ChunkCT); err != nil {
			t.Fatal(err)
		}
	}
	runtime.ReadMemStats(&after)
	if got := (after.TotalAlloc - before.TotalAlloc) / rounds; got > 1<<20 {
		t.Fatalf("fillRange d'un morceau (%d octets) alloue %d octets par appel", ChunkCT, got)
	}
	// Une grande plage reste écrite par tranches de fillChunk au plus, sans rien omettre.
	sizes = nil
	const big = 2*fillChunk + 123
	if err := s.fillRange(id, Header, Header+big); err != nil {
		t.Fatal(err)
	}
	if len(sizes) != 3 || sizes[0] != fillChunk || sizes[1] != fillChunk || sizes[2] != 123 {
		t.Fatal("tranches", sizes)
	}
	// Plage vide ou inversée : aucune écriture.
	sizes = nil
	if err := s.fillRange(id, 100, 100); err != nil || len(sizes) != 0 {
		t.Fatal(err, sizes)
	}
	if err := s.fillRange(id, 200, 100); err != nil || len(sizes) != 0 {
		t.Fatal(err, sizes)
	}
}
