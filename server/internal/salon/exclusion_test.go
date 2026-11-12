package salon

import (
	"bytes"
	"context"
	"errors"
	"os"
	"testing"
	"testing/synctest"

	"github.com/skoow/shhdrop/server/internal/share"
)

// Exclusion et rotation de l'invitation (plan C-2 Task 14, spec §39.13).

// invitation : nouvelle invitation (K_accès_s', K_preuve_s') d'une rotation ; même S_gestion.
func invitation(c cles) cles {
	return cles{acces: aleatoire(), preuve: aleatoire(), gestion: c.gestion}
}

// reqExclure : rotation vers n (nouvelle invitation) avec le siège et le nonce donnés (nil :
// rotation seule) et le numéro r.
func reqExclure(c, n cles, siege *uint8, nonce *[16]byte, r uint32) ExclureReq {
	return ExclureReq{ManageV: share.Verifier(c.gestion), AccessNewV: share.Verifier(n.acces),
		ProofV: share.Verifier(n.preuve), Salt: bytes.Repeat([]byte{9}, 16), KdfOps: 3, KdfMem: 67108864,
		Siege: siege, Nonce: nonce, R: r}
}

func siegeP(n uint8) *uint8 { return &n }

// ligneSalon : colonnes du salon que la rotation remplace (et failed_attempts).
type ligneSalon struct {
	accessV, proofV, salt []byte
	ops, mem, essais      int
}

func (b *banc) ligne(t *testing.T, s *salon) ligneSalon {
	t.Helper()
	var l ligneSalon
	if err := b.db.QueryRow(`SELECT access_v, proof_v, salt, kdf_ops, kdf_mem, failed_attempts FROM salons WHERE id=?`,
		s.id).Scan(&l.accessV, &l.proofV, &l.salt, &l.ops, &l.mem, &l.essais); err != nil {
		t.Fatal(err)
	}
	return l
}

func memeLigne(a, b ligneSalon) bool {
	return bytes.Equal(a.accessV, b.accessV) && bytes.Equal(a.proofV, b.proofV) && bytes.Equal(a.salt, b.salt) &&
		a.ops == b.ops && a.mem == b.mem && a.essais == b.essais
}

// exclusions : enregistrements 0x09 du journal.
func exclusions(s *salon) []evenement {
	s.mu.Lock()
	defer s.mu.Unlock()
	var l []evenement
	for _, ev := range s.journal {
		if ev.enr[0] == 0x09 {
			l = append(l, ev)
		}
	}
	return l
}

// de : enregistrements de type ty reçus par l.
func de(l *fauxLien, ty byte) []enrC {
	var out []enrC
	for _, e := range l.enrs() {
		if e.ty == ty {
			out = append(out, e)
		}
	}
	return out
}

