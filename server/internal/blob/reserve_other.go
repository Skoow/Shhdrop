//go:build !linux

package blob

import "os"

// allocate : hors Linux, simple Truncate (fichier creux) ; refusé si noSparse.
func allocate(f *os.File, size int64, noSparse bool) error {
	if noSparse && size > 0 {
		return ErrNoAllocate
	}
	return f.Truncate(size)
}

// openRead : hors Linux, pas d'O_NOATIME ; le volume doit être monté en noatime (spec §15.1).
func openRead(path string) (*os.File, error) { return os.Open(path) }
