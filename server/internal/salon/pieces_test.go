package salon

import (
	"bytes"
	"context"
	"crypto/sha256"
	"errors"
	"io"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/skoow/shhdrop/server/internal/blob"
	"github.com/skoow/shhdrop/server/internal/share"
)

// Pièces jointes et vocaux (plan C-2 Task 13, v3 §5.1).

// creux : les réservations deviennent des fichiers creux (aucun bloc alloué), recomptés par
// Resync : un palier de 8 000 (524 Mo) ne prend rien sur le disque des tests.
func creux(t *testing.T) {
	t.Helper()
	avant := reserverPiece
	reserverPiece = func(st *blob.Store, id string, n int64) error {
		p := filepath.Join(st.Dir, id)
		f, err := os.OpenFile(p, os.O_RDWR|os.O_CREATE|os.O_EXCL, 0o600)
		if err != nil {
			return err
		}
		if err := errors.Join(f.Truncate(n), f.Close()); err != nil {
			return err
		}
		return st.Resync()
	}
	t.Cleanup(func() { reserverPiece = avant })
}

// connecte : siège de mb avec un WebSocket ouvert (inscrire) ; rend la fonction qui le ferme.
func (b *banc) connecte(t *testing.T, mb Membre) func() {
	t.Helper()
	c, code := b.m.inscrire(context.Background(), mb, Accueil{}, nouveauLien())
	if c == nil {
		t.Fatal("inscrire :", code)
	}
	return func() { b.m.desinscrire(c) }
}

// creerPiece : CreerPiece réussie.
func (b *banc) creerPiece(t *testing.T, mb Membre, bucket int, vocal bool) string {
	t.Helper()
	id, err := b.m.CreerPiece(mb, bucket, vocal)
	if err != nil {
		t.Fatal("CreerPiece :", err)
	}
	return id
}

// segments : contenu de chaque segment d'un palier (graine distincte par segment).
func segments(bucket int, graine byte) [][]byte {
	var l [][]byte
	for n := range share.SegmentCount(bucket) {
		l = append(l, bytes.Repeat([]byte{graine + byte(n)}, share.SegmentSize(bucket, n)))
	}
	return l
}

// pretePiece : pièce créée, tous ses segments envoyés, finalisée sans bourrage.
func (b *banc) pretePiece(t *testing.T, mb Membre, bucket int, vocal bool) string {
	t.Helper()
	id := b.creerPiece(t, mb, bucket, vocal)
	for n, seg := range segments(bucket, 1) {
		if err := b.m.PutSegment(id, n, seg); err != nil {
			t.Fatal("PutSegment :", n, err)
		}
	}
	if err := b.m.FinalizePiece(id, 0, 0); err != nil {
		t.Fatal("FinalizePiece :", err)
	}
	return id
}

func idPiece(id string) *[16]byte {
	b, err := b64.DecodeString(id)
	if err != nil || len(b) != 16 {
		panic("id de pièce")
	}
	return (*[16]byte)(b)
}

// lier : trame non volatile de règle d (bits 1-2) portant la pièce id.
func (b *banc) lier(t *testing.T, mb Membre, d byte, id string) uint64 {
	t.Helper()
	seq, err := b.m.Recevoir(mb, trameD(d, 1), idPiece(id))
	if err != nil {
		t.Fatal("Recevoir avec pièce :", err)
	}
	return seq
}

// surDisque : fichier et ligne de la pièce id.
func (b *banc) surDisque(t *testing.T, id string) (fichier, ligne bool) {
	t.Helper()
	_, err := os.Stat(filepath.Join(b.cfg.Pieces.Dir, id))
	fichier = err == nil
	var un int
	ligne = b.db.QueryRow(`SELECT 1 FROM salon_pieces WHERE id=?`, id).Scan(&un) == nil
	return
}