// L'exclu est refusé partout : WebSocket fermé (0x05 raison 5 puis 4002, sans le 0x09),
// reconnexion 4002, Membre ErrExcluded, et toute action d'un Membre obtenu avant l'exclusion
// rend ErrExcluded, siège pourtant libéré (hypothèse de l'audit).
func TestExcluRefusePartout(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		b := nouveauBanc(t, 200)
		c := b.creer(t, 4)
		e0, g := b.entrerMembre(t, c, true)
		eb, mb := b.entrerMembre(t, c, false)
		s := g.salon
		envoi := b.creerPiece(t, mb, 1, false)   // envoi en cours de l'exclu
		lisible := b.pretePiece(t, g, 1, false)  // pièce que l'exclu pouvait lire
		trame := b.recevoir(t, mb, trameD(0, 1)) // trame de l'exclu
		l0 := b.connecter(e0.Jeton, e0.Seq)
		lb := b.connecter(eb.Jeton, eb.Seq)
		synctest.Wait()
		n := invitation(c)
		if err := b.m.Exclure(reqExclure(c, n, siegeP(eb.Siege), &eb.Nonce, 1)); err != nil {
			t.Fatal("Exclure :", err)
		}
		attendreFin(t, lb)
		if code := lb.codeFerme(); code != CodeRevoque {
			t.Fatal("code de fermeture", code)
		}
		fin := de(lb, 0x05)
		if len(fin) != 1 || !bytes.Equal(fin[0].corps, []byte{RaisonExclu}) || len(de(lb, 0x09)) != 0 {
			t.Fatalf("chez l'exclu : %d 0x05, %d 0x09", len(fin), len(de(lb, 0x09)))
		}
		synctest.Wait()
		ex := de(l0, 0x09)
		if len(ex) != 1 {
			t.Fatalf("0x09 chez le créateur : %d", len(ex))
		}
		if want := EnrExclusion(ex[0].seq, eb.Siege, eb.Nonce, 1); !bytes.Equal(ex[0].corps, want[9:]) {
			t.Fatalf("0x09 : %x", ex[0].corps)
		}
		if _, err := b.m.Membre(eb.Jeton[:]); !errors.Is(err, ErrExcluded) {
			t.Fatal("Membre :", err)
		}
		lb = b.connecter(eb.Jeton, eb.Seq)
		attendreFin(t, lb)
		if code := lb.codeFerme(); code != CodeRevoque || len(lb.enrs()) != 0 {
			t.Fatal("reconnexion :", code, len(lb.enrs()))
		}
		sous(s, func() {
			if s.sieges[eb.Siege] != nil {
				t.Fatal("siège de l'exclu encore occupé")
			}
		})
		_, err := b.m.Recevoir(mb, trameD(0, 2), nil)
		errs := map[string]error{
			"Recevoir":      err,
			"Retirer":       b.m.Retirer(mb, trame),
			"Lu":            b.m.Lu(mb, trame),
			"Quitter":       b.m.Quitter(mb),
			"RetirerPiece":  b.m.RetirerPiece(mb, envoi),
			"PutSegment":    b.m.PutSegment(envoi, 0, segments(1, 1)[0]),
			"FinalizePiece": b.m.FinalizePiece(envoi, 0, 0),
		}
		_, errs["CreerPiece"] = b.m.CreerPiece(mb, 1, false)
		_, errs["OuvrirSegment"] = b.m.OuvrirSegment(context.Background(), mb, lisible, 0)
		for nom, err := range errs {
			if !errors.Is(err, ErrExcluded) {
				t.Errorf("%s : %v, attendu ErrExcluded", nom, err)
			}
		}
		if codeErreur(ErrExcluded) != CodeRevoque {
			t.Error("codeErreur(ErrExcluded)", codeErreur(ErrExcluded))
		}
		finir(t, l0)
		invariantJournal(t, s)
	})
}

// 0x09 émis une fois, à un seul rang, reçu par chaque siège restant, jamais par l'exclu.
func TestExclusionUneFois(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		b := nouveauBanc(t, 200)
		c := b.creer(t, 4)
		e0, g := b.entrerMembre(t, c, true)
		ea := b.entrer(t, c, false)
		eb := b.entrer(t, c, false)
		s := g.salon
		l0, la, lb := b.connecter(e0.Jeton, e0.Seq), b.connecter(ea.Jeton, ea.Seq), b.connecter(eb.Jeton, eb.Seq)
		synctest.Wait()
		avant := dernierSeq(s)
		if err := b.m.Exclure(reqExclure(c, invitation(c), siegeP(eb.Siege), &eb.Nonce, 7)); err != nil {
			t.Fatal(err)
		}
		attendreFin(t, lb)
		synctest.Wait()
		ev := exclusions(s)
		if len(ev) != 1 || ev[0].seq != avant+1 || dernierSeq(s) != avant+1 {
			t.Fatalf("journal : %d 0x09, rang %d (avant %d, dernier %d)", len(ev), ev[0].seq, avant, dernierSeq(s))
		}
		for nom, l := range map[string]*fauxLien{"créateur": l0, "A": la} {
			if r := de(l, 0x09); len(r) != 1 || r[0].seq != ev[0].seq || !bytes.Equal(r[0].corps, ev[0].enr[9:]) {
				t.Errorf("%s : %d 0x09", nom, len(r))
			}
			if len(de(l, 0x03)) != 0 {
				t.Errorf("%s : 0x03 reçu en plus du 0x09", nom)
			}
		}
		if len(de(lb, 0x09)) != 0 {
			t.Error("l'exclu a reçu le 0x09")
		}
		// Après une reconnexion, le 0x0D ne compte plus l'exclu.
		finir(t, la)
		la = b.connecter(ea.Jeton, dernierSeq(s))
		synctest.Wait()
		if l := la.brut(0); l[0] != 0x0D || l[10] != 2 {
			t.Fatalf("0x0D après l'exclusion : %x", l[:11])
		}
		finir(t, l0, la)
	})
}

