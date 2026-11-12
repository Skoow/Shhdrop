package share

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/skoow/shhdrop/server/internal/blob"
)

// Octroi d'ouverture (spec §41.4, plan amendement v2.9 ; D42-22 : valable jusqu'à l'échéance
// du partage, retours bornés à MaxReopens par ouverture).

func opensOf(t *testing.T, s *Service, id string) (left, issued, failed int) {
	t.Helper()
	if err := s.DB.QueryRow(`SELECT opens_left, opens_issued, failed_attempts FROM shares WHERE id=?`, id).
		Scan(&left, &issued, &failed); err != nil {
		t.Fatal(err)
	}
	return
}

func TestGrantFormat(t *testing.T) {
	var key, other [32]byte
	other[0] = 1
	var id, id2 [16]byte
	id2[0] = 1
	now := time.Unix(1_800_000_000, 0)
	g := IssueGrant(key, id, 3, now.Add(time.Hour))
	if len(g) != 54 {
		t.Fatal("54 caractères attendus", len(g))
	}
	if n, ok := VerifyGrant(key, id, g, now); !ok || n != 3 {
		t.Fatal(n, ok)
	}
	raw, _ := DecodeB64(g, 40)
	raw[3] = 4 // autre ouverture
	forged := b64.EncodeToString(raw)
	for name, c := range map[string]func() bool{
		"falsifié":       func() bool { _, ok := VerifyGrant(key, id, forged, now); return ok },
		"autre partage":  func() bool { _, ok := VerifyGrant(key, id2, g, now); return ok },
		"autre clé":      func() bool { _, ok := VerifyGrant(other, id, g, now); return ok },
		"expiré":         func() bool { _, ok := VerifyGrant(key, id, g, now.Add(time.Hour)); return ok },
		"vide":           func() bool { _, ok := VerifyGrant(key, id, "", now); return ok },
		"mauvaise forme": func() bool { _, ok := VerifyGrant(key, id, g[:53]+"=", now); return ok },
	} {
		if c() {
			t.Error(name, ": accepté")
		}
	}
}

// Recharger : même ouverture, aucune consommée, jeton neuf, octroi valable jusqu'à l'échéance.
func TestReopenKeepsOpening(t *testing.T) {
	s, c := newSvc(t)
	k := newKeys()
	id := ready(t, s, k, 1, 24, 3)
	o, err := s.UnlockGrant(id, k.acces, k.preuve, "")
	if err != nil || o.N != 1 || len(o.Grant) != 54 || o.OpensLeft != 2 {
		t.Fatal(o, err)
	}
	c.Add(5 * time.Minute)
	r, err := s.UnlockGrant(id, k.acces, k.preuve, o.Grant)
	if err != nil || r.N != 1 || len(r.Grant) != 54 || len(r.Envelope) != EnvelopeLen || r.OpensLeft != 2 {
		t.Fatal(r, err)
	}
	if left, issued, _ := opensOf(t, s, id); left != 2 || issued != 1 {
		t.Fatal("ouverture consommée", left, issued)
	}
	// D42-22 : l'octroi vaut jusqu'à l'échéance du partage (24 h), sans renouvellement ;
	// le balayage ne termine pas l'ouverture.
	c.Add(23 * time.Hour)
	if _, err := s.Sweep(); err != nil {
		t.Fatal(err)
	}
	if _, err := s.UnlockGrant(id, k.acces, k.preuve, o.Grant); err != nil {
		t.Fatal("retour 23 h plus tard", err)
	}
	m, err := s.MetaGrant(k.acces, r.Grant)
	if err != nil || m.OpensLeft != 2 {
		t.Fatal(m, err)
	}
	if left, issued, _ := opensOf(t, s, id); left != 2 || issued != 1 {
		t.Fatal("ouverture consommée", left, issued)
	}
}

