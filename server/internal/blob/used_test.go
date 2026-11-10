package blob

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"testing"
)

const id3 = "CCCCCCCCCCCCCCCCCCCCCC"

// scanned : somme des tailles relue sur le disque (la vérité du moment).
func scanned(t *testing.T, s *Store) int64 {
	t.Helper()
	n, err := s.scan()
	if err != nil {
		t.Fatal(err)
	}
	return n
}

func used(t *testing.T, s *Store) int64 {
	t.Helper()
	n, err := s.UsedBytes()
	if err != nil {
		t.Fatal(err)
	}
	return n
}

// Revue du 10 novembre : UsedBytes ne relit plus le dossier à chaque appel. Un compteur en
// mémoire, initialisé par une lecture du dossier, suit Reserve, Resize et Delete ; Resync le
// recale sur le disque (fichiers supprimés par la commande d'administration, autre processus).
func TestUsedBytesIsACounter(t *testing.T) {
	s := newStore(t)
	if err := s.Reserve(id1, 100); err != nil { // avant la première lecture : vu par elle
		t.Fatal(err)
	}
	if n := used(t, s); n != 100 {
		t.Fatal(n)
	}
	if err := s.Reserve(id2, 50); err != nil {
		t.Fatal(err)
	}
	if err := s.Resize(id1, 1000); err != nil {
		t.Fatal(err)
	}
	if n := used(t, s); n != 1050 {
		t.Fatal("après Reserve et Resize (agrandi)", n)
	}
	if err := s.Resize(id1, 10); err != nil {
		t.Fatal(err)
	}
	if err := s.Erase(id2, 0, 50); err != nil { // la taille logique reste comptée
		t.Fatal(err)
	}
	if n := used(t, s); n != 60 {
		t.Fatal("après Resize (réduit) et Erase", n)
	}
	// Échecs : rien ne bouge.
	if err := s.Reserve(id1, 500); err == nil {
		t.Fatal("réservation en double acceptée")
	}
	if err := s.Resize(id3, 500); !errors.Is(err, os.ErrNotExist) {
		t.Fatal(err)
	}
	if err := s.Delete(id3); err != nil {
		t.Fatal(err)
	}
	if n := used(t, s); n != 60 {
		t.Fatal("après des échecs", n)
	}
	if err := s.Delete(id2); err != nil {
		t.Fatal(err)
	}
	if n := used(t, s); n != 10 {
		t.Fatal("après Delete", n)
	}
	// Pas de relecture du dossier : un fichier posé hors du Store n'est vu qu'après Resync.
	if err := os.WriteFile(filepath.Join(s.Dir, id3), make([]byte, 7), 0o600); err != nil {
		t.Fatal(err)
	}
	if n := used(t, s); n != 10 {
		t.Fatal("le dossier a été relu", n)
	}
	if err := s.Resync(); err != nil {
		t.Fatal(err)
	}
	if n := used(t, s); n != 17 {
		t.Fatal("après Resync", n)
	}
	// Fichier supprimé par un autre processus : compté (prudence) jusqu'à Resync.
	if err := os.Remove(filepath.Join(s.Dir, id1)); err != nil {
		t.Fatal(err)
	}
	if n := used(t, s); n != 17 {
		t.Fatal("suppression externe vue sans Resync", n)
	}
	if err := s.Resync(); err != nil {
		t.Fatal(err)
	}
	if n := used(t, s); n != 7 {
		t.Fatal("après la suppression externe et Resync", n)
	}
}

