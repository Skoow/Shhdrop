//go:build linux

package blob

import (
	"errors"
	"os"
	"path/filepath"
	"syscall"
	"testing"

	"golang.org/x/sys/unix"
)

// fallocateSupported sonde le système de fichiers du dossier de test.
func fallocateSupported(t *testing.T, dir string) bool {
	f, err := os.CreateTemp(dir, "probe")
	if err != nil {
		t.Fatal(err)
	}
	defer os.Remove(f.Name())
	defer f.Close()
	return unix.Fallocate(int(f.Fd()), 0, 0, 1<<20) == nil
}

// Sur un système de fichiers qui le permet, l'espace est vraiment alloué (pas de fichier creux).
func TestReserveAllocatesBlocks(t *testing.T) {
	s := newStore(t)
	if err := os.MkdirAll(s.Dir, 0o700); err != nil {
		t.Fatal(err)
	}
	if !fallocateSupported(t, s.Dir) {
		t.Skip("fallocate non pris en charge ici : repli Truncate couvert par TestReserveFallback")
	}
	const size = 4 << 20
	if err := s.Reserve(id1, size); err != nil {
		t.Fatal(err)
	}
	fi, err := os.Stat(filepath.Join(s.Dir, id1))
	if err != nil {
		t.Fatal(err)
	}
	st := fi.Sys().(*syscall.Stat_t)
	if fi.Size() != size || st.Blocks*512 < size {
		t.Fatalf("taille %d, blocs alloués %d octets", fi.Size(), st.Blocks*512)
	}
}

func TestReserveFallback(t *testing.T) {
	orig := fallocate
	t.Cleanup(func() { fallocate = orig })
	s := newStore(t)
	// Système de fichiers sans fallocate : repli Truncate, même taille logique.
	fallocate = func(int, int64) error { return unix.EOPNOTSUPP }
	if err := s.Reserve(id1, 1000); err != nil {
		t.Fatal(err)
	}
	if fi, err := os.Stat(filepath.Join(s.Dir, id1)); err != nil || fi.Size() != 1000 {
		t.Fatal(err, fi)
	}
	// Autre erreur (disque plein) : la réservation échoue et ne laisse aucun fichier.
	fallocate = func(int, int64) error { return unix.ENOSPC }
	if err := s.Reserve(id2, 1000); !errors.Is(err, unix.ENOSPC) {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(s.Dir, id2)); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("fichier laissé après échec", err)
	}
}
