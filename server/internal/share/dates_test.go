package share

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

// Audit adverse du 13 novembre, 3e campagne, stockage, F5 : le brouillage des dates du janitor
// ne visitait que les dossiers des partages et du salon. Le dossier de données, frozen, kill/,
// kill.key et les fichiers de la base gardaient l'heure du dernier gel, de la dernière
// destruction par l'administrateur ou de la dernière écriture. Après ScrubDataTimes, leurs dates
// de contenu et d'accès sont à l'epoch (le ctime, lui, prend l'heure du passage), et la base
// reste utilisable.
func TestBrouillageDesDatesDuDossierDeDonnees(t *testing.T) {
	s, _ := newSvc(t)
	k := newKeys()
	ready(t, s, k, 1, 24, 2) // écrit dans shares.db-wal
	dir := filepath.Dir(s.FrozenFile)
	if _, err := s.ensureKillKey(); err != nil {
		t.Fatal(err)
	}
	// kill/ existe dès le premier passage du serveur, pas à la première destruction : sa date
	// de création ne dit plus l'heure de la première destruction par l'administrateur.
	if fi, err := os.Stat(s.killDir()); err != nil || !fi.IsDir() {
		t.Fatal("kill/ non créé avec la clé du serveur :", err)
	}
	if err := os.WriteFile(s.FrozenFile, nil, 0o600); err != nil { // gel (cmd/shhdrop freeze)
		t.Fatal(err)
	}
	noms := []string{"", "frozen", "kill", "kill.key", "shares.db", "shares.db-wal", "shares.db-shm"}
	maintenant := time.Now()
	for _, n := range noms {
		p := filepath.Join(dir, n)
		if _, err := os.Stat(p); err != nil {
			t.Fatalf("témoin : %q absent (%v)", n, err)
		}
		if err := os.Chtimes(p, maintenant, maintenant); err != nil {
			t.Fatal(err)
		}
	}
	if err := s.ScrubDataTimes(); err != nil {
		t.Fatal(err)
	}
	for _, n := range noms {
		fi, err := os.Stat(filepath.Join(dir, n))
		if err != nil {
			t.Fatal(err)
		}
		if !fi.ModTime().Equal(time.Unix(0, 0)) {
			t.Errorf("%q : date de modification %v après le brouillage (attendu : epoch)", "data/"+n, fi.ModTime())
		}
	}
	// Fichiers absents (pas de gel) : pas une erreur ; la base continue de servir normalement
	// (écriture et lecture).
	if err := os.Remove(s.FrozenFile); err != nil {
		t.Fatal(err)
	}
	if err := s.ScrubDataTimes(); err != nil {
		t.Fatal("sans frozen :", err)
	}
	id, _, err := s.Create(newKeys().req(1, 24, 1))
	if err != nil {
		t.Fatal("base après le brouillage :", err)
	}
	if rowCount(t, s, id) != 1 {
		t.Fatal("lecture après le brouillage")
	}
}
