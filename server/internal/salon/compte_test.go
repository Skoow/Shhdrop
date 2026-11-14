package salon

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/skoow/shhdrop/server/internal/share"
)

// Lot 6 du plan du compte : salon ↔ compte (création réservée aux comptes, paliers, salons du
// compte, fermeture par le compte) et signalements par catégorie, en mémoire.

var (
	paliersNeuf     = Palier{Salons: 1, Places: 4, Heures: 24}
	paliersConfirme = Palier{Salons: 3, Places: 10, Heures: 24}
)

// bancCompte : nouveauBanc dont le crochet Palier rend *palier (modifiable par le test) ou err.
func bancCompte(t *testing.T, palier *Palier, err *error) *banc {
	t.Helper()
	b := nouveauBanc(t, 200)
	b.m.cfg.Palier = func([16]byte) (Palier, error) {
		if err != nil && *err != nil {
			return Palier{}, *err
		}
		return *palier, nil
	}
	return b
}

func compteTest(n byte) *[16]byte {
	var h [16]byte
	for i := range h {
		h[i] = n
	}
	return &h
}

// creerPour : création d'un salon de max places et ttl heures pour le compte h.
func (b *banc) creerPour(h *[16]byte, max, ttl int) (cles, error) {
	c := nouvellesCles()
	r := reqValide(c)
	r.MaxMembers, r.TTLHours, r.Compte = max, ttl, h
	_, err := b.m.Creer(r)
	return c, err
}

func palierDepasse(err error) bool {
	var p *PalierDepasse
	return errors.As(err, &p) && p != nil
}

// La colonne compte de la ligne est remplie à la création, et seulement là.
func TestCreerAvecCompte(t *testing.T) {
	p := paliersConfirme
	b := bancCompte(t, &p, nil)
	h := compteTest(1)
	c, err := b.creerPour(h, 4, 24)
	if err != nil {
		t.Fatal(err)
	}
	var col []byte
	if err := b.db.QueryRow(`SELECT compte FROM salons WHERE access_v=?`, share.Verifier(c.acces)).Scan(&col); err != nil ||
		string(col) != string(h[:]) {
		t.Fatalf("colonne compte : %x %v", col, err)
	}
	if n, err := b.m.SalonsDuCompte(*h); err != nil || n != 1 {
		t.Fatal("salons du compte :", n, err)
	}
	if n, err := b.m.SalonsDuCompte(*compteTest(2)); err != nil || n != 0 {
		t.Fatal("salons d'un autre compte :", n, err)
	}
	// Sans compte (SHH_COMPTES=0) : colonne NULL, aucun crochet appelé.
	b.m.cfg.Palier = nil
	c2 := b.creer(t, 10)
	var nul []byte
	if err := b.db.QueryRow(`SELECT compte FROM salons WHERE access_v=?`, share.Verifier(c2.acces)).Scan(&nul); err != nil || nul != nil {
		t.Fatalf("salon sans compte : %x %v", nul, err)
	}
	got, err := b.m.CompteDuSalon(c.acces)
	if err != nil || got == nil || *got != *h {
		t.Fatal("CompteDuSalon :", got, err)
	}
	if got, err := b.m.CompteDuSalon(c2.acces); err != nil || got != nil {
		t.Fatal("CompteDuSalon sans compte :", got, err)
	}
	if _, err := b.m.CompteDuSalon(aleatoire()); !errors.Is(err, ErrNotFound) {
		t.Fatal("CompteDuSalon inconnu :", err)
	}
}

// Palier « neuf » : 1 salon vivant, 4 places ; un refus n'écrit rien. Une fois le premier
// salon détruit, la place est rendue.
func TestPalierNeuf(t *testing.T) {
	p := paliersNeuf
	b := bancCompte(t, &p, nil)
	h := compteTest(1)
	if _, err := b.creerPour(h, 5, 24); !palierDepasse(err) {
		t.Fatal("5 places pour un compte neuf :", err)
	}
	c, err := b.creerPour(h, 4, 24)
	if err != nil {
		t.Fatal("4 places :", err)
	}
	var pd *PalierDepasse
	if _, err := b.creerPour(h, 2, 1); !errors.As(err, &pd) || pd.Palier != paliersNeuf {
		t.Fatal("2e salon vivant :", err)
	}
	if n := b.lignesSalons(t); n != 1 {
		t.Fatal("lignes après refus :", n)
	}
	// Un autre compte n'est pas compté avec celui-ci.
	if _, err := b.creerPour(compteTest(2), 4, 24); err != nil {
		t.Fatal("autre compte :", err)
	}
	if err := b.m.Detruire(c.gestion, nil); err != nil {
		t.Fatal(err)
	}
	if _, err := b.creerPour(h, 4, 24); err != nil {
		t.Fatal("après destruction :", err)
	}
}

