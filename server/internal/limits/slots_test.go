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

func TestKeyed(t *testing.T) {
	k := NewKeyed(2)
	r1, err1 := k.Acquire("a")
	r2, err2 := k.Acquire("a")
	if err1 != nil || err2 != nil {
		t.Fatal(err1, err2)
	}
	if _, err := k.Acquire("a"); !errors.Is(err, ErrTooMany) {
		t.Fatal("3ᵉ place de la même clé accordée", err)
	}
	rb, err := k.Acquire("b")
	if err != nil {
		t.Fatal("autre clé refusée", err)
	}
	r1()
	r1() // une seule fois
	if k.Len() != 2 {
		t.Fatal(k.Len())
	}
	r3, err := k.Acquire("a")
	if err != nil {
		t.Fatal("place rendue non réutilisable", err)
	}
	r2()
	r3()
	rb()
	k.mu.Lock()
	n := len(k.n)
	k.mu.Unlock()
	if n != 0 || k.Len() != 0 {
		t.Fatal("clé gardée sans transfert", n)
	}
}

// Audit du 13 novembre, D2 : 8 adresses IPv4 prenaient les 64 places d'envoi (8 chacune), 16
// les 256 places de lecture (16 chacune). Part équitable : une nouvelle adresse a encore une
// place, et il faut bien plus d'adresses pour tout prendre.
func TestPartEquitable(t *testing.T) {
	for _, c := range []struct {
		nom                 string
		total, per64, per48 int
		attaquants          int // adresses qui saturaient avant
		pourSaturer         int // adresses nécessaires maintenant
	}{
		{"envois (64)", 64, 8, 32, 8, 6 + 16},
		{"envois (67)", 67, 8, 32, 9, 7 + 16},
		{"lectures (256)", 256, 16, 64, 16, 12 + 64},
		{"lectures (360)", 360, 16, 64, 23, 17 + 90},
		{"WebSocket (2000)", 2000, 8, 16, 250, 188 + 500},
	} {
		prendre := func(s *Slots, n int) (pris int) {
			for a := range n {
				k := string(rune('A' + a))
				for {
					if _, err := s.Acquire(k+"64", k+"48"); err != nil {
						break
					}
					pris++
				}
			}
			return pris
		}
		// Avant : NewSlots seul, saturé par c.attaquants adresses.
		if old := NewSlots(c.total, c.per64, c.per48); prendre(old, c.attaquants) != c.total {
			t.Fatalf("%s : l'attaque d'avant ne sature pas", c.nom)
		}
		s := NewFairSlots(c.total, c.per64, c.per48)
		prendre(s, c.attaquants)
		if _, err := s.Acquire("victime64", "victime48"); err != nil {
			t.Fatalf("%s : %d adresses privent encore une nouvelle venue : %v", c.nom, c.attaquants, err)
		}
		s = NewFairSlots(c.total, c.per64, c.per48)
		if prendre(s, c.pourSaturer-1); s.Len() == c.total {
			t.Fatalf("%s : saturé par %d adresses", c.nom, c.pourSaturer-1)
		}
		if prendre(s, c.pourSaturer); s.Len() != c.total { // les mêmes, plus une
			t.Fatalf("%s : %d places sur %d avec %d adresses", c.nom, s.Len(), c.total, c.pourSaturer)
		}
	}
}
