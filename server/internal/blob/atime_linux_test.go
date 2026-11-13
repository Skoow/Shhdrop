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

func ctime(t *testing.T, p string) time.Time {
	t.Helper()
	var st unix.Stat_t
	if err := unix.Stat(p, &st); err != nil {
		t.Fatal(err)
	}
	return time.Unix(st.Ctim.Unix())
}

// Audit adverse du 13 novembre, stockage, F4 : la date de changement d'inode (ctime) d'un
// fichier donnait l'heure de la fin de son envoi. Après ScrubTimes (passage du janitor), le
// ctime de tous les fichiers et du dossier est l'heure du passage ; les dates de contenu et
// d'accès restent à l'epoch.
func TestScrubTimesBrouilleCtime(t *testing.T) {
	s := newStore(t)
	if err := s.Reserve(id1, 10); err != nil {
		t.Fatal(err)
	}
	c1 := ctime(t, filepath.Join(s.Dir, id1))
	time.Sleep(30 * time.Millisecond)
	if err := s.Reserve(id2, 10); err != nil {
		t.Fatal(err)
	}
	if c2 := ctime(t, filepath.Join(s.Dir, id2)); !c2.After(c1) {
		t.Fatal("témoin : les ctime ne distinguent pas les deux créations")
	}
	time.Sleep(30 * time.Millisecond)
	passage := time.Now()
	if err := s.ScrubTimes(); err != nil {
		t.Fatal(err)
	}
	for _, p := range []string{filepath.Join(s.Dir, id1), filepath.Join(s.Dir, id2), s.Dir} {
		// Marge : l'horloge des inodes du noyau peut retarder de quelques ms sur time.Now.
		if c := ctime(t, p); c.Before(passage.Add(-20 * time.Millisecond)) {
			t.Errorf("%s : ctime %v d'avant le passage (%v)", filepath.Base(p), c, passage)
		}
		fi, err := os.Stat(p)
		if err != nil || !fi.ModTime().Equal(time.Unix(0, 0)) {
			t.Errorf("%s : date de contenu %v", filepath.Base(p), fi.ModTime())
		}
	}
	// Dossier absent ou fichier disparu : pas d'erreur.
	if err := (&Store{Dir: filepath.Join(s.Dir, "absent")}).ScrubTimes(); err != nil {
		t.Fatal(err)
	}
}
