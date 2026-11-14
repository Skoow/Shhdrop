package salon

import (
	"context"
	"net/netip"
	"os"
	"path/filepath"
	"runtime"
	"sync"
	"testing"
	"time"

	"github.com/skoow/shhdrop/server/internal/blob"
)

// Non-régression de l'audit adverse du 13 novembre, 3e campagne, front « serveur Go,
// concurrence et déni de service » (A, B, D, H). Les démonstrations de l'audit sont reprises
// ici, retournées : ce qui prouvait la faiblesse doit maintenant échouer.

// A : le renouvellement ne fait plus aucun appel disque, et n'attend plus le verrou de la
// conversation, sous le verrou du salon. Une écriture est bloquée dans son appel disque (verrou
// de l'ancienne conversation tenu) ; le créateur renouvelle : le renouvellement attend le
// disque (destruction de l'ancienne conversation), mais HORS du verrou du salon : l'entretien
// en mémoire de tous les salons, Membre, et les autres membres n'attendent pas.
func TestRT3_A_RenouvellementHorsDuVerrouDuSalon(t *testing.T) {
	b := nouveauBanc(t, 200)
	c := b.creer(t, 4)
	eG, g := b.entrerMembre(t, c, true)
	_, inv := b.entrerMembre(t, c, false)
	s := g.salon
	b.recevoir(t, g, trameD(0, 0))
	// Un autre salon, sans rapport, avec une trame à effacer à l'échéance (règle 1, seul).
	c2 := b.creer(t, 4)
	_, g2 := b.entrerMembre(t, c2, true)
	seq2 := b.recevoir(t, g2, trameD(dUneMinute, 7))

	ancienne := s.conv
	lent := &fichierLent{File: ancienne.f.(*os.File), entree: make(chan struct{}, 1), relache: make(chan struct{})}
	ancienne.f = lent
	recFini := make(chan struct{})
	var seqInv uint64
	var errInv error
	go func() { seqInv, errInv = b.m.Recevoir(inv, trameD(0, 1), nil); close(recFini) }()
	<-lent.entree // écriture dans l'appel disque, hors de s.mu
	regFini := make(chan struct{})
	var errReg error
	go func() { _, errReg = b.m.Regler(c.gestion, ReglagesReq{Heures: 1}, nil); close(regFini) }()
	// Le renouvellement arrive à la destruction de l'ancienne conversation : la nouvelle est
	// déjà en place en mémoire.
	deadline := time.Now().Add(2 * time.Second)
	for {
		s.mu.Lock()
		remplacee := s.conv != ancienne
		s.mu.Unlock()
		if remplacee {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("FAIBLESSE A : conversation jamais remplacée pendant que le disque est bloqué " +
				"(le renouvellement attend le disque avant d'avoir fini sa partie mémoire, sous s.mu)")
		}
		time.Sleep(time.Millisecond)
	}
	pasFini(t, "renouvellement, disque bloqué (destruction de l'ancienne conversation)", regFini)

	b.h.avancer(2 * time.Minute) // l'échéance de la trame du salon 2 est passée
	termine(t, "Stats", func() { b.m.Stats() })
	termine(t, "passe mémoire de l'entretien (tous les salons)", b.m.entretienMemoire)
	termine(t, "Membre(jeton) du salon renouvelé", func() {
		if _, err := b.m.Membre(eG.Jeton[:]); err != nil {
			t.Error(err)
		}
	})
	termine(t, "trame volatile d'un autre membre du salon renouvelé", func() {
		if _, err := b.m.Recevoir(g, trameD(dVolatile, 3), nil); err != nil {
			t.Error(err)
		}
	})
	termine(t, "trame rangée dans la nouvelle conversation", func() {
		if _, err := b.m.Recevoir(g, trameD(0, 4), nil); err != nil {
			t.Error(err)
		}
	})
	if e2, _ := entreeDe(g2.salon, seq2); !e2.efface() {
		t.Fatal("salon sans rapport : trame échue non marquée effacée pendant le renouvellement")
	}

	close(lent.relache)
	termine(t, "Recevoir et renouvellement après le retour du disque", func() { <-recFini; <-regFini })
	if errReg != nil {
		t.Fatal("renouvellement :", errReg)
	}
	// La trame en vol pendant le renouvellement est d'après lui : rangée dans la nouvelle.
	if errInv != nil || !servie(t, s, seqInv) {
		t.Fatal("trame en vol pendant le renouvellement non rangée :", seqInv, errInv)
	}
	// Sur le disque : un fichier par salon, au nom du salon (aucun nom provisoire laissé), et
	// celui du salon renouvelé est la nouvelle conversation.
	es0, err := os.ReadDir(b.cfg.DossierConversations)
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range es0 {
		if !idValide(e.Name()) {
			t.Fatalf("dossier des conversations après le renouvellement : fichier inattendu %q", e.Name())
		}
	}
	if len(es0) != 2 {
		t.Fatalf("dossier des conversations après le renouvellement : %d fichiers, attendu 2", len(es0))
	}
	if got := b.tailleConv(t, s.id); got != TaillePalier {
		t.Fatalf("fichier de la nouvelle conversation : %d o, attendu un palier (%d)", got, TaillePalier)
	}
	if got := b.m.octetsConv.Load(); got != 2*TaillePalier {
		t.Fatalf("octets des conversations comptés : %d, attendu deux paliers (un par salon)", got)
	}
}

