//go:build !unix

package config

// nofile : inconnue hors Unix.
func nofile() uint64 { return 0 }
