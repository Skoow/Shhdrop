package salon

import (
	"bytes"
	"crypto/sha256"
	"errors"
	"os"
	"sync/atomic"
	"syscall"
	"testing"
	"testing/synctest"
	"time"
)

// Limites des trames et garde-fou du disque (plan C-2 Task 12, Review Focus 4).

// bancLimite : banc dont les limites par siège jouent (nouveauBanc les coupe pour les autres
// tests, qui envoient des centaines de trames à horloge figée).
func bancLimite(t *testing.T) *banc {
	t.Helper()
	b := nouveauBanc(t, 200)
	b.m.sansLimiteSiege = false
	return b
}

// essai : Recevoir, rend le délai d'un refus *Attente (0 : acceptée) ; toute autre erreur
// arrête le test.
func (b *banc) essai(t *testing.T, mb Membre, trame []byte) time.Duration {
	t.Helper()
	_, err := b.m.Recevoir(mb, trame, nil)
	var at *Attente
	switch {
	case err == nil:
		return 0
	case errors.As(err, &at):
		if at.Retry <= 0 {
			t.Fatal("Attente sans délai")
		}
		return at.Retry
	}
	t.Fatal(err)
	return 0
}

// 20 messages (non volatils) d'un coup acceptés ; le 21ᵉ → Attente d'une seconde, aucun rang consommé ; une
// seconde plus tard, une de plus passe. Par le WebSocket : 0x0B de 1 s, connexion ouverte.
func TestRafale20(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		b := bancLimite(t)
		c := b.creer(t, 4)
		eg, g := b.entrerMembre(t, c, true)
		s := g.salon
		for i := range 20 {
			if d := b.essai(t, g, trameD(0, i)); d != 0 {
				t.Fatal("refusée dans la rafale :", i, d)
			}
		}
		avant := dernierSeq(s)
		if d := b.essai(t, g, trameD(0, 20)); d != time.Second {
			t.Fatal("21ᵉ :", d)
		}
		if dernierSeq(s) != avant {
			t.Fatal("rang consommé par un refus")
		}
		b.h.avancer(time.Second)
		if d := b.essai(t, g, trameD(0, 21)); d != 0 {
			t.Fatal("après 1 s :", d)
		}
		if d := b.essai(t, g, trameD(0, 22)); d != time.Second {
			t.Fatal("seconde suivante :", d)
		}
		lg := b.connecter(eg.Jeton, eg.Seq)
		synctest.Wait()
		lg.envoyer(demTrame(trameD(0, 23)))
		synctest.Wait()
		l := lg.enrs()
		if !bytes.Equal(lg.brut(len(l)-1), EnrLimite(dernierSeq(s), 1)) || lg.codeFerme() != 0 {
			t.Fatalf("0x0B attendu : %x", lg.brut(len(l)-1))
		}
		finir(t, lg)
	})
}

// cadence : n essais espacés de pas ; rend les acceptés à partir de l'essai debut.
func (b *banc) cadence(t *testing.T, mb Membre, n, debut int, pas time.Duration, d byte) (acceptes int) {
	t.Helper()
	for i := range n {
		if b.essai(t, mb, trameD(d, i)) == 0 && i >= debut {
			acceptes++
		}
		b.h.avancer(pas)
	}
	return acceptes
}

// 10 min à 1 trame par seconde : aucune refusée. À 2 par seconde : la moitié refusée une fois
// la rafale épuisée.
func TestSoixanteParMinute(t *testing.T) {
	b := bancLimite(t)
	c := b.creer(t, 4)
	_, g := b.entrerMembre(t, c, true)
	_, a := b.entrerMembre(t, c, false)
	if n := b.cadence(t, g, 600, 0, time.Second, 0); n != 600 {
		t.Fatal("1 par seconde :", n, "acceptées sur 600")
	}
	// Rafale de 20 et 0,5 jeton par essai : épuisée avant le 40ᵉ essai.
	if n := b.cadence(t, a, 1200, 100, 500*time.Millisecond, 0); n != 550 {
		t.Fatal("2 par seconde :", n, "acceptées sur 1 100 après la rafale")
	}
}