// Palier « confirmé » : 3 salons, 10 places ; le 4e est refusé ; un salon échu ne compte plus.
func TestPalierConfirme(t *testing.T) {
	p := paliersConfirme
	b := bancCompte(t, &p, nil)
	h := compteTest(1)
	for _, ttl := range []int{1, 24, 24} {
		if _, err := b.creerPour(h, 10, ttl); err != nil {
			t.Fatal(ttl, err)
		}
	}
	if n, _ := b.m.SalonsDuCompte(*h); n != 3 {
		t.Fatal("salons vivants :", n)
	}
	if _, err := b.creerPour(h, 10, 24); !palierDepasse(err) {
		t.Fatal("4e salon :", err)
	}
	b.h.avancer(2 * time.Hour) // le salon d'une heure est échu
	if _, err := b.creerPour(h, 10, 24); err != nil {
		t.Fatal("après échéance :", err)
	}
}

// Crochet en erreur (compte banni, supprimé, base illisible) : erreur rendue telle quelle,
// rien d'écrit. Compte donné sans crochet : refus fermé.
func TestPalierCrochet(t *testing.T) {
	p := paliersConfirme
	refus := errors.New("banni")
	var err error = refus
	b := bancCompte(t, &p, &err)
	if _, e := b.creerPour(compteTest(1), 4, 24); !errors.Is(e, refus) {
		t.Fatal("erreur du crochet :", e)
	}
	b.m.cfg.Palier = nil
	if _, e := b.creerPour(compteTest(1), 4, 24); e == nil {
		t.Fatal("compte sans crochet accepté")
	}
	if n := b.lignesSalons(t); n != 0 {
		t.Fatal("lignes :", n)
	}
}

// Réglages : places et renouvellement suivent le palier du compte du salon (lu par la ligne) ;
// un salon sans compte garde SalonPlacesMax.
func TestReglagesSuiventLePalier(t *testing.T) {
	p := paliersConfirme
	b := bancCompte(t, &p, nil)
	c, err := b.creerPour(compteTest(1), 10, 24)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := b.m.Regler(c.gestion, ReglagesReq{Places: 8}, nil); err != nil {
		t.Fatal("confirmé, 8 places :", err)
	}
	p = paliersNeuf // signalé entre-temps : palier neuf
	appels := 0
	avant := func() error { appels++; return nil }
	for _, r := range []ReglagesReq{{Places: 5}, {Heures: 1}, {Places: 10, Heures: 6}} {
		if _, err := b.m.Regler(c.gestion, r, avant); !palierDepasse(err) {
			t.Fatalf("%+v sur un compte neuf : %v", r, err)
		}
	}
	if appels != 0 {
		t.Fatal("preuve et quota consommés pour un refus de palier :", appels)
	}
	if res, err := b.m.Regler(c.gestion, ReglagesReq{Places: 4, Heures: 6}, avant); err != nil || res.MaxMembers != 4 || appels != 1 {
		t.Fatal("4 places et renouvellement :", res, err, appels)
	}
	sans := b.creer(t, 4)
	if _, err := b.m.Regler(sans.gestion, ReglagesReq{Places: SalonPlacesMax}, nil); err != nil {
		t.Fatal("salon sans compte :", err)
	}
}

// Salons vivants du compte : échéance au quart d'heure, places, sièges occupés ; jamais ceux
// d'un autre compte ni un salon échu.
func TestSalonsVivantsDuCompte(t *testing.T) {
	p := paliersConfirme
	b := bancCompte(t, &p, nil)
	h := compteTest(1)
	c, _ := b.creerPour(h, 6, 1)
	b.entrer(t, c, true)
	b.entrer(t, c, false)
	if _, err := b.creerPour(compteTest(2), 4, 24); err != nil {
		t.Fatal(err)
	}
	vs, err := b.m.SalonsVivantsDuCompte(*h)
	if err != nil || len(vs) != 1 {
		t.Fatal(vs, err)
	}
	v := vs[0]
	if v.Places != 6 || v.Sieges != 2 || v.ExpireVers%quart != 0 || v.ExpireVers <= b.h.Now().Unix() || !idValide(v.ID) {
		t.Fatalf("%+v", v)
	}
	b.h.avancer(2 * time.Hour)
	if vs, err := b.m.SalonsVivantsDuCompte(*h); err != nil || len(vs) != 0 {
		t.Fatal("salon échu listé :", vs, err)
	}
}

