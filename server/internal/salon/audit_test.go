package salon

// Tests offensifs des audits du 12 novembre (serveur du salon), repris du scratchpad et
// changés en assertions : chacun échouait avant sa correction.

import (
	"bytes"
	"context"
	"errors"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/skoow/shhdrop/server/internal/blob"
	"github.com/skoow/shhdrop/server/internal/share"
)

// D1 de l'audit : amplification par le bourrage. Deux segments reçus ne font plus écrire
// 123 segments d'aléa au serveur : l'aléa est borné comme celui des partages (padAllowed,
// D42-17), au plus 4 × morceaux reçus + 512, sinon ErrBadRequest (400) sans rien écrire. La
// place reste réservée dès la création (budget honnête).
func TestAuditAmplificationBourrage(t *testing.T) {
	creux(t)
	var ecrits int64
	avant := remplir
	remplir = func(_ *blob.Store, _ string, _ int64, b []byte) error { ecrits += int64(len(b)); return nil }
	t.Cleanup(func() { remplir = avant })
	b := nouveauBanc(t, 200)
	c := b.creer(t, 3)
	_, mb := b.entrerMembre(t, c, true)
	id := b.creerPiece(t, mb, 8000, false)
	der := share.SegmentCount(8000) - 1
	for _, n := range []int{0, der} {
		if err := b.m.PutSegment(id, n, make([]byte, share.SegmentSize(8000, n))); err != nil {
			t.Fatal(err)
		}
	}
	if err := b.m.FinalizePiece(id, 1, der); !errors.Is(err, ErrBadRequest) {
		t.Fatal("finalisation avec 123 segments d'aléa pour 2 reçus :", err)
	}
	if ecrits != 0 {
		t.Fatal("aléa écrit malgré le refus :", ecrits)
	}
}

// Borne exacte du bourrage (padAllowed) : palier 1 600 (25 segments de 64 morceaux), trou
// [1, 1 + t) et tous les autres segments envoyés. t = 21 : 4 segments reçus (256 morceaux),
// 4 × 256 + 512 = 1 536 ≥ 21 × 64, permis ; t = 22 : 3 reçus, 1 280 < 22 × 64, refusé.
func TestBourrageBorneExacte(t *testing.T) {
	creux(t)
	var ecrits int64
	avant := remplir
	remplir = func(_ *blob.Store, _ string, _ int64, b []byte) error { ecrits += int64(len(b)); return nil }
	t.Cleanup(func() { remplir = avant })
	b := nouveauBanc(t, 200)
	c := b.creer(t, 3)
	_, mb := b.entrerMembre(t, c, true)
	essai := func(trou int) error {
		id := b.creerPiece(t, mb, 1600, false)
		for n := range share.SegmentCount(1600) {
			if n >= 1 && n < 1+trou {
				continue
			}
			if err := b.m.PutSegment(id, n, make([]byte, share.SegmentSize(1600, n))); err != nil {
				t.Fatal(n, err)
			}
		}
		return b.m.FinalizePiece(id, 1, 1+trou)
	}
	if err := essai(22); !errors.Is(err, ErrBadRequest) || ecrits != 0 {
		t.Fatal("22 segments d'aléa pour 3 reçus :", err, ecrits)
	}
	if err := essai(21); err != nil {
		t.Fatal("21 segments d'aléa pour 4 reçus :", err)
	}
	if ecrits != 21*64*share.ChunkCT {
		t.Fatal("aléa écrit :", ecrits)
	}
}

// D2 de l'audit : un segment réécrit sans fin (vocal hors de tout quota d'octets). Le total
// reçu par pièce, réécritures comprises, est plafonné à 2 × sa taille (une reprise complète
// après coupure reste possible) : au-delà, ErrTropEcrit (413), pour un vocal comme pour un
// fichier, sans rien écrire.
func TestAuditReecriturePlafonnee(t *testing.T) {
	for _, vocal := range []bool{true, false} {
		b := nouveauBanc(t, 200)
		c := b.creer(t, 3)
		_, mb := b.entrerMembre(t, c, true)
		fin := b.connecte(t, mb)
		b.h.avancer(30 * time.Minute) // réserve vocale : 7,2 Mo ≥ 5 244 208 o
		id := b.creerPiece(t, mb, 80, vocal)
		segs := segments(80, 1)
		// 2 × 4 195 376 o ≤ 2 × 5 244 208 o : la reprise du segment 0 passe.
		for i := range 2 {
			if err := b.m.PutSegment(id, 0, segs[0]); err != nil {
				t.Fatal(vocal, i, err)
			}
		}
		if err := b.m.PutSegment(id, 0, segs[0]); !errors.Is(err, ErrTropEcrit) {
			t.Fatal(vocal, "3ᵉ écriture du segment 0 :", err)
		}
		// Le refus n'a rien compté : le segment 1 (1 048 832 o) tient encore deux fois, la
		// seconde atteignant exactement 2 × 5 244 208 o.
		for i := range 2 {
			if err := b.m.PutSegment(id, 1, segs[1]); err != nil {
				t.Fatal(vocal, i, err)
			}
		}
		if err := b.m.PutSegment(id, 1, segs[1]); !errors.Is(err, ErrTropEcrit) {
			t.Fatal(vocal, "au-delà de 2 × la taille :", err)
		}
		if err := b.m.FinalizePiece(id, 0, 0); err != nil {
			t.Fatal(vocal, err)
		}
		if got, _ := b.lire(t, mb, id, 0); !bytes.Equal(got, segs[0]) {
			t.Fatal(vocal, "contenu")
		}
		fin()
	}
}

