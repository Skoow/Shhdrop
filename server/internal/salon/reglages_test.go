package salon

import (
	"bytes"
	"encoding/binary"
	"errors"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"testing"
	"testing/synctest"
	"time"

	"github.com/skoow/shhdrop/server/internal/blob"
	"github.com/skoow/shhdrop/server/internal/share"
)

// Réglages du salon (spec 2026-11-13, révision du 13 novembre) : places et renouvellement.

// reglages0x10 : enregistrements 0x10 reçus (taille exacte vérifiée), décodés.
type enr10 struct {
	seq, depart uint64
	secondes    uint32
	places      uint8
}

func reglagesRecus(t *testing.T, l *fauxLien) []enr10 {
	t.Helper()
	var out []enr10
	for i, e := range l.enrs() {
		if e.ty != 0x10 {
			continue
		}
		b := l.brut(i)
		if len(b) != 22 {
			t.Fatalf("0x10 de %d octets", len(b))
		}
		out = append(out, enr10{seq: e.seq, depart: binary.BigEndian.Uint64(b[9:17]),
			secondes: binary.BigEndian.Uint32(b[17:21]), places: b[21]})
	}
	return out
}

func (b *banc) regler(t *testing.T, c cles, r ReglagesReq) Reglages {
	t.Helper()
	res, err := b.m.Regler(c.gestion, r, nil)
	if err != nil {
		t.Fatal("Regler :", err)
	}
	return res
}

func (b *banc) tailleConv(t *testing.T, id string) int64 {
	t.Helper()
	fi, err := os.Stat(filepath.Join(b.cfg.DossierConversations, id))
	if err != nil {
		t.Fatal("conversation :", err)
	}
	return fi.Size()
}

func (b *banc) expiresAt(t *testing.T, id string) (exp int64, places int) {
	t.Helper()
	if err := b.db.QueryRow(`SELECT expires_at, max_members FROM salons WHERE id=?`, id).Scan(&exp, &places); err != nil {
		t.Fatal(err)
	}
	return
}

