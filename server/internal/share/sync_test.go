package share

import (
	"bytes"
	"errors"
	"sync"
	"testing"

	"github.com/skoow/shhdrop/server/internal/blob"
)

// hookSync remplace syncBlob le temps du test.
func hookSync(t *testing.T, f func(b *blob.Store, id string) error) {
	t.Helper()
	orig := syncBlob
	syncBlob = f
	t.Cleanup(func() { syncBlob = orig })
}

func stateOf(t *testing.T, s *Service, id string) string {
	t.Helper()
	var st string
	if err := s.DB.QueryRow(`SELECT state FROM shares WHERE id=?`, id).Scan(&st); err != nil {
		t.Fatal(err)
	}
	return st
}

// Revue B4 : le fichier est forcé sur le disque (fdatasync) avant que le partage passe en
// « ready » ; plus rien n'y est écrit après la dernière synchronisation. Sans cela, une panne
// de courant juste après la finalisation laisserait un partage « ready » au contenu perdu.
func TestFinalizeSyncsBeforeReady(t *testing.T) {
	for name, tc := range map[string]struct {
		prepare func(t *testing.T, s *Service) (string, FinalizeReq)
	}{
		"au clic": {func(t *testing.T, s *Service) (string, FinalizeReq) {
			id := upload400(t, s, newKeys(), 1, 2, 3, 4, 5)
			return id, withFill(id, 1, 6)
		}},
		"brouillon": {func(t *testing.T, s *Service) (string, FinalizeReq) {
			id, _, err := s.createAny(newKeys().req(160, 1, 1))
			if err != nil {
				t.Fatal(err)
			}
			if err := s.PutSegment(id, 0, segBody(160, 0, 1)); err != nil {
				t.Fatal(err)
			}
			return id, draftFin(id, 80)
		}},
	} {
		t.Run(name, func(t *testing.T) {
			s, _ := newSvc(t)
			id, r := tc.prepare(t, s)
			var last []byte
			calls := 0
			hookSync(t, func(b *blob.Store, got string) error {
				calls++
				if got != id {
					t.Errorf("synchronisation de %q", got)
				}
				if st := stateOf(t, s, id); st != "uploading" {
					t.Errorf("synchronisation après le passage à %q", st)
				}
				last = fileBytes(t, s, id)
				return b.Sync(got)
			})
			if _, err := s.Finalize(id, r); err != nil {
				t.Fatal(err)
			}
			if calls == 0 {
				t.Fatal("fichier jamais synchronisé avant « ready »")
			}
			if stateOf(t, s, id) != "ready" || !bytes.Equal(last, fileBytes(t, s, id)) {
				t.Fatal("fichier modifié après la dernière synchronisation")
			}
		})
	}
}

// Une synchronisation qui échoue (disque en erreur) empêche la finalisation : l'envoi reste
// « uploading », et un nouvel essai aboutit.
func TestFinalizeAbortsWhenSyncFails(t *testing.T) {
	boom := errors.New("disque en erreur")
	for name, draft := range map[string]bool{"au clic": false, "brouillon": true} {
		t.Run(name, func(t *testing.T) {
			s, _ := newSvc(t)
			id, _, err := s.createAny(newKeys().req(16, 1, 1))
			if err != nil {
				t.Fatal(err)
			}
			if err := s.PutSegment(id, 0, segBody(16, 0, 1)); err != nil {
				t.Fatal(err)
			}
			r := fin(id)
			if draft {
				r = draftFin(id, 16)
			}
			hookSync(t, func(*blob.Store, string) error { return boom })
			if _, err := s.Finalize(id, r); !errors.Is(err, boom) {
				t.Fatal("finalisation malgré l'échec de la synchronisation :", err)
			}
			if st := stateOf(t, s, id); st != "uploading" {
				t.Fatal("état", st)
			}
			syncBlob = func(b *blob.Store, id string) error { return b.Sync(id) }
			if _, err := s.Finalize(id, r); err != nil {
				t.Fatal(err)
			}
			if st := stateOf(t, s, id); st != "ready" {
				t.Fatal("état", st)
			}
		})
	}
}

// Rapport de performance A12 : le fichier d'un envoi est synchronisé en arrière-plan tous les
// syncEvery octets reçus, jamais deux fois à la fois pour le même envoi ; Finalize synchronise
// toujours tout le fichier avant « ready ».
func TestSynchronisationDeFond(t *testing.T) {
	s, _ := newSvc(t)
	var mu sync.Mutex
	calls, enCours, maxEnCours := 0, 0, 0
	orig := bgSyncBlob
	bgSyncBlob = func(b *blob.Store, id string) error {
		mu.Lock()
		calls++
		enCours++
		maxEnCours = max(maxEnCours, enCours)
		mu.Unlock()
		err := orig(b, id)
		mu.Lock()
		enCours--
		mu.Unlock()
		return err
	}
	t.Cleanup(func() { bgSyncBlob = orig })
	const bucket = 1600 // 25 segments de 4 Mio
	k := newKeys()
	id, segs, err := s.createAny(k.req(bucket, 24, 1))
	if err != nil {
		t.Fatal(err)
	}
	for n := range segs {
		if err := s.PutSegment(id, n, segBody(bucket, n, byte(n+1))); err != nil {
			t.Fatal(err)
		}
	}
	s.waitBackgroundSync()
	mu.Lock()
	c, m := calls, maxEnCours
	mu.Unlock()
	// 25 segments ≈ 100 Mio : au moins une, au plus 3 synchronisations de fond (32 Mio).
	if c < 1 || c > 3 || m != 1 {
		t.Fatalf("synchronisations de fond : %d (au plus %d à la fois)", c, m)
	}
	if _, err := s.Finalize(id, fin(id)); err != nil {
		t.Fatal(err)
	}
}