// B : une panique dans la fin d'un salon vide (effacerVides), récupérée par l'entretien, ne
// garde pas le verrou d'entrée de la raie : les autres salons de la raie restent joignables et
// la passe suivante passe.
func TestRT3_B_PaniqueEffacerVidesRendLeVerrouDEntree(t *testing.T) {
	b := nouveauBanc(t, 200)
	b.creer(t, 4)
	var id string
	if err := b.db.QueryRow(`SELECT id FROM salons`).Scan(&id); err != nil {
		t.Fatal(err)
	}
	b.h.avancer(videMax + time.Second)
	crochetAchever = func(*salon) { panic("panne simulée dans achever") }
	defer func() { crochetAchever = nil }()
	b.m.passeSure(b.m.Tick)
	crochetAchever = nil
	if b.m.PaniquesTick() != 1 {
		t.Fatal("pré-condition : panique récupérée et comptée :", b.m.PaniquesTick())
	}
	mu := b.m.essaiLock(id)
	if !mu.TryLock() {
		t.Fatal("FAIBLESSE B : verrou d'entrée de la raie toujours pris après une panique récupérée dans effacerVides")
	}
	mu.Unlock()
	termine(t, "passe suivante de l'entretien", b.m.Tick)
	if b.lignes(t, "salons", id) != 0 {
		t.Fatal("salon vide non effacé à la passe suivante")
	}
}

// H : la passe disque de l'entretien (écrasements, fins de salon) n'attend jamais la borne des
// partages et des pièces (blob.Store.Gate) : borne saturée par des transferts sur un disque
// lent, une pièce à purger en attente, l'emplacement d'une trame échue est quand même écrasé,
// et un salon échu perd quand même sa conversation et sa ligne vivante.
func TestRT3_H_PasseDisqueSansLaBorneDesPartages(t *testing.T) {
	b := nouveauBanc(t, 200)
	gate := blob.NewGate(2)
	b.m.cfg.Pieces.Gate = gate // comme en production : même borne que les partages (main.go)
	// Salon X : une pièce jamais envoyée (échue après PieceSansSegment).
	cx := b.creer(t, 4)
	_, gx := b.entrerMembre(t, cx, true)
	b.creerPiece(t, gx, 1, false)
	// Salon Y, sans rapport : une trame de règle 1 (1 min), expéditeur seul.
	cy := b.creer(t, 4)
	_, gy := b.entrerMembre(t, cy, true)
	sy := gy.salon
	// Salon Z : arrive à échéance (1 h), avec une trame rangée.
	cz := nouvellesCles()
	rz := reqValide(cz)
	rz.TTLHours = 1
	if _, err := b.m.Creer(rz); err != nil {
		t.Fatal(err)
	}
	_, gz := b.entrerMembre(t, cz, true)
	sz := gz.salon
	b.recevoir(t, gz, trameD(0, 1))

	liberer := borneOccupee(t, gate) // transferts de partages sur un disque lent
	b.h.avancer(PieceSansSegment + time.Minute)
	b.m.entretienMemoire() // pièce de X marquée à purger
	seq := b.recevoir(t, gy, trameD(dUneMinute, 9))
	e, _ := entreeDe(sy, seq)
	emplacement := e.emplacement
	b.h.avancer(time.Hour) // trame de Y échue, salon Z échu
	b.m.entretienMemoire()
	if e, _ := entreeDe(sy, seq); !e.efface() {
		t.Fatal("pré-condition : trame de Y marquée effacée en mémoire")
	}
	if !sz.estFini() {
		t.Fatal("pré-condition : salon Z fini en mémoire")
	}

	termine(t, "FAIBLESSE H : passe disque, borne des partages saturée", b.m.entretienDisque)
	if _, err := sy.conv.Lire(emplacement); err != ErrEfface {
		t.Fatalf("emplacement de la trame échue de Y, borne des partages saturée : %v (attendu : effacé)", err)
	}
	if b.convExiste(t, sz.id) {
		t.Fatal("salon Z échu : fichier de conversation encore là, borne des partages saturée")
	}
	var essais int
	if err := b.db.QueryRow(`SELECT failed_attempts FROM salons WHERE id=?`, sz.id).Scan(&essais); err == nil && essais < maxEssais {
		t.Fatal("salon Z échu : ligne encore vivante en base, borne des partages saturée")
	}
	// La purge des pièces, elle, attend la borne (c'est son rôle), puis finit tout.
	liberer()
	termine(t, "entretien complet, borne libérée", b.m.Tick)
	b.m.Tick()
	if n := b.lignes(t, "salons", sz.id); n != 0 {
		t.Fatal("salon Z : ligne restante après la libération de la borne")
	}
	if gx.salon.resteAPurger() {
		t.Fatal("salon X : pièce échue non purgée après la libération de la borne")
	}
}

