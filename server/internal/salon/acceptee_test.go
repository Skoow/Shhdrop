package salon

import (
	"bytes"
	"net/netip"
	"testing"
	"testing/synctest"
	"time"
)

// Accusé d'acceptation 0x0F (revue finale C-2, I1) : l'expéditeur d'une trame 0x01 acceptée
// reçoit 0x0F (seq de la trame), même en rattrapage, quand il ne verra jamais l'écho de sa
// trame (volatile, « instantané » effacée avant que son rattrapage l'atteigne). Personne
// d'autre ne le reçoit. 0x0B et 0x0C atteignent aussi l'expéditeur en rattrapage.

// acceptees : seq des 0x0F reçus, dans l'ordre (taille exacte vérifiée).
func acceptees(t *testing.T, l *fauxLien) []uint64 {
	t.Helper()
	var r []uint64
	for i, e := range l.enrs() {
		if e.ty == 0x0F {
			if b := l.brut(i); len(b) != 9 {
				t.Fatalf("0x0F de %d octets", len(b))
			}
			r = append(r, e.seq)
		}
	}
	return r
}

// echo : l a reçu un 0x01 de rang seq.
func echo(l *fauxLien, seq uint64) bool {
	for _, e := range l.enrs() {
		if e.ty == 0x01 && e.seq == seq {
			return true
		}
	}
	return false
}

// enRattrapage : 500 trames rangées par g, puis connexion lente (1 ms par écriture) du jeton de
// ea depuis son rang d'émission : elle est en rattrapage pour environ 500 ms simulées.
func (b *banc) enRattrapage(t *testing.T, g Membre, ea Entree, autoriser func(netip.Addr) bool) *fauxLien {
	t.Helper()
	for i := 0; i < 500; i++ {
		b.recevoir(t, g, trameD(0, i))
	}
	la := nouveauLien()
	la.set(func(f *fauxLien) { f.delai = time.Millisecond })
	b.servir(la, autoriser)
	la.envoyer(accueilWS(ea.Jeton, ea.Seq))
	synctest.Wait()
	s := g.salon
	sous(s, func() {
		if c := s.conns[ea.Siege]; c == nil || c.direct {
			t.Fatal("connexion pas en rattrapage")
		}
	})
	return la
}

// Expéditeur en rattrapage, trame volatile : 0x0F reçu (jamais l'écho, la volatile n'est pas
// servie au rattrapage) ; l'autre membre, en direct, reçoit la trame mais aucun 0x0F.
func TestAccepteeVolatileEnRattrapage(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		b := nouveauBanc(t, 200)
		c := b.creer(t, 4)
		_, g := b.entrerMembre(t, c, true)
		ea := b.entrer(t, c, false)
		eb := b.entrer(t, c, false)
		lb := b.connecter(eb.Jeton, eb.Seq)
		synctest.Wait()
		la := b.enRattrapage(t, g, ea, toujours)
		la.envoyer(demTrame(trameD(dVolatile, 1)))
		synctest.Wait()
		seq := dernierSeq(g.salon)
		time.Sleep(2 * time.Second) // fin du rattrapage
		synctest.Wait()
		if got := acceptees(t, la); len(got) != 1 || got[0] != seq {
			t.Fatalf("0x0F chez l'expéditeur : %v, attendu [%d]", got, seq)
		}
		if echo(la, seq) {
			t.Fatal("écho d'une volatile servi hors du direct")
		}
		if !echo(lb, seq) {
			t.Fatal("trame volatile non relayée à l'autre membre")
		}
		if got := acceptees(t, lb); len(got) != 0 {
			t.Fatal("0x0F chez un autre membre :", got)
		}
		if la.codeFerme() != 0 || lb.codeFerme() != 0 {
			t.Fatal("connexion fermée")
		}
		finir(t, la, lb)
	})
}

