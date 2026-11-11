package share

import (
	"bytes"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// Disparition pendant un téléchargement (spec §41.8, D41-10 ; Task M2 étapes 3c et 7b).
// Palier 400 : 7 segments (un fichier de 40 segments ne correspond à aucun palier ; la
// règle est la même à chaque segment).
const gb = 400

// heldFDs : descripteurs du processus ouverts sur le fichier du partage id, même supprimé
// (Linux, /proc/self/fd) ; -1 ailleurs.
func heldFDs(t *testing.T, s *Service, id string) int {
	t.Helper()
	es, err := os.ReadDir("/proc/self/fd")
	if err != nil {
		return -1
	}
	n := 0
	for _, e := range es {
		if l, err := os.Readlink(filepath.Join("/proc/self/fd", e.Name())); err == nil && strings.HasPrefix(l, filepath.Join(s.Blobs.Dir, id)) {
			n++
		}
	}
	return n
}

func listed(t *testing.T, s *Service, id string) bool {
	t.Helper()
	ids, err := s.Blobs.List()
	if err != nil {
		t.Fatal(err)
	}
	for _, x := range ids {
		if x == id {
			return true
		}
	}
	return false
}

func mustRead(t *testing.T, s *Service, id string, n, openN int) {
	t.Helper()
	got, err := readSegment(s, id, n, openN)
	if err != nil {
		t.Fatalf("segment %d de l'ouverture %d : %v", n, openN, err)
	}
	if !bytes.Equal(got, segBody(gb, n, byte(n+1))) {
		t.Fatalf("segment %d : octets différents", n)
	}
}

func mustGone(t *testing.T, s *Service, id string, n, openN int) {
	t.Helper()
	if _, err := readSegment(s, id, n, openN); !errors.Is(err, ErrGone) {
		t.Fatalf("segment %d de l'ouverture %d : %v, attendu ErrGone", n, openN, err)
	}
}

func at(h, m, sec int) time.Time { return time.Date(2026, 11, 4, h, m, sec, 0, time.UTC) }

func setClock(c *clock, t time.Time) { c.mu.Lock(); c.t = t; c.mu.Unlock() }

// Cas 1 : à l'échéance (11:15), l'ouverture active (segment servi dans les 120 s) continue ;
// l'ouverture jamais commencée et toute nouvelle ouverture sont refusées ; le partage est
// retiré du dossier et de la base dès le balayage ; pas de reprise après 120 s de pause.
func TestExpiryGraceForActiveOpen(t *testing.T) {
	s, c := newSvc(t)
	k := newKeys()
	id := ready(t, s, k, gb, 1, 3) // expires_at = 11:15
	o1, _, _ := s.Unlock(id, k.acces, k.preuve)
	o2, _, _ := s.Unlock(id, k.acces, k.preuve) // émise, jamais commencée
	setClock(c, at(11, 14, 0))
	mustRead(t, s, id, 0, o1)
	setClock(c, at(11, 15, 30))
	mustRead(t, s, id, 1, o1) // après l'échéance, avant le balayage
	mustGone(t, s, id, 0, o2)
	if _, err := s.Meta(k.acces); !errors.Is(err, ErrNotFound) {
		t.Fatal("meta après l'échéance", err)
	}
	if _, _, err := s.Unlock(id, k.acces, k.preuve); !errors.Is(err, ErrNotFound) {
		t.Fatal("unlock après l'échéance", err)
	}
	if _, err := s.Sweep(); err != nil {
		t.Fatal(err)
	}
	gone(t, s, id) // ligne et nom de fichier retirés
	setClock(c, at(11, 16, 30))
	mustRead(t, s, id, 2, o1) // depuis le descripteur gardé
	mustRead(t, s, id, 3, o1)
	setClock(c, at(11, 18, 30)) // 120 s sans segment : droit perdu
	mustGone(t, s, id, 4, o1)
	if _, err := s.Sweep(); err != nil {
		t.Fatal(err)
	}
	if n := heldFDs(t, s, id); n > 0 {
		t.Fatal("descripteur encore ouvert", n)
	}
	if err := s.Done(id, o1); !errors.Is(err, ErrGone) {
		t.Fatal("done après disparition", err)
	}
}

// La grâce finit à l'échéance + 2 h, même pour une ouverture restée active (ici par un
// segment en cours, le budget de lecture interdisant de relire le paquet pendant 2 h).
func TestExpiryGraceEndsAfter2h(t *testing.T) {
	s, c := newSvc(t)
	k := newKeys()
	id := ready(t, s, k, gb, 1, 1)
	o1, _, _ := s.Unlock(id, k.acces, k.preuve)
	setClock(c, at(11, 14, 0))
	slow, err := s.OpenSegment(id, 0, o1)
	if err != nil {
		t.Fatal(err)
	}
	defer slow.Close()
	setClock(c, at(12, 0, 0))
	s.Sweep()
	mustRead(t, s, id, 1, o1)
	setClock(c, at(13, 14, 59))
	s.Sweep()
	mustRead(t, s, id, 2, o1)
	setClock(c, at(13, 15, 0))
	mustGone(t, s, id, 3, o1)
}

// Un segment en cours d'envoi à l'échéance n'est jamais coupé, même par le balayage.
func TestSegmentInFlightNotCutAtExpiry(t *testing.T) {
	s, c := newSvc(t)
	k := newKeys()
	id := ready(t, s, k, gb, 1, 1)
	o1, _, _ := s.Unlock(id, k.acces, k.preuve)
	setClock(c, at(11, 14, 50))
	seg, err := s.OpenSegment(id, 2, o1)
	if err != nil {
		t.Fatal(err)
	}
	half := make([]byte, seg.Size()/2)
	if _, err := io.ReadFull(seg, half); err != nil {
		t.Fatal(err)
	}
	setClock(c, at(11, 17, 30)) // flux lent : plus de 120 s pour ce segment
	if _, err := s.Sweep(); err != nil {
		t.Fatal(err)
	}
	rest, err := io.ReadAll(seg)
	seg.Close()
	if err != nil || !bytes.Equal(append(half, rest...), segBody(gb, 2, 3)) {
		t.Fatal("segment en cours coupé", err)
	}
	mustRead(t, s, id, 3, o1) // fin du segment il y a moins de 120 s : toujours active
}

// Cas 2 : suppression par l'expéditeur, par le destinataire, ou 5 mots de passe faux,
// pendant un téléchargement : plus rien de neuf ; l'ouverture active finit depuis le
// descripteur gardé, le fichier n'est plus listé, la place reste comptée jusqu'à la fermeture.
func TestDeleteDuringDownloadGrace(t *testing.T) {
	for _, tc := range []struct {
		name string
		kill func(s *Service, k keys, id string) error
	}{
		{"expéditeur", func(s *Service, k keys, _ string) error { return s.DestroyManaged(k.gestion) }},
		{"destinataire", func(s *Service, k keys, _ string) error { return s.DestroyWithProof(k.acces, k.preuve, false) }},
		{"5 mots de passe faux", func(s *Service, k keys, id string) error {
			for i := 0; i < maxAttempts; i++ {
				s.Unlock(id, k.acces, rnd(32))
			}
			return nil
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s, c := newSvc(t)
			s.StorageMax = totalSize(gb) // la place d'un seul partage
			k := newKeys()
			id := ready(t, s, k, gb, 24, 3)
			o1, _, _ := s.Unlock(id, k.acces, k.preuve)
			o2, _, _ := s.Unlock(id, k.acces, k.preuve)
			mustRead(t, s, id, 0, o1)
			if err := tc.kill(s, k, id); err != nil {
				t.Fatal(err)
			}
			gone(t, s, id)
			if n := heldFDs(t, s, id); n == 0 {
				t.Fatal("aucun descripteur détaché (le contrôle des descripteurs ne prouverait rien)")
			}
			if listed(t, s, id) {
				t.Fatal("fichier encore listé")
			}
			if _, err := s.Meta(k.acces); !errors.Is(err, ErrNotFound) {
				t.Fatal(err)
			}
			if _, _, err := s.Unlock(id, k.acces, k.preuve); !errors.Is(err, ErrNotFound) {
				t.Fatal(err)
			}
			if _, err := s.Status(k.gestion); !errors.Is(err, ErrNotFound) {
				t.Fatal(err)
			}
			mustGone(t, s, id, 0, o2) // autre ouverture, pas commencée
			if _, _, err := s.createAny(newKeys().req(gb, 1, 1)); !errors.Is(err, ErrFull) {
				t.Fatal("place libérée avant la fermeture du descripteur", err)
			}
			for n := 1; n < SegmentCount(gb); n++ {
				c.Add(30 * time.Second)
				mustRead(t, s, id, n, o1)
			}
			// Fin de grâce (2 h) : descripteur fermé, place libérée.
			c.Add(2 * time.Hour)
			mustGone(t, s, id, 0, o1)
			s.Sweep()
			if n := heldFDs(t, s, id); n > 0 {
				t.Fatal("descripteur encore ouvert", n)
			}
			if _, _, err := s.createAny(newKeys().req(gb, 1, 1)); err != nil {
				t.Fatal("place non libérée", err)
			}
		})
	}
}

// done de la seule ouverture active d'un partage supprimé : descripteur fermé aussitôt.
func TestDetachedClosedAtDone(t *testing.T) {
	s, _ := newSvc(t)
	k := newKeys()
	id := ready(t, s, k, gb, 24, 2)
	o1, _, _ := s.Unlock(id, k.acces, k.preuve)
	mustRead(t, s, id, 0, o1)
	if err := s.DestroyManaged(k.gestion); err != nil {
		t.Fatal(err)
	}
	mustRead(t, s, id, 1, o1)
	if err := s.Done(id, o1); err != nil {
		t.Fatal(err)
	}
	if n := heldFDs(t, s, id); n > 0 {
		t.Fatal("descripteur encore ouvert après done", n)
	}
	mustGone(t, s, id, 2, o1)
}

// Exceptions sans grâce : signalement et destruction par l'administrateur coupent tous les
// flux en cours (octets reçus < taille) ; aucune requête suivante n'est servie.
func TestReportAndAdminCutStreams(t *testing.T) {
	for _, tc := range []struct {
		name string
		kill func(s *Service, k keys, id string)
	}{
		{"signalement", func(s *Service, k keys, _ string) {
			if err := s.DestroyWithProof(k.acces, k.preuve, true); err != nil {
				t.Fatal(err)
			}
		}},
		{"administrateur", func(s *Service, k keys, _ string) {
			if err := s.DestroyAdmin(k.acces); err != nil {
				t.Fatal(err)
			}
		}},
		{"administrateur (autre processus)", func(s *Service, _ keys, id string) {
			// shhdrop admin destroy : fichier et ligne effacés hors du serveur.
			os.Remove(filepath.Join(s.Blobs.Dir, id))
			s.DB.Exec(`DELETE FROM shares WHERE id=?`, id)
			if err := s.PollRemoved(); err != nil {
				t.Fatal(err)
			}
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s, _ := newSvc(t)
			k := newKeys()
			id := ready(t, s, k, gb, 24, 2)
			o1, _, _ := s.Unlock(id, k.acces, k.preuve)
			o2, _, _ := s.Unlock(id, k.acces, k.preuve)
			w, err := s.Watch(id, o2)
			if err != nil {
				t.Fatal(err)
			}
			defer w.Stop()
			seg, err := s.OpenSegment(id, 1, o1)
			if err != nil {
				t.Fatal(err)
			}
			buf := make([]byte, 64<<10)
			if _, err := io.ReadFull(seg, buf); err != nil {
				t.Fatal(err)
			}
			tc.kill(s, k, id)
			select {
			case <-w.Gone:
			case <-time.After(time.Second):
				t.Fatal("surveillance non prévenue")
			}
			rest, err := io.ReadAll(seg)
			seg.Close()
			if err == nil || int64(len(buf)+len(rest)) >= seg.Size() {
				t.Fatal("flux non coupé", len(rest), err)
			}
			mustGone(t, s, id, 2, o1)
			if s.streams.Len() != 0 {
				t.Fatal("registre non vide", s.streams.Len())
			}
			if n := heldFDs(t, s, id); n > 0 {
				t.Fatal("descripteur encore ouvert", n)
			}
		})
	}
}

// Surveillance : ErrGone aussitôt pour un partage disparu ou une ouverture terminée ;
// sinon le canal se ferme à la suppression, et l'échéance est rendue.
func TestWatch(t *testing.T) {
	s, c := newSvc(t)
	k := newKeys()
	id := ready(t, s, k, 1, 1, 2)
	o1, _, _ := s.Unlock(id, k.acces, k.preuve)
	w, err := s.Watch(id, o1)
	if err != nil || !w.Expires.Equal(at(11, 15, 0)) {
		t.Fatal(w.Expires, err)
	}
	select {
	case <-w.Gone:
		t.Fatal("prévenu trop tôt")
	default:
	}
	if err := s.DestroyManaged(k.gestion); err != nil {
		t.Fatal(err)
	}
	select {
	case <-w.Gone:
	case <-time.After(time.Second):
		t.Fatal("non prévenu")
	}
	w.Stop()
	if _, err := s.Watch(id, o1); !errors.Is(err, ErrGone) {
		t.Fatal(err)
	}
	k2 := newKeys()
	id2 := ready(t, s, k2, 1, 1, 2)
	p1, _, _ := s.Unlock(id2, k2.acces, k2.preuve)
	s.Unlock(id2, k2.acces, k2.preuve)
	s.Done(id2, p1)
	if _, err := s.Watch(id2, p1); !errors.Is(err, ErrGone) {
		t.Fatal("ouverture terminée", err)
	}
	c.Add(2 * time.Hour)
	p2 := 2
	if _, err := s.Watch(id2, p2); !errors.Is(err, ErrGone) {
		t.Fatal("partage expiré", err)
	}
	s.gone.mu.Lock()
	n := len(s.gone.watch)
	s.gone.mu.Unlock()
	if n != 0 {
		t.Fatal("abonnements restants", n)
	}
}

// Audit F2 : un signalement après l'échéance ou une destruction coupe aussi les lectures en
// grâce (spec §41.8 : « signalement : aucune grâce »). Réponse inchangée (introuvable, comme
// tout partage disparu) ; il exige K_accès et K_preuve, comme un signalement ordinaire.
func TestReportCutsGraceReads(t *testing.T) {
	for _, tc := range []struct {
		name string
		end  func(t *testing.T, s *Service, c *clock, k keys, id string)
	}{
		{"échu, pas encore balayé", func(t *testing.T, s *Service, c *clock, _ keys, _ string) {
			setClock(c, at(11, 15, 30))
		}},
		{"échu et balayé (descripteur détaché)", func(t *testing.T, s *Service, c *clock, _ keys, id string) {
			setClock(c, at(11, 15, 30))
			if _, err := s.Sweep(); err != nil {
				t.Fatal(err)
			}
			gone(t, s, id)
		}},
		{"détruit par l'expéditeur", func(t *testing.T, s *Service, _ *clock, k keys, _ string) {
			if err := s.DestroyManaged(k.gestion); err != nil {
				t.Fatal(err)
			}
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s, c := newSvc(t)
			k := newKeys()
			id := ready(t, s, k, gb, 1, 2) // expires_at = 11:15
			o1, _, _ := s.Unlock(id, k.acces, k.preuve)
			setClock(c, at(11, 14, 0))
			mustRead(t, s, id, 0, o1)
			seg, err := s.OpenSegment(id, 1, o1)
			if err != nil {
				t.Fatal(err)
			}
			defer seg.Close()
			tc.end(t, s, c, k, id)
			// Mauvaise preuve : rien n'est coupé.
			if err := s.DestroyWithProof(k.acces, rnd(32), true); !errors.Is(err, ErrNotFound) {
				t.Fatal(err)
			}
			if seg.Context().Err() != nil {
				t.Fatal("flux coupé sans la bonne preuve")
			}
			if err := s.DestroyWithProof(k.acces, k.preuve, true); !errors.Is(err, ErrNotFound) {
				t.Fatal("réponse :", err)
			}
			if seg.Context().Err() == nil {
				t.Fatal("flux en grâce non coupé par le signalement")
			}
			seg.Close()
			mustGone(t, s, id, 2, o1)
			if n := heldFDs(t, s, id); n > 0 {
				t.Fatal("descripteur encore ouvert", n)
			}
		})
	}
}
