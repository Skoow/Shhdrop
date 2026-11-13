//go:build unix

package config

import "syscall"

// nofile : limite de descripteurs du processus (souple, relevée au plafond par Go au
// démarrage) ; 0 si inconnue (une limite infinie dépasse fdShare : sans borne).
func nofile() uint64 {
	var r syscall.Rlimit
	if syscall.Getrlimit(syscall.RLIMIT_NOFILE, &r) != nil {
		return 0
	}
	return uint64(r.Cur)
}