// D3 de l'audit : la reprise du siège 0 (rejoindre, appareil perdu ou volé) et tout départ
// (Quitter, exclusion) coupent la lecture en cours de l'ancien jeton
// (clé "m:" + hex(SHA-256(jeton))), pas seulement les lectures suivantes.
func TestAuditRepriseNeCoupePasLecture(t *testing.T) {
	for _, cas := range []string{"reprise", "départ"} {
		b := nouveauBanc(t, 200)
		c := b.creer(t, 3)
		_, createur := b.entrerMembre(t, c, true)
		_, invite := b.entrerMembre(t, c, false)
		id := b.pretePiece(t, createur, 16, false)
		ancien, autre := createur, invite
		if cas == "départ" {
			ancien, autre = invite, createur
		}
		l, err := b.m.OuvrirSegment(context.Background(), ancien, id, 0)
		if err != nil {
			t.Fatal(err)
		}
		temoin, err := b.m.OuvrirSegment(context.Background(), autre, id, 0)
		if err != nil {
			t.Fatal(err)
		}
		if cas == "reprise" {
			b.entrer(t, c, true) // nouveau jeton, ancien oublié
		} else if err := b.m.Quitter(invite); err != nil {
			t.Fatal(err)
		}
		if !errors.Is(context.Cause(l.Context()), share.ErrRevoked) {
			t.Fatal(cas, ": lecture de l'ancien jeton non coupée")
		}
		if _, err := io.Copy(io.Discard, l); err == nil {
			t.Fatal(cas, ": lecture de l'ancien jeton menée à son terme")
		}
		if temoin.Context().Err() != nil {
			t.Fatal(cas, ": lecture d'un autre membre coupée")
		}
		l.Close()
		temoin.Close()
	}
}

