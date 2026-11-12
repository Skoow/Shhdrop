package salon

import (
	"bytes"
	"encoding/binary"
	"errors"
	"slices"
	"sync"
	"testing"
	"testing/synctest"
	"time"
)

// Effacement par règle et par lectures (plan C-2 Task 11, v3 §5).

const (
	dDixMinutes = byte(DixMinutes) << 1
	dUneHeure   = byte(UneHeure) << 1
)

func demLu(seq uint64) []byte { return binary.BigEndian.AppendUint64([]byte{DemLu}, seq) }

// effaces : cibles des 0x0E reçus par l, dans l'ordre.
func effaces(l *fauxLien) []uint64 {
	var r []uint64
	for _, e := range l.enrs() {
		if e.ty == 0x0E {
			r = append(r, binary.BigEndian.Uint64(e.corps))
		}
	}
	return r
}

// entreeDe : copie de l'entrée d'index de rang seq (ok = false si absente).
func entreeDe(s *salon, seq uint64) (entree, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, e := range s.index {
		if e.seq == seq {
			return e, true
		}
	}
	return entree{}, false
}

// servie : la trame de rang seq est encore servie au rattrapage.
func servie(t *testing.T, s *salon, seq uint64) bool {
	t.Helper()
	return slices.Contains(stockes(t, s, 0), seq)
}

// effaceeSurDisque : l'entrée de rang seq est marquée effacée et son emplacement d'origine
// est nul sur le disque (ErrEfface).
func effaceeSurDisque(t *testing.T, s *salon, seq uint64, emplacement uint32) bool {
	t.Helper()
	e, ok := entreeDe(s, seq)
	if !ok {
		t.Fatal("rang absent de l'index :", seq)
	}
	_, err := s.conv.Lire(emplacement)
	return e.efface() && errors.Is(err, ErrEfface)
}

func (b *banc) lu(t *testing.T, mb Membre, seq uint64) {
	t.Helper()
	if err := b.m.Lu(mb, seq); err != nil {
		t.Fatal(err)
	}
}

// « Instantané », 3 sièges : B lit → encore servie ; C lit (par le WebSocket) → emplacement
// nul, 0x0E reçu par A, B et C (expéditeur compris), plus servie au rattrapage.
func TestInstantaneTousLu(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		b := nouveauBanc(t, 200)
		c := b.creer(t, 4)
		eg, g := b.entrerMembre(t, c, true)
		ea, _ := b.entrerMembre(t, c, false)
		eb, _ := b.entrerMembre(t, c, false)
		lg := b.connecter(eg.Jeton, eg.Seq)
		la := b.connecter(ea.Jeton, ea.Seq)
		lb := b.connecter(eb.Jeton, eb.Seq)
		synctest.Wait()
		s := g.salon
		seq := b.recevoir(t, g, trameD(dInstantane, 1))
		e0, _ := entreeDe(s, seq)
		la.envoyer(demLu(seq))
		synctest.Wait()
		if !servie(t, s, seq) || len(effaces(lg)) != 0 {
			t.Fatal("effacée après une seule lecture sur deux")
		}
		lb.envoyer(demLu(seq))
		synctest.Wait()
		if !effaceeSurDisque(t, s, seq, e0.emplacement) || servie(t, s, seq) {
			t.Fatal("non effacée après la dernière lecture")
		}
		for _, l := range []*fauxLien{lg, la, lb} {
			if !slices.Equal(effaces(l), []uint64{seq}) {
				t.Fatal("0x0E :", effaces(l))
			}
			if last := l.brut(len(l.enrs()) - 1); !bytes.Equal(last, EnrEfface(dernierSeq(s), seq)) {
				t.Fatalf("0x0E : %x", last)
			}
			if l.codeFerme() != 0 {
				t.Fatal("fermée :", l.codeFerme())
			}
		}
		finir(t, lg, la, lb)
	})
}

