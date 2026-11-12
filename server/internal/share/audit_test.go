package share

// Test offensif de l'audit des partages du 12 novembre (D1), repris du scratchpad et changé
// en assertion : il échouait avant sa correction.

import (
	"sync"
	"testing"
)

// D1 : un premier déverrouillage concurrent d'une destruction recréait, après le retrait,
// un octroi et un budget de lecture pour un partage effacé (et rendait 200 avec un jeton).
// Sous gone.mu, UnlockGrant refuse un partage mort ou en retrait et relit la ligne avant
// grantLocked : rien ne reste en mémoire. À lancer aussi en -count élevé.
func TestAuditUnlockVsDestroyLeak(t *testing.T) {
	for manche := 0; manche < 300; manche++ { // 600 dans l'audit : 0 à 4 manches touchées
		s, _ := newSvc(t)
		k := newKeys()
		id := ready(t, s, k, 1, 24, 10)
		var wg sync.WaitGroup
		for range 4 {
			wg.Add(1)
			go func() { defer wg.Done(); s.UnlockGrant(id, k.acces, k.preuve, "") }()
		}
		wg.Add(1)
		go func() { defer wg.Done(); s.DestroyManaged(k.gestion) }()
		wg.Wait()
		s.DestroyManaged(k.gestion)
		var un int
		if s.DB.QueryRow(`SELECT 1 FROM shares WHERE id=?`, id).Scan(&un) == nil {
			t.Fatal("partage encore présent après la destruction")
		}
		if s.GrantCount() > 0 || s.BudgetCount() > 0 {
			t.Fatalf("manche %d : octrois %d, budgets %d pour un partage disparu", manche, s.GrantCount(), s.BudgetCount())
		}
	}
}
