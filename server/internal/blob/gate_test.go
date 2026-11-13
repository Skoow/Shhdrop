package blob

import (
	"bytes"
	"io"
	"path/filepath"
	"sync"
	"testing"
)

// Audit du 13 novembre, D4 : au plus n appels système de fichiers à la fois, quel que soit le
// nombre de transferts (écritures, lectures en flux, réservations, suppressions).
func TestGateBorneLesAppels(t *testing.T) {
	g := NewGate(3)
	s := &Store{Dir: filepath.Join(t.TempDir(), "b"), Gate: g}
	const n = 40
	ids := make([]string, n)
	for i := range ids {
		ids[i] = string(bytes.Repeat([]byte{byte('A' + i%26)}, 21)) + string(rune('a'+i/26))
		if err := s.Reserve(ids[i], 1<<20); err != nil {
			t.Fatal(err)
		}
	}
	var wg sync.WaitGroup
	for _, id := range ids {
		wg.Go(func() {
			if err := s.WriteAt(id, 0, bytes.Repeat([]byte{1}, 1<<20)); err != nil {
				t.Error(err)
			}
			sec, err := s.Open(id, 0, 1<<20)
			if err != nil {
				t.Error(err)
				return
			}
			io.Copy(io.Discard, io.LimitReader(sec, 1<<20))
			sec.Close()
			if err := s.Sync(id); err != nil {
				t.Error(err)
			}
			if err := s.Delete(id); err != nil {
				t.Error(err)
			}
		})
	}
	wg.Wait()
	if p := g.Peak(); p < 1 || p > 3 {
		t.Fatal("appels simultanés :", p)
	}
	if len(g.c) != 0 || g.used.Load() != 0 {
		t.Fatal("places non rendues")
	}
}
