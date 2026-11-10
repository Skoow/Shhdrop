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

// Audit F6 : en production (NoSparse), le repli « fichier creux » est refusé : le disque
// pourrait se remplir en plein envoi.
func TestReserveNoSparse(t *testing.T) {
	orig := fallocate
	t.Cleanup(func() { fallocate = orig })
	s := newStore(t)
	s.NoSparse = true
	fallocate = func(int, int64) error { return unix.EOPNOTSUPP }
	if err := s.Reserve(id1, 1000); !errors.Is(err, ErrNoAllocate) {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(s.Dir, id1)); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("fichier laissé après refus", err)
	}
	if err := s.CheckAllocate(); !errors.Is(err, ErrNoAllocate) {
		t.Fatal("sonde de démarrage :", err)
	}
	if ids, _ := s.List(); len(ids) != 0 {
		t.Fatal("sonde laissée", ids)
	}
	fallocate = orig
	if fallocateSupported(t, s.Dir) {
		if err := s.CheckAllocate(); err != nil {
			t.Fatal(err)
		}
	}
	if es, _ := os.ReadDir(s.Dir); len(es) != 0 {
		t.Fatal("sonde laissée", es)
	}
}

// Une réservation en cours (fallocate lent) pendant toute une relecture du dossier : sa
// place, pas encore visible sur le disque, reste comptée après la relecture.
func TestResyncCountsReservationInFlight(t *testing.T) {
	s := newStore(t)
	if err := os.MkdirAll(s.Dir, 0o700); err != nil {
		t.Fatal(err)
	}
	if !fallocateSupported(t, s.Dir) {
		t.Skip("fallocate non pris en charge ici")
	}
	if n, err := s.UsedBytes(); err != nil || n != 0 {
		t.Fatal(n, err)
	}
	orig := fallocate
	defer func() { fallocate = orig }()
	entered, release := make(chan struct{}), make(chan struct{})
	fallocate = func(fd int, size int64) error {
		close(entered)
		<-release
		return orig(fd, size)
	}
	done := make(chan error, 1)
	go func() { done <- s.Reserve(id1, 1<<20) }()
	<-entered // fichier créé, vide
	if n, err := s.UsedBytes(); err != nil || n != 1<<20 {
		t.Fatal("réservation en cours non comptée d'avance :", n, err)
	}
	if err := s.Resync(); err != nil {
		t.Fatal(err)
	}
	if n, err := s.UsedBytes(); err != nil || n < 1<<20 {
		t.Fatal("réservation en cours oubliée par la relecture :", n, err)
	}
	close(release)
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	fallocate = orig
	if n, err := s.UsedBytes(); err != nil || n < 1<<20 {
		t.Fatal(n, err)
	}
	if err := s.Resync(); err != nil {
		t.Fatal(err)
	}
	if n, err := s.UsedBytes(); err != nil || n != 1<<20 {
		t.Fatal(n, err)
	}
}
