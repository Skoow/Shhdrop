package salon

import (
	"bytes"
	"context"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"testing"
	"testing/synctest"
	"time"

	"github.com/skoow/shhdrop/server/internal/blob"
)

// Fin de vie, destruction, purge au démarrage (plan C-2 Task 15).

// creerPermis : salon de max membres dont les participants peuvent détruire.
func (b *banc) creerPermis(t *testing.T, max int) cles {
	t.Helper()
	c := nouvellesCles()
	r := reqValide(c)
	r.MaxMembers, r.MembersCanDestroy = max, true
	if _, err := b.m.Creer(r); err != nil {
		t.Fatal(err)
	}
	return c
}

// lignes : nombre de lignes de la table pour ce salon (id pour salons, salon_id sinon).
func (b *banc) lignes(t *testing.T, table, id string) int {
	t.Helper()
	col := "salon_id"
	if table == "salons" {
		col = "id"
	}
	var n int
	if err := b.db.QueryRow(`SELECT count(*) FROM `+table+` WHERE `+col+`=?`, id).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

// convExiste : le fichier de conversation du salon id existe.
func (b *banc) convExiste(t *testing.T, id string) bool {
	t.Helper()
	_, err := os.Stat(filepath.Join(b.cfg.DossierConversations, id))
	if err != nil && !errors.Is(err, fs.ErrNotExist) {
		t.Fatal(err)
	}
	return err == nil
}

// finRecue : l a reçu exactement un 0x05 de raison r, en dernier, puis la fermeture 1000.
func finRecue(t *testing.T, nom string, l *fauxLien, r uint8) {
	t.Helper()
	attendreFin(t, l)
	e := l.enrs()
	if len(e) == 0 || e[len(e)-1].ty != 0x05 || !bytes.Equal(e[len(e)-1].corps, []byte{r}) || len(de(l, 0x05)) != 1 {
		t.Fatalf("%s : 0x05 raison %d attendu en dernier", nom, r)
	}
	if code := l.codeFerme(); code != CodeFin {
		t.Fatalf("%s : fermeture %d, attendu 1000", nom, code)
	}
}

// toutEfface : conversation, pièces (fichier et ligne), ligne du salon absentes ; jetons
// refusés ; index des pièces vide.
func (b *banc) toutEfface(t *testing.T, s *salon, pieces []string, jetons ...[32]byte) {
	t.Helper()
	if b.convExiste(t, s.id) {
		t.Error("conversation gardée")
	}
	for _, id := range pieces {
		if f, l := b.surDisque(t, id); f || l {
			t.Errorf("pièce gardée : fichier=%v ligne=%v", f, l)
		}
		if b.m.salonDePiece(id) != nil {
			t.Error("index de la pièce gardé")
		}
	}
	if n := b.lignes(t, "salons", s.id); n != 0 {
		t.Error("ligne du salon gardée")
	}
	for _, j := range jetons {
		if _, err := b.m.Membre(j[:]); !errors.Is(err, ErrNotFound) {
			t.Error("Membre après la fin :", err)
		}
	}
	if s.conv != nil {
		s.conv.mu.Lock()
		cle := s.conv.cle
		s.conv.mu.Unlock()
		if cle != [32]byte{} {
			t.Error("clé de la conversation non mise à zéro")
		}
	}
}

// À l'échéance : 0x05 raison 1 chez tous, puis 1000 ; conversation, pièces et ligne effacées.
func TestExpiration(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		b := nouveauBanc(t, 200)
		c := b.creer(t, 4)
		e0, g := b.entrerMembre(t, c, true)
		ea, ma := b.entrerMembre(t, c, false)
		s := g.salon
		liee := b.pretePiece(t, g, 1, false)
		b.lier(t, g, 0, liee)
		enCours := b.creerPiece(t, ma, 1, false)
		l0, la := b.connecter(e0.Jeton, e0.Seq), b.connecter(ea.Jeton, ea.Seq)
		synctest.Wait()
		b.h.avancer(25 * time.Hour)
		b.m.Tick()
		finRecue(t, "créateur", l0, RaisonExpire)
		finRecue(t, "invité", la, RaisonExpire)
		b.toutEfface(t, s, []string{liee, enCours}, e0.Jeton, ea.Jeton)
	})
}

