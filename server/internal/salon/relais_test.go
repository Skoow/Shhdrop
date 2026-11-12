package salon

import (
	"bytes"
	"encoding/binary"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"sync"
	"sync/atomic"
	"testing"
	"time"
	"unsafe"
)

// Relais et stockage des trames (plan C-2 Task 8).

// trameD : trame de test d'octet drapeaux d (bit 0 volatile, bits 1–2 règle).
func trameD(d byte, i int) []byte {
	t := trameTest(i)
	t[len(marque)] = d
	return t
}

const (
	dVolatile   = 0b001
	dInstantane = byte(Instantane) << 1
)

// membreDe : Membre du jeton reçu à l'entrée.
func (b *banc) membreDe(t *testing.T, e Entree) Membre {
	t.Helper()
	mb, err := b.m.Membre(e.Jeton[:])
	if err != nil {
		t.Fatal(err)
	}
	return mb
}

// entrerMembre : entrée puis Membre.
func (b *banc) entrerMembre(t *testing.T, c cles, createur bool) (Entree, Membre) {
	t.Helper()
	e := b.entrer(t, c, createur)
	return e, b.membreDe(t, e)
}

func (b *banc) recevoir(t *testing.T, mb Membre, trame []byte) uint64 {
	t.Helper()
	seq, err := b.m.Recevoir(mb, trame, nil)
	if err != nil {
		t.Fatal(err)
	}
	return seq
}

// enr : enregistrement décodé (type, seq) ; pour 0x01 : siège, heure et trame.
type enrLu struct {
	ty     byte
	seq    uint64
	siege  uint8
	recuMs int64
	trame  []byte
}

func lireEnr(t *testing.T, r []byte) enrLu {
	t.Helper()
	if len(r) < 10 {
		t.Fatalf("enregistrement trop court : %d", len(r))
	}
	e := enrLu{ty: r[0], seq: binary.BigEndian.Uint64(r[1:9]), siege: r[9]}
	if e.ty == 0x01 {
		if len(r) != 9+1+8+TailleTrame {
			t.Fatalf("0x01 de %d octets", len(r))
		}
		e.recuMs = int64(binary.BigEndian.Uint64(r[10:18]))
		e.trame = r[18:]
	}
	return e
}

func lireSuite(t *testing.T, s *salon, apres uint64, max int) []enrLu {
	t.Helper()
	var l []enrLu
	for _, r := range s.suite(apres, max) {
		l = append(l, lireEnr(t, r))
	}
	return l
}

func dernierSeq(s *salon) uint64 {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.seq
}

// 300 trames de 3 sièges en parallèle, volatiles mêlées : 300 rangs consécutifs, sans trou ni
// doublon ; la suite sert chaque trame non volatile une fois, dans l'ordre, avec son siège.
func TestSeqStrictementCroissant(t *testing.T) {
	b := nouveauBanc(t, 200)
	c := b.creer(t, 3)
	var mbs [3]Membre
	_, mbs[0] = b.entrerMembre(t, c, true)
	_, mbs[1] = b.entrerMembre(t, c, false)
	_, mbs[2] = b.entrerMembre(t, c, false)
	s := mbs[0].salon
	depart := dernierSeq(s)
	type envoi struct {
		seq      uint64
		siege    uint8
		volatile bool
		trame    []byte
	}
	var mu sync.Mutex
	var envois []envoi
	var wg sync.WaitGroup
	for i, mb := range mbs {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for k := 0; k < 100; k++ {
				var d byte
				if k%3 == 0 {
					d = dVolatile
				}
				tr := trameD(d, i*1000+k)
				seq, err := b.m.Recevoir(mb, tr, nil)
				if err != nil {
					t.Error(err)
					return
				}
				mu.Lock()
				envois = append(envois, envoi{seq, mb.siege, d == dVolatile, tr})
				mu.Unlock()
			}
		}()
	}
	wg.Wait()
	if len(envois) != 300 {
		t.Fatal("envois", len(envois))
	}
	sort.Slice(envois, func(i, j int) bool { return envois[i].seq < envois[j].seq })
	for i, e := range envois {
		if e.seq != depart+uint64(i)+1 {
			t.Fatalf("rang %d : %d, attendu %d (trou ou doublon)", i, e.seq, depart+uint64(i)+1)
		}
	}
	if dernierSeq(s) != depart+300 {
		t.Fatal("dernier rang", dernierSeq(s))
	}
	var attendus []envoi
	for _, e := range envois {
		if !e.volatile {
			attendus = append(attendus, e)
		}
	}
	l := lireSuite(t, s, depart, 1000)
	if len(l) != len(attendus) || len(attendus) != 3*66 { // k % 3 == 0 : 34 volatiles sur 100 par siège
		t.Fatal("suite", len(l), len(attendus))
	}
	for i, e := range l {
		a := attendus[i]
		if e.ty != 0x01 || e.seq != a.seq || e.siege != a.siege || !bytes.Equal(e.trame, a.trame) {
			t.Fatalf("suite[%d] : type %x rang %d siège %d", i, e.ty, e.seq, e.siege)
		}
	}
}

