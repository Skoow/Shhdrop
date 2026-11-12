//go:build !linux

package api

import (
	"os"
	"time"
)

// atime : non lue hors de Linux.
func atime(os.FileInfo) (time.Time, bool) { return time.Time{}, false }