// Renouvellement : conversation (fichier vide, clé neuve) et pièces (fichier, ligne,
// pieces_bytes) effacées, index, échéances et attentes vidés ; membres gardés ; seq continue ;
// échéance = maintenant + durée au quart d'heure supérieur ; 0x10 reçu en direct, en
// rattrapage (jamais d'ancienne trame après lui, aucune fermeture) et à la reconnexion depuis 0,
// qui ne sert rien d'avant.
func TestRenouvelerEfface(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		b := nouveauBanc(t, 200)
		c := b.creer(t, 4)
		eg, g := b.entrerMembre(t, c, true)
		ea, a := b.entrerMembre(t, c, false)
		eb, bb := b.entrerMembre(t, c, false) // hors ligne
		s := g.salon
		lie := b.pretePiece(t, g, 1, false)
		b.lier(t, g, 0, lie)
		libre := b.pretePiece(t, a, 1, false)
		envoi := b.creerPiece(t, bb, 1, false)
		b.recevoir(t, g, trameD(0, 1))
		inst := b.recevoir(t, g, trameD(dUneMinute, 2))
		b.recevoir(t, g, trameD(byte(CinqMinutes)<<1, 3))
		lg := b.connecter(eg.Jeton, dernierSeq(s))
		synctest.Wait()
		la := b.enRattrapage(t, g, ea, toujours)
		ancienne := s.conv
		if b.tailleConv(t, s.id) == 0 || b.budgetPris(t, s) == 0 || b.lignes(t, "salon_pieces", s.id) != 3 {
			t.Fatal("témoin : conversation et pièces présentes avant")
		}
		time.Sleep(20 * time.Millisecond) // écrivain de la connexion lente au milieu d'un lot de rattrapage
		synctest.Wait()                   // … bloqué dans l'écriture d'un enregistrement (1 ms)
		d := dernierSeq(s)
		n := len(la.enrs())
		if n < 10 || n > 60 {
			t.Fatal("témoin : lot de rattrapage en cours attendu", n)
		}
		res := b.regler(t, c, ReglagesReq{Heures: 6})
		now := b.h.Now().Unix()
		exp := share.Ceil15(now + 6*3600)
		if res.Depuis != d || res.MaxMembers != 4 || res.ExpiresIn != secs(exp-now) {
			t.Fatalf("réponse %+v, départ attendu %d", res, d)
		}
		if e, p := b.expiresAt(t, s.id); e != exp || p != 4 {
			t.Fatal("base :", e, p)
		}
		if b.tailleConv(t, s.id) != 0 || b.lignes(t, "salon_pieces", s.id) != 0 || b.budgetPris(t, s) != 0 {
			t.Fatal("conversation ou pièces gardées")
		}
		for _, id := range []string{lie, libre, envoi} {
			if f, l := b.surDisque(t, id); f || l {
				t.Fatal("pièce gardée", id, f, l)
			}
		}
		ancienne.mu.Lock()
		cle := ancienne.cle
		ancienne.mu.Unlock()
		if cle != [32]byte{} || s.conv == ancienne {
			t.Fatal("ancienne clé gardée")
		}
		sous(s, func() {
			if len(s.index) != 0 || len(s.echeances) != 0 || len(s.lesPieces) != 0 || len(s.pieces) != 0 ||
				len(s.libres) != 0 || s.seq != d || !s.expires.Equal(time.Unix(exp, 0)) {
				t.Fatal("état mémoire gardé")
			}
		})
		if occupes(s) != 3 {
			t.Fatal("membres perdus")
		}
		for _, e := range []Entree{eg, ea, eb} {
			if _, err := b.m.Membre(e.Jeton[:]); err != nil {
				t.Fatal("membre perdu :", err)
			}
		}
		if err := b.m.PutSegment(envoi, 0, segments(1, 1)[0]); !errors.Is(err, ErrNotFound) {
			t.Fatal("segment d'une pièce d'avant :", err)
		}
		b.lu(t, a, inst) // trame d'avant : ignorée sans erreur
		synctest.Wait()
		if r := reglagesRecus(t, lg); len(r) != 1 || r[0] != (enr10{d, d, uint32(exp - now), 4}) {
			t.Fatalf("0x10 en direct : %+v", r)
		}
		// Rattrapage : 0x10 reçu au retour au direct, aucune trame d'avant écrite après le
		// renouvellement (une au plus, celle dont l'écriture était en cours), aucune fermeture.
		for i := 0; len(reglagesRecus(t, la)) == 0; i++ {
			if i > 1000 {
				t.Fatal("0x10 jamais reçu en rattrapage")
			}
			time.Sleep(10 * time.Millisecond)
		}
		vieilles := 0
		for _, e := range la.enrs()[n:] {
			if e.ty == 0x01 && e.seq <= d {
				vieilles++
			}
		}
		t.Logf("trames d'avant écrites après le renouvellement : %d", vieilles)
		if vieilles > 1 || la.codeFerme() != 0 {
			t.Fatal("rattrapage : trames d'avant après le renouvellement", vieilles, la.codeFerme())
		}
		if r := reglagesRecus(t, la); len(r) != 1 || r[0].depart != d || r[0].places != 4 {
			t.Fatalf("0x10 en rattrapage : %+v", r)
		}
		// Reconnexion depuis 0 : 0x0D au rang de départ, 0x07, 0x10, rien de rang ≤ départ.
		lb := b.connecter(eb.Jeton, 0)
		synctest.Wait()
		l := lb.enrs()
		if len(l) == 0 || l[0].ty != 0x0D || l[0].seq != d {
			t.Fatal("0x0D au rang de départ attendu", l)
		}
		for _, e := range l {
			if e.prendRang() {
				t.Fatalf("enregistrement d'avant servi : %x %d", e.ty, e.seq)
			}
		}
		if r := reglagesRecus(t, lb); len(r) != 1 || r[0].depart != d {
			t.Fatalf("0x10 à l'accueil : %+v", r)
		}
		// La conversation continue : rang suivant, servi à tous, rattrapage depuis 0 sans rien d'avant.
		nouv := b.recevoir(t, a, trameD(0, 9))
		synctest.Wait()
		if nouv != d+1 || !echo(lb, nouv) || !echo(lg, nouv) {
			t.Fatal("trame d'après", nouv)
		}
		for _, e := range lireSuite(t, s, 0, 1<<30) {
			if e.ty == 0x01 && e.seq <= d {
				t.Fatal("rattrapage depuis 0 : trame d'avant", e.seq)
			}
		}
		if b.tailleConv(t, s.id) != TailleEmplacement {
			t.Fatal("nouvelle conversation", b.tailleConv(t, s.id))
		}
		finir(t, lg, la, lb)
	})
}