// Volatiles : rien d'écrit ni d'indexé, rangs consommés.
func TestVolatileNonEcrite(t *testing.T) {
	b := nouveauBanc(t, 200)
	c := b.creer(t, 2)
	_, mb := b.entrerMembre(t, c, true)
	s := mb.salon
	avant := dernierSeq(s)
	for i := 0; i < 10; i++ {
		for _, regle := range []byte{0, dInstantane} {
			if seq := b.recevoir(t, mb, trameD(dVolatile|regle, i)); seq <= avant {
				t.Fatal("rang", seq)
			}
		}
	}
	if dernierSeq(s) != avant+20 {
		t.Fatal("rangs non consommés", dernierSeq(s)-avant)
	}
	fi, err := os.Stat(filepath.Join(b.cfg.DossierConversations, b.idDe(t, c)))
	if err != nil || fi.Size() != 0 {
		t.Fatal("fichier de conversation", fi, err)
	}
	s.mu.Lock()
	n := len(s.index)
	s.mu.Unlock()
	if n != 0 || len(lireSuite(t, s, avant, 100)) != 0 {
		t.Fatal("volatile indexée ou servie", n)
	}
}

// L'heure de réception est celle du serveur (Now, en ms), jamais lue dans la trame ; elle
// n'est écrite nulle part sur disque.
func TestHeureDeReception(t *testing.T) {
	b := nouveauBanc(t, 200)
	c := b.creer(t, 2)
	_, mb := b.entrerMembre(t, c, true)
	b.h.avancer(123*time.Millisecond + 456*time.Microsecond)
	attendu := b.h.Now().UnixMilli()
	tr := trameD(0, 1)
	// La trame porte une autre heure, plausible, juste après la marque.
	leurre := attendu - 3_600_000
	binary.BigEndian.PutUint64(tr[5:13], uint64(leurre))
	seq := b.recevoir(t, mb, tr)
	b.h.avancer(time.Second)
	l := lireSuite(t, mb.salon, seq-1, 10)
	if len(l) != 1 || l[0].recuMs != attendu || l[0].seq != seq || !bytes.Equal(l[0].trame, tr) {
		t.Fatalf("heure %d, attendu %d (leurre %d)", l[0].recuMs, attendu, leurre)
	}
	var heure [8]byte
	binary.BigEndian.PutUint64(heure[:], uint64(attendu))
	lus := 0
	filepath.WalkDir(b.dir, func(p string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return err
		}
		f, err := os.ReadFile(p)
		if err != nil {
			t.Fatal(err)
		}
		lus++
		if bytes.Contains(f, heure[:]) {
			t.Errorf("%s contient l'heure de réception", filepath.Base(p))
		}
		if bytes.Contains(f, tr[13:77]) {
			t.Errorf("%s contient la trame en clair", filepath.Base(p))
		}
		return nil
	})
	if lus < 2 { // base et fichier de conversation au moins
		t.Fatal("fichiers lus", lus)
	}
}

