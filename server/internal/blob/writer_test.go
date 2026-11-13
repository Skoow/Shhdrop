package blob

import (
	"os"
	"path/filepath"
	"testing"
)

// Writer : écritures dans la réservation seulement ; dates remises à l'epoch à la fermeture.
func TestWriter(t *testing.T) {
	s := &Store{Dir: filepath.Join(t.TempDir(), "b"), Gate: NewGate(1)}
	id := "AAAAAAAAAAAAAAAAAAAAAA"
	if err := s.Reserve(id, 10); err != nil {
		t.Fatal(err)
	}
	w, err := s.OpenWriter(id)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := w.WriteAt([]byte("abc"), 7); err != nil {
		t.Fatal(err)
	}
	if _, err := w.WriteAt([]byte("abcd"), 7); err == nil {
		t.Fatal("écriture au-delà de la réservation")
	}
	if _, err := w.WriteAt([]byte("a"), -1); err == nil {
		t.Fatal("décalage négatif")
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	fi, err := os.Stat(filepath.Join(s.Dir, id))
	if err != nil || fi.ModTime().Unix() != 0 || fi.Size() != 10 {
		t.Fatal(fi.ModTime(), fi.Size(), err)
	}
	if _, err := s.OpenWriter("../x"); err == nil {
		t.Fatal("identifiant invalide accepté")
	}
}