// L'exclu ne compte plus dans max_members : sa place est rendue.
func TestSiegeLibre(t *testing.T) {
	b := nouveauBanc(t, 200)
	c := b.creer(t, 2)
	b.entrer(t, c, true)
	eb := b.entrer(t, c, false)
	if _, err := b.m.Rejoindre(c.acces, c.preuve, nil); !errors.Is(err, ErrFull) {
		t.Fatal("salon plein :", err)
	}
	n := invitation(c)
	if err := b.m.Exclure(reqExclure(c, n, siegeP(eb.Siege), &eb.Nonce, 1)); err != nil {
		t.Fatal(err)
	}
	if _, present, _ := b.m.Gestion(c.gestion); present != 1 {
		t.Fatal("présents après l'exclusion :", present)
	}
	ec, err := b.m.Rejoindre(n.acces, n.preuve, nil)
	if err != nil || ec.Siege != eb.Siege {
		t.Fatal("nouvelle entrée :", ec.Siege, err)
	}
}

// Sans siège : 0x09 siège 0xFF (nonce nul), personne n'est sorti, l'ancien lien est mort, le
// nouveau marche.
func TestRotationSeule(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		b := nouveauBanc(t, 200)
		c := b.creer(t, 4)
		e0, g := b.entrerMembre(t, c, true)
		ea := b.entrer(t, c, false)
		s := g.salon
		l0, la := b.connecter(e0.Jeton, e0.Seq), b.connecter(ea.Jeton, ea.Seq)
		synctest.Wait()
		n := invitation(c)
		if err := b.m.Exclure(reqExclure(c, n, nil, nil, 1)); err != nil {
			t.Fatal(err)
		}
		synctest.Wait()
		ev := exclusions(s)
		if len(ev) != 1 || !bytes.Equal(ev[0].enr, EnrExclusion(ev[0].seq, SansExclu, [16]byte{}, 1)) {
			t.Fatalf("journal : %v", ev)
		}
		for _, l := range []*fauxLien{l0, la} {
			if len(de(l, 0x09)) != 1 || l.codeFerme() != 0 {
				t.Fatal("0x09 non reçu, ou connexion fermée")
			}
		}
		if occupes(s) != 2 {
			t.Fatal("sièges occupés", occupes(s))
		}
		for _, j := range [][32]byte{e0.Jeton, ea.Jeton} {
			if _, err := b.m.Membre(j[:]); err != nil {
				t.Fatal("jeton d'un membre resté :", err)
			}
		}
		if _, err := b.m.Meta(c.acces); !errors.Is(err, ErrNotFound) {
			t.Fatal("ancien lien :", err)
		}
		if _, err := b.m.Rejoindre(c.acces, c.preuve, nil); !errors.Is(err, ErrNotFound) {
			t.Fatal("ancien lien, rejoindre :", err)
		}
		if _, err := b.m.Meta(n.acces); err != nil {
			t.Fatal("nouveau lien :", err)
		}
		finir(t, l0, la)
	})
}

// Siège réattribué, nonce faux ou r déjà vu : ErrStale, rien de changé.
func TestExclureStale(t *testing.T) {
	b := nouveauBanc(t, 200)
	c := b.creer(t, 4)
	_, g := b.entrerMembre(t, c, true)
	s := g.salon
	eb := b.entrer(t, c, false)
	b.depart(s, eb.Siege)
	ec := b.entrer(t, c, false)
	if ec.Siege != eb.Siege {
		t.Fatal("siège réattribué", ec.Siege)
	}
	avant := b.ligne(t, s)
	faux := [16]byte(aleatoire()[:16])
	for nom, r := range map[string]ExclureReq{
		"ancien titulaire": reqExclure(c, invitation(c), siegeP(eb.Siege), &eb.Nonce, 1),
		"nonce faux":       reqExclure(c, invitation(c), siegeP(ec.Siege), &faux, 1),
		"siège libre":      reqExclure(c, invitation(c), siegeP(5), &ec.Nonce, 1),
	} {
		if err := b.m.Exclure(r); !errors.Is(err, ErrStale) {
			t.Errorf("%s : %v", nom, err)
		}
	}
	if !memeLigne(avant, b.ligne(t, s)) || len(exclusions(s)) != 0 || occupes(s) != 2 {
		t.Fatal("état changé par un refus")
	}
	// r croissant : r ≤ dernier r → ErrStale.
	if err := b.m.Exclure(reqExclure(c, invitation(c), nil, nil, 5)); err != nil {
		t.Fatal(err)
	}
	avant = b.ligne(t, s)
	for _, r := range []uint32{0, 4, 5} {
		if err := b.m.Exclure(reqExclure(c, invitation(c), nil, nil, r)); !errors.Is(err, ErrStale) {
			t.Errorf("r = %d : %v", r, err)
		}
	}
	if !memeLigne(avant, b.ligne(t, s)) || len(exclusions(s)) != 1 {
		t.Fatal("état changé par un r périmé")
	}
	if err := b.m.Exclure(reqExclure(c, invitation(c), nil, nil, 6)); err != nil {
		t.Fatal("r = 6 :", err)
	}
}