// Seul l'auteur (le titulaire du siège qui a posté la trame) la retire ; volatile, rang
// inconnu ou trame d'un ancien titulaire du siège : sans effet ni erreur.
func TestRetirerParAuteurSeul(t *testing.T) {
	b := nouveauBanc(t, 200)
	c := b.creer(t, 3)
	_, a := b.entrerMembre(t, c, false)
	_, bb := b.entrerMembre(t, c, false)
	s := a.salon
	x := b.recevoir(t, a, trameD(0, 1))
	vol := b.recevoir(t, a, trameD(dVolatile, 2))
	servie := func(seq uint64) bool {
		for _, e := range lireSuite(t, s, 0, 1000) {
			if e.ty == 0x01 && e.seq == seq {
				return true
			}
		}
		return false
	}
	if err := b.m.Retirer(bb, x); err != nil {
		t.Fatal(err)
	}
	if !servie(x) {
		t.Fatal("retirée par un autre siège")
	}
	for _, seq := range []uint64{vol, 0, 999999} {
		if err := b.m.Retirer(a, seq); err != nil {
			t.Fatal(seq, err)
		}
	}
	s.mu.Lock()
	emplacementX := s.index[0].emplacement
	s.mu.Unlock()
	if err := b.m.Retirer(a, x); err != nil {
		t.Fatal(err)
	}
	if servie(x) {
		t.Fatal("trame retirée encore servie")
	}
	s.mu.Lock()
	e := s.index[0]
	s.mu.Unlock()
	if !e.efface() || e.seq != x {
		t.Fatal("entrée", e)
	}
	if _, err := s.conv.Lire(emplacementX); !errors.Is(err, ErrEfface) {
		t.Fatal("emplacement non écrasé :", err)
	}
	// Retirer deux fois : sans effet.
	if err := b.m.Retirer(a, x); err != nil {
		t.Fatal(err)
	}
	// Le siège de a passe à quelqu'un d'autre : sa trame reste à a.
	y := b.recevoir(t, a, trameD(0, 3))
	if err := b.m.Quitter(a); err != nil {
		t.Fatal(err)
	}
	_, nouveau := b.entrerMembre(t, c, false)
	if nouveau.siege != a.siege {
		t.Fatal("siège non réattribué", nouveau.siege, a.siege)
	}
	if err := b.m.Retirer(nouveau, y); err != nil {
		t.Fatal(err)
	}
	if !servie(y) {
		t.Fatal("trame d'un ancien titulaire retirée par le nouveau")
	}
	// Ancien titulaire : plus membre.
	if err := b.m.Retirer(a, y); !errors.Is(err, ErrNotFound) {
		t.Fatal("ancien jeton :", err)
	}
}

// Trames et annonces 0x02, 0x03, 0x0A intercalées : suite dans l'ordre seq exact, sans les
// volatiles ; apres et max respectés.
func TestSuiteFusionnee(t *testing.T) {
	b := nouveauBanc(t, 200)
	c := b.creer(t, 4)
	type att struct {
		ty  byte
		seq uint64
	}
	var attendu []att
	e0, g := b.entrerMembre(t, c, true)
	attendu = append(attendu, att{0x02, e0.Seq})
	ea, a := b.entrerMembre(t, c, false)
	attendu = append(attendu, att{0x02, ea.Seq})
	attendu = append(attendu, att{0x01, b.recevoir(t, a, trameD(0, 1))})
	b.recevoir(t, g, trameD(dVolatile, 2))
	e0b, g := b.entrerMembre(t, c, true) // reprise du créateur
	attendu = append(attendu, att{0x0A, e0b.Seq})
	attendu = append(attendu, att{0x01, b.recevoir(t, g, trameD(dInstantane, 3))})
	eb, bb := b.entrerMembre(t, c, false)
	attendu = append(attendu, att{0x02, eb.Seq})
	attendu = append(attendu, att{0x01, b.recevoir(t, bb, trameD(byte(UneHeure)<<1, 4))})
	b.recevoir(t, a, trameD(dVolatile, 5))
	if err := b.m.Quitter(a); err != nil {
		t.Fatal(err)
	}
	s := g.salon
	attendu = append(attendu, att{0x03, dernierSeq(s)})
	attendu = append(attendu, att{0x01, b.recevoir(t, g, trameD(0, 6))})

	var lu []att
	for _, e := range lireSuite(t, s, 0, 1000) {
		lu = append(lu, att{e.ty, e.seq})
	}
	if !reflect.DeepEqual(lu, attendu) {
		t.Fatalf("suite :\n%v\nattendu :\n%v", lu, attendu)
	}
	// apres = rang de la 1ʳᵉ trame : tout ce qui suit ; max = 2 : les deux suivants.
	lu = nil
	for _, e := range lireSuite(t, s, attendu[2].seq, 1000) {
		lu = append(lu, att{e.ty, e.seq})
	}
	if !reflect.DeepEqual(lu, attendu[3:]) {
		t.Fatalf("suite après %d : %v", attendu[2].seq, lu)
	}
	lu = nil
	for _, e := range lireSuite(t, s, attendu[2].seq, 2) {
		lu = append(lu, att{e.ty, e.seq})
	}
	if !reflect.DeepEqual(lu, attendu[3:5]) {
		t.Fatalf("suite bornée : %v", lu)
	}
	if l := lireSuite(t, s, dernierSeq(s), 1000); len(l) != 0 {
		t.Fatal("suite après le dernier rang", len(l))
	}
	if l := lireSuite(t, s, 0, 0); len(l) != 0 {
		t.Fatal("max = 0", len(l))
	}
}