// Destruction par le compte : seulement un salon vivant de ce compte ; même effet que celle
// du créateur.
func TestDetruireDuCompte(t *testing.T) {
	p := paliersConfirme
	b := bancCompte(t, &p, nil)
	h := compteTest(1)
	c, _ := b.creerPour(h, 4, 24)
	vs, _ := b.m.SalonsVivantsDuCompte(*h)
	if len(vs) != 1 {
		t.Fatal(vs)
	}
	if err := b.m.DetruireDuCompte(*compteTest(2), vs[0].ID); !errors.Is(err, ErrNotFound) {
		t.Fatal("autre compte :", err)
	}
	if err := b.m.DetruireDuCompte(*h, "inconnu"); !errors.Is(err, ErrNotFound) {
		t.Fatal("identifiant inconnu :", err)
	}
	if err := b.m.DetruireDuCompte(*h, vs[0].ID); err != nil {
		t.Fatal(err)
	}
	if _, err := b.m.Meta(c.acces); !errors.Is(err, ErrNotFound) {
		t.Fatal("salon encore vivant :", err)
	}
	if err := b.m.DetruireDuCompte(*h, vs[0].ID); !errors.Is(err, ErrNotFound) {
		t.Fatal("seconde destruction :", err)
	}
}

// Suppression (ou bannissement) d'un compte : tous ses salons fermés, ceux des autres intacts.
func TestFermerDuCompte(t *testing.T) {
	p := paliersConfirme
	b := bancCompte(t, &p, nil)
	h := compteTest(1)
	c1, _ := b.creerPour(h, 4, 24)
	c2, _ := b.creerPour(h, 4, 24)
	autre, _ := b.creerPour(compteTest(2), 4, 24)
	sans := b.creer(t, 4)
	b.entrer(t, c1, true)
	n, err := b.m.FermerDuCompte(*h)
	if err != nil || n != 2 {
		t.Fatal(n, err)
	}
	for _, c := range []cles{c1, c2} {
		if _, err := b.m.Meta(c.acces); !errors.Is(err, ErrNotFound) {
			t.Fatal("salon du compte encore vivant :", err)
		}
	}
	for _, c := range []cles{autre, sans} {
		if _, err := b.m.Meta(c.acces); err != nil {
			t.Fatal("salon d'autrui fermé :", err)
		}
	}
	if n, err := b.m.FermerDuCompte(*h); err != nil || n != 0 {
		t.Fatal("seconde passe :", n, err)
	}
}