// Messages non volatils : 1 200 par heure et par siège (seau de 1 200, rempli de 1 200 par
// heure). À 1 par 3 s, tous passent ; 1 200 d'un coup vident le seau, la 1 201ᵉ attend 3 s ;
// les volatiles n'entament pas ce compte.
func TestMilleDeuxCentsParHeure(t *testing.T) {
	t.Run("1 par 3 s", func(t *testing.T) {
		b := bancLimite(t)
		c := b.creer(t, 4)
		_, g := b.entrerMembre(t, c, true)
		if n := b.cadence(t, g, 1500, 0, 3*time.Second, 0); n != 1500 {
			t.Fatal(n, "acceptées sur 1 500")
		}
	})
	t.Run("seau horaire", func(t *testing.T) {
		now := time.Date(2026, 11, 12, 10, 0, 0, 0, time.UTC)
		h := nouvelleLimite().horaire
		for i := range 1200 {
			if ok, _ := h.prendre(now); !ok {
				t.Fatal("refusée :", i)
			}
		}
		if ok, d := h.prendre(now); ok || d != 3*time.Second {
			t.Fatal("1 201ᵉ :", ok, d)
		}
	})
	t.Run("volatiles hors compte", func(t *testing.T) {
		b := bancLimite(t)
		c := b.creer(t, 4)
		_, g := b.entrerMembre(t, c, true)
		// 1 800 volatiles à 1 par seconde : le seau horaire serait vide s'ils comptaient.
		if n := b.cadence(t, g, 1800, 0, time.Second, dVolatile); n != 1800 {
			t.Fatal("volatiles :", n)
		}
		// Puis des non volatiles à 1 par seconde : la cadence suit, le seau horaire (plein)
		// se vide en 1 799 environ (1 200 + 1 799 / 3).
		acceptes := 0
		for ; acceptes < 2000; acceptes++ {
			if b.essai(t, g, trameD(0, acceptes)) != 0 {
				break
			}
			b.h.avancer(time.Second)
		}
		if acceptes < 1795 || acceptes > 1800 {
			t.Fatal("non volatiles acceptées :", acceptes)
		}
		// Refus du seau horaire seul : une volatile passe au même instant.
		if d := b.essai(t, g, trameD(dVolatile, 0)); d != 0 {
			t.Fatal("volatile refusée :", d)
		}
	})
}

// Un siège limité n'en gêne pas un autre ; les sièges gardent leur compte après une reprise
// par rejoindre (aucun contournement en reprenant le siège 0).
func TestLimiteParSiege(t *testing.T) {
	b := bancLimite(t)
	c := b.creer(t, 4)
	_, g := b.entrerMembre(t, c, true)
	_, a := b.entrerMembre(t, c, false)
	for i := range 20 {
		b.essai(t, g, trameD(0, i))
	}
	if b.essai(t, g, trameD(0, 20)) == 0 {
		t.Fatal("G non limité")
	}
	for i := range 20 {
		if d := b.essai(t, a, trameD(0, i)); d != 0 {
			t.Fatal("A gêné par G :", i, d)
		}
	}
	_, g2 := b.entrerMembre(t, c, true) // reprise du siège 0 : nouveau jeton, même siège
	if b.essai(t, g2, trameD(0, 21)) == 0 {
		t.Fatal("reprise : compte du siège remis à zéro")
	}
}

// Horloge qui recule : aucun jeton gagné, et le seau se remplit de nouveau ensuite.
func TestSeauHorlogeRecule(t *testing.T) {
	now := time.Date(2026, 11, 12, 10, 0, 0, 0, time.UTC)
	b := nouvelleLimite().cadence
	for range 20 {
		b.prendre(now)
	}
	now = now.Add(-time.Hour)
	if ok, d := b.prendre(now); ok || d != time.Second {
		t.Fatal("après recul :", ok, d)
	}
	if ok, _ := b.prendre(now.Add(time.Second)); !ok {
		t.Fatal("non rempli après le recul")
	}
}

// partagesInjectes : usage des partages modifiable par le test (Config.UsedPartages).
func (b *banc) partagesInjectes() *atomic.Int64 {
	var p atomic.Int64
	b.m.cfg.UsedPartages = func() (int64, error) { return p.Load(), nil }
	return &p
}

// empreinte : SHA-256 du fichier de conversation.
func empreinte(t *testing.T, s *salon) [32]byte {
	t.Helper()
	d, err := os.ReadFile(s.conv.chemin)
	if err != nil {
		t.Fatal(err)
	}
	return sha256.Sum256(d)
}