// Une pièce dont la création a commencé avant le renouvellement n'est jamais inscrite : fichier,
// ligne et budget rendus.
func TestRenouvelerPieceEnCreation(t *testing.T) {
	b := nouveauBanc(t, 200)
	c := b.creer(t, 3)
	_, g := b.entrerMembre(t, c, true)
	s := g.salon
	avant := reserverPiece
	var une sync.Once
	reserverPiece = func(st *blob.Store, id string, n int64) error {
		une.Do(func() { b.regler(t, c, ReglagesReq{Heures: 1}) })
		return avant(st, id, n)
	}
	t.Cleanup(func() { reserverPiece = avant })
	if _, err := b.m.CreerPiece(g, 1, false); !errors.Is(err, ErrNotFound) {
		t.Fatal("pièce d'avant inscrite :", err)
	}
	if b.lignes(t, "salon_pieces", s.id) != 0 || b.budgetPris(t, s) != 0 {
		t.Fatal("pièce d'avant gardée")
	}
	if l, _ := b.cfg.Pieces.List(); len(l) != 0 {
		t.Fatal("fichier gardé", l)
	}
	b.creerPiece(t, g, 1, false) // après : permise
}

// Places : bornes 2..10 (sinon ErrBadRequest), jamais sous les sièges occupés (ErrOccupied) ;
// plafond des arrivées recalculé (5 × N) ; 0x10 au même départ, conversation gardée ; base
// mise à jour.
func TestReglerPlaces(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		b := nouveauBanc(t, 200)
		c := b.creer(t, 2)
		eg, g := b.entrerMembre(t, c, true)
		s := g.salon
		lg := b.connecter(eg.Jeton, eg.Seq)
		synctest.Wait()
		vieux := b.recevoir(t, g, trameD(0, 1))
		for _, p := range []int{1, -1, SalonPlacesMax + 1} {
			if _, err := b.m.Regler(c.gestion, ReglagesReq{Places: p}, nil); !errors.Is(err, ErrBadRequest) {
				t.Fatal("places", p, err)
			}
		}
		if _, err := b.m.Regler(c.gestion, ReglagesReq{}, nil); !errors.Is(err, ErrBadRequest) {
			t.Fatal("aucun réglage :", err)
		}
		for _, h := range []int{2, 48, -1} {
			if _, err := b.m.Regler(c.gestion, ReglagesReq{Heures: h}, nil); !errors.Is(err, ErrBadRequest) {
				t.Fatal("heures", h, err)
			}
		}
		// 10 arrivées d'invités (plafond 5 × 2), chacune repartie : la 11ᵉ est refusée.
		for range 10 {
			e := b.entrer(t, c, false)
			b.depart(s, e.Siege)
		}
		if _, err := b.m.Rejoindre(c.acces, c.preuve, nil); !errors.Is(err, ErrFull) {
			t.Fatal("11ᵉ arrivée :", err)
		}
		res := b.regler(t, c, ReglagesReq{Places: 3})
		if res.MaxMembers != 3 || res.Depuis != 0 {
			t.Fatalf("réponse %+v", res)
		}
		if _, p := b.expiresAt(t, s.id); p != 3 {
			t.Fatal("max_members en base", p)
		}
		b.entrer(t, c, false) // plafond 15 : permise
		b.entrer(t, c, false)
		if _, err := b.m.Rejoindre(c.acces, c.preuve, nil); !errors.Is(err, ErrFull) {
			t.Fatal("4ᵉ siège pour 3 places :", err)
		}
		if _, err := b.m.Regler(c.gestion, ReglagesReq{Places: 2}, nil); !errors.Is(err, ErrOccupied) {
			t.Fatal("sous l'occupation :", err)
		}
		b.regler(t, c, ReglagesReq{Places: SalonPlacesMax})
		synctest.Wait()
		r := reglagesRecus(t, lg)
		if len(r) != 2 || r[0].places != 3 || r[1].places != 10 || r[1].depart != 0 || r[1].seq != dernierSeq(s) {
			t.Fatalf("0x10 : %+v", r)
		}
		if !servie(t, s, vieux) {
			t.Fatal("conversation effacée par un changement de places")
		}
		if e, p := b.expiresAt(t, s.id); p != 10 || e != share.Ceil15(b.h.Now().Unix()+24*3600) {
			t.Fatal("base", e, p)
		}
		finir(t, lg)
	})
}