// En « draining » (plus d'ouverture disponible), l'ouverture non terminée rouvre ; sans
// octroi, le partage reste introuvable.
func TestReopenDraining(t *testing.T) {
	s, _ := newSvc(t)
	k := newKeys()
	id := ready(t, s, k, 1, 24, 1)
	o, err := s.UnlockGrant(id, k.acces, k.preuve, "")
	if err != nil || o.OpensLeft != 0 {
		t.Fatal(o, err)
	}
	if _, err := s.Meta(k.acces); !errors.Is(err, ErrNotFound) {
		t.Fatal("meta sans octroi", err)
	}
	if _, err := s.MetaGrant(k.acces, o.Grant); err != nil {
		t.Fatal("meta avec octroi", err)
	}
	if r, err := s.UnlockGrant(id, k.acces, k.preuve, o.Grant); err != nil || r.N != 1 || r.OpensLeft != 0 {
		t.Fatal(r, err)
	}
	if rowCount(t, s, id) != 1 {
		t.Fatal("partage effacé")
	}
}

// Mot de passe faux avec octroi : un essai compté (5 → destruction).
func TestReopenWrongPasswordCounts(t *testing.T) {
	s, _ := newSvc(t)
	k := newKeys()
	id := ready(t, s, k, 1, 24, 3)
	o, _ := s.UnlockGrant(id, k.acces, k.preuve, "")
	for want := 4; want >= 1; want-- {
		_, err := s.UnlockGrant(id, k.acces, rnd(32), o.Grant)
		var bp *BadPassword
		if !errors.As(err, &bp) || bp.AttemptsLeft != want {
			t.Fatal(want, err)
		}
	}
	_, err := s.UnlockGrant(id, k.acces, rnd(32), o.Grant)
	var bp *BadPassword
	if !errors.As(err, &bp) || bp.AttemptsLeft != 0 {
		t.Fatal(err)
	}
	gone(t, s, id)
}

// Octroi falsifié, d'un autre partage, expiré, ou ouverture terminée : ErrGrantInvalid, ni
// ouverture ni essai consommé (même avec un mauvais mot de passe).
func TestReopenInvalidGrant(t *testing.T) {
	s, c := newSvc(t)
	k, k2 := newKeys(), newKeys()
	id := ready(t, s, k, 1, 24, 3)
	id2 := ready(t, s, k2, 1, 24, 3)
	o, _ := s.UnlockGrant(id, k.acces, k.preuve, "")
	o2, _ := s.UnlockGrant(id2, k2.acces, k2.preuve, "")
	raw, _ := DecodeB64(o.Grant, 40)
	raw[3] = 2
	check := func(name, g string, proof []byte) {
		t.Helper()
		if _, err := s.UnlockGrant(id, k.acces, proof, g); !errors.Is(err, ErrGrantInvalid) {
			t.Fatal(name, err)
		}
		if left, issued, failed := opensOf(t, s, id); left != 2 || issued != 1 || failed != 0 {
			t.Fatal(name, ": consommé", left, issued, failed)
		}
	}
	check("falsifié", b64.EncodeToString(raw), k.preuve)
	check("autre partage", o2.Grant, k.preuve)
	check("autre partage, mauvais mot de passe", o2.Grant, rnd(32))
	idb, _ := idBytes(id)
	check("expiré", IssueGrant(s.grantKey, idb, uint32(o.N), c.Now()), k.preuve)
	if err := s.Done(id, o.N); err != nil {
		t.Fatal(err)
	}
	check("ouverture terminée", o.Grant, k.preuve)
}