// Review Focus 4 : SHH_STORAGE_MAX atteint. La dernière trame qui tient passe ; la suivante
// → 0x0C, rang non consommé, fichier inchangé ; les volatiles passent encore ; un autre
// salon reçoit aussi 0x0C ; Creer → ErrBusy. De la place rendue : tout repart.
func TestDisquePlein(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		b := nouveauBanc(t, 200)
		b.m.cfg.StorageMax = 3 << 30
		partages := b.partagesInjectes()
		c1, c2 := b.creer(t, 4), b.creer(t, 4)
		e1, g1 := b.entrerMembre(t, c1, true)
		e2, g2 := b.entrerMembre(t, c2, true)
		s1, s2 := g1.salon, g2.salon
		b.recevoir(t, g1, trameD(0, 1))
		l1 := b.connecter(e1.Jeton, e1.Seq)
		l2 := b.connecter(e2.Jeton, e2.Seq)
		synctest.Wait()
		// Il reste juste un palier de conversation (usage + un palier = StorageMax) : une trame
		// tient encore ; un octet de moins, plus aucune (le fichier grandit par paliers : refus
		// dès qu'un palier ne tiendrait plus, même si la trame va dans un palier déjà écrit).
		partages.Store(b.m.cfg.StorageMax - b.m.UsedBytes() - TaillePalier)
		b.recevoir(t, g1, trameD(0, 2))
		partages.Add(1)
		taille, sceau, seq := s1.conv.Taille(), empreinte(t, s1), dernierSeq(s1)
		if _, err := b.m.Recevoir(g1, trameD(0, 3), nil); !errors.Is(err, ErrPlein) {
			t.Fatal("trame au-delà de StorageMax :", err)
		}
		if _, err := b.m.Recevoir(g1, trameD(dUneMinute, 3), nil); !errors.Is(err, ErrPlein) {
			t.Fatal("« instantané » au-delà de StorageMax :", err)
		}
		if dernierSeq(s1) != seq || s1.conv.Taille() != taille || empreinte(t, s1) != sceau {
			t.Fatal("rang consommé ou fichier changé par un refus")
		}
		l1.envoyer(demTrame(trameD(0, 4)))
		synctest.Wait()
		if l := l1.enrs(); !bytes.Equal(l1.brut(len(l)-1), EnrPlein(seq)) || l1.codeFerme() != 0 {
			t.Fatalf("0x0C attendu : %x", l1.brut(len(l)-1))
		}
		if v := b.recevoir(t, g1, trameD(dVolatile, 5)); v != seq+1 {
			t.Fatal("volatile :", v)
		}
		seq2, taille2 := dernierSeq(s2), s2.conv.Taille()
		l2.envoyer(demTrame(trameD(0, 6)))
		synctest.Wait()
		if l := l2.enrs(); !bytes.Equal(l2.brut(len(l)-1), EnrPlein(seq2)) || dernierSeq(s2) != seq2 ||
			s2.conv.Taille() != taille2 {
			t.Fatalf("autre salon : %x", l2.brut(len(l)-1))
		}
		if _, err := b.m.Creer(reqValide(nouvellesCles())); !errors.Is(err, ErrBusy) {
			t.Fatal("Creer :", err)
		}
		partages.Store(0)
		l2.envoyer(demTrame(trameD(0, 7)))
		synctest.Wait()
		if dernierSeq(s2) != seq2+1 || s2.conv.Taille() != taille2+TaillePalier {
			t.Fatal("place rendue : trame toujours refusée")
		}
		finir(t, l1, l2)
	})
}

// Usage illisible (partages) : échec fermé, 0x0C.
func TestDisqueUsageIllisible(t *testing.T) {
	b := nouveauBanc(t, 200)
	c := b.creer(t, 4)
	_, g := b.entrerMembre(t, c, true)
	b.m.cfg.UsedPartages = func() (int64, error) { return 0, errors.New("illisible") }
	if _, err := b.m.Recevoir(g, trameD(0, 1), nil); !errors.Is(err, ErrPlein) {
		t.Fatal(err)
	}
}

