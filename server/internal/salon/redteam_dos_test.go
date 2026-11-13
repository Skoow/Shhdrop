package salon

import (
	"context"
	"errors"
	"os"
	"sync"
	"sync/atomic"
	"testing"
	"testing/synctest"
	"time"

	"github.com/skoow/shhdrop/server/internal/blob"
)

// Non-régression de l'audit adverse du 13 novembre, 2e passage, front « serveur Go et déni de
// service » (F1, F2, F3). Les démonstrations de l'audit (R1 à R5) sont reprises ici, retournées :
// ce qui prouvait la faiblesse doit maintenant échouer.

// borneOccupee : toutes les places de g prises par des appels qui ne rendent qu'à l'appel de
// la fonction rendue (un disque qui ne répond pas, ou des transferts lents).
func borneOccupee(t *testing.T, g *blob.Gate) (liberer func()) {
	t.Helper()
	relache := make(chan struct{})
	var pret, fini sync.WaitGroup
	for range g.Cap() {
		pret.Add(1)
		fini.Go(func() {
			_ = g.Do(func() error { pret.Done(); <-relache; return nil })
		})
	}
	pret.Wait()
	var une sync.Once
	liberer = func() { une.Do(func() { close(relache); fini.Wait() }) }
	t.Cleanup(liberer)
	return liberer
}

// termine : f rend avant le délai (sinon le test échoue, f étant laissée derrière).
func termine(t *testing.T, quoi string, f func()) {
	t.Helper()
	fini := make(chan struct{})
	go func() { f(); close(fini) }()
	select {
	case <-fini:
	case <-time.After(2 * time.Second):
		t.Fatalf("%s : toujours en attente après 2 s", quoi)
	}
}

// pasFini : c n'est pas fermé après 100 ms (l'appel attend bien).
func pasFini(t *testing.T, quoi string, c <-chan struct{}) {
	t.Helper()
	select {
	case <-c:
		t.Fatalf("%s : a fini alors qu'il devait attendre (pré-condition du test)", quoi)
	case <-time.After(100 * time.Millisecond):
	}
}

// R1 (repris tel quel, plus le pot commun de F3) : course Recevoir / renouvellement / fin sur
// les compteurs globaux. Ni tramesGlob ni tramesPot ne deviennent négatifs, et les deux
// reviennent exactement à 0 quand tout est détruit (sinon le plafond serait inopérant, ou
// atteint pour toujours).
func TestRedTeam_R1_CompteursGlobauxCourse(t *testing.T) {
	b := nouveauBanc(t, 2000)
	b.m.cfg.SalonFramesTotal = 2000 * 20 // part de 10 trames par salon : le pot sert aussi
	const N = 12
	cs := make([]cles, N)
	mbs := make([]Membre, N)
	for i := range cs {
		cs[i] = b.creer(t, 10)
		_, mbs[i] = b.entrerMembre(t, cs[i], true)
	}
	var minGlob, minPot atomic.Int64
	stop := make(chan struct{})
	var watch sync.WaitGroup
	watch.Go(func() {
		for {
			select {
			case <-stop:
				return
			default:
			}
			if v := b.m.tramesGlob.Load(); v < minGlob.Load() {
				minGlob.Store(v)
			}
			if v := b.m.tramesPot.Load(); v < minPot.Load() {
				minPot.Store(v)
			}
		}
	})
	var wg sync.WaitGroup
	for i := range N {
		wg.Go(func() {
			for k := range 300 {
				_, _ = b.m.Recevoir(mbs[i], trameD(0, k), nil) // erreurs (salon fini) ignorées
			}
		})
		wg.Go(func() {
			for range 40 {
				_, _ = b.m.Regler(cs[i].gestion, ReglagesReq{Heures: 1}, nil)
			}
		})
		if i%2 == 0 {
			wg.Go(func() {
				time.Sleep(time.Millisecond)
				_ = b.m.Detruire(cs[i].gestion, nil)
			})
		}
	}
	wg.Wait()
	close(stop)
	watch.Wait()
	if minGlob.Load() < 0 || minPot.Load() < 0 {
		t.Fatalf("compteur négatif : tramesGlob %d, tramesPot %d", minGlob.Load(), minPot.Load())
	}
	for i := range N {
		_ = b.m.Detruire(cs[i].gestion, nil)
	}
	b.m.Tick()
	if g, p := b.m.tramesGlob.Load(), b.m.tramesPot.Load(); g != 0 || p != 0 {
		t.Fatalf("fuite après destruction totale : tramesGlob %d, tramesPot %d", g, p)
	}
}