// Destruction par le créateur (S_gestion) : 0x05 raison 2 chez tous, tout effacé ; ensuite
// ErrNotFound (salon introuvable), comme un S_gestion inconnu.
func TestDetruireCreateur(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		b := nouveauBanc(t, 200)
		c := b.creer(t, 4)
		e0, g := b.entrerMembre(t, c, true)
		ea := b.entrer(t, c, false)
		s := g.salon
		p := b.pretePiece(t, g, 1, false)
		b.recevoir(t, g, trameD(0, 1))
		l0, la := b.connecter(e0.Jeton, e0.Seq), b.connecter(ea.Jeton, ea.Seq)
		synctest.Wait()
		if err := b.m.Detruire(aleatoire(), nil); !errors.Is(err, ErrNotFound) {
			t.Fatal("S_gestion inconnu :", err)
		}
		if err := b.m.Detruire(c.gestion, nil); err != nil {
			t.Fatal("Detruire :", err)
		}
		finRecue(t, "créateur", l0, RaisonDetruit)
		finRecue(t, "invité", la, RaisonDetruit)
		b.toutEfface(t, s, []string{p}, e0.Jeton, ea.Jeton)
		if err := b.m.Detruire(c.gestion, nil); !errors.Is(err, ErrNotFound) {
			t.Fatal("deuxième destruction :", err)
		}
		if _, err := b.m.Meta(c.acces); !errors.Is(err, ErrNotFound) {
			t.Fatal("Meta :", err)
		}
	})
}

// Jeton de membre : seulement si members_can_destroy (sinon ErrForbidden, rien changé) ;
// exclu : ErrExcluded ; inconnu : ErrNotFound ; ni S_gestion ni jeton : ErrForbidden.
func TestDetruireMembreSiPermis(t *testing.T) {
	b := nouveauBanc(t, 200)
	c := b.creer(t, 4)
	_, g := b.entrerMembre(t, c, true)
	ea := b.entrer(t, c, false)
	if err := b.m.Detruire(nil, ea.Jeton[:]); !errors.Is(err, ErrForbidden) {
		t.Fatal("membre sans permission :", err)
	}
	if err := b.m.Detruire(nil, nil); !errors.Is(err, ErrForbidden) {
		t.Fatal("sans rien :", err)
	}
	if err := b.m.Detruire(nil, aleatoire()); !errors.Is(err, ErrNotFound) {
		t.Fatal("jeton inconnu :", err)
	}
	if b.lignes(t, "salons", g.salon.id) != 1 || g.salon.estFini() {
		t.Fatal("salon touché par un refus")
	}

	cp := b.creerPermis(t, 4)
	_, gp := b.entrerMembre(t, cp, true)
	eb := b.entrer(t, cp, false)
	ec := b.entrer(t, cp, false)
	if err := b.m.Exclure(reqExclure(cp, invitation(cp), siegeP(ec.Siege), &ec.Nonce, 1)); err != nil {
		t.Fatal(err)
	}
	if err := b.m.Detruire(nil, ec.Jeton[:]); !errors.Is(err, ErrExcluded) {
		t.Fatal("exclu :", err)
	}
	if err := b.m.Detruire(nil, eb.Jeton[:]); err != nil {
		t.Fatal("membre permis :", err)
	}
	if !gp.salon.estFini() || b.lignes(t, "salons", gp.salon.id) != 0 {
		t.Fatal("salon non détruit")
	}
}

// 10ᵉ mot de passe faux : raison 2 chez les connectés, tout effacé.
func TestDixFauxDetruit(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		b := nouveauBanc(t, 200)
		c := b.creer(t, 4)
		e0, g := b.entrerMembre(t, c, true)
		s := g.salon
		p := b.pretePiece(t, g, 1, false)
		l0 := b.connecter(e0.Jeton, e0.Seq)
		synctest.Wait()
		for range 9 {
			b.m.Rejoindre(c.acces, secret(0xEE), nil)
		}
		if _, err := b.m.Rejoindre(c.acces, secret(0xEE), nil); !errors.Is(err, ErrNotFound) {
			t.Fatal("10ᵉ essai :", err)
		}
		finRecue(t, "créateur", l0, RaisonDetruit)
		b.toutEfface(t, s, []string{p}, e0.Jeton)
	})
}