// Requêtes invalides : siège 0 (on ne s'exclut pas), siège sans nonce ou l'inverse, siège
// hors des bornes, valeurs hors de la spécification : ErrBadRequest, rien de changé.
func TestExclureSoiMeme(t *testing.T) {
	b := nouveauBanc(t, 200)
	c := b.creer(t, 4)
	e0, g := b.entrerMembre(t, c, true)
	eb := b.entrer(t, c, false)
	s := g.salon
	avant := b.ligne(t, s)
	n := invitation(c)
	mod := func(f func(r *ExclureReq)) ExclureReq {
		r := reqExclure(c, n, siegeP(eb.Siege), &eb.Nonce, 1)
		f(&r)
		return r
	}
	for nom, r := range map[string]ExclureReq{
		"siège 0":           reqExclure(c, n, siegeP(0), &e0.Nonce, 1),
		"siège sans nonce":  mod(func(r *ExclureReq) { r.Nonce = nil }),
		"nonce sans siège":  mod(func(r *ExclureReq) { r.Siege = nil }),
		"siège 10":          mod(func(r *ExclureReq) { r.Siege = siegeP(10) }),
		"siège 0xFF":        mod(func(r *ExclureReq) { r.Siege = siegeP(SansExclu) }),
		"sel court":         mod(func(r *ExclureReq) { r.Salt = r.Salt[:15] }),
		"preuve courte":     mod(func(r *ExclureReq) { r.ProofV = r.ProofV[:31] }),
		"accès court":       mod(func(r *ExclureReq) { r.AccessNewV = r.AccessNewV[:31] }),
		"kdf_ops":           mod(func(r *ExclureReq) { r.KdfOps = 2 }),
		"kdf_mem":           mod(func(r *ExclureReq) { r.KdfMem = 1 << 20 }),
		"accès = gestion":   mod(func(r *ExclureReq) { r.AccessNewV = r.ManageV }),
		"preuve = accès":    mod(func(r *ExclureReq) { r.ProofV = r.AccessNewV }),
		"preuve = gestion":  mod(func(r *ExclureReq) { r.ProofV = r.ManageV }),
		"empreinte du vide": mod(func(r *ExclureReq) { r.AccessNewV = share.Verifier(nil) }),
	} {
		if err := b.m.Exclure(r); !errors.Is(err, ErrBadRequest) {
			t.Errorf("%s : %v", nom, err)
		}
	}
	if !memeLigne(avant, b.ligne(t, s)) || len(exclusions(s)) != 0 || occupes(s) != 2 {
		t.Fatal("état changé par un refus")
	}
}

// Sans S_gestion, ou avec un jeton de membre à sa place : ErrForbidden, rien de changé.
func TestExclureSansGestion(t *testing.T) {
	b := nouveauBanc(t, 200)
	c := b.creer(t, 4)
	_, g := b.entrerMembre(t, c, true)
	eb := b.entrer(t, c, false)
	s := g.salon
	avant := b.ligne(t, s)
	for nom, v := range map[string][]byte{"absent": nil, "jeton de membre": share.Verifier(eb.Jeton[:]),
		"court": share.Verifier(c.gestion)[:31], "accès": share.Verifier(c.acces)} {
		r := reqExclure(c, invitation(c), siegeP(eb.Siege), &eb.Nonce, 1)
		r.ManageV = v
		if err := b.m.Exclure(r); !errors.Is(err, ErrForbidden) {
			t.Errorf("%s : %v", nom, err)
		}
	}
	if !memeLigne(avant, b.ligne(t, s)) || len(exclusions(s)) != 0 || occupes(s) != 2 {
		t.Fatal("état changé par un refus")
	}
}