// Lu sans effet : expéditeur, siège arrivé après l'envoi, deux fois le même, règle 10 min,
// volatile, rang inconnu ; membre périmé : ErrNotFound.
func TestLuRefuse(t *testing.T) {
	b := nouveauBanc(t, 200)
	c := b.creer(t, 5)
	_, g := b.entrerMembre(t, c, true)
	_, a := b.entrerMembre(t, c, false)
	_, bm := b.entrerMembre(t, c, false)
	s := g.salon
	inst := b.recevoir(t, g, trameD(dInstantane, 1))
	dix := b.recevoir(t, g, trameD(dDixMinutes, 2))
	vol := b.recevoir(t, g, trameD(dVolatile|dInstantane, 3))
	_, tard := b.entrerMembre(t, c, false)
	avant, _ := entreeDe(s, inst)
	if avant.attendus != 1<<a.siege|1<<bm.siege {
		t.Fatalf("attendus %b", avant.attendus)
	}
	b.lu(t, g, inst)    // expéditeur
	b.lu(t, tard, inst) // arrivé après l'envoi
	b.lu(t, a, inst)
	b.lu(t, a, inst) // deux fois
	b.lu(t, a, dix)
	b.lu(t, bm, dix)
	b.lu(t, a, vol)
	b.lu(t, bm, vol)
	b.lu(t, a, 999)
	if e, _ := entreeDe(s, inst); e.efface() || e.attendus != 1<<bm.siege {
		t.Fatalf("instantané : %+v", e)
	}
	if e, _ := entreeDe(s, dix); e.efface() || e.attendus != 0 {
		t.Fatalf("10 min : %+v", e)
	}
	if _, ok := entreeDe(s, vol); ok {
		t.Fatal("volatile indexée")
	}
	if err := b.m.Quitter(a); err != nil {
		t.Fatal(err)
	}
	if err := b.m.Lu(a, inst); !errors.Is(err, ErrNotFound) {
		t.Fatal("membre parti :", err)
	}
	if err := b.m.Lu(Membre{}, inst); !errors.Is(err, ErrNotFound) {
		t.Fatal("membre vide :", err)
	}
}

// Expéditeur seul : effacée dès sa diffusion (0x01 puis 0x0E), jamais écrite sur le disque.
func TestInstantaneSeul(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		b := nouveauBanc(t, 200)
		c := b.creer(t, 4)
		eg, g := b.entrerMembre(t, c, true)
		lg := b.connecter(eg.Jeton, eg.Seq)
		synctest.Wait()
		s := g.salon
		seq := b.recevoir(t, g, trameD(dInstantane, 1))
		synctest.Wait()
		if e, ok := entreeDe(s, seq); !ok || !e.efface() || servie(t, s, seq) {
			t.Fatalf("non effacée : %+v", e)
		}
		if n := s.conv.Taille(); n != 0 {
			t.Fatal("écrite sur le disque :", n)
		}
		l := lg.enrs()
		if len(l) < 2 || l[len(l)-2].ty != 0x01 || l[len(l)-2].seq != seq ||
			!bytes.Equal(lg.brut(len(l)-1), EnrEfface(seq, seq)) {
			t.Fatalf("0x01 puis 0x0E attendus : %v", l)
		}
		finir(t, lg)
	})
}