// D5 de l'audit : un effacement de pièce en échec se perdait avec la tombe (index et fichier
// gardés pour toujours). La tombe reste tant que des pièces sont à purger ; Tick réessaie.
func TestAuditPurgeEchoueePerdueAvecTombe(t *testing.T) {
	b := nouveauBanc(t, 200)
	c := b.creer(t, 3)
	_, mb := b.entrerMembre(t, c, true)
	s := mb.salon
	id := b.pretePiece(t, mb, 1, false)
	p := filepath.Join(b.cfg.Pieces.Dir, id)
	// Fichier remplacé par un dossier non vide : os.Remove échoue (ENOTEMPTY), même en root.
	if err := os.Remove(p); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(p, "x"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := b.m.RetirerPiece(mb, id); err != nil {
		t.Fatal(err)
	}
	_ = b.m.detruire(s.id)
	b.h.avancer(26 * time.Hour)
	tombe := func() bool {
		b.m.mu.Lock()
		defer b.m.mu.Unlock()
		return b.m.salons[s.id] == s
	}
	for range 3 {
		b.m.Tick()
		if !tombe() || b.m.salonDePiece(id) == nil {
			t.Fatal("tombe oubliée avant la purge de sa pièce")
		}
	}
	if err := os.RemoveAll(p); err != nil { // suppression de nouveau possible
		t.Fatal(err)
	}
	b.m.Tick()
	if tombe() || b.m.salonDePiece(id) != nil {
		t.Fatal("tombe ou index gardés après la purge :", tombe())
	}
}

// Constat de l'audit pour la Task 15 : à l'échéance naturelle (sans destruction), Tick
// n'effaçait ni le fichier ni la ligne d'une pièce, ni la conversation. Il détruit désormais
// le salon échu : pièces (fichier puis ligne), conversation, ligne du salon, index.
func TestAuditEcheanceNaturelle(t *testing.T) {
	b := nouveauBanc(t, 200)
	c := b.creer(t, 3)
	e, mb := b.entrerMembre(t, c, true)
	s := mb.salon
	liee := b.pretePiece(t, mb, 1, false)
	b.lier(t, mb, 0, liee)
	enCours := b.creerPiece(t, mb, 16, false)
	conv := filepath.Join(b.cfg.DossierConversations, s.id)
	if _, err := os.Stat(conv); err != nil {
		t.Fatal("conversation absente avant l'échéance :", err)
	}
	b.h.avancer(25 * time.Hour)
	b.m.Tick()
	for _, id := range []string{liee, enCours} {
		if f, l := b.surDisque(t, id); f || l {
			t.Fatalf("pièce après l'échéance : fichier=%v ligne=%v", f, l)
		}
		if b.m.salonDePiece(id) != nil {
			t.Fatal("index de la pièce gardé")
		}
	}
	if _, err := os.Stat(conv); !errors.Is(err, fs.ErrNotExist) {
		t.Fatal("conversation gardée après l'échéance :", err)
	}
	var n int
	if b.db.QueryRow(`SELECT count(*) FROM salons WHERE id=?`, s.id).Scan(&n); n != 0 {
		t.Fatal("ligne du salon gardée")
	}
	if _, err := b.m.Membre(e.Jeton[:]); !errors.Is(err, ErrNotFound) {
		t.Fatal("membre après l'échéance :", err)
	}
	if u, _ := b.cfg.Pieces.UsedBytes(); u != 0 {
		t.Fatal("usage des pièces :", u)
	}
}

// D6 de l'audit : une pièce effacée entre-temps (PieceSansLien, puis Tick) fermait le
// WebSocket en 4003 et perdait la trame. La trame est désormais rangée sans lien.
func TestAuditLienPieceEchue(t *testing.T) {
	b := nouveauBanc(t, 200)
	c := b.creer(t, 3)
	_, mb := b.entrerMembre(t, c, true)
	defer b.connecte(t, mb)()
	id := b.pretePiece(t, mb, 1, false)
	b.h.avancer(PieceSansLien)
	b.m.Tick()
	seq, err := b.m.Recevoir(mb, trameD(0, 1), idPiece(id))
	if err != nil {
		t.Fatalf("Recevoir après l'échéance de la pièce : %v → code %d", err, codeErreur(err))
	}
	sous(mb.salon, func() {
		if mb.salon.pieces[seq] != nil {
			t.Fatal("trame liée à une pièce effacée")
		}
	})
	if f, l := b.surDisque(t, id); f || l {
		t.Fatal("pièce effacée revenue :", f, l)
	}
}

// Pièce d'un autre salon : jamais liable (trame rangée sans lien, la pièce reste libre dans
// son salon), ni lisible, ni retirable.
func TestAuditAutreSalon(t *testing.T) {
	b := nouveauBanc(t, 200)
	ca, cb := b.creer(t, 3), b.creer(t, 3)
	_, ma := b.entrerMembre(t, ca, true)
	_, mbb := b.entrerMembre(t, cb, true)
	id := b.pretePiece(t, ma, 1, false)
	seq, err := b.m.Recevoir(mbb, trameD(0, 1), idPiece(id))
	if err != nil {
		t.Fatal("trame d'un autre salon :", err)
	}
	sous(mbb.salon, func() {
		if mbb.salon.pieces[seq] != nil {
			t.Fatal("pièce d'un autre salon liée")
		}
	})
	sous(ma.salon, func() {
		if p := ma.salon.libres[id]; p == nil || p.lien != 0 {
			t.Fatal("pièce de son salon touchée")
		}
	})
	if _, err := b.lire(t, mbb, id, 0); !errors.Is(err, ErrNotFound) {
		t.Fatal("lecture depuis un autre salon :", err)
	}
	if err := b.m.RetirerPiece(mbb, id); !errors.Is(err, ErrNotFound) {
		t.Fatal("retrait depuis un autre salon :", err)
	}
}

// D7 de l'audit : les dossiers salon-pieces/ et salons/ gardaient l'heure de la dernière
// création ou suppression d'une pièce ou d'une conversation. Leur date de modification est
// remise à l'epoch après chacune (la date de changement d'inode, ctime, ne peut pas l'être).
func TestAuditDateDossier(t *testing.T) {
	b := nouveauBanc(t, 200)
	epoch := time.Unix(0, 0)
	verifier := func(quand string) {
		t.Helper()
		for _, d := range []string{b.cfg.Pieces.Dir, b.cfg.DossierConversations} {
			fi, err := os.Stat(d)
			if err != nil {
				t.Fatal(err)
			}
			if !fi.ModTime().Equal(epoch) {
				t.Fatalf("%s : mtime de %s = %v", quand, filepath.Base(d), fi.ModTime())
			}
		}
	}
	c := b.creer(t, 3)
	_, mb := b.entrerMembre(t, c, true) // conversation créée
	verifier("entrée (conversation créée)")
	id := b.creerPiece(t, mb, 1, false)
	verifier("création de pièce")
	if err := b.m.RetirerPiece(mb, id); err != nil {
		t.Fatal(err)
	}
	verifier("retrait de pièce")
	b.pretePiece(t, mb, 1, false)
	if err := b.m.detruire(mb.salon.id); err != nil {
		t.Fatal(err)
	}
	verifier("destruction (conversation et pièce effacées)")
}