// Au plus MaxReopens (20) retours par ouverture ; budget de lecture borné (revue D42-22).
func TestReopenLimitAndBudget(t *testing.T) {
	s, _ := newSvc(t)
	k := newKeys()
	id := ready(t, s, k, gb, 24, 3)
	o, _ := s.UnlockGrant(id, k.acces, k.preuve, "")
	segs := SegmentCount(gb)
	readAll := func() error {
		for n := range segs {
			if _, err := readSegment(s, id, n, o.N); err != nil {
				return err
			}
		}
		return nil
	}
	// Sans rechargement : deux lectures complètes, pas trois.
	if err := readAll(); err != nil {
		t.Fatal(err)
	}
	if err := readAll(); err != nil {
		t.Fatal(err)
	}
	if err := readAll(); !errors.Is(err, ErrBudget) {
		t.Fatal("3ᵉ lecture sans rechargement", err)
	}
	g := o.Grant
	for i := 1; i <= MaxReopens; i++ {
		r, err := s.UnlockGrant(id, k.acces, k.preuve, g)
		if err != nil || r.N != o.N {
			t.Fatal(i, r, err)
		}
		g = r.Grant
	}
	if _, err := s.UnlockGrant(id, k.acces, k.preuve, g); !errors.Is(err, ErrReopenLimit) {
		t.Fatal("21ᵉ retour", err)
	}
	if left, issued, failed := opensOf(t, s, id); left != 2 || issued != 1 || failed != 0 {
		t.Fatal(left, issued, failed)
	}
	// 20 retours : min(20 × F, max(3 × F, 256 Mio)) de plus, soit ici (F ≈ 26 Mio) neuf
	// lectures complètes ; le compteur n'a pas été remis à zéro.
	f := totalSize(gb)
	extra := int(min(MaxReopens*f, max(3*f, reopenExtraMin)) / f)
	if extra < 3 || extra >= MaxReopens {
		t.Fatal("palier de test inattendu", extra)
	}
	for i := 0; i < extra; i++ {
		if err := readAll(); err != nil {
			t.Fatal(i, err)
		}
	}
	if err := readAll(); !errors.Is(err, ErrBudget) {
		t.Fatal("budget dépassé", err)
	}
}

// D42-22 : un partage dont toutes les ouvertures sont prises (« draining ») reste jusqu'à son
// échéance ; la personne qui l'a ouvert y revient, personne d'autre n'entre ; à l'échéance,
// il est effacé et l'octroi ne vaut plus rien.
func TestDrainingKeptUntilExpiry(t *testing.T) {
	s, c := newSvc(t)
	k := newKeys()
	id := ready(t, s, k, 1, 24, 1)
	o, err := s.UnlockGrant(id, k.acces, k.preuve, "")
	if err != nil || o.OpensLeft != 0 {
		t.Fatal(o, err)
	}
	c.Add(7 * time.Hour) // au-delà de l'ancienne purge (6 h) et des 30 min de l'ancien octroi
	if _, err := s.Sweep(); err != nil {
		t.Fatal(err)
	}
	if rowCount(t, s, id) != 1 {
		t.Fatal("effacé avant l'échéance")
	}
	if _, err := s.Meta(k.acces); !errors.Is(err, ErrNotFound) {
		t.Fatal("quelqu'un d'autre entre", err)
	}
	if _, err := s.MetaGrant(k.acces, o.Grant); err != nil {
		t.Fatal("meta du retour", err)
	}
	r, err := s.UnlockGrant(id, k.acces, k.preuve, o.Grant)
	if err != nil || r.N != o.N {
		t.Fatal("retour", r, err)
	}
	if _, err := readSegment(s, id, 0, r.N); err != nil {
		t.Fatal(err)
	}
	c.Add(17*time.Hour + 15*time.Minute) // échéance (24 h, arrondie au quart d'heure)
	if _, err := s.Sweep(); err != nil {
		t.Fatal(err)
	}
	gone(t, s, id)
	if _, err := s.MetaGrant(k.acces, r.Grant); !errors.Is(err, ErrNotFound) {
		t.Fatal(err)
	}
}

// Le budget de lecture d'une ouverture ne se remet pas à zéro quand la personne revient
// après plus de 6 h (durée d'un jeton) : il vit jusqu'à l'échéance du partage.
func TestBudgetSurvivesLongAbsence(t *testing.T) {
	s, c := newSvc(t)
	k := newKeys()
	id := ready(t, s, k, gb, 24, 2)
	o, _ := s.UnlockGrant(id, k.acces, k.preuve, "")
	segs := SegmentCount(gb)
	readAll := func(openN int) error {
		for n := range segs {
			if _, err := readSegment(s, id, n, openN); err != nil {
				return err
			}
		}
		return nil
	}
	for range 2 {
		if err := readAll(o.N); err != nil {
			t.Fatal(err)
		}
	}
	c.Add(7 * time.Hour)
	r, err := s.UnlockGrant(id, k.acces, k.preuve, o.Grant)
	if err != nil {
		t.Fatal(err)
	}
	if err := readAll(r.N); err != nil { // un retour : une lecture complète de plus
		t.Fatal(err)
	}
	if err := readAll(r.N); !errors.Is(err, ErrBudget) {
		t.Fatal("budget remis à zéro après l'absence", err)
	}
}