// regleHoraire : effacée à recu + d (pas à d − 1 s), sans lecture ni 0x0E, comptée depuis
// l'heure de réception du serveur. La trame porte dans son contenu une heure d'émission fausse
// (rien n'y est lu) ; une trame reçue 5 min plus tard vit 5 min de plus.
func regleHoraire(t *testing.T, d byte, duree time.Duration) {
	synctest.Test(t, func(t *testing.T) {
		b := nouveauBanc(t, 200)
		c := b.creer(t, 4)
		eg, g := b.entrerMembre(t, c, true)
		_, a := b.entrerMembre(t, c, false)
		lg := b.connecter(eg.Jeton, eg.Seq)
		synctest.Wait()
		s := g.salon
		tr := trameD(d, 1)
		binary.BigEndian.PutUint64(tr[len(marque)+1+24:], uint64(b.h.Now().Add(-48*time.Hour).UnixMilli()))
		un := b.recevoir(t, g, tr)
		b.h.avancer(5 * time.Minute)
		deux := b.recevoir(t, a, trameD(d, 2))
		e1, _ := entreeDe(s, un)
		e2, _ := entreeDe(s, deux)
		b.h.avancer(duree - 5*time.Minute - time.Second)
		b.m.Tick()
		if !servie(t, s, un) || !servie(t, s, deux) {
			t.Fatal("effacée avant l'échéance")
		}
		b.h.avancer(time.Second)
		b.m.Tick()
		if !effaceeSurDisque(t, s, un, e1.emplacement) || servie(t, s, un) || !servie(t, s, deux) {
			t.Fatal("première trame : échéance non tenue")
		}
		b.h.avancer(5*time.Minute - time.Millisecond)
		b.m.Tick()
		if !servie(t, s, deux) {
			t.Fatal("seconde trame effacée avant son échéance")
		}
		b.h.avancer(time.Millisecond)
		b.m.Tick()
		if !effaceeSurDisque(t, s, deux, e2.emplacement) {
			t.Fatal("seconde trame non effacée")
		}
		synctest.Wait()
		if l := effaces(lg); len(l) != 0 {
			t.Fatal("0x0E pour une règle horaire :", l)
		}
		finir(t, lg)
	})
}

func TestDixMinutes(t *testing.T) { regleHoraire(t, dDixMinutes, 10*time.Minute) }

func TestUneHeure(t *testing.T) { regleHoraire(t, dUneHeure, time.Hour) }

// « Désactivé » : jamais effacée par Tick, même 24 h plus tard (jusqu'à la fin du salon).
func TestDesactiveReste(t *testing.T) {
	b := nouveauBanc(t, 200)
	c := b.creer(t, 4)
	_, g := b.entrerMembre(t, c, true)
	seq := b.recevoir(t, g, trameD(0, 1))
	b.h.avancer(23*time.Hour + 59*time.Minute)
	b.m.Tick()
	if !servie(t, g.salon, seq) {
		t.Fatal("trame « désactivé » effacée")
	}
}

// Review Focus 5 : C, hors ligne, n'a pas lu ; la trame attend ; à 10 min hors ligne, son
// siège est libéré (0x03) puis les trames qui n'attendaient plus que lui sont effacées (0x0E).
func TestInstantaneLibereParDepart(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		b := nouveauBanc(t, 200)
		c := b.creer(t, 4)
		eg, g := b.entrerMembre(t, c, true)
		ea, a := b.entrerMembre(t, c, false)
		_, cm := b.entrerMembre(t, c, false) // jamais connecté : hors ligne depuis son entrée
		lg := b.connecter(eg.Jeton, eg.Seq)
		la := b.connecter(ea.Jeton, ea.Seq)
		synctest.Wait()
		s := g.salon
		un := b.recevoir(t, g, trameD(dInstantane, 1))
		deux := b.recevoir(t, a, trameD(dInstantane, 2))
		trois := b.recevoir(t, g, trameD(dInstantane, 3)) // A ne la lit pas
		b.lu(t, a, un)
		b.lu(t, g, deux)
		b.h.avancer(horsLigneMax - time.Second)
		b.m.Tick()
		synctest.Wait()
		if !servie(t, s, un) || !servie(t, s, deux) || len(effaces(lg)) != 0 {
			t.Fatal("effacée avant la libération")
		}
		b.h.avancer(time.Second)
		b.m.Tick()
		synctest.Wait()
		depart := dernierSeq(s)
		for _, l := range []*fauxLien{lg, la} {
			n := len(l.enrs())
			if n < 3 || !bytes.Equal(l.brut(n-3), EnrDepart(depart, cm.siege)) ||
				!bytes.Equal(l.brut(n-2), EnrEfface(depart, un)) || !bytes.Equal(l.brut(n-1), EnrEfface(depart, deux)) {
				var fin []byte
				for _, e := range l.enrs()[max(0, n-3):] {
					fin = append(fin, e.ty)
				}
				t.Fatalf("0x03 puis 0x0E attendus : %x", fin)
			}
		}
		if servie(t, s, un) || servie(t, s, deux) || !servie(t, s, trois) {
			t.Fatal("rattrapage après la libération")
		}
		if e, _ := entreeDe(s, trois); e.attendus != 1<<a.siege {
			t.Fatalf("attendus de la 3ᵉ : %b", e.attendus)
		}
		finir(t, lg, la)
	})
}