// etatAu : sièges et nonces exacts à chaque rang (arrivées, départ, reprise).
func TestEtatAu(t *testing.T) {
	b := nouveauBanc(t, 200)
	c := b.creer(t, 4)
	e0, g := b.entrerMembre(t, c, true)
	ea, a := b.entrerMembre(t, c, false)
	tr := b.recevoir(t, a, trameD(0, 1))
	eb, _ := b.entrerMembre(t, c, false)
	if err := b.m.Quitter(a); err != nil {
		t.Fatal(err)
	}
	s := g.salon
	depA := dernierSeq(s)
	e0b := b.entrer(t, c, true) // reprise : nouveau nonce
	if e0b.Nonce == e0.Nonce {
		t.Fatal("même nonce après reprise")
	}
	an := func(n uint8, nonce [16]byte) Annonce { return Annonce{Siege: n, Nonce: nonce} }
	cas := []struct {
		seq  uint64
		want []Annonce
	}{
		{0, nil},
		{e0.Seq, []Annonce{an(0, e0.Nonce)}},
		{ea.Seq, []Annonce{an(0, e0.Nonce), an(1, ea.Nonce)}},
		{tr, []Annonce{an(0, e0.Nonce), an(1, ea.Nonce)}},
		{eb.Seq, []Annonce{an(0, e0.Nonce), an(1, ea.Nonce), an(2, eb.Nonce)}},
		{depA, []Annonce{an(0, e0.Nonce), an(2, eb.Nonce)}},
		{e0b.Seq, []Annonce{an(0, e0b.Nonce), an(2, eb.Nonce)}},
		{e0b.Seq + 1000, []Annonce{an(0, e0b.Nonce), an(2, eb.Nonce)}},
	}
	for _, k := range cas {
		if got := s.etatAu(k.seq); !reflect.DeepEqual(got, k.want) {
			t.Errorf("etatAu(%d) = %v, attendu %v", k.seq, got, k.want)
		}
	}
}

// Exigence 4 (plan, point 9) : la trame de contrôle d'un arrivant (son KeyPackage, non
// volatile) reste servie au rattrapage d'un membre qui revient 30 min plus tard.
func TestKeyPackageGardePourLeRattrapage(t *testing.T) {
	b := nouveauBanc(t, 200)
	c := b.creer(t, 3)
	eg, g := b.entrerMembre(t, c, true)
	s := g.salon
	s.mu.Lock()
	s.sieges[g.siege].horsLigneDepuis = time.Time{} // WebSocket ouvert (Task 9)
	s.mu.Unlock()
	vu := dernierSeq(s) // dernier rang reçu par le créateur avant la coupure
	_, arrivant := b.entrerMembre(t, c, false)
	kp := trameD(0, 42) // en-tête de contrôle : non volatile, règle « désactivé »
	seq := b.recevoir(t, arrivant, kp)
	b.h.avancer(30 * time.Minute)
	b.m.Tick() // libère l'arrivant (hors ligne depuis 30 min), pas le créateur
	if _, err := b.m.Membre(eg.Jeton[:]); err != nil {
		t.Fatal("créateur libéré :", err)
	}
	trouve := false
	for _, e := range lireSuite(t, s, vu, 1000) {
		if e.ty == 0x01 && e.seq == seq {
			trouve = e.siege == arrivant.siege && bytes.Equal(e.trame, kp)
		}
	}
	if !trouve {
		t.Fatal("KeyPackage absent du rattrapage")
	}
}