// Sans S_gestion valide : ErrNotFound, sans appeler avant (ni preuve ni quota consommés) ; une
// erreur d'avant ne change rien.
func TestReglerSansGestion(t *testing.T) {
	b := nouveauBanc(t, 200)
	c := b.creer(t, 3)
	_, g := b.entrerMembre(t, c, true)
	s := g.salon
	seq := b.recevoir(t, g, trameD(0, 1))
	appels := 0
	avant := func() error { appels++; return errors.New("refus") }
	for _, sg := range [][]byte{nil, aleatoire(), c.acces, c.preuve, {1, 2}} {
		if _, err := b.m.Regler(sg, ReglagesReq{Heures: 1}, avant); !errors.Is(err, ErrNotFound) {
			t.Fatal("S_gestion faux :", err)
		}
	}
	if appels != 0 {
		t.Fatal("avant appelé sans S_gestion valide")
	}
	exp0, _ := b.expiresAt(t, s.id)
	if _, err := b.m.Regler(c.gestion, ReglagesReq{Heures: 1}, avant); err == nil || err.Error() != "refus" || appels != 1 {
		t.Fatal("erreur d'avant :", err)
	}
	if exp, _ := b.expiresAt(t, s.id); exp != exp0 || !servie(t, s, seq) {
		t.Fatal("renouvelé malgré le refus")
	}
	// Places sous l'occupation : refus avant avant (rien de consommé).
	b.entrer(t, c, false)
	b.entrer(t, c, false)
	if _, err := b.m.Regler(c.gestion, ReglagesReq{Places: 2, Heures: 1}, avant); !errors.Is(err, ErrOccupied) || appels != 1 {
		t.Fatal("occupé :", err, appels)
	}
	if err := b.m.Detruire(c.gestion, nil); err != nil {
		t.Fatal(err)
	}
	if _, err := b.m.Regler(c.gestion, ReglagesReq{Places: 5}, nil); !errors.Is(err, ErrNotFound) {
		t.Fatal("salon détruit :", err)
	}
}

// Salon sans état en mémoire (personne n'est entré) : renouvelé en base ; l'entrée suivante voit
// la nouvelle échéance et les nouvelles places.
func TestRenouvelerSansEtat(t *testing.T) {
	b := nouveauBanc(t, 200)
	c := b.creer(t, 2)
	b.h.avancer(3 * time.Hour)
	res := b.regler(t, c, ReglagesReq{Heures: 24, Places: 5})
	e := b.entrer(t, c, true)
	if e.ExpiresIn != res.ExpiresIn || e.MaxMembers != 5 || res.Depuis != 0 {
		t.Fatalf("entrée %+v, réglages %+v", e, res)
	}
}

// Échec de la recréation de la conversation : aucun état à moitié renouvelé ; le salon finit
// (0x05 raison 2), Tick reprend la partie disque comme pour une fin de vie.
func TestRenouvelerEchec(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		b := nouveauBanc(t, 200)
		c := b.creer(t, 3)
		eg, g := b.entrerMembre(t, c, true)
		s := g.salon
		b.recevoir(t, g, trameD(0, 1))
		id := b.pretePiece(t, g, 1, false)
		lg := b.connecter(eg.Jeton, eg.Seq)
		synctest.Wait()
		avant := rouvrirConversation
		rouvrirConversation = func(string, string) (*Conversation, error) { return nil, ErrES }
		defer func() { rouvrirConversation = avant }()
		if _, err := b.m.Regler(c.gestion, ReglagesReq{Heures: 1}, nil); err == nil {
			t.Fatal("renouvellement raté rendu réussi")
		}
		finRecue(t, "renouvellement raté", lg, RaisonDetruit)
		if len(reglagesRecus(t, lg)) != 0 {
			t.Fatal("0x10 diffusé malgré l'échec")
		}
		b.m.Tick()
		b.toutEfface(t, s, []string{id}, eg.Jeton)
	})
}

