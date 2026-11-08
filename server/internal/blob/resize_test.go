package blob

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"
	"time"
)

// Agrandissement, réduction et effacement d'une plage (spec §41.14).
func TestResizeAndErase(t *testing.T) {
	s := newStore(t)
	if err := s.Reserve(id1, 8192); err != nil {
		t.Fatal(err)
	}
	if err := s.WriteAt(id1, 0, bytes.Repeat([]byte{7}, 8192)); err != nil {
		t.Fatal(err)
	}
	if err := s.Resize(id1, 3*8192); err != nil {
		t.Fatal(err)
	}
	p := filepath.Join(s.Dir, id1)
	b, _ := os.ReadFile(p)
	if len(b) != 3*8192 || !bytes.Equal(b[:8192], bytes.Repeat([]byte{7}, 8192)) {
		t.Fatal("agrandissement", len(b))
	}
	if err := s.WriteAt(id1, 2*8192, bytes.Repeat([]byte{9}, 8192)); err != nil {
		t.Fatal("écriture dans la place agrandie", err)
	}
	if err := s.Erase(id1, 4096, 2*8192); err != nil {
		t.Fatal(err)
	}
	b, _ = os.ReadFile(p)
	if len(b) != 3*8192 || !bytes.Equal(b[4096:4096+2*8192], make([]byte, 2*8192)) || b[0] != 7 || b[len(b)-1] != 9 {
		t.Fatal("effacement")
	}
	if err := s.Erase(id1, 3*8192-10, 11); err == nil {
		t.Fatal("effacement hors du fichier accepté")
	}
	if err := s.Resize(id1, 100); err != nil {
		t.Fatal(err)
	}
	fi, _ := os.Stat(p)
	if fi.Size() != 100 || !fi.ModTime().Equal(time.Unix(0, 0)) {
		t.Fatal("réduction", fi.Size(), fi.ModTime())
	}
	if err := s.Resize(id2, 10); err == nil {
		t.Fatal("fichier absent")
	}
}