// Nouvelle access_v déjà prise (autre salon, ou la sienne) : ErrConflict, rien de changé.
func TestExclureAccesPris(t *testing.T) {
	b := nouveauBanc(t, 200)
	c := b.creer(t, 4)
	autre := b.creer(t, 4)
	_, g := b.entrerMembre(t, c, true)
	s := g.salon
	avant := b.ligne(t, s)
	for nom, acces := range map[string][]byte{"autre salon": autre.acces, "le sien": c.acces} {
		n := invitation(c)
		n.acces = acces
		if err := b.m.Exclure(reqExclure(c, n, nil, nil, 1)); !errors.Is(err, ErrConflict) {
			t.Errorf("%s : %v", nom, err)
		}
	}
	if !memeLigne(avant, b.ligne(t, s)) || len(exclusions(s)) != 0 {
		t.Fatal("état changé par un refus")
	}
}

// Panne au milieu de la transaction (déclencheur SQLite de test) : aucune colonne changée, et
// rien en mémoire (siège occupé, jeton valable, aucun 0x09, r non consommé).
func TestRotationAtomique(t *testing.T) {
	b := nouveauBanc(t, 200)
	c := b.creer(t, 4)
	_, g := b.entrerMembre(t, c, true)
	eb := b.entrer(t, c, false)
	s := g.salon
	if _, err := b.db.Exec(`UPDATE salons SET failed_attempts=3 WHERE id=?`, s.id); err != nil {
		t.Fatal(err)
	}
	avant := b.ligne(t, s)
	if _, err := b.db.Exec(`CREATE TRIGGER panne AFTER UPDATE OF access_v ON salons BEGIN SELECT RAISE(ABORT, 'panne'); END`); err != nil {
		t.Fatal(err)
	}
	r := reqExclure(c, invitation(c), siegeP(eb.Siege), &eb.Nonce, 1)
	if err := b.m.Exclure(r); !errors.Is(err, ErrBase) {
		t.Fatal("Exclure pendant la panne :", err)
	}
	if !memeLigne(avant, b.ligne(t, s)) {
		t.Fatal("colonnes changées malgré la panne")
	}
	if _, err := b.m.Membre(eb.Jeton[:]); err != nil || len(exclusions(s)) != 0 || occupes(s) != 2 {
		t.Fatal("mémoire changée malgré la panne :", err)
	}
	if _, err := b.db.Exec(`DROP TRIGGER panne`); err != nil {
		t.Fatal(err)
	}
	if err := b.m.Exclure(r); err != nil {
		t.Fatal("même requête après la panne (r non consommé) :", err)
	}
	apres := b.ligne(t, s)
	if !bytes.Equal(apres.accessV, r.AccessNewV) || !bytes.Equal(apres.proofV, r.ProofV) ||
		!bytes.Equal(apres.salt, r.Salt) || apres.essais != 0 {
		t.Fatal("colonnes non remplacées, ou essais non remis à 0")
	}
}

// Une ligne arrivée à 10 essais entre la lecture et la transaction ne revit jamais : l'UPDATE
// filtré par failed_attempts<10 ne touche aucune ligne → ErrForbidden (relecture Task 14,
// comme les autres cas « introuvable » d'Exclure), rien de changé.
func TestRotationLigneBloquee(t *testing.T) {
	b := nouveauBanc(t, 200)
	c := b.creer(t, 4)
	_, g := b.entrerMembre(t, c, true)
	eb := b.entrer(t, c, false)
	s := g.salon
	crochetExclure = func() {
		if _, err := b.db.Exec(`UPDATE salons SET failed_attempts=10 WHERE id=?`, s.id); err != nil {
			t.Error(err)
		}
	}
	t.Cleanup(func() { crochetExclure = nil })
	avant := b.ligne(t, s)
	if err := b.m.Exclure(reqExclure(c, invitation(c), siegeP(eb.Siege), &eb.Nonce, 1)); !errors.Is(err, ErrForbidden) {
		t.Fatal("Exclure :", err)
	}
	apres := b.ligne(t, s)
	if !bytes.Equal(apres.accessV, avant.accessV) || apres.essais != 10 {
		t.Fatal("ligne bloquée réécrite")
	}
	if len(exclusions(s)) != 0 || occupes(s) != 2 {
		t.Fatal("mémoire changée")
	}
}