// Redémarrage : nouvelle clé, octrois invalides (rien en base).
func TestGrantRestartInvalidates(t *testing.T) {
	s, _ := newSvc(t)
	k := newKeys()
	id := ready(t, s, k, 1, 24, 3)
	o, _ := s.UnlockGrant(id, k.acces, k.preuve, "")
	s2, err := NewService(Config{DB: s.DB, Blobs: s.Blobs, Now: s.Now, StorageMax: s.StorageMax, FrozenFile: s.FrozenFile})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s2.UnlockGrant(id, k.acces, k.preuve, o.Grant); !errors.Is(err, ErrGrantInvalid) {
		t.Fatal(err)
	}
	if left, _, failed := opensOf(t, s, id); left != 2 || failed != 0 {
		t.Fatal(left, failed)
	}
}

// Tâche 2 : l'expéditeur supprime d'abord (grâce : descripteur détaché), puis
// l'administrateur détruit le même lien, dans ce processus ou depuis « shhdrop admin
// destroy » (autre processus) : tout est coupé tout de suite.
func TestAdminDestroyCutsDetached(t *testing.T) {
	for _, other := range []bool{false, true} {
		name := "même processus"
		if other {
			name = "autre processus"
		}
		t.Run(name, func(t *testing.T) {
			s, _ := newSvc(t)
			k := newKeys()
			id := ready(t, s, k, gb, 24, 2)
			o, _, _ := s.Unlock(id, k.acces, k.preuve)
			mustRead(t, s, id, 0, o)
			seg, err := s.OpenSegment(id, 1, o)
			if err != nil {
				t.Fatal(err)
			}
			if err := s.DestroyManaged(k.gestion); err != nil {
				t.Fatal(err)
			}
			mustRead(t, s, id, 2, o) // grâce : l'ouverture active continue
			admin := s
			if other {
				admin, err = NewService(Config{DB: s.DB, Blobs: &blob.Store{Dir: s.Blobs.Dir}, Now: s.Now,
					StorageMax: s.StorageMax, FrozenFile: s.FrozenFile, KillWait: 3 * time.Second})
				if err != nil {
					t.Fatal(err)
				}
				stop := make(chan struct{})
				defer close(stop)
				go func() { // janitor.Watch du serveur
					for {
						select {
						case <-stop:
							return
						case <-time.After(20 * time.Millisecond):
							s.PollRemoved()
						}
					}
				}()
			}
			if err := admin.DestroyAdmin(k.acces); err != nil {
				t.Fatal("destruction par l'administrateur", err)
			}
			if _, err := seg.Read(make([]byte, 1<<20)); err == nil {
				if _, err := seg.Read(make([]byte, 64<<20)); err == nil {
					t.Fatal("flux en cours non coupé")
				}
			}
			seg.Close()
			mustGone(t, s, id, 3, o)
			if n := heldFDs(t, s, id); n > 0 {
				t.Fatal("descripteur encore ouvert", n)
			}
			if es, _ := os.ReadDir(filepath.Join(filepath.Dir(s.FrozenFile), "kill")); len(es) != 0 {
				t.Fatal("demande restée", len(es))
			}
		})
	}
	// Lien inconnu : introuvable après l'attente, demande retirée.
	s, _ := newSvc(t)
	s.KillWait = 100 * time.Millisecond
	if err := s.DestroyAdmin(rnd(32)); !errors.Is(err, ErrNotFound) {
		t.Fatal(err)
	}
	if es, _ := os.ReadDir(filepath.Join(filepath.Dir(s.FrozenFile), "kill")); len(es) != 0 {
		t.Fatal("demande restée", len(es))
	}
}

