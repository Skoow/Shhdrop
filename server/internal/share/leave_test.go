package share

import (
	"io"
	"testing"
	"time"
)

// Suppression à la sortie (D41-28).

func lastOpen(t *testing.T, s *Service, k keys, opens int) (string, Opened) {
	t.Helper()
	id := ready(t, s, k, 1, 24, opens)
	var o Opened
	for range opens {
		var err error
		if o, err = s.UnlockGrant(id, k.acces, k.preuve, ""); err != nil {
			t.Fatal(err)
		}
	}
	if o.OpensLeft != 0 {
		t.Fatal("dernière ouverture attendue", o.OpensLeft)
	}
	return id, o
}

func sweepLeaves(t *testing.T, s *Service) int {
	t.Helper()
	n, err := s.SweepLeaves()
	if err != nil {
		t.Fatal(err)
	}
	return n
}

func TestLeaveDestroysAfterDelay(t *testing.T) {
	s, c := newSvc(t)
	k := newKeys()
	id, o := lastOpen(t, s, k, 1)
	if err := s.Leave(id, o.N); err != nil || s.LeaveCount() != 1 {
		t.Fatal(err, s.LeaveCount())
	}
	c.Add((LeaveDelay - 1) * time.Second)
	if sweepLeaves(t, s) != 0 || rowCount(t, s, id) != 1 {
		t.Fatal("détruit avant 3 min")
	}
	c.Add(time.Second)
	if sweepLeaves(t, s) != 1 || rowCount(t, s, id) != 0 || s.LeaveCount() != 0 {
		t.Fatal("pas détruit après 3 min")
	}
	if _, err := s.Meta(k.acces); err != ErrNotFound {
		t.Fatal("encore trouvable", err)
	}
}

func TestLeaveCancelledByReopen(t *testing.T) {
	s, c := newSvc(t)
	k := newKeys()
	id, o := lastOpen(t, s, k, 2)
	if err := s.Leave(id, o.N); err != nil {
		t.Fatal(err)
	}
	c.Add(10 * time.Second)
	if _, err := s.UnlockGrant(id, k.acces, k.preuve, o.Grant); err != nil { // rechargement
		t.Fatal(err)
	}
	c.Add(LeaveDelay * time.Second)
	if sweepLeaves(t, s) != 0 || rowCount(t, s, id) != 1 || s.LeaveCount() != 0 {
		t.Fatal("détruit malgré le rechargement")
	}
}

func TestLeaveCancelledByMetaGrant(t *testing.T) {
	s, c := newSvc(t)
	k := newKeys()
	id, o := lastOpen(t, s, k, 1)
	if err := s.Leave(id, o.N); err != nil {
		t.Fatal(err)
	}
	if _, err := s.MetaGrant(k.acces, o.Grant); err != nil { // rechargement, avant le mot de passe
		t.Fatal(err)
	}
	c.Add(2 * LeaveDelay * time.Second)
	if sweepLeaves(t, s) != 0 || rowCount(t, s, id) != 1 {
		t.Fatal("détruit malgré le rechargement")
	}
}

func TestLeaveCancelledByRegrant(t *testing.T) {
	s, c := newSvc(t)
	k := newKeys()
	id, o := lastOpen(t, s, k, 1)
	if err := s.Leave(id, o.N); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Regrant(id, o.N, c.Now().Add(time.Hour)); err != nil { // autre onglet vivant
		t.Fatal(err)
	}
	c.Add(2 * LeaveDelay * time.Second)
	if sweepLeaves(t, s) != 0 || rowCount(t, s, id) != 1 {
		t.Fatal("détruit malgré un autre onglet")
	}
}

func TestLeaveWaitsForActiveSegment(t *testing.T) {
	s, c := newSvc(t)
	k := newKeys()
	id, o := lastOpen(t, s, k, 1)
	if err := s.Leave(id, o.N); err != nil {
		t.Fatal(err)
	}
	c.Add(30 * time.Second)
	seg, err := s.OpenSegment(id, 0, o.N) // téléchargement en arrière-plan
	if err != nil {
		t.Fatal(err)
	}
	c.Add(LeaveDelay * time.Second) // plus de 3 min après le départ, segment en cours
	if sweepLeaves(t, s) != 0 || rowCount(t, s, id) != 1 {
		t.Fatal("détruit pendant une lecture")
	}
	io.Copy(io.Discard, seg)
	seg.Close()
	c.Add((LeaveDelay - 1) * time.Second)
	if sweepLeaves(t, s) != 0 {
		t.Fatal("détruit moins de 3 min après la dernière lecture")
	}
	c.Add(time.Second)
	if sweepLeaves(t, s) != 1 || rowCount(t, s, id) != 0 {
		t.Fatal("pas détruit après la fin de la lecture")
	}
}

func TestLeaveIgnoredForNonLastOpening(t *testing.T) {
	s, c := newSvc(t)
	k := newKeys()
	id := ready(t, s, k, 1, 24, 3)
	o, err := s.UnlockGrant(id, k.acces, k.preuve, "")
	if err != nil || o.OpensLeft != 2 {
		t.Fatal(o, err)
	}
	if err := s.Leave(id, o.N); err != nil || s.LeaveCount() != 0 {
		t.Fatal("ouverture non dernière armée", err)
	}
	// Ouverture 1 d'un partage devenu « draining » : toujours pas la dernière.
	for range 2 {
		if _, err := s.UnlockGrant(id, k.acces, k.preuve, ""); err != nil {
			t.Fatal(err)
		}
	}
	if err := s.Leave(id, o.N); err != nil || s.LeaveCount() != 0 {
		t.Fatal("ouverture 1 armée", err)
	}
	c.Add(2 * LeaveDelay * time.Second)
	if sweepLeaves(t, s) != 0 || rowCount(t, s, id) != 1 {
		t.Fatal("détruit")
	}
	if err := s.Leave(id, 0); err != ErrNotFound {
		t.Fatal(err)
	}
}