// Disque réellement plein (ENOSPC, injecté) avant SHH_STORAGE_MAX : 0x0C, aucune écriture
// partielle, rang non consommé ; la connexion reste ouverte.
func TestDisquePleinENOSPC(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		b := nouveauBanc(t, 200)
		c := b.creer(t, 4)
		eg, g := b.entrerMembre(t, c, true)
		s := g.salon
		// Un palier plein : la trame suivante agrandit le fichier (dans un palier déjà écrit,
		// la taille ne change pas et l'emplacement raté est récrit par l'ajout suivant :
		// TestAjouterRetourArriere).
		for i := range emplacementsParPalier {
			b.recevoir(t, g, trameD(0, i))
		}
		f := avecPanne(t, s.conv)
		f.ecriturePartielle, f.errEcriture = true, syscall.ENOSPC
		taille, sceau, seq := s.conv.Taille(), empreinte(t, s), dernierSeq(s)
		if _, err := b.m.Recevoir(g, trameD(0, 2), nil); !errors.Is(err, ErrPlein) {
			t.Fatal(err)
		}
		if dernierSeq(s) != seq || s.conv.Taille() != taille || empreinte(t, s) != sceau {
			t.Fatal("rang consommé ou écriture partielle")
		}
		lg := b.connecter(eg.Jeton, seq)
		synctest.Wait()
		lg.envoyer(demTrame(trameD(0, 3)))
		synctest.Wait()
		if l := lg.enrs(); !bytes.Equal(lg.brut(len(l)-1), EnrPlein(seq)) || lg.codeFerme() != 0 {
			t.Fatalf("0x0C attendu : %x", lg.brut(len(l)-1))
		}
		f.ecriturePartielle = false
		b.recevoir(t, g, trameD(0, 4))
		finir(t, lg)
	})
}

// Décision du 12 novembre (réserve 3) : un nouvel occupant (0x02) trouve des seaux neufs, il
// n'hérite pas du compte de l'occupant précédent ; une reprise (0x0A par WebSocket, ou le
// créateur qui revient par rejoindre) garde les compteurs.
func TestLimiteNouvelOccupant(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		b := bancLimite(t)
		c := b.creer(t, 4)
		b.entrerMembre(t, c, true)
		ea, a := b.entrerMembre(t, c, false)
		vider := func(mb Membre) {
			t.Helper()
			for i := range 20 {
				b.essai(t, mb, trameD(0, i))
			}
			if b.essai(t, mb, trameD(0, 20)) == 0 {
				t.Fatal("seau non vidé")
			}
		}
		vider(a)
		// Reprise par WebSocket : même siège, compteurs gardés.
		lr := b.connecter(ea.Jeton, DepuisReprise)
		synctest.Wait()
		if b.essai(t, a, trameD(0, 21)) == 0 {
			t.Fatal("reprise par WebSocket : compteurs remis à zéro")
		}
		finir(t, lr)
		// Départ, puis un nouvel arrivant prend le même siège : seaux neufs.
		if err := b.m.Quitter(a); err != nil {
			t.Fatal(err)
		}
		_, n := b.entrerMembre(t, c, false)
		if n.siege != a.siege {
			t.Fatal("siège :", n.siege)
		}
		for i := range 20 {
			if d := b.essai(t, n, trameD(0, i)); d != 0 {
				t.Fatal("nouvel occupant : compte hérité", i, d)
			}
		}
	})
}

// Quota disque dépassé (EDQUOT, injecté) : traité comme un disque plein.
func TestDisqueQuotaEDQUOT(t *testing.T) {
	b := nouveauBanc(t, 200)
	c := b.creer(t, 4)
	_, g := b.entrerMembre(t, c, true)
	s := g.salon
	f := avecPanne(t, s.conv)
	f.ecriturePartielle, f.errEcriture = true, syscall.EDQUOT
	seq := dernierSeq(s)
	if _, err := b.m.Recevoir(g, trameD(0, 1), nil); !errors.Is(err, ErrPlein) {
		t.Fatal(err)
	}
	if dernierSeq(s) != seq || s.conv.Taille() != 0 {
		t.Fatal("rang consommé ou écriture partielle")
	}
}

// limiteDe : copie des seaux du siège de mb.
func limiteDe(mb Membre) limiteSiege {
	s := mb.salon
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.limites[mb.siege]
}