// En-tête invalide, pièce (jusqu'à la Task 13) : ErrBadRequest, rang non consommé, rien écrit.
// Membre périmé : ErrNotFound.
func TestEnTeteRefuse(t *testing.T) {
	b := nouveauBanc(t, 200)
	c := b.creer(t, 2)
	_, mb := b.entrerMembre(t, c, true)
	s := mb.salon
	avant := dernierSeq(s)
	marqueFausse := trameD(0, 1)
	marqueFausse[3] = '2'
	piece := [16]byte{1}
	for nom, f := range map[string]func() error{
		"bit réservé": func() error { _, err := b.m.Recevoir(mb, trameD(0b1000, 1), nil); return err },
		"bit 7":       func() error { _, err := b.m.Recevoir(mb, trameD(0x80, 1), nil); return err },
		"marque":      func() error { _, err := b.m.Recevoir(mb, marqueFausse, nil); return err },
		"4 139":       func() error { _, err := b.m.Recevoir(mb, trameD(0, 1)[:TailleTrame-1], nil); return err },
		"4 141":       func() error { _, err := b.m.Recevoir(mb, append(trameD(0, 1), 0), nil); return err },
		"vide":        func() error { _, err := b.m.Recevoir(mb, nil, nil); return err },
		"pièce":       func() error { _, err := b.m.Recevoir(mb, trameD(0, 1), &piece); return err },
	} {
		if err := f(); !errors.Is(err, ErrBadRequest) {
			t.Errorf("%s : %v", nom, err)
		}
	}
	if dernierSeq(s) != avant || s.conv.Taille() != 0 {
		t.Fatal("rang consommé ou trame écrite", dernierSeq(s)-avant, s.conv.Taille())
	}
	// Membre vide, ou remplacé par une reprise : introuvable.
	if _, err := b.m.Recevoir(Membre{}, trameD(0, 1), nil); !errors.Is(err, ErrNotFound) {
		t.Fatal("Membre vide :", err)
	}
	for _, f := range []func(Membre) error{
		func(m Membre) error { return b.m.Retirer(m, 1) },
		func(m Membre) error { return b.m.Quitter(m) },
	} {
		if err := f(Membre{}); !errors.Is(err, ErrNotFound) {
			t.Fatal("Membre vide :", err)
		}
	}
	b.entrer(t, c, true)
	if _, err := b.m.Recevoir(mb, trameD(0, 1), nil); !errors.Is(err, ErrNotFound) {
		t.Fatal("Membre remplacé :", err)
	}
	// Salon échu : introuvable.
	_, mb = b.entrerMembre(t, c, true)
	b.h.avancer(25 * time.Hour)
	if _, err := b.m.Recevoir(mb, trameD(0, 1), nil); !errors.Is(err, ErrNotFound) {
		t.Fatal("salon échu :", err)
	}
}

// « Instantané » : lecteurs attendus = sièges occupés à la réception, moins l'expéditeur ;
// autres règles : 0.
func TestAttendus(t *testing.T) {
	b := nouveauBanc(t, 200)
	c := b.creer(t, 4)
	_, g := b.entrerMembre(t, c, true)
	b.entrerMembre(t, c, false)
	b.entrerMembre(t, c, false)
	s := g.salon
	b.recevoir(t, g, trameD(dInstantane, 1))
	b.recevoir(t, g, trameD(byte(DixMinutes)<<1, 2))
	b.recevoir(t, g, trameD(0, 3))
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(s.index) != 3 || s.index[0].attendus != 2 || s.index[1].attendus != 0 || s.index[2].attendus != 0 {
		t.Fatal("attendus", s.index)
	}
	if s.index[0].drapeaux != dInstantane || s.index[1].drapeaux != byte(DixMinutes)<<1 || s.index[0].siege != 0 {
		t.Fatal("drapeaux ou siège", s.index)
	}
}

