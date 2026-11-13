package salon

// Audit de sécurité du 13 novembre, D2 : 40 adresses IPv4 prenaient les SHH_SALONS_MAX (200)
// places pour 24 h, 5 salons chacune, sans jamais y entrer.

import (
	"errors"
	"testing"
	"time"
)

// Part équitable : avec Max = 40, 8 blocs ne prennent plus toutes les places (6 blocs × 5,
// puis une place de réserve chacun pour les deux derniers) ; un nouveau bloc crée encore.
func TestSalonsPartEquitable(t *testing.T) {
	b := nouveauBanc(t, 40)
	pris := 0
	for i := range 8 {
		bloc := [32]byte(aleatoire())
		for range VivantsParBloc {
			r := reqValide(nouvellesCles())
			r.Bloc = bloc
			if _, err := b.m.Creer(r); err == nil {
				pris++
			} else if i < 6 {
				t.Fatalf("bloc %d refusé dans la part partagée : %v", i, err)
			}
		}
	}
	if pris != 32 {
		t.Fatalf("8 blocs ont pris %d places sur 40, attendu 32", pris)
	}
	if _, err := b.m.Creer(reqValide(nouvellesCles())); err != nil {
		t.Fatal("nouveau bloc refusé :", err)
	}
	// Max petit : au plus Max / 8 salons par bloc (au moins 1).
	b = nouveauBanc(t, 16)
	bloc := [32]byte(aleatoire())
	for i := range 3 {
		r := reqValide(nouvellesCles())
		r.Bloc = bloc
		_, err := b.m.Creer(r)
		var at *Attente
		if (i < 2) != (err == nil) || (i == 2 && !errors.As(err, &at)) {
			t.Fatal("création", i+1, "avec Max 16 :", err)
		}
	}
}

// Un salon où personne n'est entré est effacé 15 min après sa création (ligne, fichier,
// place du bloc) ; un salon où le créateur ou un invité est entré reste. Le siège 0, gardé au
// créateur, ne compte pas : sans entrée, le salon est vide.
func TestSalonVideEfface(t *testing.T) {
	b := nouveauBanc(t, 200)
	vide := b.creer(t, 4)
	avecCreateur := b.creer(t, 4)
	avecInvite := b.creer(t, 4)
	b.entrer(t, avecCreateur, true)
	b.entrer(t, avecInvite, false)
	idVide := b.idDe(t, vide)
	b.h.avancer(videMax - time.Second)
	b.m.Tick()
	if b.lignes(t, "salons", idVide) != 1 {
		t.Fatal("salon vide effacé avant 15 min")
	}
	b.h.avancer(time.Second)
	b.m.Tick()
	if b.lignes(t, "salons", idVide) != 0 || b.convExiste(t, idVide) {
		t.Fatal("salon vide encore là après 15 min")
	}
	if _, err := b.m.Rejoindre(vide.acces, vide.preuve, vide.gestion); !errors.Is(err, ErrNotFound) {
		t.Fatal("salon vide effacé, entrée :", err)
	}
	for _, c := range []cles{avecCreateur, avecInvite} {
		if b.lignes(t, "salons", b.idDe(t, c)) != 1 {
			t.Fatal("salon où quelqu'un est entré effacé")
		}
	}
	b.m.mu.Lock()
	n := len(b.m.vivants)
	b.m.mu.Unlock()
	if n != 2 {
		t.Fatal("places : ", n)
	}
}
