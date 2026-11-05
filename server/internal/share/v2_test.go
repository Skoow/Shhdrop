package share

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"sync"
	"testing"
)

// Envoi v2 de 7 segments (palier 400), segments reçus sauf ceux de skip.
func upload400(t *testing.T, s *Service, k keys, skip ...int) string {
	t.Helper()
	id, segs, err := s.Create(k.req(400, 1, 2))
	if err != nil {
		t.Fatal(err)
	}
	if segs != 7 {
		t.Fatal(segs)
	}
outer:
	for n := 0; n < segs; n++ {
		for _, x := range skip {
			if x == n {
				continue outer
			}
		}
		if err := s.PutSegment(id, n, segBody(400, n, byte(n+1))); err != nil {
			t.Fatal(n, err)
		}
	}
	return id
}

func withFill(id string, from, to int) FinalizeReq {
	r := fin(id)
	r.FillFrom, r.FillTo = from, to
	return r
}

func TestFinalizeFillRules(t *testing.T) {
	cases := []struct {
		name     string
		skip     []int
		from, to int
		want     error
	}{
		{name: "bourrage [3, 6) absent : accepté", skip: []int{3, 4, 5}, from: 3, to: 6},
		{name: "segment manquant hors bourrage", skip: []int{2, 3, 4, 5}, from: 3, to: 6, want: ErrIncomplete},
		{name: "fill_to dépasse le palier", skip: []int{3, 4, 5}, from: 3, to: 8, want: ErrBadRequest},
		{name: "fill touche le dernier segment", skip: []int{3, 4, 5, 6}, from: 3, to: 7, want: ErrBadRequest},
		{name: "fill touche le segment 0", skip: []int{0, 1}, from: 0, to: 2, want: ErrBadRequest},
		{name: "fill à l'envers", skip: []int{3}, from: 4, to: 3, want: ErrBadRequest},
		{name: "fill négatif", from: -1, to: 0, want: ErrBadRequest},
		{name: "vide [0, 0) : tout exigé", skip: []int{4}, from: 0, to: 0, want: ErrIncomplete},
		{name: "vide [6, 6) accepté", from: 6, to: 6},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			s, _ := newSvc(t)
			k := newKeys()
			id := upload400(t, s, k, tc.skip...)
			_, err := s.Finalize(id, withFill(id, tc.from, tc.to))
			if !errors.Is(err, tc.want) {
				t.Fatalf("Finalize = %v, attendu %v", err, tc.want)
			}
		})
	}
}

// Bourrage rempli par crypto/rand : aucune suite de 4 096 zéros dans [fill_from, fill_to),
// segments envoyés intacts.
func TestFinalizeFillsRandom(t *testing.T) {
	s, _ := newSvc(t)
	k := newKeys()
	id := upload400(t, s, k, 3, 4, 5)
	if _, err := s.Finalize(id, withFill(id, 3, 6)); err != nil {
		t.Fatal(err)
	}
	f, err := os.ReadFile(filepath.Join(s.Blobs.Dir, id))
	if err != nil {
		t.Fatal(err)
	}
	pad := f[segOffset(400, 3):segOffset(400, 6)]
	if bytes.Contains(pad, make([]byte, 4096)) {
		t.Fatal("suite de 4 096 zéros dans le bourrage")
	}
	for _, n := range []int{0, 1, 2, 6} {
		if !bytes.Equal(f[segOffset(400, n):segOffset(400, n)+SegmentSize(400, n)], segBody(400, n, byte(n+1))) {
			t.Fatal("segment envoyé modifié", n)
		}
	}
}

