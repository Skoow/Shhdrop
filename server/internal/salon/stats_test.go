package salon

import "testing"

// Tableau de bord d'administration : statistiques agrégées du salon, sans aucun identifiant.
// Deux salons créés ; dans le premier, le créateur et un invité entrent ; deux trames y sont
// rangées. Stats rend 2 salons vivants, 2 sièges occupés au total, 2 trames en mémoire.
func TestStatsAgregees(t *testing.T) {
	b := nouveauBanc(t, 200)
	b.m.cfg.SalonFramesTotal = 1000
	c1 := b.creer(t, 4)
	b.creer(t, 4) // second salon, personne n'y entre
	_, g := b.entrerMembre(t, c1, true) // créateur
	b.entrer(t, c1, false)              // invité
	b.recevoir(t, g, trameD(0, 1))
	b.recevoir(t, g, trameD(0, 2))
	st := b.m.Stats()
	if st.Vivants != 2 {
		t.Errorf("salons vivants = %d, attendu 2", st.Vivants)
	}
	if st.Sieges != 2 {
		t.Errorf("sièges occupés = %d, attendu 2", st.Sieges)
	}
	if st.Trames != 2 || st.TramesMax != 1000 {
		t.Errorf("trames = %d / %d, attendu 2 / 1000", st.Trames, st.TramesMax)
	}
	if st.Max != 200 {
		t.Errorf("plafond de salons = %d, attendu 200", st.Max)
	}
}