// Quitter : même effet, immédiat.
func TestInstantaneQuitter(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		b := nouveauBanc(t, 200)
		c := b.creer(t, 4)
		eg, g := b.entrerMembre(t, c, true)
		_, a := b.entrerMembre(t, c, false)
		_, cm := b.entrerMembre(t, c, false)
		lg := b.connecter(eg.Jeton, eg.Seq)
		synctest.Wait()
		s := g.salon
		seq := b.recevoir(t, g, trameD(dInstantane, 1))
		b.lu(t, a, seq)
		if err := b.m.Quitter(cm); err != nil {
			t.Fatal(err)
		}
		synctest.Wait()
		if servie(t, s, seq) || !slices.Equal(effaces(lg), []uint64{seq}) {
			t.Fatal("non effacée au départ :", effaces(lg))
		}
		finir(t, lg)
	})
}

// Reprise (0x0A) : B n'est plus attendu pour les trames d'avant son 0x0A, il l'est pour les
// suivantes ; même chose pour le créateur qui reprend le siège 0 par rejoindre.
func TestRepriseNeComptePlus(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		b := nouveauBanc(t, 200)
		c := b.creer(t, 4)
		_, g := b.entrerMembre(t, c, true)
		eb, bm := b.entrerMembre(t, c, false)
		_, cm := b.entrerMembre(t, c, false)
		s := g.salon
		avant := b.recevoir(t, g, trameD(dInstantane, 1))
		lb := b.connecter(eb.Jeton, DepuisReprise)
		synctest.Wait()
		if e, _ := entreeDe(s, avant); e.attendus != 1<<cm.siege {
			t.Fatalf("attendus après la reprise : %b", e.attendus)
		}
		apres := b.recevoir(t, g, trameD(dInstantane, 2))
		b.lu(t, cm, avant)
		b.lu(t, cm, apres)
		if servie(t, s, avant) == true || !servie(t, s, apres) {
			t.Fatal("avant : effacée par C seul ; après : B encore attendu")
		}
		lb.envoyer(demLu(apres))
		synctest.Wait()
		if servie(t, s, apres) {
			t.Fatal("après : non effacée par la lecture de B")
		}
		finir(t, lb)

		// Créateur : reprise du siège 0 par rejoindre.
		x := b.recevoir(t, bm, trameD(dInstantane, 3))
		b.entrer(t, c, true)
		if e, _ := entreeDe(s, x); e.attendus != 1<<cm.siege {
			t.Fatalf("attendus après la reprise du créateur : %b", e.attendus)
		}
	})
}

// C revient à 9 min : il reçoit la trame au rattrapage, la lit → effacée, 0x0E pour tous.
func TestAbsentRevientAvant10Min(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		b := nouveauBanc(t, 200)
		c := b.creer(t, 4)
		eg, g := b.entrerMembre(t, c, true)
		_, a := b.entrerMembre(t, c, false)
		ec, _ := b.entrerMembre(t, c, false)
		lg := b.connecter(eg.Jeton, eg.Seq)
		synctest.Wait()
		s := g.salon
		seq := b.recevoir(t, g, trameD(dInstantane, 1))
		b.lu(t, a, seq)
		b.h.avancer(9 * time.Minute)
		b.m.Tick()
		lc := b.connecter(ec.Jeton, ec.Seq)
		synctest.Wait()
		if !slices.Contains(rangs(lc.enrs()), seq) {
			t.Fatal("trame non reçue au rattrapage")
		}
		lc.envoyer(demLu(seq))
		synctest.Wait()
		if servie(t, s, seq) || !slices.Equal(effaces(lg), []uint64{seq}) || !slices.Equal(effaces(lc), []uint64{seq}) {
			t.Fatal("non effacée après la lecture de C")
		}
		b.h.avancer(2 * time.Minute)
		b.m.Tick()
		s.mu.Lock()
		libere := s.sieges[ec.Siege] == nil
		s.mu.Unlock()
		if libere {
			t.Fatal("siège de C libéré alors qu'il est en ligne")
		}
		finir(t, lg, lc)
	})
}