// lienGele : client qui s'accueille puis ne lit plus rien dès la première trame (0x01).
type lienGele struct {
	accueil []byte
	donne   bool
	mu      sync.Mutex
	ferme   chan struct{}
	une     sync.Once
	gele    chan struct{} // fermé à la première trame retenue
	uneG    sync.Once
}

func (l *lienGele) Lire(ctx context.Context) ([]byte, error) {
	l.mu.Lock()
	if !l.donne {
		l.donne = true
		l.mu.Unlock()
		return l.accueil, nil
	}
	l.mu.Unlock()
	select {
	case <-l.ferme:
	case <-ctx.Done():
	}
	return nil, errCoupe
}

func (l *lienGele) Ecrire(ctx context.Context, b []byte) error {
	if b[0] != 0x01 {
		return nil
	}
	l.uneG.Do(func() { close(l.gele) })
	select {
	case <-l.ferme:
	case <-ctx.Done():
	}
	return errCoupe
}

func (l *lienGele) Ping(context.Context) error { return nil }
func (l *lienGele) Fermer(int, string) error   { l.une.Do(func() { close(l.ferme) }); return nil }

func tasVivant() uint64 {
	runtime.GC()
	runtime.GC()
	var ms runtime.MemStats
	runtime.ReadMemStats(&ms)
	return ms.HeapAlloc
}

// D : mémoire tenue par une connexion en rattrapage dont le client ne lit plus (un lot de
// trames, gardé jusqu'à ecritureMax). Elle doit rester sous MemoireParConnexion, le coût que
// config compte par WebSocket dans son budget (computeCapacity).
func TestRT3_D_MemoireDesLotsDeRattrapage(t *testing.T) {
	const salons, sieges, trames = 30, 10, 80
	b := nouveauBanc(t, 2000)
	type sg struct {
		jeton  [32]byte
		depuis uint64
	}
	var tous []sg
	for range salons {
		c := b.creer(t, sieges)
		var js [][32]byte
		e, g := b.entrerMembre(t, c, true)
		js = append(js, e.Jeton)
		for k := 1; k < sieges; k++ {
			e, _ := b.entrerMembre(t, c, false)
			js = append(js, e.Jeton)
		}
		depuis := dernierSeq(g.salon)
		for i := range trames {
			b.recevoir(t, g, trameD(0, i))
		}
		for _, j := range js {
			tous = append(tous, sg{j, depuis})
		}
	}
	avant := tasVivant()
	var liens []*lienGele
	var fini sync.WaitGroup
	for _, x := range tous {
		l := &lienGele{accueil: accueilWS(x.jeton, x.depuis), ferme: make(chan struct{}), gele: make(chan struct{})}
		liens = append(liens, l)
		fini.Go(func() { _ = b.m.Servir(context.Background(), l, netip.MustParseAddr(ipTest), toujours) })
	}
	for i, l := range liens {
		select {
		case <-l.gele:
		case <-time.After(8 * time.Second):
			t.Fatalf("connexion %d : aucun lot de trames", i)
		}
	}
	pendant := tasVivant()
	n := len(liens)
	par := float64(pendant-avant) / float64(n)
	t.Logf("%d connexions en rattrapage, client qui ne lit plus : tas vivant +%.1f Mio, soit %.0f Kio par connexion",
		n, float64(pendant-avant)/(1<<20), par/1024)
	for _, l := range liens {
		l.Fermer(0, "")
	}
	fini.Wait()
	if par > memoireParConnexionTest {
		t.Errorf("FAIBLESSE D : %.0f Kio de tas par connexion en rattrapage, plus que le coût compté par WebSocket (%d Kio)",
			par/1024, memoireParConnexionTest>>10)
	}
}

