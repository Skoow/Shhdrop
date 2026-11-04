package blob

import (
	"bytes"
	"os"
	"path/filepath"
	"sort"
	"testing"
	"time"
)

const id1 = "AAAAAAAAAAAAAAAAAAAAAA"
const id2 = "BBBBBBBBBBBBBBBBBBBBBB"

func newStore(t *testing.T) *Store {
	return &Store{Dir: filepath.Join(t.TempDir(), "blobs")}
}

func TestReserve(t *testing.T) {
	s := newStore(t)
	if err := s.Reserve(id1, 1000); err != nil {
		t.Fatal(err)
	}
	fi, err := os.Stat(filepath.Join(s.Dir, id1))
	if err != nil {
		t.Fatal(err)
	}
	if fi.Size() != 1000 || fi.Mode().Perm() != 0o600 {
		t.Fatalf("size=%d mode=%v", fi.Size(), fi.Mode())
	}
	if !fi.ModTime().Equal(time.Unix(0, 0)) {
		t.Fatalf("mtime = %v", fi.ModTime())
	}
	di, _ := os.Stat(s.Dir)
	if di.Mode().Perm() != 0o700 {
		t.Fatalf("dir mode %v", di.Mode())
	}
	if err := s.Reserve(id1, 10); err == nil {
		t.Fatal("double réservation acceptée")
	}
}

func TestWriteReadAt(t *testing.T) {
	s := newStore(t)
	s.Reserve(id1, 10)
	if err := s.WriteAt(id1, 2, []byte("abcd")); err != nil {
		t.Fatal(err)
	}
	fi, _ := os.Stat(filepath.Join(s.Dir, id1))
	if !fi.ModTime().Equal(time.Unix(0, 0)) {
		t.Fatalf("mtime = %v", fi.ModTime())
	}
	got, err := s.ReadAt(id1, 2, 4)
	if err != nil || !bytes.Equal(got, []byte("abcd")) {
		t.Fatalf("%q %v", got, err)
	}
	before, _ := os.ReadFile(filepath.Join(s.Dir, id1))
	for _, c := range []struct {
		off int64
		p   []byte
	}{{8, []byte("xyz")}, {-1, []byte("x")}, {11, []byte("x")}, {10, []byte("x")}} {
		if err := s.WriteAt(id1, c.off, c.p); err == nil {
			t.Fatalf("écriture hors bornes acceptée off=%d", c.off)
		}
	}
	after, _ := os.ReadFile(filepath.Join(s.Dir, id1))
	if !bytes.Equal(before, after) || len(after) != 10 {
		t.Fatal("fichier modifié")
	}
	if _, err := s.ReadAt(id1, 8, 5); err == nil {
		t.Fatal("lecture hors bornes acceptée")
	}
	if _, err := s.ReadAt(id1, -1, 2); err == nil {
		t.Fatal("offset négatif accepté")
	}
}

func TestDeleteListUsed(t *testing.T) {
	s := newStore(t)
	s.Reserve(id1, 100)
	s.Reserve(id2, 50)
	n, err := s.UsedBytes()
	if err != nil || n != 150 {
		t.Fatalf("%d %v", n, err)
	}
	l, _ := s.List()
	sort.Strings(l)
	if len(l) != 2 || l[0] != id1 || l[1] != id2 {
		t.Fatalf("%v", l)
	}
	if err := s.Delete(id1); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(s.Dir, id1)); !os.IsNotExist(err) {
		t.Fatal("fichier présent")
	}
	if err := s.Delete(id1); err != nil {
		t.Fatalf("delete non idempotent: %v", err)
	}
	if n, _ := s.UsedBytes(); n != 50 {
		t.Fatalf("%d", n)
	}
}

func TestInvalidID(t *testing.T) {
	s := newStore(t)
	for _, id := range []string{"", "../etc/passwd", "short", id1 + "A", "AAAAAAAAAAAAAAAAAAAA/A", "AAAAAAAAAAAAAAAAAAAA.."} {
		if s.Reserve(id, 1) == nil || s.WriteAt(id, 0, []byte("x")) == nil || s.Delete(id) == nil {
			t.Fatalf("id invalide accepté: %q", id)
		}
		if _, err := s.ReadAt(id, 0, 1); err == nil {
			t.Fatalf("lecture id invalide %q", id)
		}
	}
}