// F3 (R2 retourné) : part équitable des trames en mémoire. Plafond global de 10 trames pour 2
// salons : part réservée de 2 trames chacun (la moitié du plafond, à parts égales), pot commun
// de 6. Le salon A prend sa part et tout le pot (8 trames), puis est refusé ; le salon B,
// vide, range quand même ses 2 trames réservées, puis est refusé à son tour. Le total ne
// dépasse jamais le plafond global. Un renouvellement de A rend le pot.
func TestPartEquitableTrames(t *testing.T) {
	b := nouveauBanc(t, 2)
	b.m.cfg.SalonFramesTotal = 10
	if part, pot := b.m.partTrames(); part != 2 || pot != 6 {
		t.Fatalf("part %d, pot %d, attendu 2 et 6", part, pot)
	}
	ca, cb := b.creer(t, 10), b.creer(t, 10)
	_, mbA := b.entrerMembre(t, ca, true)
	_, mbB := b.entrerMembre(t, cb, true)
	for k := range 8 {
		if _, err := b.m.Recevoir(mbA, trameD(0, k), nil); err != nil {
			t.Fatalf("A, trame %d : %v", k, err)
		}
	}
	if _, err := b.m.Recevoir(mbA, trameD(0, 8), nil); !errors.Is(err, ErrPlein) {
		t.Fatal("A au-delà de sa part et du pot :", err)
	}
	for k := range 2 {
		if _, err := b.m.Recevoir(mbB, trameD(0, k), nil); err != nil {
			t.Fatalf("B refusé dans sa part réservée (trame %d) alors que A a vidé le pot : %v", k, err)
		}
	}
	if _, err := b.m.Recevoir(mbB, trameD(0, 2), nil); !errors.Is(err, ErrPlein) {
		t.Fatal("B au-delà de sa part, pot vide :", err)
	}
	if _, err := b.m.Recevoir(mbB, trameD(dVolatile, 3), nil); err != nil {
		t.Fatal("volatile refusée :", err)
	}
	if g := b.m.tramesGlob.Load(); g != 10 {
		t.Fatalf("trames en mémoire : %d, plafond global 10", g)
	}
	if st := b.m.Stats(); st.Trames != 10 || st.TramesMax != 10 {
		t.Fatalf("Stats : %d / %d", st.Trames, st.TramesMax)
	}
	b.regler(t, ca, ReglagesReq{Heures: 1}) // A vide son index : son pot est rendu
	if p := b.m.tramesPot.Load(); p != 0 {
		t.Fatal("pot après le renouvellement de A :", p)
	}
	if _, err := b.m.Recevoir(mbB, trameD(0, 4), nil); err != nil {
		t.Fatal("B toujours refusé après le renouvellement de A :", err)
	}
}

// PartTrames : la somme des parts et du pot vaut toujours le plafond global ; la part ne
// dépasse jamais le plafond par salon ; sans plafond global, aucune part.
func TestPartTramesBornes(t *testing.T) {
	for _, c := range []struct{ total, max, parSalon, part, pot int }{
		{1970000, 200, 100000, 4925, 985000},
		{1000, 200, 100000, 2, 600},
		{5, 2000, 100000, 0, 5},
		{10_000_000, 10, 100000, 100000, 9_000_000},
		{0, 200, 100000, 0, 0},
	} {
		part, pot := PartTrames(c.total, c.max, c.parSalon)
		if part != c.part || pot != c.pot || (c.total > 0 && c.max*part+pot != c.total) {
			t.Errorf("PartTrames(%d, %d, %d) = %d, %d ; attendu %d, %d", c.total, c.max, c.parSalon, part, pot, c.part, c.pot)
		}
	}
}