// Relecture Task 9 : client lent sorti du direct, trame déjà reçue effacée pendant son
// rattrapage → 0x0E reçu quand même, au retour dans le direct, après la trame.
func TestEffaceePendantRattrapage(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		b := nouveauBanc(t, 200)
		c := b.creer(t, 4)
		_, g := b.entrerMembre(t, c, true)
		ea, a := b.entrerMembre(t, c, false)
		eb, bm := b.entrerMembre(t, c, false)
		la := b.connecter(ea.Jeton, ea.Seq)
		lb := b.connecter(eb.Jeton, eb.Seq)
		synctest.Wait()
		s := g.salon
		x := b.recevoir(t, g, trameD(dInstantane, 0))
		synctest.Wait()
		if !slices.Contains(rangs(lb.enrs()), x) {
			t.Fatal("trame non reçue en direct")
		}
		lb.set(func(f *fauxLien) { f.delai = 5 * time.Millisecond })
		sorti := false
		for i := 1; i < 1000 && !sorti; i++ {
			b.recevoir(t, g, trameD(0, i))
			time.Sleep(time.Millisecond)
			cb := connDe(s, eb.Siege)
			s.mu.Lock()
			sorti = !cb.direct
			s.mu.Unlock()
		}
		if !sorti {
			t.Fatal("jamais sorti du direct")
		}
		b.lu(t, a, x)
		b.lu(t, bm, x)
		if cb := connDe(s, eb.Siege); func() bool { s.mu.Lock(); defer s.mu.Unlock(); return cb.direct }() {
			t.Fatal("revenu au direct avant l'effacement : le test ne prouve rien")
		}
		lb.set(func(f *fauxLien) { f.delai = 0 })
		time.Sleep(time.Second)
		synctest.Wait()
		if lb.codeFerme() != 0 {
			t.Fatal("client lent fermé :", lb.codeFerme())
		}
		if !slices.Equal(effaces(lb), []uint64{x}) || !slices.Equal(effaces(la), []uint64{x}) {
			t.Fatal("0x0E :", effaces(lb), effaces(la))
		}
		l := lb.enrs()
		iTrame, iEff := -1, -1
		for i, e := range l {
			if e.ty == 0x01 && e.seq == x {
				iTrame = i
			}
			if e.ty == 0x0E {
				iEff = i
			}
		}
		if iTrame < 0 || iEff < iTrame {
			t.Fatal("0x0E avant la trame :", iTrame, iEff)
		}
		finir(t, la, lb)
	})
}

