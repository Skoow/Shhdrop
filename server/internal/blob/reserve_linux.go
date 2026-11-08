//go:build linux

package blob

import (
	"errors"
	"os"

	"golang.org/x/sys/unix"
)

// fallocate : appel système, variable pour simuler un système de fichiers sans prise en charge.
var fallocate = func(fd int, size int64) error { return unix.Fallocate(fd, 0, 0, size) }

// allocate réserve réellement size octets sur le disque (fallocate) ; si le système
// de fichiers ne le permet pas, se rabat sur Truncate (fichier creux), sauf si noSparse.
func allocate(f *os.File, size int64, noSparse bool) error {
	if size == 0 {
		return nil
	}
	err := fallocate(int(f.Fd()), size)
	if errors.Is(err, unix.EOPNOTSUPP) || errors.Is(err, unix.ENOSYS) {
		if noSparse {
			return ErrNoAllocate
		}
		return f.Truncate(size)
	}
	return err
}

// openRead ouvre en lecture avec O_NOATIME : la lecture ne change pas la date d'accès
// (sinon, en relatime, la première lecture après l'écriture la fixe à la milliseconde).
// O_NOATIME exige d'être propriétaire du fichier (EPERM sinon) : repli sur une ouverture
// ordinaire ; le volume monté en noatime (spec §15.1) couvre alors ce cas.
func openRead(path string) (*os.File, error) {
	f, err := os.OpenFile(path, os.O_RDONLY|unix.O_NOATIME, 0)
	if errors.Is(err, unix.EPERM) {
		return os.Open(path)
	}
	return f, err
}

// punchHole rend la plage au système de fichiers (FALLOC_FL_PUNCH_HOLE, taille gardée) ;
// faux si le système de fichiers ne le permet pas (l'appelant écrit alors des zéros).
// Les blocs libérés ne sont pas réalloués : la place logique reste comptée (UsedBytes),
// une écriture ultérieure les reprend.
func punchHole(f *os.File, off, n int64) bool {
	if n == 0 {
		return true
	}
	return unix.Fallocate(int(f.Fd()), unix.FALLOC_FL_PUNCH_HOLE|unix.FALLOC_FL_KEEP_SIZE, off, n) == nil
}