// F1 (R3 et R4 retournés) : borne des écritures de conversation saturée. Le Recevoir d'un
// salon attend sa place SANS tenir le verrou de son salon : la passe mémoire de l'entretien et
// la lecture du tableau de bord (Stats) terminent, et la passe mémoire fait son travail pour ce salon comme pour les autres (une trame « 1 minute » échue du
// salon B n'est plus servie ; le salon A lui-même reste utilisable : lecture, départ).
func TestRedTeam_R3R4_BorneSatureeNiEntretienNiStatsFiges(t *testing.T) {
	b := nouveauBanc(t, 2000)
	ca, cb := b.creer(t, 10), b.creer(t, 10)
	_, mbA := b.entrerMembre(t, ca, true)
	_, invite := b.entrerMembre(t, ca, false)
	_, mbB := b.entrerMembre(t, cb, true)
	seqB := b.recevoir(t, mbB, trameD(dUneMinute, 1)) // seule : échéance dans 1 minute

	liberer := borneOccupee(t, b.m.ecr)
	recFini := make(chan struct{})
	var seqA uint64
	var errA error
	go func() {
		seqA, errA = b.m.Recevoir(mbA, trameD(0, 1), nil)
		close(recFini)
	}()
	pasFini(t, "Recevoir, borne des écritures saturée", recFini)

	b.h.avancer(time.Minute)
	termine(t, "passe mémoire de l'entretien, borne saturée", b.m.entretienMemoire)
	termine(t, "Stats, borne saturée", func() {
		if st := b.m.Stats(); st.Sieges != 3 || st.Vivants != 2 {
			t.Errorf("Stats : %+v", st)
		}
	})
	if servie(t, mbB.salon, seqB) {
		t.Fatal("trame échue du salon B encore servie : entretien pris en otage")
	}
	termine(t, "Quitter dans le salon du Recevoir en attente", func() {
		if err := b.m.Quitter(invite); err != nil {
			t.Error(err)
		}
	})
	select {
	case <-recFini:
		t.Fatal("Recevoir a fini avant la libération de la borne")
	default:
	}
	liberer()
	termine(t, "Recevoir après libération", func() { <-recFini })
	if errA != nil || !servie(t, mbA.salon, seqA) {
		t.Fatal("trame de A non rangée après libération :", seqA, errA)
	}
}

// fichierLent : fichier d'écriture dont les écritures attendent (disque qui ne répond pas).
type fichierLent struct {
	*os.File
	entree  chan struct{} // un envoi à chaque écriture commencée
	relache chan struct{}
}

func (f *fichierLent) WriteAt(p []byte, off int64) (int, error) {
	f.entree <- struct{}{}
	<-f.relache
	return f.File.WriteAt(p, off)
}

// F1, disque lent : l'écriture d'une trame, bloquée DANS l'appel disque, ne tient pas le verrou
// de son salon. L'entretien en mémoire, Stats, et les autres membres du même salon (lecture,
// trame volatile) ne l'attendent pas.
func TestDisqueLentNeTientPasLeVerrouDuSalon(t *testing.T) {
	b := nouveauBanc(t, 2000)
	c := b.creer(t, 10)
	_, mbA := b.entrerMembre(t, c, true)
	_, mbI := b.entrerMembre(t, c, false)
	s := mbA.salon
	premier := b.recevoir(t, mbA, trameD(0, 0))
	lent := &fichierLent{File: s.conv.f.(*os.File), entree: make(chan struct{}, 1), relache: make(chan struct{})}
	s.conv.f = lent
	recFini := make(chan struct{})
	var errA error
	go func() { _, errA = b.m.Recevoir(mbA, trameD(0, 1), nil); close(recFini) }()
	<-lent.entree // l'écriture est dans l'appel disque

	termine(t, "passe mémoire de l'entretien", b.m.entretienMemoire)
	termine(t, "Stats", func() { b.m.Stats() })
	termine(t, "trame volatile d'un autre membre", func() {
		if _, err := b.m.Recevoir(mbI, trameD(dVolatile, 2), nil); err != nil {
			t.Error(err)
		}
	})
	termine(t, "Lu d'un autre membre", func() {
		if err := b.m.Lu(mbI, premier); err != nil {
			t.Error(err)
		}
	})
	pasFini(t, "Recevoir, disque bloqué", recFini)
	close(lent.relache)
	termine(t, "Recevoir après le retour du disque", func() { <-recFini })
	if errA != nil {
		t.Fatal(errA)
	}
}