// « Instantané » : l'exclu n'est plus attendu ; la trame qui n'attendait plus que lui est
// effacée, 0x0E diffusé après le 0x09.
func TestInstantaneExclu(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		b := nouveauBanc(t, 200)
		c := b.creer(t, 4)
		e0, g := b.entrerMembre(t, c, true)
		ea, ma := b.entrerMembre(t, c, false)
		eb := b.entrer(t, c, false)
		s := g.salon
		l0, la := b.connecter(e0.Jeton, e0.Seq), b.connecter(ea.Jeton, ea.Seq)
		synctest.Wait()
		seq := b.recevoir(t, g, trameD(dInstantane, 1)) // attendus : A et B
		b.lu(t, ma, seq)
		if !servie(t, s, seq) {
			t.Fatal("effacée avant le départ de B")
		}
		if err := b.m.Exclure(reqExclure(c, invitation(c), siegeP(eb.Siege), &eb.Nonce, 1)); err != nil {
			t.Fatal(err)
		}
		synctest.Wait()
		if servie(t, s, seq) {
			t.Fatal("trame encore servie")
		}
		for nom, l := range map[string]*fauxLien{"créateur": l0, "A": la} {
			if e := effaces(l); len(e) != 1 || e[0] != seq {
				t.Fatalf("%s : 0x0E %v", nom, e)
			}
			var i9, iE int
			for i, e := range l.enrs() {
				switch e.ty {
				case 0x09:
					i9 = i
				case 0x0E:
					iE = i
				}
			}
			if iE < i9 {
				t.Fatalf("%s : 0x0E avant le 0x09", nom)
			}
		}
		finir(t, l0, la)
	})
}

// Plancher des pièces (§39.13.1b (c)) : un jeton émis après l'exclusion ne lit aucune pièce
// dont le rang de référence (trame liée, sinon création) est antérieur à son arrivée (même
// ErrNotFound qu'une pièce inconnue) ; il lit les postérieures ; un jeton plus ancien lit tout.
func TestPlancher(t *testing.T) {
	b := nouveauBanc(t, 200)
	c := b.creer(t, 4)
	_, g := b.entrerMembre(t, c, true)
	_, ma := b.entrerMembre(t, c, false)
	eb := b.entrer(t, c, false)
	ancienne := b.pretePiece(t, g, 1, false)
	ancienneLiee := b.pretePiece(t, g, 1, false)
	b.lier(t, g, 0, ancienneLiee)
	plusTard := b.pretePiece(t, g, 1, false) // créée avant, liée après l'arrivée du nouveau
	n := invitation(c)
	if err := b.m.Exclure(reqExclure(c, n, siegeP(eb.Siege), &eb.Nonce, 1)); err != nil {
		t.Fatal(err)
	}
	ed, err := b.m.Rejoindre(n.acces, n.preuve, nil)
	if err != nil {
		t.Fatal(err)
	}
	md := b.membreDe(t, ed)
	b.lier(t, g, 0, plusTard)
	posterieure := b.pretePiece(t, g, 1, false)
	_, inconnue := b.lire(t, md, share.NewID(), 0)
	if !errors.Is(inconnue, ErrNotFound) {
		t.Fatal("pièce inconnue :", inconnue)
	}
	for _, k := range []struct {
		nom   string
		mb    Membre
		id    string
		passe bool
	}{
		{"nouveau, antérieure", md, ancienne, false},
		{"nouveau, antérieure liée avant", md, ancienneLiee, false},
		{"nouveau, liée après son arrivée", md, plusTard, true},
		{"nouveau, postérieure", md, posterieure, true},
		{"ancien, antérieure", ma, ancienne, true},
		{"ancien, antérieure liée", ma, ancienneLiee, true},
		{"ancien, postérieure", ma, posterieure, true},
	} {
		_, err := b.lire(t, k.mb, k.id, 0)
		if k.passe && err != nil || !k.passe && (err == nil || err.Error() != inconnue.Error() || !errors.Is(err, ErrNotFound)) {
			t.Errorf("%s : %v", k.nom, err)
		}
	}
}

