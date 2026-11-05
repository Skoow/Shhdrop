package limits

import (
	"errors"
	"sync"
	"testing"
)

func TestSlots(t *testing.T) {
	s := NewSlots(4, 2, 3)
	var rel []func()
	take := func(k64, k48 string, want error) {
		t.Helper()
		r, err := s.Acquire(k64, k48)
		if !errors.Is(err, want) {
			t.Fatalf("Acquire(%s, %s) = %v, attendu %v", k64, k48, err, want)
		}
		if err == nil {
			rel = append(rel, r)
		}
	}
	take("a", "A", nil)
	take("a", "A", nil)
	take("a", "A", ErrTooMany) // par connexion
	take("b", "A", nil)
	take("c", "A", ErrTooMany) // par /48
	take("d", "D", nil)
	take("e", "E", ErrBusy) // au total
	rel[0]()
	rel[0]() // une seconde libération ne rend rien de plus
	take("e", "E", nil)
	take("f", "F", ErrBusy)
	for _, r := range rel {
		r()
	}
	if s.n != 0 || len(s.c64) != 0 || len(s.c48) != 0 {
		t.Fatalf("places non rendues : n=%d %v %v", s.n, s.c64, s.c48)
	}
}

func TestSlotsConcurrent(t *testing.T) {
	s := NewSlots(8, 8, 8)
	var wg sync.WaitGroup
	var mu sync.Mutex
	in, peak := 0, 0
	for i := 0; i < 64; i++ {
		wg.Go(func() {
			r, err := s.Acquire("k", "K")
			if err != nil {
				return
			}
			mu.Lock()
			in++
			peak = max(peak, in)
			mu.Unlock()
			mu.Lock()
			in--
			mu.Unlock()
			r()
		})
	}
	wg.Wait()
	if peak > 8 || s.n != 0 {
		t.Fatalf("pic %d, restant %d", peak, s.n)
	}
}

func TestNewSlotsRejectsZero(t *testing.T) {
	defer func() {
		if recover() == nil {
			t.Fatal("limite nulle acceptée")
		}
	}()
	NewSlots(0, 1, 1)
}