// Quitter : 0x03 au journal, jeton oublié, siège libéré ; un second Quitter → ErrNotFound.
func TestQuitter(t *testing.T) {
	b := nouveauBanc(t, 200)
	c := b.creer(t, 3)
	b.entrerMembre(t, c, true)
	e, a := b.entrerMembre(t, c, false)
	s := a.salon
	if err := b.m.Quitter(a); err != nil {
		t.Fatal(err)
	}
	s.mu.Lock()
	dernier := s.journal[len(s.journal)-1]
	libre := s.sieges[a.siege] == nil
	s.mu.Unlock()
	if !bytes.Equal(dernier.enr, EnrDepart(dernier.seq, a.siege)) || !libre {
		t.Fatal("départ", dernier, libre)
	}
	if _, err := b.m.Membre(e.Jeton[:]); !errors.Is(err, ErrNotFound) {
		t.Fatal("jeton après Quitter :", err)
	}
	if err := b.m.Quitter(a); !errors.Is(err, ErrNotFound) {
		t.Fatal("second Quitter :", err)
	}
	invariantJournal(t, s)
}

// Journal borné : les reprises s'arrêtent sur ErrLimit avant que le journal ne dépasse
// journalMax (4 096) ; les trames (hors journal) et un départ passent encore.
func TestJournalBorne(t *testing.T) {
	b := nouveauBanc(t, 200)
	c := b.creer(t, 3)
	_, a := b.entrerMembre(t, c, false)
	s := a.salon
	var err error
	n := 0
	for ; n <= journalMax; n++ {
		if _, err = b.m.Rejoindre(c.acces, c.preuve, c.gestion); err != nil {
			break
		}
		invariantJournal(t, s)
	}
	if !errors.Is(err, ErrLimit) {
		t.Fatal("reprises :", n, err)
	}
	s.mu.Lock()
	lj := len(s.journal)
	s.mu.Unlock()
	if lj > journalMax || lj != journalMax-nbSieges {
		t.Fatal("journal", lj)
	}
	if _, err := b.m.Recevoir(a, trameD(0, 1), nil); err != nil {
		t.Fatal("trame, journal plein :", err)
	}
	if err := b.m.Quitter(a); err != nil {
		t.Fatal("départ, journal plein :", err)
	}
	invariantJournal(t, s)
}

// Salon détruit : index vidé, plus rien reçu.
func TestRecevoirApresDestruction(t *testing.T) {
	b := nouveauBanc(t, 200)
	c := b.creer(t, 2)
	_, mb := b.entrerMembre(t, c, true)
	b.recevoir(t, mb, trameD(0, 1))
	if err := b.m.detruire(b.idDe(t, c)); err != nil {
		t.Fatal(err)
	}
	if _, err := b.m.Recevoir(mb, trameD(0, 2), nil); !errors.Is(err, ErrNotFound) {
		t.Fatal(err)
	}
	mb.salon.mu.Lock()
	n := len(mb.salon.index)
	mb.salon.mu.Unlock()
	if n != 0 || len(lireSuite(t, mb.salon, 0, 100)) != 0 {
		t.Fatal("index gardé après destruction", n)
	}
}