// Concurrence (-race) : renouvellements pendant des envois, des lectures « instantané », des
// Tick, des pièces en cours d'envoi et une connexion en rattrapage. Aucune panique ; après le
// dernier, rien d'ancien ne reste (index, conversation, pièces, budget).
func TestRenouvelerConcurrent(t *testing.T) {
	b := nouveauBanc(t, 200)
	c := b.creer(t, 4)
	eg, g := b.entrerMembre(t, c, true)
	ea, a := b.entrerMembre(t, c, false)
	_, bb := b.entrerMembre(t, c, false)
	s := g.salon
	for i := range 300 {
		b.recevoir(t, g, trameD(0, i))
	}
	lg := b.connecter(eg.Jeton, 0)
	la := nouveauLien()
	la.set(func(f *fauxLien) { f.delai = 100 * time.Microsecond })
	b.servir(la, toujours)
	la.envoyer(accueilWS(ea.Jeton, ea.Seq))
	var stop atomic.Bool
	var wg sync.WaitGroup
	boucle := func(f func(i int)) {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for i := 0; !stop.Load(); i++ {
				f(i)
			}
		}()
	}
	for _, mb := range []Membre{g, a} {
		boucle(func(i int) {
			d := []byte{0, dUneMinute, byte(CinqMinutes) << 1, dVolatile}[i%4]
			if seq, err := b.m.Recevoir(mb, trameD(d, i), nil); err == nil && d == dUneMinute {
				_ = b.m.Lu(bb, seq)
			}
		})
	}
	boucle(func(int) { b.m.Tick() })
	boucle(func(i int) {
		id, err := b.m.CreerPiece(bb, 1, false)
		if err != nil {
			return
		}
		for n, seg := range segments(1, 1) {
			_ = b.m.PutSegment(id, n, seg)
		}
		if b.m.FinalizePiece(id, 0, 0) == nil {
			_, _ = b.m.Recevoir(bb, trameD(0, i), idPiece(id))
		}
	})
	for range 8 {
		b.regler(t, c, ReglagesReq{Heures: 1})
		time.Sleep(5 * time.Millisecond)
	}
	stop.Store(true)
	wg.Wait()
	res := b.regler(t, c, ReglagesReq{Heures: 1})
	attendre(t, func() bool { return !s.resteAPurger() })
	sous(s, func() {
		if len(s.index) != 0 || len(s.lesPieces) != 0 || len(s.echeances) != 0 || s.depart != res.Depuis {
			t.Fatal("état d'avant gardé")
		}
	})
	if b.tailleConv(t, s.id) != 0 || b.lignes(t, "salon_pieces", s.id) != 0 || b.budgetPris(t, s) != 0 {
		t.Fatal("disque d'avant gardé")
	}
	if l, _ := b.cfg.Pieces.List(); len(l) != 0 {
		t.Fatal("fichiers de pièces gardés", l)
	}
	if lg.codeFerme() != 0 || la.codeFerme() != 0 || b.m.PaniquesTick() != 0 {
		t.Fatal("fermeture ou panique", lg.codeFerme(), la.codeFerme())
	}
	attendre(t, func() bool { return len(reglagesRecus(t, la)) > 0 })
	finir(t, lg, la)
}

// 0x10 : 22 octets, jamais lu comme une demande ni un accueil.
func TestEnrReglages(t *testing.T) {
	e := EnrReglages(7, 5, 3600, 10)
	want := []byte{0x10, 0, 0, 0, 0, 0, 0, 0, 7, 0, 0, 0, 0, 0, 0, 0, 5, 0, 0, 0x0E, 0x10, 10}
	if !bytes.Equal(e, want) {
		t.Fatalf("%x", e)
	}
	if _, err := LireDemande(e); err == nil {
		t.Fatal("0x10 lu comme une demande")
	}
}

