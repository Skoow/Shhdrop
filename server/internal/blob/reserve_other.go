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