// Décision du propriétaire (12 novembre) : « supprimer pour tout le monde » survit à une
// reprise. La borne est le rang d'arrivée (0x02) de l'occupant du siège, gardé par 0x0A ;
// au siège 0 (toujours le créateur), tout depuis la création.
func TestRetirerApresReprise(t *testing.T) {
	b := nouveauBanc(t, 200)
	c := b.creer(t, 3)
	_, g := b.entrerMembre(t, c, true)
	_, a := b.entrerMembre(t, c, false)
	s := a.salon
	servie := func(seq uint64) bool {
		for _, e := range lireSuite(t, s, 0, 1000) {
			if e.ty == 0x01 && e.seq == seq {
				return true
			}
		}
		return false
	}
	// Invité : reprise (0x0A, nouveau jeton) simulée comme la fera la Task 9.
	xa := b.recevoir(t, a, trameD(0, 1))
	s.mu.Lock()
	jeton, x, err := s.installerLocked(a.siege, true, b.h.Now())
	s.mu.Unlock()
	if err != nil || x.emis <= xa {
		t.Fatal("reprise", err)
	}
	s.mu.Lock()
	b.m.idxMu.Lock()
	b.m.index[x.jetonV] = s
	b.m.idxMu.Unlock()
	s.mu.Unlock()
	a2, err := b.m.Membre(jeton[:])
	if err != nil {
		t.Fatal(err)
	}
	if err := b.m.Retirer(a2, xa); err != nil || servie(xa) {
		t.Fatal("invité, trame d'avant sa reprise non retirée :", err)
	}
	// Créateur : reprise par Rejoindre, puis siège 0 libéré et repris par une arrivée (0x02).
	x0 := b.recevoir(t, g, trameD(0, 2))
	y0 := b.recevoir(t, g, trameD(0, 3))
	_, g2 := b.entrerMembre(t, c, true)
	if err := b.m.Retirer(g2, x0); err != nil || servie(x0) {
		t.Fatal("créateur, trame d'avant sa reprise non retirée :", err)
	}
	if err := b.m.Quitter(g2); err != nil {
		t.Fatal(err)
	}
	_, g3 := b.entrerMembre(t, c, true)
	if err := b.m.Retirer(g3, y0); err != nil || servie(y0) {
		t.Fatal("créateur, trame d'avant sa nouvelle arrivée non retirée :", err)
	}
	// Siège invité libéré puis réattribué : le nouvel occupant ne retire pas.
	z := b.recevoir(t, a2, trameD(0, 4))
	if err := b.m.Quitter(a2); err != nil {
		t.Fatal(err)
	}
	_, n := b.entrerMembre(t, c, false)
	if n.siege != a.siege {
		t.Fatal("siège non réattribué")
	}
	if err := b.m.Retirer(n, z); err != nil || !servie(z) {
		t.Fatal("nouvel occupant a retiré la trame de l'ancien :", err)
	}
}

// I-1 : index de 24 octets par trame au plus (plan, point 10).
func TestTailleEntree(t *testing.T) {
	if n := unsafe.Sizeof(entree{}); n > 24 {
		t.Fatalf("entree : %d octets, 24 au plus", n)
	}
}

// M-1 : sous concurrence, avec une horloge qui avance à chaque lecture, l'index est trié à la
// fois par seq et par recuMs (l'heure est lue sous le verrou du salon).
func TestHeureMonotone(t *testing.T) {
	b := nouveauBanc(t, 200)
	c := b.creer(t, 4)
	var mbs []Membre
	for _, cr := range []bool{true, false, false, false} {
		_, mb := b.entrerMembre(t, c, cr)
		mbs = append(mbs, mb)
	}
	base := b.h.Now()
	var tic atomic.Int64
	b.m.cfg.Now = func() time.Time { return base.Add(time.Duration(tic.Add(1)) * time.Millisecond) }
	var wg sync.WaitGroup
	for _, mb := range mbs {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for k := 0; k < 200; k++ {
				if _, err := b.m.Recevoir(mb, trameD(0, k), nil); err != nil {
					t.Error(err)
					return
				}
			}
		}()
	}
	wg.Wait()
	s := mbs[0].salon
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(s.index) != 800 {
		t.Fatal("index", len(s.index))
	}
	for i := 1; i < len(s.index); i++ {
		p, e := s.index[i-1], s.index[i]
		if e.seq <= p.seq || e.recuMs < p.recuMs {
			t.Fatalf("index[%d] : seq %d→%d, recuMs %d→%d", i, p.seq, e.seq, p.recuMs, e.recuMs)
		}
	}
}