// Relecture Task 12 (a) : un refus de la cadence ne prend aucun jeton horaire.
func TestRefusCadenceSansJetonHoraire(t *testing.T) {
	b := bancLimite(t)
	c := b.creer(t, 4)
	_, g := b.entrerMembre(t, c, true)
	for i := range 20 {
		b.essai(t, g, trameD(0, i))
	}
	h0 := limiteDe(g).horaire.jetons
	for i := range 10 {
		if b.essai(t, g, trameD(0, i)) == 0 {
			t.Fatal("cadence non vide")
		}
	}
	b.h.avancer(20 * time.Second)
	if h := limiteDe(g).horaire.jetons; h != h0 {
		t.Fatal("jetons horaires pris par des refus :", h0, "→", h)
	}
}

// Relecture Task 12 (b) : un refus du seau horaire ne prend aucun jeton de cadence.
func TestRefusHoraireSansJetonCadence(t *testing.T) {
	b := bancLimite(t)
	c := b.creer(t, 4)
	_, g := b.entrerMembre(t, c, true)
	sous(g.salon, func() { g.salon.limites[g.siege].horaire.jetons = 0 })
	for i := range 10 {
		if b.essai(t, g, trameD(0, i)) == 0 {
			t.Fatal("horaire non vide")
		}
	}
	for i := range 20 {
		if d := b.essai(t, g, trameD(dVolatile, i)); d != 0 {
			t.Fatal("cadence entamée par des refus horaires :", i, d)
		}
	}
}

// Relecture Task 12 (c) : un refus « disque plein » ne prend aucun jeton.
func TestRefusDisqueSansJeton(t *testing.T) {
	b := bancLimite(t)
	partages := b.partagesInjectes()
	c := b.creer(t, 4)
	_, g := b.entrerMembre(t, c, true)
	partages.Store(b.m.cfg.StorageMax)
	for i := range 25 {
		if _, err := b.m.Recevoir(g, trameD(0, i), nil); !errors.Is(err, ErrPlein) {
			t.Fatal(i, err)
		}
	}
	partages.Store(0)
	for i := range 20 {
		if d := b.essai(t, g, trameD(0, i)); d != 0 {
			t.Fatal("jetons pris par des refus « disque plein » :", i, d)
		}
	}
}

// Relecture Task 12, mineur 1 : ENOSPC rend les jetons pris avant l'écriture.
func TestENOSPCRendLeJeton(t *testing.T) {
	b := bancLimite(t)
	c := b.creer(t, 4)
	_, g := b.entrerMembre(t, c, true)
	f := avecPanne(t, g.salon.conv)
	f.ecriturePartielle, f.errEcriture = true, syscall.ENOSPC
	for i := range 5 {
		if _, err := b.m.Recevoir(g, trameD(0, i), nil); !errors.Is(err, ErrPlein) {
			t.Fatal(i, err)
		}
	}
	h := limiteDe(g).horaire.jetons
	f.ecriturePartielle = false
	for i := range 20 {
		if d := b.essai(t, g, trameD(0, i)); d != 0 {
			t.Fatal("jetons non rendus après ENOSPC :", i, d)
		}
	}
	if h != horaireMax {
		t.Fatal("jetons horaires non rendus :", h)
	}
}

// Relecture Task 12, mineur 2 : total atomique des conversations (Manager.octetsConv) égal à
// la somme des tailles après des ajouts, des échecs (annulé, puis Truncate en échec) et des
// destructions ; UsedBytes le lit sans parcourir les salons.
func TestUsageAtomiqueCoherent(t *testing.T) {
	b := nouveauBanc(t, 200)
	c1, c2 := b.creer(t, 4), b.creer(t, 4)
	_, g1 := b.entrerMembre(t, c1, true)
	_, g2 := b.entrerMembre(t, c2, true)
	verifier := func(quand string, attendu int64) {
		t.Helper()
		if got := b.m.octetsConv.Load(); got != attendu {
			t.Fatalf("%s : total %d, attendu %d", quand, got, attendu)
		}
		if got := g1.salon.conv.Taille() + g2.salon.conv.Taille(); got != attendu {
			t.Fatalf("%s : somme des tailles %d, attendu %d", quand, got, attendu)
		}
		if u := b.m.UsedBytes(); u != attendu { // aucune pièce
			t.Fatalf("%s : UsedBytes %d", quand, u)
		}
	}
	verifier("ouverture", 0)
	for i := range emplacementsParPalier { // un palier plein : l'ajout suivant agrandit le fichier
		b.recevoir(t, g1, trameD(0, i))
	}
	b.recevoir(t, g2, trameD(0, 9))
	verifier("ajouts", 2*TaillePalier)
	f := avecPanne(t, g1.salon.conv)
	f.ecriturePartielle = true
	if _, err := b.m.Recevoir(g1, trameD(0, 3), nil); err == nil {
		t.Fatal("écriture partielle acceptée")
	}
	verifier("échec annulé", 2*TaillePalier)
	f.truncateEchoue = true
	if _, err := b.m.Recevoir(g1, trameD(0, 4), nil); err == nil {
		t.Fatal("écriture partielle acceptée")
	}
	verifier("Truncate en échec (borne haute)", 3*TaillePalier)
	id1 := b.idDe(t, c1)
	if err := b.m.detruire(id1); err != nil {
		t.Fatal(err)
	}
	verifier("destruction", TaillePalier)
	if err := b.m.detruire(id1); err != nil {
		t.Fatal(err)
	}
	verifier("destruction répétée", TaillePalier)
	if err := b.m.detruire(b.idDe(t, c2)); err != nil {
		t.Fatal(err)
	}
	verifier("tout détruit", 0)
}