// Lecture de pièce en cours de l'exclu coupée (share.ErrRevoked), celle d'un autre membre
// continue ; le registre ne garde que le flux de l'autre membre.
func TestCoupureTelechargementExclu(t *testing.T) {
	b := nouveauBanc(t, 200)
	c := b.creer(t, 4)
	_, g := b.entrerMembre(t, c, true)
	eb, mb := b.entrerMembre(t, c, false)
	id := b.pretePiece(t, g, 1, false)
	lb, err := b.m.OuvrirSegment(context.Background(), mb, id, 0)
	if err != nil {
		t.Fatal(err)
	}
	defer lb.Close()
	lg, err := b.m.OuvrirSegment(context.Background(), g, id, 0)
	if err != nil {
		t.Fatal(err)
	}
	defer lg.Close()
	if err := b.m.Exclure(reqExclure(c, invitation(c), siegeP(eb.Siege), &eb.Nonce, 1)); err != nil {
		t.Fatal(err)
	}
	if !errors.Is(context.Cause(lb.Context()), share.ErrRevoked) {
		t.Fatal("lecture de l'exclu non coupée :", context.Cause(lb.Context()))
	}
	if _, err := lb.Read(make([]byte, 1)); err == nil {
		t.Fatal("lecture de l'exclu continue")
	}
	if lg.Context().Err() != nil {
		t.Fatal("lecture d'un autre membre coupée")
	}
	lb.Close()
	if n := b.m.Flux().Len(); n != 2 {
		t.Fatal("flux inscrits", n)
	}
	if _, err := lg.Read(make([]byte, 16)); err != nil {
		t.Fatal("lecture de l'autre membre :", err)
	}
}

// Jetons révoqués gardés jusqu'à la fin du salon, puis oubliés (index compris).
func TestRevoquesJusquaLaFin(t *testing.T) {
	b := nouveauBanc(t, 200)
	c := b.creer(t, 4)
	_, g := b.entrerMembre(t, c, true)
	eb := b.entrer(t, c, false)
	s := g.salon
	if err := b.m.Exclure(reqExclure(c, invitation(c), siegeP(eb.Siege), &eb.Nonce, 1)); err != nil {
		t.Fatal(err)
	}
	b.m.Tick()
	if _, err := b.m.Membre(eb.Jeton[:]); !errors.Is(err, ErrExcluded) {
		t.Fatal("après Tick :", err)
	}
	if err := b.m.detruire(s.id); err != nil {
		t.Fatal(err)
	}
	if _, err := b.m.Membre(eb.Jeton[:]); !errors.Is(err, ErrNotFound) {
		t.Fatal("après la fin :", err)
	}
	b.m.idxMu.Lock()
	n := len(b.m.index)
	b.m.idxMu.Unlock()
	sous(s, func() {
		if n != 0 || len(s.revoques) != 0 {
			t.Fatal("révoqués gardés après la fin", n, len(s.revoques))
		}
	})
}

// Relecture Task 14 : l'exclu reprend son siège par WebSocket (0x0A, nonce neuf) entre la
// vérification et la transaction ; le 0x09 porte alors le nonce COURANT du siège (celui du
// 0x0A), pas celui de la requête : les membres retrouvent la feuille à retirer.
func TestExclusionApresRepriseWS(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		b := nouveauBanc(t, 200)
		c := b.creer(t, 4)
		e0, g := b.entrerMembre(t, c, true)
		eb := b.entrer(t, c, false)
		s := g.salon
		l0 := b.connecter(e0.Jeton, e0.Seq)
		synctest.Wait()
		var lb *fauxLien
		crochetExclure = func() {
			lb = b.connecter(eb.Jeton, DepuisReprise)
			synctest.Wait()
		}
		t.Cleanup(func() { crochetExclure = nil })
		if err := b.m.Exclure(reqExclure(c, invitation(c), siegeP(eb.Siege), &eb.Nonce, 1)); err != nil {
			t.Fatal("Exclure :", err)
		}
		attendreFin(t, lb)
		synctest.Wait()
		rep := de(l0, 0x0A)
		if len(rep) != 1 {
			t.Fatalf("0x0A chez le créateur : %d", len(rep))
		}
		var nonce [16]byte
		copy(nonce[:], rep[0].corps[1:17])
		if nonce == eb.Nonce {
			t.Fatal("la reprise n'a pas changé le nonce")
		}
		ex := de(l0, 0x09)
		if len(ex) != 1 {
			t.Fatalf("0x09 chez le créateur : %d", len(ex))
		}
		if want := EnrExclusion(ex[0].seq, eb.Siege, nonce, 1); !bytes.Equal(ex[0].corps, want[9:]) {
			t.Fatalf("0x09 : %x, attendu le nonce du 0x0A", ex[0].corps)
		}
		if lb.codeFerme() != CodeRevoque {
			t.Fatal("exclu non fermé en 4002 :", lb.codeFerme())
		}
		finir(t, l0)
		invariantJournal(t, s)
	})
}

