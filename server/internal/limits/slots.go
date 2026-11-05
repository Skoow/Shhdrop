package limits

import (
	"errors"
	"sync"
)

var (
	// ErrBusy : toutes les places du serveur sont prises (réponse 503).
	ErrBusy = errors.New("limits : serveur occupé")
	// ErrTooMany : la connexion ou son bloc /48 a déjà toutes ses places (réponse 429).
	ErrTooMany = errors.New("limits : trop de transferts simultanés")
)

// Slots borne les transferts simultanés (sémaphore) : au total, par connexion (/64 ou
// IPv4) et par bloc /48, sur les clés pseudonymisées de Limiter.Key. Tout est en mémoire ;
// une clé sans transfert en cours est oubliée aussitôt.
type Slots struct {
	total, per64, per48 int

	mu  sync.Mutex
	n   int
	c64 map[string]int
	c48 map[string]int
}

// NewSlots : limites > 0.
func NewSlots(total, per64, per48 int) *Slots {
	if total <= 0 || per64 <= 0 || per48 <= 0 {
		panic("limits : places de transfert ≤ 0")
	}
	return &Slots{total: total, per64: per64, per48: per48, c64: map[string]int{}, c48: map[string]int{}}
}

// Acquire prend une place pour (k64, k48) ou refuse sans attendre (ErrBusy, ErrTooMany).
// release rend la place ; l'appeler une seule fois.
func (s *Slots) Acquire(k64, k48 string) (release func(), err error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	switch {
	case s.c64[k64] >= s.per64 || s.c48[k48] >= s.per48:
		return nil, ErrTooMany
	case s.n >= s.total:
		return nil, ErrBusy
	}
	s.n++
	s.c64[k64]++
	s.c48[k48]++
	var once sync.Once
	return func() { once.Do(func() { s.release(k64, k48) }) }, nil
}

func (s *Slots) release(k64, k48 string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.n--
	if s.c64[k64]--; s.c64[k64] == 0 {
		delete(s.c64, k64)
	}
	if s.c48[k48]--; s.c48[k48] == 0 {
		delete(s.c48, k48)
	}
}