func TestUnlockEnvelopeOnlyWhenReady(t *testing.T) {
	s, _ := newSvc(t)
	k := newKeys()
	id := upload400(t, s, k, 3, 4, 5)
	// Avant finalize : proof_v NULL → 404 uniforme, aucun essai compté.
	if _, _, err := s.Unlock(id, k.acces, k.preuve); !errors.Is(err, ErrNotFound) {
		t.Fatal(err)
	}
	if _, _, err := s.Unlock(id, k.acces, rnd(32)); !errors.Is(err, ErrNotFound) {
		t.Fatal(err)
	}
	if failed(t, s, id) != 0 {
		t.Fatal("essai compté avant finalize")
	}
	if _, err := s.Meta(id, k.acces); !errors.Is(err, ErrNotFound) {
		t.Fatal(err)
	}
	r := withFill(id, 3, 6)
	if _, err := s.Finalize(id, r); err != nil {
		t.Fatal(err)
	}
	// Rejeu de finalize : plus en envoi → 404.
	if _, err := s.Finalize(id, r); !errors.Is(err, ErrNotFound) {
		t.Fatal("finalize rejoué", err)
	}
	n, env, err := s.Unlock(id, k.acces, k.preuve)
	if err != nil || n != 1 || !bytes.Equal(env, r.Envelope) {
		t.Fatal(n, err)
	}
	if _, env, err := s.Unlock(id, k.acces, rnd(32)); env != nil {
		t.Fatal("enveloppe rendue à un mauvais mot de passe", err)
	}
	m, err := s.Meta(id, k.acces)
	if err != nil || !bytes.Equal(m.Salt, r.Salt) || m.Bucket != 400 {
		t.Fatal(m, err)
	}
}

func TestCreateConflict(t *testing.T) {
	s, _ := newSvc(t)
	k := newKeys()
	r := k.req(1, 1, 1)
	if _, _, err := s.Create(r); err != nil {
		t.Fatal(err)
	}
	if err := s.PutSegment(r.ID, 0, segBody(1, 0, 9)); err != nil {
		t.Fatal(err)
	}
	other := newKeys().req(16, 1, 1)
	other.ID = r.ID
	if _, _, err := s.Create(other); !errors.Is(err, ErrConflict) {
		t.Fatal(err)
	}
	// Le partage existant est intact (fichier et ligne).
	f, _ := os.ReadFile(filepath.Join(s.Blobs.Dir, r.ID))
	if !bytes.Equal(f, segBody(1, 0, 9)) || rowCount(t, s, r.ID) != 1 {
		t.Fatal("partage existant touché")
	}
	// Fichier orphelin du même nom : conflit aussi, jamais écrasé.
	orphan := k.req(1, 1, 1)
	if err := os.WriteFile(filepath.Join(s.Blobs.Dir, orphan.ID), []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, _, err := s.Create(orphan); !errors.Is(err, ErrConflict) {
		t.Fatal(err)
	}
	if b, _ := os.ReadFile(filepath.Join(s.Blobs.Dir, orphan.ID)); string(b) != "x" {
		t.Fatal("orphelin écrasé")
	}
}

// OnAbandon : appelé pour un envoi effacé avant finalize (destruction ou balayage), jamais
// pour un partage finalisé.
func TestOnAbandon(t *testing.T) {
	s, c := newSvc(t)
	var mu sync.Mutex
	got := map[string]int{}
	s.OnAbandon = func(id string, bucket int) { mu.Lock(); got[id] = bucket; mu.Unlock() }
	k := newKeys()
	destroyed, _, _ := s.Create(k.req(16, 1, 1))
	swept, _, _ := s.Create(k.req(1, 1, 1))
	done := ready(t, s, k, 1, 1, 1)
	if err := s.Destroy(destroyed, nil, nil, k.gestion); err != nil {
		t.Fatal(err)
	}
	c.Add(20 * 60e9) // envoi sans segment : effacé 5 à 20 min après la création
	if _, err := s.Sweep(); err != nil {
		t.Fatal(err)
	}
	if err := s.Destroy(done, nil, nil, k.gestion); err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 || got[destroyed] != 16 || got[swept] != 1 {
		t.Fatal(got)
	}
}
