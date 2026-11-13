package blob

import (
	"io"
	"sync/atomic"
)

// Gate borne les appels système de fichiers simultanés (audit du 13 novembre, D4) : une
// lecture ou une écriture de fichier en Go bloque un fil du système pendant l'appel, et le
// noyau compte chaque fil dans pids_limit. Sous un disque lent, des centaines de transferts
// créaient autant de fils, jusqu'à l'arrêt net du processus (« failed to create new OS
// thread »). Au-delà de la borne, les appels attendent leur tour (goroutines, pas de fils).
// Toujours pris en dernier, après les verrous du Store, et rendu sans rien prendre d'autre :
// aucune attente croisée possible. Un Gate nil ne borne rien.
type Gate struct {
	c          chan struct{}
	used, peak atomic.Int64 // tests : appels en cours, plus haut atteint
}

// NewGate : n appels au plus à la fois (n > 0).
func NewGate(n int) *Gate {
	if n <= 0 {
		panic("blob : Gate ≤ 0")
	}
	return &Gate{c: make(chan struct{}, n)}
}

// do exécute f sous la borne.
func (g *Gate) do(f func() error) error {
	if g == nil {
		return f()
	}
	g.c <- struct{}{}
	if u := g.used.Add(1); u > g.peak.Load() {
		g.peak.Store(u)
	}
	defer func() { g.used.Add(-1); <-g.c }()
	return f()
}

// Peak : plus grand nombre d'appels simultanés vus (tests).
func (g *Gate) Peak() int64 { return g.peak.Load() }

// gatedReaderAt : lectures de r sous la borne.
type gatedReaderAt struct {
	r io.ReaderAt
	g *Gate
}

func (r gatedReaderAt) ReadAt(p []byte, off int64) (n int, err error) {
	r.g.do(func() error { n, err = r.r.ReadAt(p, off); return nil })
	return n, err
}

// ReaderAt : r lu sous la borne du Store (descripteur détaché d'un partage, spec §41.8).
func (s *Store) ReaderAt(r io.ReaderAt) io.ReaderAt {
	if s.Gate == nil {
		return r
	}
	return gatedReaderAt{r, s.Gate}
}
