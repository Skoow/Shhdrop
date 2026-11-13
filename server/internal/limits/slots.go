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
	// reserve : dernières places, ouvertes seulement à un bloc /48 qui n'en tient aucune
	// (NewFairSlots) ; 0 : aucune réserve.
	reserve int

	mu sync.Mutex
	n  int
	// peak : plus grand nombre de transferts simultanés depuis le démarrage (un entier, pour
	// le tableau de bord d'administration).
	peak int
	c64  map[string]int
	c48  map[string]int
}

// NewSlots : limites > 0.
func NewSlots(total, per64, per48 int) *Slots {
	if total <= 0 || per64 <= 0 || per48 <= 0 {
		panic("limits : places de transfert ≤ 0")
	}
	return &Slots{total: total, per64: per64, per48: per48, c64: map[string]int{}, c48: map[string]int{}}
}

// Part équitable des plafonds globaux (audit du 13 novembre, D2 : quelques adresses
// prenaient toutes les places du serveur). FairShare : une connexion ou un bloc /48 prend au
// plus 1/8 des places, en plus de ses propres plafonds ; FairReserve : le dernier quart des
// places ne va qu'à un bloc qui n'en tient aucune (nouveau venu). Saturer le serveur exige
// alors au moins 6 blocs pour les 3/4 partagés, puis un bloc de plus par place réservée.
const (
	FairShare   = 8
	FairReserve = 4
)

// NewFairSlots : NewSlots avec la part équitable : per64 et per48 ramenés à
// max(1, total / FairShare), et total / FairReserve places réservées aux nouveaux venus.
func NewFairSlots(total, per64, per48 int) *Slots {
	share := max(1, total/FairShare)
	s := NewSlots(total, min(per64, share), min(per48, share))
	s.reserve = total / FairReserve
	return s
}

// Acquire prend une place pour (k64, k48) ou refuse sans attendre (ErrBusy, ErrTooMany).
// Places réservées (NewFairSlots) : refusées (ErrBusy) à un bloc qui tient déjà une place.
// release rend la place ; l'appeler une seule fois.
func (s *Slots) Acquire(k64, k48 string) (release func(), err error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	switch {
	case s.c64[k64] >= s.per64 || s.c48[k48] >= s.per48:
		return nil, ErrTooMany
	case s.n >= s.total:
		return nil, ErrBusy
	case s.n >= s.total-s.reserve && s.c48[k48] > 0:
		return nil, ErrBusy
	}
	s.n++
	s.peak = max(s.peak, s.n)
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

// Total : places du serveur.
func (s *Slots) Total() int { return s.total }

// Len : transferts en cours au total (tests).
func (s *Slots) Len() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.n
}

// InUse : transferts en cours et plus haut atteint depuis le démarrage (tableau de bord
// d'administration : deux entiers, sans clé).
func (s *Slots) InUse() (n, peak int) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.n, s.peak
}

// Keyed borne les transferts simultanés d'une même clé (audit I3, M4) : un envoi (id interne)
// ou une ouverture (id interne et numéro). En mémoire seulement ; une clé sans transfert en
// cours est oubliée aussitôt.
type Keyed struct {
	max int

	mu sync.Mutex
	n  map[string]int
}

// NewKeyed : max > 0.
func NewKeyed(max int) *Keyed {
	if max <= 0 {
		panic("limits : places par clé ≤ 0")
	}
	return &Keyed{max: max, n: map[string]int{}}
}

// Acquire prend une place pour key ou refuse sans attendre (ErrTooMany). release rend la
// place ; l'appeler une seule fois.
func (k *Keyed) Acquire(key string) (release func(), err error) {
	k.mu.Lock()
	defer k.mu.Unlock()
	if k.n[key] >= k.max {
		return nil, ErrTooMany
	}
	k.n[key]++
	var once sync.Once
	return func() {
		once.Do(func() {
			k.mu.Lock()
			defer k.mu.Unlock()
			if k.n[key]--; k.n[key] == 0 {
				delete(k.n, key)
			}
		})
	}, nil
}

// Len : places prises au total (tests).
func (k *Keyed) Len() int {
	k.mu.Lock()
	defer k.mu.Unlock()
	t := 0
	for _, v := range k.n {
		t += v
	}
	return t
}