// F1, Run : la passe mémoire de l'entretien continue chaque seconde pendant que la passe
// disque attend (borne des écritures saturée, un emplacement à écraser en attente). Une trame
// « 1 minute » arrivée à échéance cesse d'être servie et son 0x0E part, sans attendre le
// disque ; son emplacement est écrasé dès que le disque répond.
func TestRunPasseMemoireSansAttendreLeDisque(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		b := nouveauBanc(t, 200)
		c := b.creer(t, 4)
		eg, g := b.entrerMembre(t, c, true)
		lg := b.connecter(eg.Jeton, eg.Seq)
		synctest.Wait()
		s := g.salon
		retiree := b.recevoir(t, g, trameD(0, 1))
		seq := b.recevoir(t, g, trameD(dUneMinute, 2))
		e0, _ := entreeDe(s, seq)
		ctx, annuler := context.WithCancel(t.Context())
		runFini := make(chan struct{})
		go func() { b.m.Run(ctx); close(runFini) }()

		liberer := borneOccupee(t, b.m.ecr)
		// Un retrait : son écrasement attend la borne, et fait attendre la passe disque avec lui.
		retFini := make(chan struct{})
		go func() { _ = b.m.Retirer(g, retiree); close(retFini) }()
		synctest.Wait()
		if servie(t, s, retiree) {
			t.Fatal("trame retirée encore servie pendant que le disque attend")
		}
		b.h.avancer(time.Minute)
		time.Sleep(3 * time.Second) // trois passes de chaque boucle
		synctest.Wait()
		if servie(t, s, seq) || len(effaces(lg)) != 1 {
			t.Fatal("échéance non traitée pendant que la passe disque attend : entretien figé par le disque")
		}
		if _, err := s.conv.Lire(e0.emplacement); err != nil {
			t.Fatal("pré-condition : emplacement déjà écrasé alors que la borne est saturée :", err)
		}
		liberer()
		time.Sleep(2 * time.Second)
		synctest.Wait()
		if !effaceeSurDisque(t, s, seq, e0.emplacement) {
			t.Fatal("emplacement non écrasé une fois le disque revenu")
		}
		<-retFini
		annuler()
		<-runFini
		finir(t, lg)
	})
}

// F2 (R5 retourné, côté gestionnaire) : les lectures de conversation du rattrapage passent par
// la borne des lectures du gestionnaire (à l'ouverture comme après un renouvellement), qui
// n'est pas celle des écritures. Borne des lectures saturée (lecteurs lents) : une connexion
// en rattrapage attend sa place sans tenir le verrou du salon ; les écritures (Recevoir), les
// retraits, l'entretien et Stats passent. Le rattrapage reprend quand une place se libère.
func TestLecturesBorneesSansAffamerLesEcritures(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		b := nouveauBanc(t, 200)
		if b.m.ecr == b.m.lec || b.m.ecr.Cap() != ConvDiskOpsDefaut || b.m.lec.Cap() != ConvDiskOpsDefaut {
			t.Fatal("bornes des conversations :", b.m.ecr.Cap(), b.m.lec.Cap())
		}
		if b.m.cfg.Pieces.Gate == b.m.ecr || b.m.cfg.Pieces.Gate == b.m.lec {
			t.Fatal("borne des conversations partagée avec les pièces et les partages")
		}
		c := b.creer(t, 4)
		eg, g := b.entrerMembre(t, c, true)
		s := g.salon
		if s.conv.lec != b.m.lec {
			t.Fatal("conversation ouverte sans la borne des lectures")
		}
		b.regler(t, c, ReglagesReq{Heures: 1})
		if s.conv.lec != b.m.lec {
			t.Fatal("conversation renouvelée sans la borne des lectures")
		}
		var seqs []uint64
		for i := range 3 {
			seqs = append(seqs, b.recevoir(t, g, trameD(0, i)))
		}
		liberer := borneOccupee(t, b.m.lec)
		lg := b.connecter(eg.Jeton, 0) // rattrapage : 3 trames à lire
		synctest.Wait()
		if n := len(rangsTrames(lg)); n != 0 {
			t.Fatalf("%d trames lues malgré la borne des lectures saturée", n)
		}
		// Rien de ce qui suit n'attend le lecteur (sinon : blocage, détecté par synctest).
		seqs = append(seqs, b.recevoir(t, g, trameD(0, 3)))
		if err := b.m.Retirer(g, seqs[0]); err != nil {
			t.Fatal(err)
		}
		b.m.Tick()
		if st := b.m.Stats(); st.Sieges != 1 || st.Trames != 4 {
			t.Fatalf("Stats : %+v", st)
		}
		if u := b.m.lec.InUse(); u != int64(b.m.lec.Cap()) || b.m.lec.Peak() != int64(b.m.lec.Cap()) {
			t.Fatal("borne des lectures dépassée ou relâchée :", u, b.m.lec.Peak())
		}
		liberer()
		synctest.Wait()
		if got := rangsTrames(lg); len(got) != 3 || got[0] != seqs[1] || got[2] != seqs[3] {
			t.Fatalf("rattrapage après libération : %v, attendu %v", got, seqs[1:])
		}
		finir(t, lg)
	})
}

// tramesStockees : rangs des trames (0x01) encore servies au rattrapage.
func tramesStockees(t *testing.T, s *salon) []uint64 {
	t.Helper()
	var r []uint64
	for _, e := range lireSuite(t, s, 0, 1<<30) {
		if e.ty == 0x01 {
			r = append(r, e.seq)
		}
	}
	return r
}

