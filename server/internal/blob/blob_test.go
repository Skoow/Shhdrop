package blob

import (
	"bytes"
	"io"
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

// readAll lit une section entière avec Open.
func readAll(s *Store, id string, off, n int64) ([]byte, error) {
	sec, err := s.Open(id, off, n)
	if err != nil {
		return nil, err
	}
	defer sec.Close()
	return io.ReadAll(sec)
}

func TestWriteOpen(t *testing.T) {
	s := newStore(t)
	s.Reserve(id1, 10)
	if err := s.WriteAt(id1, 2, []byte("abcd")); err != nil {
		t.Fatal(err)
	}
	fi, _ := os.Stat(filepath.Join(s.Dir, id1))
	if !fi.ModTime().Equal(time.Unix(0, 0)) {
		t.Fatalf("mtime = %v", fi.ModTime())
	}
	got, err := readAll(s, id1, 2, 4)
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
	if _, err := s.Open(id1, 8, 5); err == nil {
		t.Fatal("lecture hors bornes acceptée")
	}
	if _, err := s.Open(id1, -1, 2); err == nil {
		t.Fatal("offset négatif accepté")
	}
	if _, err := s.Open(id1, 0, -1); err == nil {
		t.Fatal("longueur négative acceptée")
	}
	// Taille annoncée = taille demandée ; rien au-delà de la zone n'est lu.
	sec, err := s.Open(id1, 2, 3)
	if err != nil || sec.Size() != 3 {
		t.Fatal(err)
	}
	b, _ := io.ReadAll(sec)
	sec.Close()
	if string(b) != "abc" {
		t.Fatalf("%q", b)
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
		if _, err := s.Open(id, 0, 1); err == nil {
			t.Fatalf("lecture id invalide %q", id)
		}
	}
}

// Tâche M, point 10 : RemoveProbes ne supprime que les fichiers ordinaires « .sonde-<chiffres> »
// créés par CheckAllocate (os.CreateTemp), jamais un blob, un dossier ni un lien.
func TestRemoveProbes(t *testing.T) {
	s := newStore(t)
	if err := s.Reserve(id1, 100); err != nil {
		t.Fatal(err)
	}
	keep := []string{".sonde-abc", ".sonde-", ".sonde", "sonde-123", ".sonde-12x", "x.sonde-123"}
	for _, n := range keep {
		if err := os.WriteFile(filepath.Join(s.Dir, n), []byte("à garder"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	os.Mkdir(filepath.Join(s.Dir, ".sonde-777"), 0o700)
	os.WriteFile(filepath.Join(s.Dir, ".sonde-777", "f"), []byte("x"), 0o600)
	outside := filepath.Join(t.TempDir(), "cible")
	os.WriteFile(outside, []byte("hors du dossier"), 0o600)
	os.Symlink(outside, filepath.Join(s.Dir, ".sonde-888"))
	gone := []string{".sonde-1", ".sonde-1234567890"}
	for _, n := range gone {
		os.WriteFile(filepath.Join(s.Dir, n), make([]byte, 4096), 0o600)
	}
	if err := s.RemoveProbes(); err != nil {
		t.Fatal(err)
	}
	for _, n := range gone {
		if _, err := os.Lstat(filepath.Join(s.Dir, n)); !os.IsNotExist(err) {
			t.Fatalf("%s laissée : %v", n, err)
		}
	}
	for _, n := range append(keep, id1, ".sonde-777", ".sonde-777/f", ".sonde-888") {
		if _, err := os.Lstat(filepath.Join(s.Dir, n)); err != nil {
			t.Fatalf("%s supprimée : %v", n, err)
		}
	}
	if _, err := os.Stat(outside); err != nil {
		t.Fatal("cible du lien supprimée", err)
	}
	// Dossier absent : rien à faire.
	if err := (&Store{Dir: filepath.Join(t.TempDir(), "absent")}).RemoveProbes(); err != nil {
		t.Fatal(err)
	}
}
