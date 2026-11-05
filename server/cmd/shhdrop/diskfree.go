package main

// availBytes : octets disponibles. Bavail se compte en blocs de « fragment » (Frsize,
// POSIX statvfs), pas de Bsize (taille d'E/S préférée) : Frsize quand il est non nul.
func availBytes(bavail, bsize, frsize uint64) uint64 {
	if frsize != 0 {
		return bavail * frsize
	}
	return bavail * bsize
}
