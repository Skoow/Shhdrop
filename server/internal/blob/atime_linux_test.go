//go:build linux

package blob

import (
	"io"
	"os"
	"path/filepath"
	"testing"
	"time"

	"golang.org/x/sys/unix"
)

func atime(t *testing.T, p string) time.Time {
	t.Helper()
	var st unix.Stat_t
	if err := unix.Stat(p, &st); err != nil {
		t.Fatal(err)
	}
	return time.Unix(st.Atim.Unix())
}

// Audit de confidentialité P5 : une lecture ne change pas la date d'accès du fichier
// (O_NOATIME), même sur un volume en relatime où une lecture ordinaire la mettrait à jour.
func TestOpenKeepsAtime(t *testing.T) {
	s := newStore(t)
	if err := s.Reserve(id1, 10); err != nil {
		t.Fatal(err)
	}
	if err := s.WriteAt(id1, 0, []byte("0123456789")); err != nil {
		t.Fatal(err)
	}
	p := filepath.Join(s.Dir, id1)
	if a := atime(t, p); !a.Equal(time.Unix(0, 0)) {
		t.Fatalf("atime après écriture = %v", a)
	}
	b, err := readAll(s, id1, 0, 10)
	if err != nil || string(b) != "0123456789" {
		t.Fatal(b, err)
	}
	if a := atime(t, p); !a.Equal(time.Unix(0, 0)) {
		t.Fatalf("atime changée par Open : %v", a)
	}
	// Témoin : une lecture ordinaire change l'atime sur ce volume, sinon le test ne prouve rien.
	f, err := os.Open(p)
	if err != nil {
		t.Fatal(err)
	}
	io.ReadAll(f)
	f.Close()
	if atime(t, p).Equal(time.Unix(0, 0)) {
		t.Skip("volume monté sans mise à jour d'atime (noatime) : témoin non concluant")
	}
}