// Concurrence (temps réel, -race) : trois lecteurs lisent 200 trames « instantané » dans le
// désordre pendant que Tick tourne et que l'un d'eux part en cours de route ; chaque trame
// est effacée, et l'expéditeur, connecté, reçoit exactement un 0x0E par trame.
func TestLuConcurrent(t *testing.T) {
	b := nouveauBanc(t, 200)
	c := b.creer(t, 4)
	eg, g := b.entrerMembre(t, c, true)
	var lecteurs [3]Membre
	for i := range lecteurs {
		_, lecteurs[i] = b.entrerMembre(t, c, false)
	}
	s := g.salon
	lg := b.connecter(eg.Jeton, eg.Seq)
	attendre(t, func() bool { cg := connDe(s, 0); return cg != nil })
	const n = 200
	seqs := make([]uint64, n)
	for i := range seqs {
		seqs[i] = b.recevoir(t, g, trameD(dInstantane, i))
	}
	stop := make(chan struct{})
	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		for {
			select {
			case <-stop:
				return
			default:
				b.m.Tick()
			}
		}
	}()
	var lus sync.WaitGroup
	for k, mb := range lecteurs {
		lus.Add(1)
		go func() {
			defer lus.Done()
			ordre := slices.Clone(seqs)
			if k%2 == 1 {
				slices.Reverse(ordre)
			}
			for i, seq := range ordre {
				if k == 2 && i == n/2 {
					if err := b.m.Quitter(mb); err != nil {
						t.Error(err)
					}
					return
				}
				if err := b.m.Lu(mb, seq); err != nil {
					t.Error(err)
					return
				}
			}
		}()
	}
	lus.Wait()
	close(stop)
	wg.Wait()
	for _, seq := range seqs {
		if servie(t, s, seq) {
			t.Fatal("non effacée :", seq)
		}
	}
	attendre(t, func() bool { return len(effaces(lg)) >= n })
	recus := effaces(lg)
	slices.Sort(recus)
	if !slices.Equal(recus, seqs) {
		t.Fatal("0x0E : manquant ou en double", len(recus))
	}
	finir(t, lg)
}

// Écriture des zéros en échec (disque) : ErrES rendue (retrait, lecture), mais la trame n'est
// plus jamais servie, quelle que soit la voie (retrait, dernière lecture, échéance).
func TestEffacementEchecPlusServie(t *testing.T) {
	b := nouveauBanc(t, 200)
	c := b.creer(t, 4)
	_, g := b.entrerMembre(t, c, true)
	_, a := b.entrerMembre(t, c, false)
	s := g.salon
	ret := b.recevoir(t, g, trameD(0, 1))
	inst := b.recevoir(t, g, trameD(dInstantane, 2))
	dix := b.recevoir(t, g, trameD(dDixMinutes, 3))
	avecPanne(t, s.conv).ecriturePartielle = true
	if err := b.m.Retirer(g, ret); !errors.Is(err, ErrES) {
		t.Fatal("Retirer :", err)
	}
	if err := b.m.Lu(a, inst); !errors.Is(err, ErrES) {
		t.Fatal("Lu :", err)
	}
	b.h.avancer(10 * time.Minute)
	b.m.Tick()
	for _, seq := range []uint64{ret, inst, dix} {
		if e, _ := entreeDe(s, seq); !e.efface() {
			t.Fatal("encore servie après un échec d'écriture :", seq)
		}
	}
	if l := stockes(t, s, 0); slices.ContainsFunc(l, func(q uint64) bool { return q == ret || q == inst || q == dix }) {
		t.Fatal("rattrapage :", l)
	}
}

// I1 : une trame « instantané » retirée par son auteur n'attend plus personne : le départ
// ultérieur de ses lecteurs n'envoie aucun 0x0E.
func TestRetireePuisDepartSans0x0E(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		b := nouveauBanc(t, 200)
		c := b.creer(t, 4)
		eg, g := b.entrerMembre(t, c, true)
		_, cm := b.entrerMembre(t, c, false)
		lg := b.connecter(eg.Jeton, eg.Seq)
		synctest.Wait()
		seq := b.recevoir(t, g, trameD(dInstantane, 1))
		if err := b.m.Retirer(g, seq); err != nil {
			t.Fatal(err)
		}
		if e, _ := entreeDe(g.salon, seq); !e.efface() || e.attendus != 0 {
			t.Fatalf("après retrait : %+v", e)
		}
		if err := b.m.Quitter(cm); err != nil {
			t.Fatal(err)
		}
		synctest.Wait()
		if l := effaces(lg); len(l) != 0 {
			t.Fatal("0x0E pour une trame retirée :", l)
		}
		finir(t, lg)
	})
}

