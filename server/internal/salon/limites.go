package salon

import (
	"math"
	"time"
)

// Limites des trames montantes par siège (plan C-2 Task 12, Global Constraints) : seaux à
// jetons, en mémoire seulement, sous s.mu. Les limites par connexion et par /48 (120 et 600
// par minute) sont celles de limits.AllowFrame, consultées par Servir avant Recevoir.
//   - cadence : toute trame, rafale de 20 puis 1 par seconde (60 par minute) ;
//   - horaire : trames non volatiles, 1 200 puis 1 200 par heure (1 par 3 s).
//
// Un seau plein au départ autorise sa capacité d'un coup : sur une heure glissante, un siège
// peut ranger jusqu'à 1 200 + 1 200 trames non volatiles (en moyenne 1 200 par heure).
// Les seaux sont ceux du numéro de siège, pas de son occupant : ni une reprise (nouveau jeton)
// ni un départ suivi d'une arrivée ne les remplissent.

const (
	rafaleSiege     = 20
	cadenceSeconde  = 1.0
	horaireMax      = 1200
	horaireParHeure = 1200.0
)

// seau : jetons disponibles (au plus cap), remplis de parSeconde par seconde depuis dernier.
type seau struct {
	jetons     float64
	cap        float64
	parSeconde float64
	dernier    time.Time
}

// remplir ajoute les jetons gagnés depuis dernier. Horloge qui recule : aucun jeton gagné,
// et le décompte repart de now (sinon le seau resterait vide le temps du recul).
func (b *seau) remplir(now time.Time) {
	if d := now.Sub(b.dernier); !b.dernier.IsZero() && d > 0 {
		b.jetons = min(b.cap, b.jetons+d.Seconds()*b.parSeconde)
	}
	b.dernier = now
}

// attente : délai avant le prochain jeton (au moins 1 ns quand il en manque).
func (b *seau) attente() time.Duration {
	if b.jetons >= 1 {
		return 0
	}
	return time.Duration(math.Ceil((1 - b.jetons) / b.parSeconde * float64(time.Second)))
}

// prendre prend un jeton s'il y en a un ; sinon rien n'est pris et attente dit quand
// réessayer.
func (b *seau) prendre(now time.Time) (ok bool, attente time.Duration) {
	b.remplir(now)
	if b.jetons < 1 {
		return false, b.attente()
	}
	b.jetons--
	return true, 0
}

// limiteSiege : seaux d'un numéro de siège.
type limiteSiege struct{ cadence, horaire seau }

// nouvelleLimite : seaux pleins.
func nouvelleLimite() limiteSiege {
	return limiteSiege{
		cadence: seau{jetons: rafaleSiege, cap: rafaleSiege, parSeconde: cadenceSeconde},
		horaire: seau{jetons: horaireMax, cap: horaireMax, parSeconde: horaireParHeure / 3600},
	}
}

// prendre : une trame (non volatile ou pas) ; 0 si elle passe, sinon le délai avant de
// réessayer, et aucun jeton n'est pris dans aucun seau.
func (l *limiteSiege) prendre(now time.Time, nonVolatile bool) time.Duration {
	if nonVolatile {
		l.horaire.remplir(now)
		if d := l.horaire.attente(); d > 0 {
			return d
		}
	}
	if ok, d := l.cadence.prendre(now); !ok {
		return d
	}
	if nonVolatile {
		l.horaire.jetons--
	}
	return 0
}