// Revue finale C-2, mineur (c) : le siège 0 est toujours le créateur ; « Quitter » puis
// rejoindre avec S_gestion n'est qu'une reprise (hors du plafond des arrivées) : ses seaux
// ne sont pas remis à neuf (sinon jusqu'à 3 600 trames non volatiles par heure).
func TestLimiteCreateurRevenu(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		b := bancLimite(t)
		c := b.creer(t, 4)
		_, g := b.entrerMembre(t, c, true)
		for i := range 20 {
			b.essai(t, g, trameD(0, i))
		}
		if b.essai(t, g, trameD(0, 20)) == 0 {
			t.Fatal("seau non vidé")
		}
		if err := b.m.Quitter(g); err != nil {
			t.Fatal(err)
		}
		_, g2 := b.entrerMembre(t, c, true)
		if g2.siege != 0 {
			t.Fatal("siège du créateur :", g2.siege)
		}
		if b.essai(t, g2, trameD(0, 21)) == 0 {
			t.Fatal("créateur revenu : rafale remise à neuf")
		}
		if h := limiteDe(g2).horaire.jetons; h > horaireMax-20 {
			t.Fatal("créateur revenu : seau horaire remis à neuf :", h)
		}
	})
}

// Point D9 du rapport de performance (décision du 13 novembre) : les trames volatiles
// (« en train d'écrire », accusés) ont leur propre seau (rafale de 30, puis 2 par seconde) ;
// elles ne retiennent plus les messages, et les messages ne les retiennent pas.
func TestSeauVolatile(t *testing.T) {
	b := bancLimite(t)
	c := b.creer(t, 4)
	_, g := b.entrerMembre(t, c, true)
	// 30 volatiles d'un coup : passent ; la 31ᵉ attend une demi-seconde.
	for i := range 30 {
		if d := b.essai(t, g, trameD(dVolatile, i)); d != 0 {
			t.Fatal("volatile refusée dans la rafale :", i, d)
		}
	}
	if d := b.essai(t, g, trameD(dVolatile, 30)); d != 500*time.Millisecond {
		t.Fatal("31ᵉ volatile :", d)
	}
	// Les 20 messages de la rafale passent encore.
	for i := range 20 {
		if d := b.essai(t, g, trameD(0, i)); d != 0 {
			t.Fatal("message retenu par les volatiles :", i, d)
		}
	}
	if b.essai(t, g, trameD(0, 21)) == 0 {
		t.Fatal("21ᵉ message accepté")
	}
	// Seau des messages vide : une volatile passe dès qu'elle a son jeton.
	b.h.avancer(500 * time.Millisecond)
	if d := b.essai(t, g, trameD(dVolatile, 31)); d != 0 {
		t.Fatal("volatile retenue par les messages :", d)
	}
	// Toujours borné : 10 min à 4 volatiles par seconde, au plus 2 par seconde passent.
	n := b.cadence(t, g, 2400, 0, 250*time.Millisecond, dVolatile)
	if n > 30+2*600+1 || n < 2*600-2 {
		t.Fatal("volatiles à 4 par seconde :", n, "acceptées sur 2 400")
	}
}
