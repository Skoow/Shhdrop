package compte

import (
	"errors"
	"testing"
	"time"
)

// Lot 6 du plan du compte : palier et bannissement à la création d'un salon, ancienneté remise
// à zéro par un signalement, salons du compte désignés par des ref éphémères.

// Palier : neuf (1 salon, 4 places, 24 h) puis confirmé 7 jours pleins après compte_des ;
// adresse bannie (bannissement actif non échu) : ErrBanni ; compte inconnu : ErrSession.
func TestPalierDuCompte(t *testing.T) {
	b := nouveauBanc(t)
	h, _, _ := b.inscrire(t, ipA, "lea@exemple.fr", "lea")
	if l, err := b.s.Palier(h); err != nil || l != limitesNeuf {
		t.Fatal("neuf :", l, err)
	}
	b.clk.Add(7 * 24 * time.Hour)
	if l, err := b.s.Palier(h); err != nil || l != limitesConfirme {
		t.Fatal("confirmé :", l, err)
	}
	if _, err := b.s.Palier([16]byte{1}); !errors.Is(err, ErrSession) {
		t.Fatal("compte inconnu :", err)
	}
	var canon []byte
	if err := b.db.QueryRow(`SELECT e_canon FROM comptes WHERE h=?`, h[:]).Scan(&canon); err != nil {
		t.Fatal(err)
	}
	j := jourDe(b.clk.Now())
	if _, err := b.db.Exec(`INSERT INTO bannis VALUES(?,?,?,?,1,8,0)`, alea8(), canon, j, j+30*jourS); err != nil {
		t.Fatal(err)
	}
	var bn ErrBanni
	if _, err := b.s.Palier(h); !errors.As(err, &bn) || bn.Jusqu != dateJour(j+30*jourS) {
		t.Fatal("banni :", err)
	}
	// Suspendu : plus d'effet.
	if _, err := b.db.Exec(`UPDATE bannis SET actif=0`); err != nil {
		t.Fatal(err)
	}
	if _, err := b.s.Palier(h); err != nil {
		t.Fatal("suspendu :", err)
	}
}

// Un signalement d'un salon du compte remet son ancienneté au jour même (conception §11).
func TestSignalementRemetAZero(t *testing.T) {
	b := nouveauBanc(t)
	h, _, d := b.inscrire(t, ipA, "lea@exemple.fr", "lea")
	b.clk.Add(10 * 24 * time.Hour)
	if l, _ := b.s.Palier(h); l != limitesConfirme {
		t.Fatal("confirmé attendu")
	}
	if err := b.s.Signale(h); err != nil {
		t.Fatal(err)
	}
	if l, _ := b.s.Palier(h); l != limitesNeuf {
		t.Fatal("neuf attendu après le signalement")
	}
	o, err := b.s.Connexion(ipA, "lea@exemple.fr", d.AAuth, OptionsSession{}, false)
	if err != nil {
		t.Fatal(err)
	}
	et, err := b.s.Etat(b.session(t, o.Jeton))
	if err != nil || et.Palier != "neuf" || et.ConfirmeLe != dateJour(jourDe(b.clk.Now())+7*jourS) {
		t.Fatal(et, err)
	}
	var des int64
	if err := b.db.QueryRow(`SELECT compte_des FROM comptes WHERE h=?`, h[:]).Scan(&des); err != nil || des%jourS != 0 {
		t.Fatal("compte_des au jour :", des, err)
	}
	// Compte supprimé entre-temps : rien à faire, pas d'erreur.
	if err := b.s.Signale([16]byte{9}); err != nil {
		t.Fatal(err)
	}
}

// fauxSalons : crochets du salon pour les tests du compte.
type fauxSalons struct {
	vivants  map[[16]byte][]SalonVivant
	detruits []string
}

func (f *fauxSalons) brancher(s *Service) {
	s.salonsVivants = func(h [16]byte) ([]SalonVivant, error) { return f.vivants[h], nil }
	s.detruireSalon = func(h [16]byte, id string) error {
		for _, v := range f.vivants[h] {
			if v.ID == id {
				f.detruits = append(f.detruits, id)
				return nil
			}
		}
		return ErrEtape
	}
}

