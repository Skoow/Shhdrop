//go:build !linux

package main

// durcirProcessus : sans objet hors Linux (la production tourne sous Linux ; PR_SET_DUMPABLE
// n'existe pas ailleurs). Voir dumpable_linux.go.
func durcirProcessus() {}