// I2 : un départ qui efface 1 500 trames d'un coup ne ferme aucune connexion (un 0x0E ne
// fait jamais fermer) ; chaque connexion reçoit les 1 500 0x0E.
func TestDepartEffaceBeaucoup(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		b := nouveauBanc(t, 200)
		c := b.creer(t, 4)
		eg, g := b.entrerMembre(t, c, true)
		ea, a := b.entrerMembre(t, c, false)
		_, cm := b.entrerMembre(t, c, false)
		lg := b.connecter(eg.Jeton, eg.Seq)
		la := b.connecter(ea.Jeton, ea.Seq)
		synctest.Wait()
		const n = 1500
		var seqs []uint64
		for i := range n {
			seq := b.recevoir(t, g, trameD(dInstantane, i))
			b.lu(t, a, seq)
			seqs = append(seqs, seq)
			if i%100 == 0 {
				synctest.Wait()
			}
		}
		synctest.Wait()
		if err := b.m.Quitter(cm); err != nil {
			t.Fatal(err)
		}
		synctest.Wait()
		for _, l := range []*fauxLien{lg, la} {
			if l.codeFerme() != 0 {
				t.Fatal("connexion fermée :", l.codeFerme())
			}
			if got := effaces(l); !slices.Equal(got, seqs) {
				t.Fatal("0x0E reçus :", len(got))
			}
		}
		finir(t, lg, la)
	})
}

// I3 : B reçoit une trame « instantané », lit, se coupe ; la trame est effacée par la
// dernière lecture ; B se reconnecte avec depuis = ce rang → 0x0E dans l'accueil, après le
// 0x0D et les 0x07.
func TestReconnexionRecoit0x0E(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		b := nouveauBanc(t, 200)
		c := b.creer(t, 4)
		_, g := b.entrerMembre(t, c, true)
		eb, bm := b.entrerMembre(t, c, false)
		_, cm := b.entrerMembre(t, c, false)
		s := g.salon
		lb := b.connecter(eb.Jeton, eb.Seq)
		synctest.Wait()
		x := b.recevoir(t, g, trameD(dInstantane, 1))
		synctest.Wait()
		if !slices.Contains(rangs(lb.enrs()), x) {
			t.Fatal("trame non reçue")
		}
		b.lu(t, bm, x)
		finir(t, lb)
		b.lu(t, cm, x)
		lb2 := b.connecter(eb.Jeton, x)
		synctest.Wait()
		l := lb2.enrs()
		if len(l) != 1+3+1 || l[0].ty != 0x0D || l[1].ty != 0x07 || l[3].ty != 0x07 ||
			!bytes.Equal(lb2.brut(4), EnrEfface(dernierSeq(s), x)) {
			t.Fatalf("accueil : %v", l)
		}
		finir(t, lb2)
	})
}

// I3, ce que l'accueil ne renvoie pas : trame retirée, trame « 10 min » échue, trame effacée
// par lecture de rang > depuis (jamais reçue : le rattrapage ne la sert pas) ou ≤ rang
// d'émission du jeton (jamais reçue) ; et une reprise ne renvoie aucun 0x0E.
func TestReconnexion0x0EExclus(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		b := nouveauBanc(t, 200)
		c := b.creer(t, 4)
		_, g := b.entrerMembre(t, c, true)
		_, a := b.entrerMembre(t, c, false)
		avantB := b.recevoir(t, g, trameD(dInstantane, 0)) // attend A seul
		eb, bm := b.entrerMembre(t, c, false)
		b.lu(t, a, avantB) // effacée par lecture, rang ≤ émission du jeton de B
		retiree := b.recevoir(t, g, trameD(dInstantane, 1))
		dix := b.recevoir(t, g, trameD(dDixMinutes, 2))
		lue := b.recevoir(t, g, trameD(dInstantane, 3))
		point := lue
		tard := b.recevoir(t, g, trameD(dInstantane, 4))
		if err := b.m.Retirer(g, retiree); err != nil {
			t.Fatal(err)
		}
		for _, seq := range []uint64{lue, tard} {
			b.lu(t, a, seq)
			b.lu(t, bm, seq)
		}
		b.h.avancer(10 * time.Minute)
		func() { // échéance sans Tick, qui libérerait aussi les sièges hors ligne
			s := g.salon
			s.mu.Lock()
			defer s.mu.Unlock()
			s.effacerEchuesLocked(b.h.Now().UnixMilli())
		}()
		if e, _ := entreeDe(g.salon, dix); !e.efface() {
			t.Fatal("10 min non effacée")
		}
		lb := b.connecter(eb.Jeton, point)
		synctest.Wait()
		if got := effaces(lb); !slices.Equal(got, []uint64{lue}) {
			t.Fatal("0x0E à l'accueil :", got)
		}
		finir(t, lb)
		lr := b.connecter(eb.Jeton, DepuisReprise)
		synctest.Wait()
		if got := effaces(lr); len(got) != 0 {
			t.Fatal("0x0E après une reprise :", got)
		}
		finir(t, lr)
	})
}