// Salons du compte : une ref aléatoire de 16 octets par salon, en mémoire, la même pendant ses
// 10 min (deux appareils du compte s'accordent), jamais l'identifiant du salon.
func TestSalonsListe(t *testing.T) {
	b := nouveauBanc(t)
	h, j, _ := b.inscrire(t, ipA, "lea@exemple.fr", "lea")
	f := &fauxSalons{vivants: map[[16]byte][]SalonVivant{h: {{ID: "salon-a", ExpireVers: 1800, Places: 4, Sieges: 2},
		{ID: "salon-b", ExpireVers: 2700, Places: 3, Sieges: 0}}}}
	f.brancher(b.s)
	c := b.session(t, j)
	l1, err := b.s.SalonsListe(c)
	if err != nil || len(l1) != 2 || l1[0].Ref == l1[1].Ref || l1[0].Ref == [16]byte{} {
		t.Fatal(l1, err)
	}
	if l1[0].ExpireVers != 1800 || l1[0].Places != 4 || l1[0].Sieges != 2 {
		t.Fatalf("%+v", l1[0])
	}
	b.clk.Add(5 * time.Minute)
	l2, _ := b.s.SalonsListe(c)
	if len(l2) != 2 || l2[0].Ref != l1[0].Ref || l2[1].Ref != l1[1].Ref {
		t.Fatal("ref changée avant 10 min :", l1, l2)
	}
	b.clk.Add(6 * time.Minute)
	l3, _ := b.s.SalonsListe(c)
	if len(l3) != 2 || l3[0].Ref == l1[0].Ref {
		t.Fatal("ref gardée après 10 min :", l3)
	}
	// Sans crochet (salon désactivé) : liste vide.
	b.s.salonsVivants = nil
	if l, err := b.s.SalonsListe(c); err != nil || len(l) != 0 {
		t.Fatal(l, err)
	}
}

// Une ref expire 10 min après sa création ; elle ne sert qu'au compte qui l'a reçue ; une ref
// inconnue, échue ou d'un autre compte : la même réponse (ErrEtape, 404).
func TestRefExpire10Min(t *testing.T) {
	b := nouveauBanc(t)
	h, j, _ := b.inscrire(t, ipA, "lea@exemple.fr", "lea")
	f := &fauxSalons{vivants: map[[16]byte][]SalonVivant{h: {{ID: "salon-a", Places: 4}, {ID: "salon-b", Places: 4}}}}
	f.brancher(b.s)
	c := b.session(t, j)
	l, _ := b.s.SalonsListe(c)
	b.clk.Add(10*time.Minute - time.Second)
	if err := b.s.DetruireParRef(c, l[0].Ref); err != nil || len(f.detruits) != 1 || f.detruits[0] != "salon-a" {
		t.Fatal(err, f.detruits)
	}
	if err := b.s.DetruireParRef(c, l[0].Ref); !errors.Is(err, ErrEtape) {
		t.Fatal("ref déjà servie :", err)
	}
	b.clk.Add(time.Second)
	if err := b.s.DetruireParRef(c, l[1].Ref); !errors.Is(err, ErrEtape) || len(f.detruits) != 1 {
		t.Fatal("ref échue :", err)
	}
	if err := b.s.DetruireParRef(c, [16]byte{1}); !errors.Is(err, ErrEtape) {
		t.Fatal("ref inconnue :", err)
	}
}

func TestRefDUnAutreCompteRefusee(t *testing.T) {
	b := nouveauBanc(t)
	h, j, _ := b.inscrire(t, ipA, "lea@exemple.fr", "lea")
	_, j2, _ := b.inscrire(t, ipN(1), "leo@exemple.fr", "leo")
	f := &fauxSalons{vivants: map[[16]byte][]SalonVivant{h: {{ID: "salon-a", Places: 4}}}}
	f.brancher(b.s)
	l, _ := b.s.SalonsListe(b.session(t, j))
	if err := b.s.DetruireParRef(b.session(t, j2), l[0].Ref); !errors.Is(err, ErrEtape) || len(f.detruits) != 0 {
		t.Fatal(err, f.detruits)
	}
	if err := b.s.DetruireParRef(b.session(t, j), l[0].Ref); err != nil || len(f.detruits) != 1 {
		t.Fatal(err, f.detruits)
	}
}

// Salon déjà fini quand la ref sert : ErrEtape (404), comme une ref inconnue.
func TestRefSalonFini(t *testing.T) {
	b := nouveauBanc(t)
	h, j, _ := b.inscrire(t, ipA, "lea@exemple.fr", "lea")
	f := &fauxSalons{vivants: map[[16]byte][]SalonVivant{h: {{ID: "salon-a", Places: 4}}}}
	f.brancher(b.s)
	c := b.session(t, j)
	l, _ := b.s.SalonsListe(c)
	f.vivants = nil
	if err := b.s.DetruireParRef(c, l[0].Ref); !errors.Is(err, ErrEtape) {
		t.Fatal(err)
	}
}

// Suppression : les salons sont fermés une seconde fois une fois le compte effacé (une création
// commencée avant l'effacement, finie après la première passe, ne survit pas), et le nombre
// rendu les compte tous.
func TestSuppressionDeuxPasses(t *testing.T) {
	b := nouveauBanc(t)
	h, j, _ := b.inscrire(t, ipA, "lea@exemple.fr", "lea")
	var passes []bool
	b.s.fermerSalons = func(x [16]byte) (int, error) {
		if x != h {
			t.Error("autre compte")
		}
		var un int
		existe := b.db.QueryRow(`SELECT 1 FROM comptes WHERE h=?`, h[:]).Scan(&un) == nil
		passes = append(passes, existe)
		if existe {
			return 2, nil
		}
		return 1, nil
	}
	b.clk.Add(time.Minute)
	n, err := b.s.Supprimer(b.session(t, j))
	if err != nil || n != 3 || len(passes) != 2 || !passes[0] || passes[1] {
		t.Fatal(n, err, passes)
	}
}