// Relecture Task 9 : le 0x05 atteint aussi une connexion en rattrapage (hors du direct).
func TestFinEnRattrapage(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		b := nouveauBanc(t, 200)
		c := b.creer(t, 4)
		_, g := b.entrerMembre(t, c, true)
		ea := b.entrer(t, c, false)
		s := g.salon
		for i := range 1000 {
			b.recevoir(t, g, trameD(0, i))
		}
		la := nouveauLien()
		la.delai = time.Millisecond
		b.servir(la, toujours)
		la.envoyer(accueilWS(ea.Jeton, ea.Seq))
		time.Sleep(20 * time.Millisecond)
		if cn := connDe(s, ea.Siege); cn == nil || func() bool { s.mu.Lock(); defer s.mu.Unlock(); return cn.direct }() {
			t.Fatal("témoin : la connexion devait être en rattrapage")
		}
		if err := b.m.Detruire(c.gestion, nil); err != nil {
			t.Fatal(err)
		}
		finRecue(t, "en rattrapage", la, RaisonDetruit)
	})
}

// Ordre de fin : connexions arrêtées (0x05 décidé) avant tout effacement de fichier ; pièces :
// fichier avant ligne. Un échec de suppression du fichier d'une pièce laisse sa ligne (et la
// ligne du salon, morte : failed_attempts = 10) ; Tick reprend la fin au passage suivant.
func TestOrdreDeFin(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		b := nouveauBanc(t, 200)
		c := b.creer(t, 4)
		e0, g := b.entrerMembre(t, c, true)
		s := g.salon
		id := b.pretePiece(t, g, 1, false)
		l0 := b.connecter(e0.Jeton, e0.Seq)
		synctest.Wait()
		vu := false
		crochetAchever = func(x *salon) {
			if x != s || vu {
				return
			}
			vu = true
			sous(s, func() {
				if cn := s.conns[0]; cn != nil && cn.codeFinal() != CodeFin {
					t.Error("connexion pas encore arrêtée", cn.codeFinal())
				}
			})
			if !b.convExiste(t, s.id) {
				t.Error("conversation effacée avant l'arrêt des connexions")
			}
		}
		t.Cleanup(func() { crochetAchever = nil })
		// Fichier de la pièce remplacé par un dossier non vide : sa suppression échoue.
		p := filepath.Join(b.cfg.Pieces.Dir, id)
		if err := os.Remove(p); err != nil {
			t.Fatal(err)
		}
		if err := os.MkdirAll(filepath.Join(p, "x"), 0o700); err != nil {
			t.Fatal(err)
		}
		if err := b.m.Detruire(c.gestion, nil); err != nil {
			t.Fatal(err)
		}
		if !vu {
			t.Fatal("crochet non appelé")
		}
		finRecue(t, "créateur", l0, RaisonDetruit)
		if b.convExiste(t, s.id) {
			t.Fatal("conversation gardée")
		}
		if b.lignes(t, "salon_pieces", s.id) != 1 {
			t.Fatal("ligne de la pièce effacée avant son fichier")
		}
		var fa int
		if err := b.db.QueryRow(`SELECT failed_attempts FROM salons WHERE id=?`, s.id).Scan(&fa); err != nil || fa != maxEssais {
			t.Fatal("ligne du salon : attendue gardée et morte", fa, err)
		}
		if _, err := b.m.Meta(c.acces); !errors.Is(err, ErrNotFound) {
			t.Fatal("Meta pendant la reprise :", err)
		}
		b.m.Tick()
		if b.lignes(t, "salon_pieces", s.id) != 1 || b.lignes(t, "salons", s.id) != 1 {
			t.Fatal("fichier toujours là : rien ne doit être effacé après lui")
		}
		if err := os.RemoveAll(p); err != nil {
			t.Fatal(err)
		}
		b.m.Tick()
		b.toutEfface(t, s, []string{id}, e0.Jeton)
	})
}