// Une opération qui croise une relecture du dossier ne fait jamais passer le compteur sous
// la vérité : une place créée ou agrandie pendant la relecture est comptée (au pire deux
// fois, jusqu'à la relecture suivante), une place rendue pendant la relecture ne l'est pas.
func TestResyncNeverUndercounts(t *testing.T) {
	t.Run("réservation pendant la relecture", func(t *testing.T) {
		s := newStore(t)
		s.Reserve(id1, 100)
		s.afterScan = func() {
			if err := s.Reserve(id2, 50); err != nil {
				t.Error(err)
			}
			if err := s.Resize(id1, 300); err != nil {
				t.Error(err)
			}
		}
		if err := s.Resync(); err != nil {
			t.Fatal(err)
		}
		s.afterScan = nil
		if n := used(t, s); n < 350 {
			t.Fatal("place créée pendant la relecture oubliée :", n)
		}
		if err := s.Resync(); err != nil {
			t.Fatal(err)
		}
		if n := used(t, s); n != 350 {
			t.Fatal(n)
		}
	})
	t.Run("suppression et réduction pendant la relecture", func(t *testing.T) {
		s := newStore(t)
		s.Reserve(id1, 100)
		s.Reserve(id2, 50)
		s.Reserve(id3, 30)
		used(t, s)
		// Le dossier est relu (180), puis id1 est supprimé et id2 réduit avant que le
		// compteur soit recalé : sans précaution, il passerait à 180 − 100 − 40 = 40 puis
		// serait recalé à 180 (prudent), ou l'inverse (trop bas).
		s.afterScan = func() {
			if err := s.Delete(id1); err != nil {
				t.Error(err)
			}
			if err := s.Resize(id2, 10); err != nil {
				t.Error(err)
			}
		}
		if err := s.Resync(); err != nil {
			t.Fatal(err)
		}
		s.afterScan = nil
		if n := used(t, s); n < 40 {
			t.Fatal("compteur sous la vérité :", n)
		}
		if err := s.Resync(); err != nil {
			t.Fatal(err)
		}
		if n := used(t, s); n != 40 {
			t.Fatal(n)
		}
	})
	t.Run("relecture entière entre une suppression et son décompte", func(t *testing.T) {
		s := newStore(t)
		s.Reserve(id1, 100)
		used(t, s)
		// Les pas de Delete, un à un : le fichier est retiré, le dossier relu (0), puis
		// seulement la suppression est décomptée : elle ne doit pas l'être deux fois.
		scans := s.begin(0)
		if err := os.Remove(filepath.Join(s.Dir, id1)); err != nil {
			t.Fatal(err)
		}
		if err := s.Resync(); err != nil {
			t.Fatal(err)
		}
		s.end(scans, 0, -100)
		if n := used(t, s); n != 0 {
			t.Fatal("suppression décomptée deux fois :", n)
		}
	})
}

// Opérations et relectures en parallèle (à lancer avec -race) : au repos, le compteur n'est
// jamais sous la somme réelle ; après une relecture, il lui est égal.
func TestUsedBytesConcurrent(t *testing.T) {
	s := newStore(t)
	if err := os.MkdirAll(s.Dir, 0o700); err != nil {
		t.Fatal(err)
	}
	stop := make(chan struct{})
	var scans sync.WaitGroup
	scans.Add(1)
	go func() {
		defer scans.Done()
		for {
			select {
			case <-stop:
				return
			default:
				if err := s.Resync(); err != nil {
					t.Error(err)
				}
			}
		}
	}()
	var wg sync.WaitGroup
	for g := 0; g < 8; g++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for i := 0; i < 60; i++ {
				id := fmt.Sprintf("%022d", g*1000+i)
				if err := s.Reserve(id, int64(1000+i)); err != nil {
					t.Error(err)
				}
				if err := s.Resize(id, int64(3000+i)); err != nil {
					t.Error(err)
				}
				if _, err := s.UsedBytes(); err != nil {
					t.Error(err)
				}
				if err := s.Resize(id, int64(500+i)); err != nil {
					t.Error(err)
				}
				if i%3 != 0 {
					if err := s.Delete(id); err != nil {
						t.Error(err)
					}
				}
			}
		}()
	}
	wg.Wait()
	close(stop)
	scans.Wait()
	truth := scanned(t, s)
	if truth == 0 {
		t.Fatal("aucun fichier gardé")
	}
	if n := used(t, s); n < truth {
		t.Fatalf("compteur %d sous la somme réelle %d", n, truth)
	}
	if err := s.Resync(); err != nil {
		t.Fatal(err)
	}
	if n := used(t, s); n != truth {
		t.Fatalf("après relecture : compteur %d, somme réelle %d", n, truth)
	}
}
