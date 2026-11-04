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
// de fichiers ne le permet pas, se rabat sur Truncate (fichier creux).
func allocate(f *os.File, size int64) error {
	if size == 0 {
		return nil
	}
	err := fallocate(int(f.Fd()), size)
	if errors.Is(err, unix.EOPNOTSUPP) || errors.Is(err, unix.ENOSYS) {
		return f.Truncate(size)
	}
	return err
}