// budgetPris : pieces_bytes du salon de s.
func (b *banc) budgetPris(t *testing.T, s *salon) int64 {
	t.Helper()
	var n int64
	if err := b.db.QueryRow(`SELECT pieces_bytes FROM salons WHERE id=?`, s.id).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

// lire : segment n de la pièce id lu en entier par mb.
func (b *banc) lire(t *testing.T, mb Membre, id string, n int) ([]byte, error) {
	t.Helper()
	l, err := b.m.OuvrirSegment(context.Background(), mb, id, n)
	if err != nil {
		return nil, err
	}
	defer l.Close()
	return io.ReadAll(l)
}

func TestBudgetUnGo(t *testing.T) {
	creux(t)
	b := nouveauBanc(t, 200)
	c := b.creer(t, 2)
	_, mb := b.entrerMembre(t, c, true)
	s := mb.salon
	if Budget != 1073741824 || PalierMax != 8000 || share.TotalSize(PalierMax) != 524416048 {
		t.Fatal("constantes", Budget, PalierMax, share.TotalSize(PalierMax))
	}
	// « 500 Mo » : palier 8 000, 524 416 048 octets, deux fois.
	for range 2 {
		b.creerPiece(t, mb, 8000, false)
	}
	if got := b.budgetPris(t, s); got != 2*524416048 {
		t.Fatal("pieces_bytes", got)
	}
	if _, err := b.m.CreerPiece(mb, 8000, false); !errors.Is(err, ErrBudget) {
		t.Fatal("troisième palier 8 000 :", err)
	}
	// Ce qui reste (24 909 728 o) prend encore un palier 160 (10 488 368 o), pas un 400.
	if _, err := b.m.CreerPiece(mb, 400, false); !errors.Is(err, ErrBudget) {
		t.Fatal("palier 400 :", err)
	}
	b.creerPiece(t, mb, 160, false)
	for _, p := range []int{16385, 32769, 0, 2, -1, 8001} {
		if _, err := b.m.CreerPiece(mb, p, false); !errors.Is(err, ErrBadRequest) {
			t.Fatal("palier", p, err)
		}
	}
	if got := b.budgetPris(t, s); got != 2*524416048+share.TotalSize(160) {
		t.Fatal("refus comptés dans pieces_bytes", got)
	}
	e := b.entrer(t, c, false)
	if e.BudgetLeft != Budget-2*524416048-share.TotalSize(160) {
		t.Fatal("budget_left", e.BudgetLeft)
	}
}

// Salon plein à 1 Go : les fichiers sont refusés, un vocal passe encore (v3 §5.1, décision 3).
func TestVocalHorsBudget(t *testing.T) {
	b := nouveauBanc(t, 200)
	c := b.creer(t, 2)
	_, mb := b.entrerMembre(t, c, true)
	if _, err := b.db.Exec(`UPDATE salons SET pieces_bytes=? WHERE id=?`, Budget, mb.salon.id); err != nil {
		t.Fatal(err)
	}
	if _, err := b.m.CreerPiece(mb, 1, false); !errors.Is(err, ErrBudget) {
		t.Fatal("fichier dans un salon plein :", err)
	}
	fin := b.connecte(t, mb)
	defer fin()
	b.h.avancer(17 * time.Second) // 68 000 o ≥ 65 600
	id := b.pretePiece(t, mb, 1, true)
	if got := b.budgetPris(t, mb.salon); got != Budget {
		t.Fatal("vocal compté dans le budget", got)
	}
	if f, l := b.surDisque(t, id); !f || !l {
		t.Fatal("vocal absent", f, l)
	}
}

// reserveDe : réserve vocale du siège de mb, à jour à l'heure du banc.
func (b *banc) reserveDe(mb Membre) int64 {
	var n int64
	sous(mb.salon, func() {
		r := &mb.salon.limites[mb.siege].vocal
		r.remplir(b.h.Now())
		n = r.octets
	})
	return n
}

func TestReserveVocale(t *testing.T) {
	b := nouveauBanc(t, 200)
	c := b.creer(t, 2)
	_, mb := b.entrerMembre(t, c, true)
	if VocalOctetsParSeconde != 4000 || VocalReserveMax != 14400000 {
		t.Fatal("constantes")
	}
	// Sans WebSocket ouvert, la réserve ne se remplit pas.
	b.h.avancer(time.Hour)
	if _, err := b.m.CreerPiece(mb, 1, true); !isAttente(err, 17*time.Second) {
		t.Fatal("vocal sans présence :", err)
	}
	fin := b.connecte(t, mb)
	b.h.avancer(20 * time.Second)
	if got := b.reserveDe(mb); got != 80000 {
		t.Fatal("réserve après 20 s :", got)
	}
	b.creerPiece(t, mb, 1, true) // 65 600 o
	// Reste 14 400 o : il manque 51 200 o, soit 12,8 s → 13 s.
	if _, err := b.m.CreerPiece(mb, 1, true); !isAttente(err, 13*time.Second) {
		t.Fatal("second vocal :", err)
	}
	if got := b.reserveDe(mb); got != 14400 {
		t.Fatal("refus débité :", got)
	}
	b.h.avancer(90 * time.Minute)
	if got := b.reserveDe(mb); got != VocalReserveMax {
		t.Fatal("réserve après 1 h 30 :", got)
	}
	// Hors ligne : plus rien ne s'ajoute.
	b.creerPiece(t, mb, 80, true)
	fin()
	apres := b.reserveDe(mb)
	b.h.avancer(10 * time.Minute)
	if got := b.reserveDe(mb); got != apres || apres != VocalReserveMax-share.TotalSize(80) {
		t.Fatal("réserve hors ligne :", apres, got)
	}
	// Horloge qui recule : rien n'est gagné, rien n'est perdu.
	fin = b.connecte(t, mb)
	defer fin()
	b.h.avancer(-time.Hour)
	if got := b.reserveDe(mb); got != apres {
		t.Fatal("horloge qui recule :", got)
	}
	b.h.avancer(time.Second)
	if got := b.reserveDe(mb); got != apres+4000 {
		t.Fatal("après le recul :", got)
	}
}

func isAttente(err error, d time.Duration) bool {
	var at *Attente
	return errors.As(err, &at) && at.Retry == d
}

// Un nouvel occupant du siège repart d'une réserve vide ; une reprise (0x0A) la garde.
func TestReserveVocaleOccupant(t *testing.T) {
	b := nouveauBanc(t, 200)
	c := b.creer(t, 3)
	_, mb := b.entrerMembre(t, c, false)
	fin := b.connecte(t, mb)
	b.h.avancer(time.Minute)
	fin()
	if b.reserveDe(mb) != 240000 {
		t.Fatal("réserve", b.reserveDe(mb))
	}
	b.depart(mb.salon, mb.siege)
	_, mb2 := b.entrerMembre(t, c, false)
	if mb2.siege != mb.siege || b.reserveDe(mb2) != 0 {
		t.Fatal("nouvel occupant :", mb2.siege, b.reserveDe(mb2))
	}
}

func TestVocalPalierRefuse(t *testing.T) {
	b := nouveauBanc(t, 200)
	c := b.creer(t, 2)
	_, mb := b.entrerMembre(t, c, true)
	fin := b.connecte(t, mb)
	defer fin()
	b.h.avancer(time.Hour)
	if len(VocalPaliers) != 3 || VocalPaliers[0] != 1 || VocalPaliers[1] != 16 || VocalPaliers[2] != 80 {
		t.Fatal("VocalPaliers", VocalPaliers)
	}
	for _, p := range []int{160, 0, 2, 400, 8000} {
		if _, err := b.m.CreerPiece(mb, p, true); !errors.Is(err, ErrBadRequest) {
			t.Fatal("vocal palier", p, err)
		}
	}
	if got := b.reserveDe(mb); got != VocalReserveMax {
		t.Fatal("refus débité de la réserve :", got)
	}
}

func TestBudgetRendu(t *testing.T) {
	b := nouveauBanc(t, 200)
	c := b.creer(t, 3)
	_, mb := b.entrerMembre(t, c, true)
	id := b.pretePiece(t, mb, 16, false)
	if e := b.entrer(t, c, false); e.BudgetLeft != Budget-share.TotalSize(16) {
		t.Fatal("budget_left après la pièce :", e.BudgetLeft)
	}
	if err := b.m.RetirerPiece(mb, id); err != nil {
		t.Fatal(err)
	}
	if e := b.entrer(t, c, false); e.BudgetLeft != Budget {
		t.Fatal("budget_left après le retrait :", e.BudgetLeft)
	}
	if f, l := b.surDisque(t, id); f || l {
		t.Fatal("pièce retirée encore présente", f, l)
	}
	if err := b.m.RetirerPiece(mb, id); !errors.Is(err, ErrNotFound) {
		t.Fatal("second retrait :", err)
	}
	if got := b.budgetPris(t, mb.salon); got != 0 {
		t.Fatal("budget rendu deux fois ?", got)
	}
}

// Pièce liée à une trame « 10 min » : effacée avec elle, à 600 s de la réception.
func TestPieceLieeSuitSaTrame(t *testing.T) {
	b := nouveauBanc(t, 200)
	c := b.creer(t, 2)
	_, mb := b.entrerMembre(t, c, true)
	defer b.connecte(t, mb)()
	id := b.pretePiece(t, mb, 16, false)
	b.lier(t, mb, byte(DixMinutes)<<1, id)
	b.h.avancer(599 * time.Second)
	b.m.Tick()
	if f, l := b.surDisque(t, id); !f || !l {
		t.Fatal("pièce effacée avant l'échéance", f, l)
	}
	b.h.avancer(time.Second)
	b.m.Tick()
	if f, l := b.surDisque(t, id); f || l {
		t.Fatal("pièce encore présente à 600 s", f, l)
	}
	if got := b.budgetPris(t, mb.salon); got != 0 {
		t.Fatal("budget non rendu", got)
	}
	if _, err := b.lire(t, mb, id, 0); !errors.Is(err, ErrNotFound) {
		t.Fatal("lecture après l'échéance :", err)
	}
}

// Retrait (0x02) de la trame : pièce effacée (delete(s.pieces, seq)), flux en cours coupé.
func TestPieceLieeRetrait(t *testing.T) {
	b := nouveauBanc(t, 200)
	c := b.creer(t, 2)
	_, mb := b.entrerMembre(t, c, true)
	id := b.pretePiece(t, mb, 16, false)
	seq := b.lier(t, mb, 0, id)
	l, err := b.m.OuvrirSegment(context.Background(), mb, id, 0)
	if err != nil {
		t.Fatal(err)
	}
	defer l.Close()
	if b.m.Flux().Len() != 2 { // "m:…" et "p:…"
		t.Fatal("flux inscrits :", b.m.Flux().Len())
	}
	var lie bool
	sous(mb.salon, func() { _, lie = mb.salon.pieces[seq] })
	if !lie {
		t.Fatal("pièce non liée à sa trame")
	}
	if err := b.m.Retirer(mb, seq); err != nil {
		t.Fatal(err)
	}
	sous(mb.salon, func() { _, lie = mb.salon.pieces[seq] })
	if lie {
		t.Fatal("salon.pieces garde la trame retirée")
	}
	if !errors.Is(context.Cause(l.Context()), share.ErrRevoked) {
		t.Fatal("flux non coupé :", context.Cause(l.Context()))
	}
	if _, err := l.Read(make([]byte, 10)); err == nil {
		t.Fatal("lecture après la coupure")
	}
	if f, ll := b.surDisque(t, id); f || ll {
		t.Fatal("pièce encore présente", f, ll)
	}
	l.Close()
	if b.m.Flux().Len() != 0 {
		t.Fatal("flux encore inscrits :", b.m.Flux().Len())
	}
}

// « Instantané » : pièce effacée avec la trame à la dernière lecture.
func TestPieceLieeInstantane(t *testing.T) {
	b := nouveauBanc(t, 200)
	c := b.creer(t, 3)
	_, mb := b.entrerMembre(t, c, true)
	_, mb2 := b.entrerMembre(t, c, false)
	id := b.pretePiece(t, mb, 1, false)
	seq := b.lier(t, mb, dInstantane, id)
	if got, err := b.lire(t, mb2, id, 0); err != nil || len(got) != share.SegmentSize(1, 0) {
		t.Fatal("lecture :", len(got), err)
	}
	b.lu(t, mb2, seq)
	if f, l := b.surDisque(t, id); f || l {
		t.Fatal("pièce encore présente après la dernière lecture", f, l)
	}
	// Seul dans le salon : la trame est effacée tout de suite, et sa pièce aussi (au Tick).
	id2 := b.pretePiece(t, mb2, 1, false)
	b.depart(mb.salon, mb.siege)
	b.lier(t, mb2, dInstantane, id2)
	b.m.Tick()
	if f, l := b.surDisque(t, id2); f || l {
		t.Fatal("pièce d'une trame effacée aussitôt", f, l)
	}
}

func TestPieceNonLiee(t *testing.T) {
	b := nouveauBanc(t, 200)
	c := b.creer(t, 2)
	_, mb := b.entrerMembre(t, c, true)
	if PieceSansLien != 15*time.Minute || PieceSansSegment != 15*time.Minute {
		t.Fatal("constantes")
	}
	defer b.connecte(t, mb)()
	id := b.pretePiece(t, mb, 16, false)
	b.h.avancer(PieceSansLien - time.Second)
	b.m.Tick()
	if f, l := b.surDisque(t, id); !f || !l {
		t.Fatal("effacée trop tôt", f, l)
	}
	b.h.avancer(time.Second)
	b.m.Tick()
	if f, l := b.surDisque(t, id); f || l {
		t.Fatal("pièce jamais liée encore présente à 15 min", f, l)
	}
	if got := b.budgetPris(t, mb.salon); got != 0 {
		t.Fatal("budget non rendu", got)
	}
	// Liée à temps : gardée au-delà de 15 min.
	id2 := b.pretePiece(t, mb, 1, false)
	b.lier(t, mb, 0, id2)
	b.h.avancer(time.Hour)
	b.m.Tick()
	if f, l := b.surDisque(t, id2); !f || !l {
		t.Fatal("pièce liée effacée", f, l)
	}
}

// Aucun segment depuis 15 min : pièce effacée (fichier puis ligne, budget rendu), envoi
// déclaré abandonné aux quotas (OnAbandon). Un segment reçu repousse l'échéance.
func TestPieceSansSegment(t *testing.T) {
	b := nouveauBanc(t, 200)
	var mu sync.Mutex
	var abandons []string
	b.m.cfg.OnAbandon = func(id string) { mu.Lock(); abandons = append(abandons, id); mu.Unlock() }
	c := b.creer(t, 2)
	_, mb := b.entrerMembre(t, c, true)
	defer b.connecte(t, mb)()
	id := b.creerPiece(t, mb, 80, false)
	b.h.avancer(10 * time.Minute)
	if err := b.m.PutSegment(id, 0, segments(80, 0)[0]); err != nil {
		t.Fatal(err)
	}
	b.h.avancer(PieceSansSegment - time.Second)
	b.m.Tick()
	if f, l := b.surDisque(t, id); !f || !l {
		t.Fatal("effacée alors qu'un segment est arrivé", f, l)
	}
	b.h.avancer(time.Second)
	b.m.Tick()
	if f, l := b.surDisque(t, id); f || l {
		t.Fatal("pièce sans segment encore présente", f, l)
	}
	if got := b.budgetPris(t, mb.salon); got != 0 {
		t.Fatal("budget non rendu", got)
	}
	mu.Lock()
	defer mu.Unlock()
	if len(abandons) != 1 || abandons[0] != id {
		t.Fatal("abandon :", abandons)
	}
	if err := b.m.PutSegment(id, 1, segments(80, 0)[1]); !errors.Is(err, ErrNotFound) {
		t.Fatal("segment d'une pièce effacée :", err)
	}
}

// Lien d'une trame à une pièce (audit D6, décision du 12 novembre) : une pièce d'un autre
// auteur (autre siège, ou ancien occupant du siège) ou une trame volatile → ErrBadRequest
// (4003), sans rang consommé ; une pièce disparue (inconnue, effacée, d'un autre salon), pas
// encore prête ou déjà liée (course honnête : PieceSansLien, retrait depuis un autre onglet,
// message modifié) → trame rangée SANS lien (le client affichera « pièce indisponible »).
func TestLienRefuse(t *testing.T) {
	b := nouveauBanc(t, 200)
	c := b.creer(t, 3)
	_, mb := b.entrerMembre(t, c, true)
	_, autre := b.entrerMembre(t, c, false)
	s := mb.salon
	aAutre := b.pretePiece(t, autre, 1, false)
	enCours := b.creerPiece(t, mb, 1, false)
	liee := b.pretePiece(t, mb, 1, false)
	premier := b.lier(t, mb, 0, liee)
	libre := b.pretePiece(t, mb, 1, false)
	inconnue := [16]byte{9}
	avant := dernierSeq(s)
	for nom, f := range map[string]func() error{
		"autre siège": func() error { _, err := b.m.Recevoir(mb, trameD(0, 1), idPiece(aAutre)); return err },
		"volatile":    func() error { _, err := b.m.Recevoir(mb, trameD(dVolatile, 1), idPiece(libre)); return err },
	} {
		if err := f(); !errors.Is(err, ErrBadRequest) {
			t.Errorf("%s : %v", nom, err)
		}
	}
	if dernierSeq(s) != avant {
		t.Fatal("rang consommé par un refus")
	}
	for nom, id := range map[string]*[16]byte{"non finalisée": idPiece(enCours), "déjà liée": idPiece(liee),
		"inconnue": &inconnue} {
		seq, err := b.m.Recevoir(mb, trameD(0, 1), id)
		if err != nil || seq != dernierSeq(s) {
			t.Fatalf("%s : trame refusée : %v", nom, err)
		}
		sous(s, func() {
			if s.pieces[seq] != nil {
				t.Errorf("%s : trame liée", nom)
			}
		})
	}
	sous(s, func() {
		if p := s.pieces[premier]; p == nil || p.id != liee || p.lien != premier {
			t.Error("pièce déjà liée détachée de sa trame")
		}
		if p := s.lesPieces[enCours]; p == nil || p.lien != 0 {
			t.Error("pièce non finalisée liée")
		}
	})
	// Ancien occupant du siège : sa pièce n'est pas au nouveau (autre auteur : 4003).
	b.depart(s, autre.siege)
	_, nouveau := b.entrerMembre(t, c, false)
	if nouveau.siege != autre.siege {
		t.Fatal("siège", nouveau.siege)
	}
	if _, err := b.m.Recevoir(nouveau, trameD(0, 1), idPiece(aAutre)); !errors.Is(err, ErrBadRequest) {
		t.Fatal("pièce de l'ancien occupant :", err)
	}
	b.lier(t, mb, 0, libre)
}

// Jeton révoqué (exclusion, Task 14) : envoi, finalisation, création et lecture refusés
// (ErrExcluded), même avec un jeton d'envoi encore valable.
func TestPieceExclu(t *testing.T) {
	b := nouveauBanc(t, 200)
	c := b.creer(t, 3)
	e, mb := b.entrerMembre(t, c, false)
	_, autre := b.entrerMembre(t, c, true)
	id := b.creerPiece(t, mb, 16, false)
	lisible := b.pretePiece(t, autre, 1, false)
	s := mb.salon
	h := sha256.Sum256(e.Jeton[:])
	sous(s, func() { s.revoques[h] = struct{}{} })
	if err := b.m.PutSegment(id, 0, segments(16, 0)[0]); !errors.Is(err, ErrExcluded) {
		t.Fatal("PutSegment :", err)
	}
	if err := b.m.FinalizePiece(id, 0, 0); !errors.Is(err, ErrExcluded) {
		t.Fatal("FinalizePiece :", err)
	}
	if _, err := b.m.Membre(e.Jeton[:]); !errors.Is(err, ErrExcluded) {
		t.Fatal("Membre :", err)
	}
	// Membre obtenu avant la révocation : refusé quand même.
	if _, err := b.lire(t, mb, lisible, 0); !errors.Is(err, ErrExcluded) {
		t.Fatal("lecture :", err)
	}
	if _, err := b.m.CreerPiece(mb, 1, false); !errors.Is(err, ErrExcluded) {
		t.Fatal("création :", err)
	}
	if err := b.m.RetirerPiece(mb, id); !errors.Is(err, ErrExcluded) {
		t.Fatal("retrait :", err)
	}
}

// Plancher (plan, point 11) : un arrivant ne lit pas une pièce d'avant son arrivée, sauf si
// elle est liée à une trame reçue après (qu'il peut lire).
func TestPlancherPieces(t *testing.T) {
	b := nouveauBanc(t, 200)
	c := b.creer(t, 3)
	_, mb := b.entrerMembre(t, c, true)
	avantLiee := b.pretePiece(t, mb, 1, false)
	b.lier(t, mb, 0, avantLiee)
	avantLibre := b.pretePiece(t, mb, 1, false)
	_, arrivant := b.entrerMembre(t, c, false)
	if _, err := b.lire(t, arrivant, avantLiee, 0); !errors.Is(err, ErrNotFound) {
		t.Fatal("pièce liée avant l'arrivée :", err)
	}
	if _, err := b.lire(t, arrivant, avantLibre, 0); !errors.Is(err, ErrNotFound) {
		t.Fatal("pièce créée avant l'arrivée, pas encore liée :", err)
	}
	b.lier(t, mb, 0, avantLibre)
	if got, err := b.lire(t, arrivant, avantLibre, 0); err != nil || !bytes.Equal(got, segments(1, 1)[0]) {
		t.Fatal("pièce liée après l'arrivée :", err)
	}
	if _, err := b.lire(t, mb, avantLiee, 0); err != nil {
		t.Fatal("auteur :", err)
	}
}

func TestRetirerPieceAuteurSeul(t *testing.T) {
	b := nouveauBanc(t, 200)
	c := b.creer(t, 3)
	_, mb := b.entrerMembre(t, c, false)
	_, createur := b.entrerMembre(t, c, true)
	id := b.pretePiece(t, mb, 1, false)
	if err := b.m.RetirerPiece(createur, id); !errors.Is(err, ErrForbidden) {
		t.Fatal("retrait par un autre membre :", err)
	}
	if f, l := b.surDisque(t, id); !f || !l {
		t.Fatal("pièce retirée par un autre", f, l)
	}
	if err := b.m.RetirerPiece(mb, "AAAAAAAAAAAAAAAAAAAAAA"); !errors.Is(err, ErrNotFound) {
		t.Fatal("pièce inconnue :", err)
	}
	if err := b.m.RetirerPiece(mb, id); err != nil {
		t.Fatal(err)
	}
}

// Envoi complet : tailles exactes, bourrage d'aléa, état ready, lecture identique.
func TestEnvoiPieceSalon(t *testing.T) {
	b := nouveauBanc(t, 200)
	c := b.creer(t, 3)
	_, mb := b.entrerMembre(t, c, true)
	_, lecteur := b.entrerMembre(t, c, false)
	const p = 160 // 3 segments
	id := b.creerPiece(t, mb, p, false)
	segs := segments(p, 7)
	if err := b.m.PutSegment(id, 0, segs[0][:10]); !errors.Is(err, ErrBadRequest) {
		t.Fatal("segment court :", err)
	}
	if err := b.m.PutSegment(id, 3, segs[2]); !errors.Is(err, ErrBadRequest) {
		t.Fatal("segment hors palier :", err)
	}
	if err := b.m.PutSegment(id, 0, segs[0]); err != nil {
		t.Fatal(err)
	}
	if err := b.m.FinalizePiece(id, 1, 2); !errors.Is(err, ErrBadRequest) {
		t.Fatal("finalisation sans le dernier segment :", err)
	}
	if err := b.m.PutSegment(id, 2, segs[2]); err != nil {
		t.Fatal(err)
	}
	if _, err := b.lire(t, lecteur, id, 0); !errors.Is(err, ErrNotFound) {
		t.Fatal("lecture avant la finalisation :", err)
	}
	for _, f := range [][2]int{{0, 1}, {1, 3}, {2, 1}} {
		if err := b.m.FinalizePiece(id, f[0], f[1]); !errors.Is(err, ErrBadRequest) {
			t.Fatal("bourrage", f, err)
		}
	}
	if err := b.m.FinalizePiece(id, 1, 2); err != nil {
		t.Fatal(err)
	}
	if err := b.m.FinalizePiece(id, 1, 2); !errors.Is(err, ErrNotFound) {
		t.Fatal("seconde finalisation :", err)
	}
	if err := b.m.PutSegment(id, 0, segs[0]); !errors.Is(err, ErrNotFound) {
		t.Fatal("segment après la finalisation :", err)
	}
	var etat string
	if err := b.db.QueryRow(`SELECT state FROM salon_pieces WHERE id=?`, id).Scan(&etat); err != nil || etat != "ready" {
		t.Fatal("état", etat, err)
	}
	for _, n := range []int{0, 2} {
		if got, err := b.lire(t, lecteur, id, n); err != nil || !bytes.Equal(got, segs[n]) {
			t.Fatal("segment", n, err)
		}
	}
	bourrage, err := b.lire(t, lecteur, id, 1)
	if err != nil || len(bourrage) != share.SegmentSize(p, 1) || bytes.Count(bourrage, []byte{0}) > len(bourrage)/100 {
		t.Fatal("bourrage d'aléa :", len(bourrage), err)
	}
	if _, err := b.lire(t, lecteur, id, 3); !errors.Is(err, ErrBadRequest) {
		t.Fatal("segment hors palier :", err)
	}
	for _, mauvais := range []string{"", "x", "AAAAAAAAAAAAAAAAAAAAA/", "../../salons/AAAAAAAAAA"} {
		if err := b.m.PutSegment(mauvais, 0, segs[0]); !errors.Is(err, ErrNotFound) {
			t.Fatal("id invalide", mauvais, err)
		}
	}
}

// Budget de lecture par (jeton, pièce) : share.ReadBudget(palier), puis ErrBudget ; un autre
// membre a le sien.
func TestLectureBudgetSalon(t *testing.T) {
	b := nouveauBanc(t, 200)
	c := b.creer(t, 4)
	_, mb := b.entrerMembre(t, c, true)
	_, l1 := b.entrerMembre(t, c, false)
	_, l2 := b.entrerMembre(t, c, false)
	id := b.pretePiece(t, mb, 1, false)
	lus := int64(0)
	for lus+int64(share.SegmentSize(1, 0)) <= share.ReadBudget(1) {
		if _, err := b.lire(t, l1, id, 0); err != nil {
			t.Fatal(err)
		}
		lus += int64(share.SegmentSize(1, 0))
	}
	if _, err := b.lire(t, l1, id, 0); !errors.Is(err, ErrBudget) {
		t.Fatal("au-delà du budget :", err)
	}
	if _, err := b.lire(t, l2, id, 0); err != nil {
		t.Fatal("autre membre :", err)
	}
}

// Place totale (StorageMax) réservée dans la même section atomique que sa vérification : une
// réservation en cours compte déjà (une seconde création qui ne tiendrait plus est refusée).
func TestPlaceAtomique(t *testing.T) {
	b := nouveauBanc(t, 200)
	c := b.creer(t, 2)
	_, mb := b.entrerMembre(t, c, true)
	b.m.cfg.StorageMax = b.m.UsedBytes() + share.TotalSize(16) + share.TotalSize(16)/2
	avant := reserverPiece
	entre, repart := make(chan struct{}), make(chan struct{})
	reserverPiece = func(st *blob.Store, id string, n int64) error {
		close(entre)
		<-repart
		return avant(st, id, n)
	}
	t.Cleanup(func() { reserverPiece = avant })
	fini := make(chan error, 1)
	go func() { _, err := b.m.CreerPiece(mb, 16, false); fini <- err }()
	<-entre
	if b.m.UsedBytes() < share.TotalSize(16) {
		t.Fatal("réservation en cours non comptée :", b.m.UsedBytes())
	}
	reserverPiece = avant
	if _, err := b.m.CreerPiece(mb, 16, false); !errors.Is(err, ErrFull) {
		t.Fatal("seconde création :", err)
	}
	close(repart)
	if err := <-fini; err != nil {
		t.Fatal(err)
	}
	if got := b.budgetPris(t, mb.salon); got != share.TotalSize(16) {
		t.Fatal("refus ErrFull compté dans le budget", got)
	}
	// Trames refusées aussi (plein) : l'usage compte la pièce.
	if !b.m.plein(share.TotalSize(16)) {
		t.Fatal("usage sans la pièce")
	}
}

// Fin du salon : pièces effacées (fichier et ligne), flux coupés, segments refusés.
func TestFinSalonPieces(t *testing.T) {
	b := nouveauBanc(t, 200)
	c := b.creer(t, 2)
	_, mb := b.entrerMembre(t, c, true)
	prete := b.pretePiece(t, mb, 1, false)
	b.lier(t, mb, 0, prete)
	enCours := b.creerPiece(t, mb, 16, false)
	l, err := b.m.OuvrirSegment(context.Background(), mb, prete, 0)
	if err != nil {
		t.Fatal(err)
	}
	defer l.Close()
	if err := b.m.detruire(mb.salon.id); err != nil {
		t.Fatal(err)
	}
	if !errors.Is(context.Cause(l.Context()), share.ErrRevoked) {
		t.Fatal("flux non coupé")
	}
	for _, id := range []string{prete, enCours} {
		if f, ll := b.surDisque(t, id); f || ll {
			t.Fatal("pièce après la fin du salon", id, f, ll)
		}
	}
	if err := b.m.PutSegment(enCours, 0, segments(16, 0)[0]); !errors.Is(err, ErrNotFound) {
		t.Fatal("segment après la fin :", err)
	}
	b.m.idxMu.Lock()
	n := len(b.m.pieceIdx)
	b.m.idxMu.Unlock()
	if n != 0 {
		t.Fatal("index des pièces", n)
	}
}

// Plafond propre au salon (décision du 12 novembre) : 120 pièces non vocales par heure et par
// siège (seau plein au départ, 1 toutes les 30 s), neuf pour chaque nouvel occupant ; les
// vocaux n'y comptent pas ; un refus plus loin (budget) rend le jeton.
func TestPiecesParHeure(t *testing.T) {
	b := bancLimite(t)
	c := b.creer(t, 3)
	_, mb := b.entrerMembre(t, c, true)
	if PiecesParHeure != 120 {
		t.Fatal("PiecesParHeure", PiecesParHeure)
	}
	for i := range PiecesParHeure {
		if _, err := b.m.CreerPiece(mb, 1, false); err != nil {
			t.Fatal("pièce", i+1, err)
		}
	}
	if _, err := b.m.CreerPiece(mb, 1, false); !isAttente(err, 30*time.Second) {
		t.Fatal("121e pièce dans l'heure :", err)
	}
	// Les vocaux restent hors de ce plafond.
	fin := b.connecte(t, mb)
	defer fin()
	b.h.avancer(29 * time.Second)
	if _, err := b.m.CreerPiece(mb, 1, true); err != nil {
		t.Fatal("vocal :", err)
	}
	if _, err := b.m.CreerPiece(mb, 1, false); !isAttente(err, time.Second) {
		t.Fatal("avant 30 s :", err)
	}
	b.h.avancer(time.Second)
	b.creerPiece(t, mb, 1, false)
	// Refus du budget : jeton rendu.
	b.h.avancer(30 * time.Second)
	if _, err := b.db.Exec(`UPDATE salons SET pieces_bytes=? WHERE id=?`, Budget, mb.salon.id); err != nil {
		t.Fatal(err)
	}
	if _, err := b.m.CreerPiece(mb, 1, false); !errors.Is(err, ErrBudget) {
		t.Fatal("budget :", err)
	}
	if _, err := b.db.Exec(`UPDATE salons SET pieces_bytes=0 WHERE id=?`, mb.salon.id); err != nil {
		t.Fatal(err)
	}
	b.creerPiece(t, mb, 1, false)
	// Nouvel occupant d'un siège : seau neuf.
	_, invite := b.entrerMembre(t, c, false)
	for range PiecesParHeure {
		b.creerPiece(t, invite, 1, false)
	}
	b.depart(mb.salon, invite.siege)
	_, suivant := b.entrerMembre(t, c, false)
	if suivant.siege != invite.siege {
		t.Fatal("siège", suivant.siege)
	}
	b.creerPiece(t, suivant, 1, false)
}