// Relecture Task 14 (spec §39.13.1b) : le numéro de rotation vit en base (rotation_r). Après
// un redémarrage (nouveau Manager sur la même base, mémoire vide), un ancien exclure rejoué
// ne fait pas revivre l'invitation morte : ErrStale, ligne inchangée.
func TestRotationRejoueeApresRedemarrage(t *testing.T) {
	b := nouveauBanc(t, 200)
	c := b.creer(t, 4)
	_, g := b.entrerMembre(t, c, true)
	s := g.salon
	vieille := reqExclure(c, invitation(c), nil, nil, 1)
	if err := b.m.Exclure(vieille); err != nil {
		t.Fatal("r = 1 :", err)
	}
	if err := b.m.Exclure(reqExclure(c, invitation(c), nil, nil, 2)); err != nil {
		t.Fatal("r = 2 :", err)
	}
	var r int
	if err := b.db.QueryRow(`SELECT rotation_r FROM salons WHERE id=?`, s.id).Scan(&r); err != nil || r != 2 {
		t.Fatal("rotation_r :", r, err)
	}
	// Redémarrage simulé : conversation effacée (purge au démarrage), mémoire neuve.
	if err := os.RemoveAll(b.cfg.DossierConversations); err != nil {
		t.Fatal(err)
	}
	m2, err := NewManager(b.cfg)
	if err != nil {
		t.Fatal(err)
	}
	avant := b.ligne(t, s)
	for _, k := range []uint32{1, 2} {
		rejeu := vieille
		rejeu.R = k
		if err := m2.Exclure(rejeu); !errors.Is(err, ErrStale) {
			t.Errorf("rejeu r = %d : %v, attendu ErrStale", k, err)
		}
	}
	if !memeLigne(avant, b.ligne(t, s)) {
		t.Fatal("invitation morte revenue après le redémarrage")
	}
	if err := m2.Exclure(reqExclure(c, invitation(c), nil, nil, 3)); err != nil {
		t.Fatal("r = 3 après le redémarrage :", err)
	}
}

// Relecture Task 14 : une ligne passée à 10 essais, ou échue, pendant la transaction rend
// ErrForbidden, comme les autres cas « introuvable » d'Exclure ; rien n'est changé.
func TestRotationLigneMorteForbidden(t *testing.T) {
	for nom, q := range map[string]string{
		"10 essais": `UPDATE salons SET failed_attempts=10 WHERE id=?`,
		"échue":     `UPDATE salons SET expires_at=0 WHERE id=?`,
	} {
		t.Run(nom, func(t *testing.T) {
			b := nouveauBanc(t, 200)
			c := b.creer(t, 4)
			_, g := b.entrerMembre(t, c, true)
			eb := b.entrer(t, c, false)
			s := g.salon
			crochetExclure = func() {
				if _, err := b.db.Exec(q, s.id); err != nil {
					t.Error(err)
				}
			}
			t.Cleanup(func() { crochetExclure = nil })
			avant := b.ligne(t, s)
			if err := b.m.Exclure(reqExclure(c, invitation(c), siegeP(eb.Siege), &eb.Nonce, 1)); !errors.Is(err, ErrForbidden) {
				t.Fatal("Exclure :", err)
			}
			if apres := b.ligne(t, s); !bytes.Equal(apres.accessV, avant.accessV) {
				t.Fatal("ligne réécrite")
			}
			if len(exclusions(s)) != 0 || occupes(s) != 2 {
				t.Fatal("mémoire changée")
			}
		})
	}
}
