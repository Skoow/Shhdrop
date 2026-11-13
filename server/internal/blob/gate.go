package blob

import (
	"errors"
	"io"
	"os"
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

// Writer : fichier ouvert une fois pour une suite d'écritures dans sa réservation (bourrage
// de Finalize : jusqu'à 2 Gio par tranches de 4 Mio, rapport de performance A12 : ouvrir,
// fermer et remettre les dates à zéro à chaque tranche coûtait autant d'appels). Chaque
// écriture passe sous la borne (Gate). À fermer (Close remet les dates à l'epoch).
type Writer struct {
	f    *os.File
	path string
	size int64
	g    *Gate
}

// OpenWriter ouvre le fichier id en écriture.
func (s *Store) OpenWriter(id string) (*Writer, error) {
	path, err := s.path(id)
	if err != nil {
		return nil, err
	}
	w := &Writer{path: path, g: s.Gate}
	err = s.Gate.do(func() error {
		f, err := os.OpenFile(path, os.O_WRONLY, 0)
		if err != nil {
			return err
		}
		fi, err := f.Stat()
		if err != nil {
			f.Close()
			return err
		}
		w.f, w.size = f, fi.Size()
		return nil
	})
	if err != nil {
		return nil, err
	}
	return w, nil
}

// WriteAt écrit p à off, dans la taille du fichier à l'ouverture ; refuse tout dépassement.
func (w *Writer) WriteAt(p []byte, off int64) (int, error) {
	if off < 0 || off > w.size || int64(len(p)) > w.size-off {
		return 0, errors.New("blob : écriture hors de la réservation")
	}
	var n int
	err := w.g.do(func() (err error) { n, err = w.f.WriteAt(p, off); return err })
	return n, err
}

// Close ferme le fichier, puis remet ses dates à l'epoch.
func (w *Writer) Close() error {
	return w.g.do(func() error { return errors.Join(w.f.Close(), wipeTimes(w.path)) })
}