// M2 : une trame échue n'est jamais servie, même avant le passage de Tick.
func TestEchueJamaisServie(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		b := nouveauBanc(t, 200)
		c := b.creer(t, 4)
		_, g := b.entrerMembre(t, c, true)
		ea, _ := b.entrerMembre(t, c, false)
		s := g.salon
		seq := b.recevoir(t, g, trameD(dDixMinutes, 1))
		b.h.avancer(10 * time.Minute)
		if servie(t, s, seq) {
			t.Fatal("servie par suite après l'échéance, avant Tick")
		}
		seq2 := b.recevoir(t, g, trameD(dDixMinutes, 2))
		b.h.avancer(10 * time.Minute)
		la := b.connecter(ea.Jeton, ea.Seq)
		synctest.Wait()
		if r := rangs(la.enrs()); slices.Contains(r, seq) || slices.Contains(r, seq2) {
			t.Fatal("servie au rattrapage après l'échéance :", r)
		}
		finir(t, la)
	})
}

// M4 : l'ancien Membre du créateur, après sa reprise par rejoindre, ne lit plus rien.
func TestLuAncienMembreApresReprise(t *testing.T) {
	b := nouveauBanc(t, 200)
	c := b.creer(t, 4)
	_, ancien := b.entrerMembre(t, c, true)
	_, a := b.entrerMembre(t, c, false)
	seq := b.recevoir(t, a, trameD(dInstantane, 1))
	b.entrer(t, c, true)
	if err := b.m.Lu(ancien, seq); !errors.Is(err, ErrNotFound) {
		t.Fatal("ancien membre :", err)
	}
}

// M4 : l'horloge recule de 5 min entre deux réceptions : chaque trame est effacée à sa
// propre échéance (tas, pas une file dans l'ordre des rangs).
func TestHorlogeRecule(t *testing.T) {
	b := nouveauBanc(t, 200)
	c := b.creer(t, 4)
	_, g := b.entrerMembre(t, c, true)
	s := g.salon
	un := b.recevoir(t, g, trameD(dDixMinutes, 1))
	b.h.avancer(-5 * time.Minute)
	deux := b.recevoir(t, g, trameD(dDixMinutes, 2))
	b.h.avancer(10 * time.Minute) // échéance de la seconde
	b.m.Tick()
	if a, d := entreeDeEfface(s, un), entreeDeEfface(s, deux); a || !d {
		t.Fatal("à l'échéance de la seconde :", a, d)
	}
	b.h.avancer(5*time.Minute - time.Millisecond)
	b.m.Tick()
	if entreeDeEfface(s, un) {
		t.Fatal("première effacée avant son échéance")
	}
	b.h.avancer(time.Millisecond)
	b.m.Tick()
	if !entreeDeEfface(s, un) {
		t.Fatal("première non effacée à son échéance")
	}
}

func entreeDeEfface(s *salon, seq uint64) bool {
	e, _ := entreeDe(s, seq)
	return e.efface()
}