// Suppression ratée du fichier de conversation : retentée par Tick, tombe gardée d'ici là.
func TestConversationReessayee(t *testing.T) {
	b := nouveauBanc(t, 200)
	c := b.creer(t, 4)
	_, g := b.entrerMembre(t, c, true)
	s := g.salon
	conv := filepath.Join(b.cfg.DossierConversations, s.id)
	if err := os.Remove(conv); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(conv, "x"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := b.m.Detruire(c.gestion, nil); err != nil {
		t.Fatal(err)
	}
	b.h.avancer(26 * time.Hour)
	b.m.Tick()
	if !b.convExiste(t, s.id) || b.lignes(t, "salons", s.id) != 0 {
		t.Fatal("témoin : fichier gardé, ligne supprimée")
	}
	b.m.mu.Lock()
	tombe := b.m.salons[s.id] == s
	b.m.mu.Unlock()
	if !tombe {
		t.Fatal("tombe oubliée avant l'effacement de la conversation")
	}
	if err := os.RemoveAll(conv); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(conv, []byte("x"), 0o600); err != nil { // fichier de nouveau supprimable
		t.Fatal(err)
	}
	b.m.Tick()
	if b.convExiste(t, s.id) {
		t.Fatal("conversation non effacée au tick suivant")
	}
	b.m.Tick()
	b.m.mu.Lock()
	tombe = b.m.salons[s.id] != nil
	b.m.mu.Unlock()
	if tombe {
		t.Fatal("tombe gardée après la fin complète")
	}
}

// Ligne supprimée hors du processus (admin destroy, wipe) : au tick suivant, connexions fermées
// en raison 2, état oublié ; place du plafond par /48 rendue, même pour un salon sans état.
func TestLigneDisparue(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		b := nouveauBanc(t, 200)
		c := b.creer(t, 4)
		e0, g := b.entrerMembre(t, c, true)
		s := g.salon
		l0 := b.connecter(e0.Jeton, e0.Seq)
		synctest.Wait()
		if _, err := b.db.Exec(`DELETE FROM salons WHERE id=?`, s.id); err != nil {
			t.Fatal(err)
		}
		b.m.Tick()
		finRecue(t, "créateur", l0, RaisonDetruit)
		b.toutEfface(t, s, nil, e0.Jeton)

		// Plafond par bloc : 5 salons vivants ; une ligne supprimée par l'administrateur (salon
		// jamais rejoint, sans état) rend sa place au tick suivant.
		bloc := [32]byte(aleatoire())
		var ids []string
		for range VivantsParBloc {
			k := nouvellesCles()
			r := reqValide(k)
			r.Bloc = bloc
			if _, err := b.m.Creer(r); err != nil {
				t.Fatal(err)
			}
			ids = append(ids, b.idDe(t, k))
		}
		r := reqValide(nouvellesCles())
		r.Bloc = bloc
		var at *Attente
		if _, err := b.m.Creer(r); !errors.As(err, &at) {
			t.Fatal("témoin : 6ᵉ salon du bloc refusé", err)
		}
		if _, err := b.db.Exec(`DELETE FROM salons WHERE id=?`, ids[0]); err != nil {
			t.Fatal(err)
		}
		b.m.Tick()
		if _, err := b.m.Creer(r); err != nil {
			t.Fatal("place du bloc non rendue :", err)
		}
	})
}

// Une ligne passée à 10 essais hors du processus est supprimée au tick suivant (et l'état
// en mémoire, s'il y en a, fini).
func TestDixEssaisPurgesAuTick(t *testing.T) {
	b := nouveauBanc(t, 200)
	c := b.creer(t, 4)
	c2 := b.creer(t, 4)
	_, g := b.entrerMembre(t, c2, true)
	id := b.idDe(t, c)
	if _, err := b.db.Exec(`UPDATE salons SET failed_attempts=10 WHERE id IN (?,?)`, id, g.salon.id); err != nil {
		t.Fatal(err)
	}
	b.m.Tick()
	if b.lignes(t, "salons", id) != 0 || b.lignes(t, "salons", g.salon.id) != 0 {
		t.Fatal("ligne à 10 essais gardée")
	}
	if !g.salon.estFini() {
		t.Fatal("état d'un salon à 10 essais gardé")
	}
}

// Run : Tick chaque seconde jusqu'à l'annulation du contexte.
func TestRun(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		b := nouveauBanc(t, 200)
		c := b.creer(t, 4)
		e0, _ := b.entrerMembre(t, c, true)
		l0 := b.connecter(e0.Jeton, e0.Seq)
		synctest.Wait()
		ctx, cancel := context.WithCancel(context.Background())
		fini := make(chan struct{})
		go func() { b.m.Run(ctx); close(fini) }()
		b.h.avancer(25 * time.Hour)
		time.Sleep(1500 * time.Millisecond)
		finRecue(t, "créateur", l0, RaisonExpire)
		cancel()
		<-fini
	})
}

