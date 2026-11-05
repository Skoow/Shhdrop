package share

import (
	"errors"
	"testing"
	"time"
)

func TestReadBudgetValues(t *testing.T) {
	for _, b := range Buckets {
		last := SegmentCount(b) - 1
		want := 2*int64(Header+b*ChunkCT) + int64(SegmentSize(b, 0)) + int64(SegmentSize(b, last))
		if got := ReadBudget(b); got != want {
			t.Fatalf("palier %d : %d, attendu %d", b, got, want)
		}
	}
}

// Audit M1 : une lecture complète plus un nouvel essai de chaque segment passent ; au-delà
// du budget, ErrBudget. Le budget est propre à chaque ouverture.
func TestOpenSegmentBudget(t *testing.T) {
	s, c := newSvc(t)
	k := newKeys()
	const bucket = 160 // 3 segments
	id, segs, err := s.Create(k.req(bucket, 1, 2))
	if err != nil {
		t.Fatal(err)
	}
	for n := 0; n < segs; n++ {
		if err := s.PutSegment(id, n, segBody(bucket, n, byte(n+1))); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := s.Finalize(id, fin(id)); err != nil {
		t.Fatal(err)
	}
	o1, _, err := s.Unlock(id, k.acces, k.preuve)
	if err != nil {
		t.Fatal(err)
	}
	// Ouverture v2 (segment 0, dernier segment), lecture complète, puis un nouvel essai de
	// chaque segment : exactement le budget.
	reads := []int{0, segs - 1}
	for pass := 0; pass < 2; pass++ {
		for n := 0; n < segs; n++ {
			reads = append(reads, n)
		}
	}
	for i, n := range reads {
		if _, err := readSegment(s, id, n, o1); err != nil {
			t.Fatal(i, n, err)
		}
	}
	// Le plus petit segment (le dernier) ne passe plus.
	if _, err := s.OpenSegment(id, segs-1, o1); !errors.Is(err, ErrBudget) {
		t.Fatal("au-delà du budget :", err)
	}
	// Une autre ouverture a son propre budget.
	o2, _, err := s.Unlock(id, k.acces, k.preuve)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := readSegment(s, id, 0, o2); err != nil {
		t.Fatal(err)
	}
	// Le temps ne recharge pas le budget pendant la vie du jeton.
	c.Add(30 * time.Minute)
	if _, err := s.OpenSegment(id, segs-1, o1); !errors.Is(err, ErrBudget) {
		t.Fatal("budget rechargé :", err)
	}
}

func TestReadBudgetForgetsExpired(t *testing.T) {
	var b readBudget
	k := openKey{"AAAAAAAAAAAAAAAAAAAAAA", 1}
	if !b.charge(k, 10, 10, 1000) || b.charge(k, 1, 10, 1000) {
		t.Fatal("limite")
	}
	// Une entrée échue (jeton expiré) est effacée au balayage suivant.
	b.charge(openKey{"BBBBBBBBBBBBBBBBBBBBBB", 1}, 1, 10, 1000+purgeWindow+60)
	if _, ok := b.m[k]; ok || len(b.m) != 1 {
		t.Fatalf("entrées : %v", b.m)
	}
}
