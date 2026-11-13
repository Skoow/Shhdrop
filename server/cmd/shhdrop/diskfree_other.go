//go:build !linux && !darwin

package main

import "errors"

// statfsFree : non pris en charge ; le démarrage est refusé (échec fermé).
func statfsFree(string) (uint64, error) {
	return 0, errors.New("espace disque libre illisible sur ce système")
}

// statfsTotal : non pris en charge.
func statfsTotal(string) (uint64, error) {
	return 0, errors.New("taille du disque illisible sur ce système")
}
