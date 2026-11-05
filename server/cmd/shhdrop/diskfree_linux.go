//go:build linux

package main

import "golang.org/x/sys/unix"

// statfsFree : octets disponibles pour un utilisateur non administrateur (Bavail).
func statfsFree(path string) (uint64, error) {
	var st unix.Statfs_t
	if err := unix.Statfs(path, &st); err != nil {
		return 0, err
	}
	return availBytes(uint64(st.Bavail), uint64(st.Bsize), uint64(st.Frsize)), nil
}
