//go:build linux

package api

import (
	"os"
	"syscall"
	"time"
)

// atime : date d'accès du fichier (Linux).
func atime(fi os.FileInfo) (time.Time, bool) {
	st, ok := fi.Sys().(*syscall.Stat_t)
	if !ok {
		return time.Time{}, false
	}
	return time.Unix(st.Atim.Sec, st.Atim.Nsec), true
}
