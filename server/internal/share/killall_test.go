package share

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/skoow/shhdrop/server/internal/blob"
)

// adminOf : Service de la commande d'administration (autre processus) sur les mêmes données.
func adminOf(t *testing.T, s *Service, wait time.Duration) *Service {
	t.Helper()
	a, err := NewService(Config{DB: s.DB, Blobs: &blob.Store{Dir: s.Blobs.Dir}, Now: s.Now,
		StorageMax: s.StorageMax, FrozenFile: s.FrozenFile, KillWait: wait})
	if err != nil {
		t.Fatal(err)
	}
	return a
}

// pollEvery : janitor.Watch du serveur, jusqu'à la fin du test.
func pollEvery(t *testing.T, s *Service) {
	t.Helper()
	stop, done := make(chan struct{}), make(chan struct{})
	t.Cleanup(func() { close(stop); <-done })
	go func() {
		defer close(done)
		for {
			select {
			case <-stop:
				return
			case <-time.After(20 * time.Millisecond):
				s.PollRemoved()
			}
		}
	}()
}

func killRequests(s *Service) int {
	es, _ := os.ReadDir(filepath.Join(filepath.Dir(s.FrozenFile), "kill"))
	return len(es)
}

// Revue B5 : « shhdrop admin wipe » (autre processus) coupe aussi les partages déjà retirés
// dont une ouverture finissait sur un descripteur détaché (jusqu'à 2 h de grâce) : le serveur
// en marche coupe tous ses flux détachés, ferme les descripteurs et efface la demande.
func TestCutAllDetached(t *testing.T) {
	t.Run("serveur en marche : flux détachés coupés, demande effacée", func(t *testing.T) {
		s, _ := newSvc(t)
		var ids []string
		var segs []*Segment
		var opens []int
		for i := 0; i < 2; i++ {
			k := newKeys()
			id := ready(t, s, k, gb, 24, 2)
			o, _, _ := s.Unlock(id, k.acces, k.preuve)
			mustRead(t, s, id, 0, o)
			seg, err := s.OpenSegment(id, 1, o)
			if err != nil {
				t.Fatal(err)
			}
			if err := s.DestroyManaged(k.gestion); err != nil {
				t.Fatal(err)
			}
			mustRead(t, s, id, 2, o) // grâce : l'ouverture active continue
			ids, segs, opens = append(ids, id), append(segs, seg), append(opens, o)
		}
		pollEvery(t, s)
		ok, err := adminOf(t, s, 3*time.Second).CutAllDetached()
		if err != nil || !ok {
			t.Fatal("coupure non confirmée", ok, err)
		}
		for i, id := range ids {
			if _, err := segs[i].Read(make([]byte, 1<<20)); err == nil {
				if _, err := segs[i].Read(make([]byte, 64<<20)); err == nil {
					t.Fatal("flux en cours non coupé")
				}
			}
			segs[i].Close()
			mustGone(t, s, id, 3, opens[i])
			if n := heldFDs(t, s, id); n > 0 {
				t.Fatal("descripteur encore ouvert", n)
			}
		}
		if killRequests(s) != 0 {
			t.Fatal("demande restée")
		}
	})
	t.Run("serveur en marche sans descripteur détaché : confirmé aussi", func(t *testing.T) {
		s, _ := newSvc(t)
		pollEvery(t, s)
		if ok, err := adminOf(t, s, 3*time.Second).CutAllDetached(); err != nil || !ok || killRequests(s) != 0 {
			t.Fatal(ok, err, killRequests(s))
		}
	})
	t.Run("aucun serveur : non confirmé, demande retirée", func(t *testing.T) {
		s, _ := newSvc(t)
		if ok, err := adminOf(t, s, 100*time.Millisecond).CutAllDetached(); err != nil || ok || killRequests(s) != 0 {
			t.Fatal(ok, err, killRequests(s))
		}
	})
}

// Audit F9 : un envoi en cours effacé par « shhdrop admin destroy » ou « wipe » (autre
// processus : ligne et fichier retirés hors du serveur) est oublié au balayage suivant
// (échéances en mémoire) et signalé à OnAbandon (place d'envoi en cours rendue aux quotas).
// Un envoi en cours de création (échéance posée, ligne pas encore écrite) n'est pas touché.
func TestSweepForgetsUploadsRemovedElsewhere(t *testing.T) {
	s, _ := newSvc(t)
	var abandoned []string
	s.OnAbandon = func(id string, _ int) { abandoned = append(abandoned, id) }
	id, _, err := s.createAny(newKeys().req(80, 1, 1))
	if err != nil {
		t.Fatal(err)
	}
	keep, _, err := s.createAny(newKeys().req(80, 1, 1))
	if err != nil {
		t.Fatal(err)
	}
	os.Remove(filepath.Join(s.Blobs.Dir, id))
	if _, err := s.DB.Exec(`DELETE FROM shares WHERE id=?`, id); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Sweep(); err != nil {
		t.Fatal(err)
	}
	s.mem.mu.Lock()
	_, still := s.mem.up[id]
	_, kept := s.mem.up[keep]
	s.mem.mu.Unlock()
	if still || !kept {
		t.Fatal("échéance d'envoi : oubliée", !still, "gardée pour l'envoi vivant", kept)
	}
	if len(abandoned) != 1 || abandoned[0] != id {
		t.Fatal("OnAbandon :", abandoned)
	}
	if _, err := s.Sweep(); err != nil || len(abandoned) != 1 {
		t.Fatal("signalé deux fois", abandoned, err)
	}
}