// Connexion en direct dont la file attend encore des trames d'avant (écrivain occupé) : elles ne
// sont jamais écrites après le renouvellement (une au plus, celle en cours d'écriture) ; le 0x10
// suit, sans fermeture.
func TestRenouvelerFileDuDirect(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		b := nouveauBanc(t, 200)
		c := b.creer(t, 3)
		_, g := b.entrerMembre(t, c, true)
		ea := b.entrer(t, c, false)
		s := g.salon
		la := nouveauLien()
		la.set(func(f *fauxLien) { f.delai = time.Millisecond })
		b.servir(la, toujours)
		la.envoyer(accueilWS(ea.Jeton, ea.Seq))
		synctest.Wait()
		time.Sleep(10 * time.Millisecond) // accueil écrit
		synctest.Wait()
		b.recevoir(t, g, trameD(0, 0))
		synctest.Wait() // écrivain bloqué dans l'écriture de cette trame
		for i := range 9 {
			b.recevoir(t, g, trameD(0, i+1))
		}
		sous(s, func() {
			if cn := s.conns[ea.Siege]; !cn.direct || len(cn.file) < 8 {
				t.Fatal("témoin : trames en file attendues")
			}
		})
		n := len(la.enrs())
		d := b.regler(t, c, ReglagesReq{Heures: 1}).Depuis
		time.Sleep(50 * time.Millisecond)
		synctest.Wait()
		vieilles := 0
		for _, e := range la.enrs()[n:] {
			if e.ty == 0x01 && e.seq <= d {
				vieilles++
			}
		}
		if vieilles > 1 || len(reglagesRecus(t, la)) != 1 || la.codeFerme() != 0 {
			t.Fatal("file du direct après le renouvellement", vieilles, la.codeFerme())
		}
		finir(t, la)
	})
}

// La place du bloc (VivantsParBloc) suit la nouvelle échéance : elle n'est pas rendue à
// l'ancienne.
func TestRenouvelerPlaceDuBloc(t *testing.T) {
	b := nouveauBanc(t, 200)
	c := nouvellesCles()
	r := reqValide(c)
	r.TTLHours = 1
	if _, err := b.m.Creer(r); err != nil {
		t.Fatal(err)
	}
	b.h.avancer(50 * time.Minute)
	b.regler(t, c, ReglagesReq{Heures: 6})
	b.h.avancer(2 * time.Hour) // ancienne échéance passée
	b.m.Tick()
	b.m.mu.Lock()
	n := b.m.parBloc[r.Bloc]
	b.m.mu.Unlock()
	if n != 1 {
		t.Fatal("place du bloc rendue à l'ancienne échéance", n)
	}
}

// Le siège 0 du créateur, même vide, compte dans le besoin minimal : choisirLocked le lui rend
// toujours. Créateur parti, 3 invités : 3 places refusées (4 personnes possibles), 4 permises.
func TestReglerPlacesCreateurParti(t *testing.T) {
	b := nouveauBanc(t, 200)
	c := b.creer(t, 5)
	e0 := b.entrer(t, c, true)
	s := b.etat(t, c)
	for range 3 {
		b.entrer(t, c, false)
	}
	b.depart(s, e0.Siege)
	if _, err := b.m.Regler(c.gestion, ReglagesReq{Places: 3}, nil); !errors.Is(err, ErrOccupied) {
		t.Fatal("3 places pour 3 invités et le siège du créateur :", err)
	}
	if _, p := b.expiresAt(t, s.id); p != 5 {
		t.Fatal("max_members changé :", p)
	}
	if res := b.regler(t, c, ReglagesReq{Places: 4}); res.MaxMembers != 4 {
		t.Fatalf("4 places : %+v", res)
	}
	b.entrer(t, c, true) // le créateur revient : 4 personnes pour 4 places
	if n := occupes(s); n != 4 {
		t.Fatal("occupés", n)
	}
}