// Le lien compte ↔ salon disparaît avec le salon : destruction (ligne rendue morte : colonne
// vidée tout de suite), échéance, fermeture par le compte.
func TestColonneCompteEffaceeAvecLeSalon(t *testing.T) {
	p := paliersConfirme
	b := bancCompte(t, &p, nil)
	h := compteTest(1)
	avecCompte := func() int {
		var n int
		if err := b.db.QueryRow(`SELECT count(*) FROM salons WHERE compte IS NOT NULL`).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}
	c, _ := b.creerPour(h, 4, 24)
	_, g := b.entrerMembre(t, c, true)
	// Fichier d'une pièce qui ne s'efface pas (TestOrdreDeFin) : la ligne du salon reste,
	// morte, jusqu'à la reprise ; sa colonne compte est déjà vide.
	id := b.pretePiece(t, g, 1, false)
	chemin := filepath.Join(b.cfg.Pieces.Dir, id)
	if err := os.Remove(chemin); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(chemin, "x"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := b.m.Detruire(c.gestion, nil); err != nil {
		t.Fatal(err)
	}
	if b.lignes(t, "salons", g.salon.id) != 1 {
		t.Fatal("ligne morte attendue")
	}
	if n := avecCompte(); n != 0 {
		t.Fatal("ligne morte avec compte :", n)
	}
	if err := os.RemoveAll(chemin); err != nil {
		t.Fatal(err)
	}
	b.m.Tick()
	if b.lignesSalons(t) != 0 {
		t.Fatal("ligne gardée après reprise")
	}
	b.creerPour(h, 4, 1)
	b.h.avancer(2 * time.Hour)
	b.m.Tick()
	if n := avecCompte(); n != 0 {
		t.Fatal("après échéance :", n)
	}
	b.creerPour(h, 4, 24)
	if _, err := b.m.FermerDuCompte(*h); err != nil {
		t.Fatal(err)
	}
	b.m.Tick()
	if n := avecCompte(); n != 0 || b.lignesSalons(t) != 0 {
		t.Fatal("après fermeture :", n, b.lignesSalons(t))
	}
}

// Quitter et signaler par catégorie : un compte par catégorie sur le salon vivant, en mémoire ;
// le compte du salon rendu au premier signalement seulement (ancienneté) ; catégorie hors de 1
// à 10 : refus, le membre reste.
func TestSignalementsParCategorie(t *testing.T) {
	p := paliersConfirme
	b := bancCompte(t, &p, nil)
	h := compteTest(1)
	c, _ := b.creerPour(h, 6, 24)
	b.entrer(t, c, true)
	var ms []Membre
	for range 3 {
		_, mb := b.entrerMembre(t, c, false)
		ms = append(ms, mb)
	}
	for _, cat := range []uint8{0, 11, 255} {
		if _, err := b.m.QuitterSignaler(ms[0], cat); !errors.Is(err, ErrBadRequest) {
			t.Fatal(cat, err)
		}
	}
	if len(b.m.Signalements()) != 0 {
		t.Fatal("refus comptés")
	}
	sig, err := b.m.QuitterSignaler(ms[0], 6)
	if err != nil || !sig.Premier || sig.Compte == nil || *sig.Compte != *h {
		t.Fatal("premier :", sig, err)
	}
	for _, mb := range ms[1:] {
		if sig, err := b.m.QuitterSignaler(mb, CategorieAutre); err != nil || sig.Premier || sig.Compte != nil {
			t.Fatal("suivant :", sig, err)
		}
	}
	ss := b.m.Signalements()
	if len(ss) != 1 || !idValide(ss[0].ID) {
		t.Fatal(ss)
	}
	var want [NbCategories]int
	want[5], want[9] = 1, 2
	if ss[0].Categories != want {
		t.Fatalf("catégories : %v", ss[0].Categories)
	}
	// Salon sans compte : premier sans compte.
	sans := b.creer(t, 4)
	b.entrer(t, sans, true)
	_, mb := b.entrerMembre(t, sans, false)
	if sig, err := b.m.QuitterSignaler(mb, 1); err != nil || !sig.Premier || sig.Compte != nil {
		t.Fatal("salon sans compte :", sig, err)
	}
}

// Les signalements d'un salon sont oubliés à sa fin (destruction, échéance) ; un
// renouvellement les garde (le salon continue).
func TestSignalementsDuSalonOubliesALaFin(t *testing.T) {
	b := nouveauBanc(t, 200)
	c := b.creer(t, 6)
	b.entrer(t, c, true)
	_, m1 := b.entrerMembre(t, c, false)
	_, m2 := b.entrerMembre(t, c, false)
	if _, err := b.m.QuitterSignaler(m1, 4); err != nil {
		t.Fatal(err)
	}
	if _, err := b.m.Regler(c.gestion, ReglagesReq{Heures: 1}, nil); err != nil {
		t.Fatal(err)
	}
	if ss := b.m.Signalements(); len(ss) != 1 || ss[0].Categories[3] != 1 {
		t.Fatal("après renouvellement :", ss)
	}
	s := b.etat(t, c)
	if err := b.m.Detruire(c.gestion, nil); err != nil {
		t.Fatal(err)
	}
	if ss := b.m.Signalements(); len(ss) != 0 {
		t.Fatal("après destruction :", ss)
	}
	s.mu.Lock()
	reste := s.signalements
	s.mu.Unlock()
	if reste != ([NbCategories]int{}) {
		t.Fatal("tombe : catégories gardées", reste)
	}
	if _, err := b.m.QuitterSignaler(m2, 4); !errors.Is(err, ErrNotFound) {
		t.Fatal("salon détruit :", err)
	}

	c2 := b.creer(t, 4)
	b.entrer(t, c2, true)
	_, m3 := b.entrerMembre(t, c2, false)
	if _, err := b.m.QuitterSignaler(m3, 2); err != nil {
		t.Fatal(err)
	}
	b.h.avancer(25 * time.Hour)
	b.m.Tick()
	if ss := b.m.Signalements(); len(ss) != 0 {
		t.Fatal("après échéance :", ss)
	}
}

// « Détruire et signaler » d'un salon : le compte du salon est rendu au premier signalement.
func TestDetruireSignalerRendLeCompte(t *testing.T) {
	p := paliersConfirme
	b := bancCompte(t, &p, nil)
	h := compteTest(1)
	c, _ := b.creerPour(h, 4, 24)
	b.entrer(t, c, true)
	sig, err := b.m.DetruireSignaler(c.gestion, nil)
	if err != nil || !sig.Premier || sig.Compte == nil || *sig.Compte != *h {
		t.Fatal(sig, err)
	}
}

// lignesSalons : lignes de la table salons.
func (b *banc) lignesSalons(t *testing.T) int {
	t.Helper()
	var n int
	if err := b.db.QueryRow(`SELECT count(*) FROM salons`).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}
