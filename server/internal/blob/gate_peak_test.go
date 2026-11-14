package blob

import (
	"sync"
	"testing"
)

// Le plus haut atteint ne redescend jamais sous le nombre d'appels réellement en cours, même
// quand beaucoup d'appels entrent en même temps (mise à jour par comparaison-échange).
func TestGatePicExactSousConcurrence(t *testing.T) {
	for range 200 {
		const n = 32
		g := NewGate(n)
		var entres, sortir sync.WaitGroup
		entres.Add(n)
		sortir.Add(1)
		var fini sync.WaitGroup
		for range n {
			fini.Add(1)
			go func() {
				defer fini.Done()
				_ = g.Do(func() error { entres.Done(); sortir.Wait(); return nil })
			}()
		}
		entres.Wait()
		if g.InUse() != n || g.Peak() != n {
			t.Fatalf("en cours %d, pic %d, attendu %d et %d", g.InUse(), g.Peak(), n, n)
		}
		sortir.Done()
		fini.Wait()
	}
}