// memoireParConnexionTest : seuil du test D (avant le correctif : 310 Kio mesurés, pour des lots
// de 64 enregistrements).
const memoireParConnexionTest = MemoireParConnexion

// Audit adverse du 13 novembre, 3e campagne, tableau de bord, F2 : destruction par
// l'administrateur dans le serveur en marche (DetruireAdmin). Le salon est fini par le
// gestionnaire : jeton refusé tout de suite (sans attendre une passe d'entretien), conversation,
// pièces et ligne effacées, et « complet » n'est rendu que si la ligne est partie.
func TestRT3_DetruireAdmin(t *testing.T) {
	b := nouveauBanc(t, 200)
	c, autre := b.creer(t, 4), b.creer(t, 4)
	eg, g := b.entrerMembre(t, c, true)
	_, ga := b.entrerMembre(t, autre, true)
	s := g.salon
	b.recevoir(t, g, trameD(0, 1))
	piece := b.pretePiece(t, g, 1, false)
	// Une pièce en cours de création pendant la destruction : sa ligne est déjà en base, le
	// gestionnaire ne la connaît pas encore (même INSERT que CreerPieceID).
	enVol := idPieceTest(t)
	crochetAchever = func(x *salon) {
		crochetAchever = nil
		if _, err := b.db.Exec(`INSERT INTO salon_pieces(id,salon_id,bucket,state,segments_mask) VALUES(?,?,1,'uploading',x'00')`,
			enVol, x.id); err != nil {
			t.Error(err)
		}
	}
	defer func() { crochetAchever = nil }()
	complet, err := b.m.DetruireAdmin(c.acces)
	if err != nil || !complet {
		t.Fatalf("destruction : complet=%v, %v", complet, err)
	}
	if _, err := b.m.Membre(eg.Jeton[:]); err != ErrNotFound {
		t.Fatal("jeton encore accepté après la destruction :", err)
	}
	b.toutEfface(t, s, []string{piece, enVol}, eg.Jeton)
	if _, err := b.m.DetruireAdmin(c.acces); err != ErrNotFound {
		t.Fatal("seconde destruction :", err)
	}
	if _, err := b.m.DetruireAdmin(aleatoire()); err != ErrNotFound {
		t.Fatal("lien inconnu :", err)
	}
	if b.lignes(t, "salons", ga.salon.id) != 1 || !b.convExiste(t, ga.salon.id) {
		t.Fatal("un autre salon a été touché")
	}

	// Effacement d'un fichier de pièce impossible : le salon est détruit pour tous (ligne morte,
	// jeton refusé), mais « complet » est faux tant que la ligne reste ; l'entretien finit.
	ea, _ := b.entrerMembre(t, autre, false)
	bloquee := b.pretePiece(t, ga, 1, false)
	chemin := filepath.Join(b.cfg.Pieces.Dir, bloquee)
	if err := os.Remove(chemin); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(chemin, "x"), 0o700); err != nil { // dossier non vide : ne s'efface pas
		t.Fatal(err)
	}
	complet, err = b.m.DetruireAdmin(autre.acces)
	if err != nil || complet {
		t.Fatalf("fichier de pièce bloqué : complet=%v, %v (attendu : incomplet, sans erreur)", complet, err)
	}
	if _, err := b.m.Membre(ea.Jeton[:]); err != ErrNotFound {
		t.Fatal("jeton encore accepté :", err)
	}
	var essais int
	if err := b.db.QueryRow(`SELECT failed_attempts FROM salons WHERE id=?`, ga.salon.id).Scan(&essais); err != nil || essais < maxEssais {
		t.Fatalf("ligne non rendue morte : %d %v", essais, err)
	}
	if b.convExiste(t, ga.salon.id) {
		t.Fatal("conversation encore sur le disque")
	}
	if err := os.RemoveAll(chemin); err != nil {
		t.Fatal(err)
	}
	b.m.Tick()
	if b.lignes(t, "salons", ga.salon.id) != 0 {
		t.Fatal("l'entretien n'a pas fini l'effacement")
	}
	if complet, err := b.m.DetruireAdmin(autre.acces); err != ErrNotFound || complet {
		t.Fatal("après l'entretien :", complet, err)
	}
}

func idPieceTest(t *testing.T) string {
	t.Helper()
	return b64.EncodeToString(aleatoire()[:16])
}