// rangsTrames : rangs des trames (0x01) reçues par l.
func rangsTrames(l *fauxLien) []uint64 {
	var r []uint64
	for _, e := range l.enrs() {
		if e.ty == 0x01 {
			r = append(r, e.seq)
		}
	}
	return r
}

// F2 : Config.ConvDiskOps règle la taille des deux bornes.
func TestConvDiskOpsRegle(t *testing.T) {
	b := nouveauBanc(t, 200)
	cfg := b.cfg
	cfg.ConvDiskOps = 5
	m, err := NewManager(cfg)
	if err != nil {
		t.Fatal(err)
	}
	if m.ecr.Cap() != 5 || m.lec.Cap() != 5 {
		t.Fatal(m.ecr.Cap(), m.lec.Cap())
	}
}

// F1, entre l'écriture et le rangement : un membre exclu pendant que sa trame s'écrit ne la
// voit jamais rangée (erreur d'exclu, aucun rang, rien de servi), et l'emplacement écrit est
// écrasé au passage suivant de l'entretien.
func TestRecevoirMembrePartiPendantLEcriture(t *testing.T) {
	b := nouveauBanc(t, 200)
	c := b.creer(t, 4)
	_, g := b.entrerMembre(t, c, true)
	_, a := b.entrerMembre(t, c, false)
	s := g.salon
	b.recevoir(t, g, trameD(0, 0))
	lent := &fichierLent{File: s.conv.f.(*os.File), entree: make(chan struct{}, 1), relache: make(chan struct{})}
	s.conv.f = lent
	avant := dernierSeq(s)
	recFini := make(chan struct{})
	var errA error
	go func() { _, errA = b.m.Recevoir(a, trameD(0, 1), nil); close(recFini) }()
	<-lent.entree
	if err := b.m.Quitter(a); err != nil {
		t.Fatal(err)
	}
	close(lent.relache)
	<-recFini
	if !errors.Is(errA, ErrNotFound) {
		t.Fatal("trame d'un membre parti pendant l'écriture :", errA)
	}
	if got := tramesStockees(t, s); len(got) != 1 || dernierSeq(s) != avant+1 { // +1 : l'annonce du départ
		t.Fatal("trame rangée ou rang consommé :", got, dernierSeq(s)-avant)
	}
	if _, err := s.conv.Lire(1); err != nil {
		t.Fatal("pré-condition : emplacement 1 écrit :", err)
	}
	b.m.Tick()
	if _, err := s.conv.Lire(1); !errors.Is(err, ErrEfface) {
		t.Fatal("emplacement de la trame jamais rangée non écrasé :", err)
	}
}

// F1, renouvellement pendant l'écriture : la trame, écrite dans la conversation d'avant
// (détruite), est récrite dans la nouvelle et rangée après le renouvellement, une seule fois.
func TestRecevoirPendantUnRenouvellement(t *testing.T) {
	b := nouveauBanc(t, 200)
	c := b.creer(t, 4)
	_, g := b.entrerMembre(t, c, true)
	s := g.salon
	b.recevoir(t, g, trameD(0, 0))
	ancienne := s.conv
	lent := &fichierLent{File: ancienne.f.(*os.File), entree: make(chan struct{}, 1), relache: make(chan struct{})}
	ancienne.f = lent
	recFini := make(chan struct{})
	var seq uint64
	var errR error
	go func() { seq, errR = b.m.Recevoir(g, trameD(0, 1), nil); close(recFini) }()
	<-lent.entree
	// Le renouvellement détruit l'ancienne conversation : il attend la fin de l'écriture en cours.
	regFini := make(chan struct{})
	var r Reglages
	go func() { r = b.regler(t, c, ReglagesReq{Heures: 1}); close(regFini) }()
	time.Sleep(50 * time.Millisecond)
	close(lent.relache)
	<-recFini
	<-regFini
	if errR != nil {
		t.Fatal(errR)
	}
	got := tramesStockees(t, s)
	switch {
	case seq > r.Depuis: // rangée après le renouvellement : servie, depuis la nouvelle conversation
		if len(got) != 1 || got[0] != seq || s.conv == ancienne {
			t.Fatal("trame d'après le renouvellement :", got, seq)
		}
	default: // rangée avant : effacée par le renouvellement
		if len(got) != 0 {
			t.Fatal("trame d'avant le renouvellement encore servie :", got)
		}
	}
	if g, p := b.m.tramesGlob.Load(), int64(len(got)); g != p {
		t.Fatal("compteur global :", g, p)
	}
}
