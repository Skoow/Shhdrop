//go:build !linux

package blob

import "os"

// allocate : hors Linux, simple Truncate (fichier creux).
func allocate(f *os.File, size int64) error { return f.Truncate(size) }