// Revue de sécurité D42-22 (point 1) : aucun octroi ni compteur de budget ne reste en mémoire
// après l'échéance (balayage) ni après une destruction.
func TestGrantsForgottenWhenShareGoes(t *testing.T) {
	s, c := newSvc(t)
	k, k2 := newKeys(), newKeys()
	exp := ready(t, s, k, 1, 1, 2)
	gone2 := ready(t, s, k2, 1, 24, 2)
	if _, err := s.UnlockGrant(exp, k.acces, k.preuve, ""); err != nil {
		t.Fatal(err)
	}
	o2, err := s.UnlockGrant(gone2, k2.acces, k2.preuve, "")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := readSegment(s, gone2, 0, o2.N); err != nil {
		t.Fatal(err)
	}
	if s.GrantCount() != 2 {
		t.Fatal(s.GrantCount())
	}
	if err := s.DestroyManaged(k2.gestion); err != nil {
		t.Fatal(err)
	}
	c.Add(2 * time.Hour) // échéance du premier, fin de grâce du second
	if _, err := s.Sweep(); err != nil {
		t.Fatal(err)
	}
	gone(t, s, exp)
	if s.GrantCount() != 0 || s.BudgetCount() != 0 {
		t.Fatal("restés en mémoire :", s.GrantCount(), s.BudgetCount())
	}
}

// Point 1 (bis) : partage effacé hors de ce processus (administrateur) : les octrois partent
// au plus tard à la fin de grâce de son échéance.
func TestGrantsForgottenAfterOutOfProcessDelete(t *testing.T) {
	s, c := newSvc(t)
	k := newKeys()
	id := ready(t, s, k, 1, 1, 2)
	o, err := s.UnlockGrant(id, k.acces, k.preuve, "")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := readSegment(s, id, 0, o.N); err != nil { // compteur de budget créé
		t.Fatal(err)
	}
	if _, err := s.DB.Exec(`DELETE FROM shares WHERE id=?`, id); err != nil {
		t.Fatal(err)
	}
	c.Add(4 * time.Hour)
	if _, err := s.Sweep(); err != nil {
		t.Fatal(err)
	}
	if s.GrantCount() != 0 || s.BudgetCount() != 0 {
		t.Fatal(s.GrantCount(), s.BudgetCount())
	}
}

// Point 2 : le budget d'une ouverture ne repart pas à zéro à l'échéance (grâce de 2 h).
func TestBudgetNotResetAtExpiry(t *testing.T) {
	s, c := newSvc(t)
	k := newKeys()
	id := ready(t, s, k, gb, 1, 2)
	o, _ := s.UnlockGrant(id, k.acces, k.preuve, "")
	segs := SegmentCount(gb)
	m, err := s.Meta(k.acces)
	if err != nil {
		t.Fatal(err)
	}
	c.Add(m.ExpiresIn - 30*time.Second)
	var last error
	for i := 0; i < 3 && last == nil; i++ {
		for n := range segs {
			if _, last = readSegment(s, id, n, o.N); last != nil {
				break
			}
		}
	}
	if !errors.Is(last, ErrBudget) {
		t.Fatal("budget non épuisé", last)
	}
	c.Add(31 * time.Second)
	if _, err := s.Sweep(); err != nil {
		t.Fatal(err)
	}
	if _, err := readSegment(s, id, 0, o.N); !errors.Is(err, ErrBudget) {
		t.Fatal("budget remis à zéro pendant la grâce", err)
	}
}