// Redémarrage (Review) : nouveau Manager sur les mêmes dossiers → conversation et pièces
// effacées (fichier puis ligne), pieces_bytes = 0, ligne gardée (lien et mot de passe valables) ;
// salons échus et lignes à 10 essais supprimés ; dossiers ramenés à 0700. rejoindre repart
// avec un siège neuf et des rangs depuis 1.
func TestPurgeAuDemarrage(t *testing.T) {
	b := nouveauBanc(t, 200)
	c := b.creer(t, 4)
	_, g := b.entrerMembre(t, c, true)
	b.entrer(t, c, false)
	s := g.salon
	b.recevoir(t, g, trameD(0, 1))
	p := b.pretePiece(t, g, 1, false)
	b.lier(t, g, 0, p)
	enCours := b.creerPiece(t, g, 16, false)
	echu := b.creer(t, 4)
	bloque := b.creer(t, 4)
	idEchu := b.idDe(t, echu)
	if _, err := b.db.Exec(`UPDATE salons SET expires_at=1 WHERE id=?`, idEchu); err != nil {
		t.Fatal(err)
	}
	idBloque := b.idDe(t, bloque)
	if _, err := b.db.Exec(`UPDATE salons SET failed_attempts=10 WHERE id=?`, idBloque); err != nil {
		t.Fatal(err)
	}
	for _, d := range []string{b.cfg.DossierConversations, b.cfg.Pieces.Dir} {
		if err := os.Chmod(d, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	// Redémarrage : l'ancien Manager disparaît sans rien effacer.
	cfg := b.cfg
	cfg.Pieces = &blob.Store{Dir: b.cfg.Pieces.Dir}
	m2, err := NewManager(cfg)
	if err != nil {
		t.Fatal(err)
	}
	m2.sansLimiteSiege = true
	if err := m2.PurgerAuDemarrage(); err != nil {
		t.Fatal("PurgerAuDemarrage :", err)
	}
	for _, d := range []string{cfg.DossierConversations, cfg.Pieces.Dir} {
		es, err := os.ReadDir(d)
		if err != nil || len(es) != 0 {
			t.Fatalf("%s : %d entrées, %v", d, len(es), err)
		}
		fi, err := os.Stat(d)
		if err != nil || fi.Mode().Perm() != 0o700 {
			t.Fatalf("%s : droits %v, %v", d, fi.Mode().Perm(), err)
		}
	}
	for _, id := range []string{p, enCours} {
		if f, l := b.surDisque(t, id); f || l {
			t.Fatalf("pièce après la purge : fichier=%v ligne=%v", f, l)
		}
	}
	var pb int64
	if err := b.db.QueryRow(`SELECT pieces_bytes FROM salons WHERE id=?`, s.id).Scan(&pb); err != nil || pb != 0 {
		t.Fatal("ligne du salon vivant : gardée avec pieces_bytes = 0 attendu", pb, err)
	}
	if b.lignes(t, "salons", idEchu) != 0 || b.lignes(t, "salons", idBloque) != 0 {
		t.Fatal("salon échu ou bloqué gardé")
	}
	if u, err := cfg.Pieces.UsedBytes(); err != nil || u != 0 {
		t.Fatal("usage des pièces après la purge :", u, err)
	}
	e, err := m2.Rejoindre(c.acces, c.preuve, c.gestion)
	if err != nil || e.Siege != 0 || e.Seq != 1 || e.BudgetLeft != Budget {
		t.Fatalf("rejoindre après le redémarrage : %+v, %v", e, err)
	}
}

// Arrêt du serveur borné avant la fermeture de la base : après FermerTout, AttendreConnexions
// rend vrai dès que tous les Servir ont rendu (un client qui ne lit plus est fermé au plus
// après attenteFinale), faux si le délai passe d'abord.
func TestAttendreConnexions(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		b := nouveauBanc(t, 200)
		c := b.creer(t, 3)
		e0, _ := b.entrerMembre(t, c, true)
		l0 := b.connecter(e0.Jeton, e0.Seq)
		synctest.Wait()
		if b.m.AttendreConnexions(time.Second) {
			t.Fatal("connexion ouverte ignorée")
		}
		l0.set(func(f *fauxLien) { f.bloqueApres = 0 }) // n'écrit plus rien
		debut := time.Now()
		b.m.FermerTout()
		if !b.m.AttendreConnexions(10 * time.Second) {
			t.Fatal("connexions encore ouvertes après l'arrêt")
		}
		if d := time.Since(debut); d > 2*time.Second {
			t.Fatal("arrêt trop long :", d)
		}
		attendreFin(t, l0)
	})
}
