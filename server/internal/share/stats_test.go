package share

import "testing"

// Tableau de bord d'administration : décompte des partages par état, un agrégat sans aucun
// identifiant (un partage prêt, un envoi en cours ; les états absents valent 0).
func TestCountByState(t *testing.T) {
	s, _ := newSvc(t)
	if got, err := s.CountByState(); err != nil || got.Uploading != 0 || got.Ready != 0 || got.Draining != 0 {
		t.Fatalf("base vide : %+v, %v", got, err)
	}
	ready(t, s, newKeys(), 1, 24, 1)
	if _, _, err := s.createAny(newKeys().req(1, 24, 1)); err != nil { // envoi resté en cours
		t.Fatal(err)
	}
	got, err := s.CountByState()
	if err != nil {
		t.Fatal(err)
	}
	if got.Ready != 1 || got.Uploading != 1 || got.Draining != 0 {
		t.Fatalf("décompte : %+v, attendu 1 prêt, 1 envoi en cours, 0 en fin de lecture", got)
	}
}