// Expéditeur en rattrapage, trame « instantané » lue par le seul autre membre avant que le
// rattrapage l'atteigne : jamais servie, mais 0x0F reçu (puis le 0x0E).
func TestAccepteeInstantaneEffaceeAvantRattrapage(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		b := nouveauBanc(t, 200)
		c := b.creer(t, 4)
		_, g := b.entrerMembre(t, c, true)
		ea := b.entrer(t, c, false)
		la := b.enRattrapage(t, g, ea, toujours)
		la.envoyer(demTrame(trameD(dInstantane, 1)))
		synctest.Wait()
		seq := dernierSeq(g.salon)
		b.lu(t, g, seq) // dernier lecteur attendu : effacée
		time.Sleep(2 * time.Second)
		synctest.Wait()
		if echo(la, seq) {
			t.Fatal("trame effacée servie")
		}
		if got := acceptees(t, la); len(got) != 1 || got[0] != seq {
			t.Fatalf("0x0F : %v, attendu [%d]", got, seq)
		}
		if e := effaces(la); len(e) != 1 || e[0] != seq {
			t.Fatal("0x0E :", e)
		}
		finir(t, la)
	})
}

// Expéditeur seul dans le salon et en rattrapage : sa trame « instantané » est effacée aussitôt
// (personne à attendre) ; 0x0F reçu quand même.
func TestAccepteeInstantaneSeulEnRattrapage(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		b := nouveauBanc(t, 200)
		c := b.creer(t, 4)
		_, g := b.entrerMembre(t, c, true)
		ea := b.entrer(t, c, false)
		la := b.enRattrapage(t, g, ea, toujours)
		if err := b.m.Quitter(g); err != nil {
			t.Fatal(err)
		}
		la.envoyer(demTrame(trameD(dInstantane, 1)))
		synctest.Wait()
		seq := dernierSeq(g.salon)
		time.Sleep(2 * time.Second)
		synctest.Wait()
		if got := acceptees(t, la); len(got) != 1 || got[0] != seq {
			t.Fatalf("0x0F : %v, attendu [%d]", got, seq)
		}
		finir(t, la)
	})
}

// En direct, 0x0F suit l'écho de la trame, à chaque trame acceptée ; un refus (0x0B) n'en
// donne pas.
func TestAccepteeApresEchoEnDirect(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		b := nouveauBanc(t, 200)
		c := b.creer(t, 4)
		b.entrer(t, c, true)
		ea, a := b.entrerMembre(t, c, false)
		la := b.connecter(ea.Jeton, ea.Seq)
		synctest.Wait()
		var seqs []uint64
		for i := 0; i < 3; i++ {
			la.envoyer(demTrame(trameD(byte(i%2), i)))
			synctest.Wait()
			seqs = append(seqs, dernierSeq(a.salon))
		}
		l := la.enrs()
		vu := 0
		for i, e := range l {
			if e.ty != 0x0F {
				continue
			}
			if i == 0 || l[i-1].ty != 0x01 || l[i-1].seq != e.seq || e.seq != seqs[vu] {
				t.Fatalf("0x0F %d sans son écho juste avant", e.seq)
			}
			vu++
		}
		if vu != len(seqs) {
			t.Fatal("0x0F reçus :", vu)
		}
		finir(t, la)
	})
}

// 0x0B (adresse limitée) et 0x0C (disque plein) atteignent l'expéditeur en rattrapage, sans
// 0x0F ni fermeture.
func TestRefusAtteintExpediteurEnRattrapage(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		b := nouveauBanc(t, 200)
		c := b.creer(t, 4)
		_, g := b.entrerMembre(t, c, true)
		ea := b.entrer(t, c, false)
		refus := false
		autoriser := func(netip.Addr) bool { return !refus }
		la := b.enRattrapage(t, g, ea, autoriser)
		refus = true
		la.envoyer(demTrame(trameD(0, 1)))
		synctest.Wait()
		seq := dernierSeq(g.salon)
		refus = false
		b.m.cfg.StorageMax = 1 // disque plein pour toute trame non volatile
		la.envoyer(demTrame(trameD(0, 2)))
		synctest.Wait()
		time.Sleep(2 * time.Second)
		synctest.Wait()
		if dernierSeq(g.salon) != seq {
			t.Fatal("trame refusée rangée")
		}
		var limite, plein bool
		for i, e := range la.enrs() {
			switch e.ty {
			case 0x0B:
				limite = bytes.Equal(la.brut(i), EnrLimite(seq, 30))
			case 0x0C:
				plein = bytes.Equal(la.brut(i), EnrPlein(seq))
			}
		}
		if !limite || !plein {
			t.Fatalf("0x0B reçu : %v, 0x0C reçu : %v", limite, plein)
		}
		if got := acceptees(t, la); len(got) != 0 || la.codeFerme() != 0 {
			t.Fatal("0x0F sur un refus, ou fermeture :", got, la.codeFerme())
		}
		finir(t, la)
	})
}