// Point 3 : budget = ReadBudget + min(r × fichier, max(3 × fichier, 256 Mio)) : un petit partage
// relit à chaque retour, un gros fichier trois fois de plus au plus.
func TestReopenBudgetCapped(t *testing.T) {
	s, _ := newSvc(t)
	k := openKey{"AAAAAAAAAAAAAAAAAAAAAA", 1}
	big := 32769 // plus grand palier gratuit (2 Gio)
	s.gone.mu.Lock()
	s.gone.init()
	s.gone.grants[k] = &grantEntry{reopens: 20}
	gotBig := s.budgetLocked(k, big)
	gotSmall := s.budgetLocked(k, 1)
	s.gone.unlock()
	if want := ReadBudget(big) + 3*totalSize(big); gotBig != want {
		t.Fatal("gros", gotBig, want)
	}
	if want := ReadBudget(1) + 20*totalSize(1); gotSmall != want {
		t.Fatal("petit", gotSmall, want)
	}
}

// Point 4 : last_open seulement pour la dernière ouverture permise (n = opens_issued, plus
// aucune ouverture) ; une personne qui revient sans être la dernière ne l'a pas.
func TestLastOpen(t *testing.T) {
	s, _ := newSvc(t)
	k := newKeys()
	id := ready(t, s, k, 1, 24, 2)
	a, _ := s.UnlockGrant(id, k.acces, k.preuve, "")
	if a.LastOpen {
		t.Fatal("première sur deux")
	}
	b, _ := s.UnlockGrant(id, k.acces, k.preuve, "")
	if !b.LastOpen || b.OpensLeft != 0 {
		t.Fatal("dernière", b)
	}
	ra, err := s.UnlockGrant(id, k.acces, k.preuve, a.Grant)
	if err != nil || ra.LastOpen || ra.OpensLeft != 0 {
		t.Fatal("retour de la première", ra, err)
	}
	rb, err := s.UnlockGrant(id, k.acces, k.preuve, b.Grant)
	if err != nil || !rb.LastOpen {
		t.Fatal("retour de la dernière", rb, err)
	}
}

// Relecture du 12 novembre (B) : suppression du fichier en échec pendant qu'une lecture tient
// le descripteur détaché (refs > 0) : la ligne reste, le partage vit ; ses octrois et budgets
// ne doivent pas être oubliés quand ce descripteur est refermé, et un retrait suivant garde
// les ouvertures qui finissent encore.
func TestFailedDestroyKeepsGrantsOfLiveShare(t *testing.T) {
	s, c := newSvc(t)
	k := newKeys()
	id := ready(t, s, k, gb, 24, 2)
	o1, _ := s.UnlockGrant(id, k.acces, k.preuve, "")
	if _, err := s.UnlockGrant(id, k.acces, k.preuve, ""); err != nil {
		t.Fatal(err)
	}
	mustRead(t, s, id, 0, o1.N) // ouverture 1 active : droit de finir
	orig := deleteBlob
	t.Cleanup(func() { deleteBlob = orig })
	boom := errors.New("disque")
	var held *Segment
	deleteBlob = func(*blob.Store, string) error {
		seg, err := s.OpenSegment(id, 1, o1.N) // servi par le descripteur détaché : refs > 0
		if err != nil {
			t.Error(err)
		}
		held = seg
		return boom
	}
	if err := s.DestroyManaged(k.gestion); !errors.Is(err, boom) {
		t.Fatal(err)
	}
	deleteBlob = orig
	if rowCount(t, s, id) != 1 {
		t.Fatal("ligne effacée")
	}
	held.Close()
	c.Add(3 * time.Minute) // plus active : le descripteur détaché est refermé
	if _, err := s.Sweep(); err != nil {
		t.Fatal(err)
	}
	if s.GrantCount() != 2 || s.BudgetCount() == 0 {
		t.Fatal("octrois ou budgets oubliés d'un partage vivant", s.GrantCount(), s.BudgetCount())
	}
	if _, err := s.UnlockGrant(id, k.acces, k.preuve, o1.Grant); err != nil {
		t.Fatal("retour refusé sur un partage vivant", err)
	}
}

// Le chiffre 20 est écrit dans les textes (lost.limit, content.return.limits, fr et en) : le
// changer demande de changer les textes (relecture du 12 novembre).
func TestMaxReopensMatchesTexts(t *testing.T) {
	if MaxReopens != 20 {
		t.Fatal("MaxReopens a changé : mettre à jour lost.limit et content.return.limits (fr, en)", MaxReopens)
	}
}
