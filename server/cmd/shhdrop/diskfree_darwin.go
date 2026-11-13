//go:build darwin

package main

import "golang.org/x/sys/unix"

// statfsFree : octets disponibles pour un utilisateur non administrateur (Bavail).
// Statfs_t n'a pas de Frsize sous macOS : Bsize est l'unité.
func statfsFree(path string) (uint64, error) {
	var st unix.Statfs_t
	if err := unix.Statfs(path, &st); err != nil {
		return 0, err
	}
	return availBytes(uint64(st.Bavail), uint64(st.Bsize), 0), nil
}

// statfsTotal : taille du système de fichiers, en octets (tableau de bord d'administration).
func statfsTotal(path string) (uint64, error) {
	var st unix.Statfs_t
	if err := unix.Statfs(path, &st); err != nil {
		return 0, err
	}
	return availBytes(uint64(st.Blocks), uint64(st.Bsize), 0), nil
}
