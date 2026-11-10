package share

import (
	"bytes"
	"errors"
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
