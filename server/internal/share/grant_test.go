package share

import (
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/skoow/shhdrop/server/internal/blob"
)

// Octroi d'ouverture (spec §41.4, plan amendement v2.9).

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
	g := IssueGrant(key, id, 3, now.Add(GrantTTL))
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
		"expiré":         func() bool { _, ok := VerifyGrant(key, id, g, now.Add(GrantTTL)); return ok },
		"vide":           func() bool { _, ok := VerifyGrant(key, id, "", now); return ok },
		"mauvaise forme": func() bool { _, ok := VerifyGrant(key, id, g[:53]+"=", now); return ok },
	} {
		if c() {
			t.Error(name, ": accepté")
		}
	}
}

// Recharger : même ouverture, aucune consommée, jeton neuf, octroi renouvelé.
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
	if err != nil || r.N != 1 || r.Grant == o.Grant || len(r.Envelope) != EnvelopeLen || r.OpensLeft != 2 {
		t.Fatal(r, err)
	}
	if left, issued, _ := opensOf(t, s, id); left != 2 || issued != 1 {
		t.Fatal("ouverture consommée", left, issued)
	}
	// L'octroi renouvelé vaut 30 min depuis le rechargement.
	c.Add(29 * time.Minute)
	if _, err := s.UnlockGrant(id, k.acces, k.preuve, r.Grant); err != nil {
		t.Fatal(err)
	}
	m, err := s.MetaGrant(k.acces, r.Grant)
	if err != nil || m.OpensLeft != 2 {
		t.Fatal(m, err)
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
	c.Add(GrantTTL)
	check("expiré", o.Grant, k.preuve)
	// Renouvelé par regrant, puis terminé par done.
	c.Add(-GrantTTL)
	g, err := s.Regrant(id, o.N, c.Now().Add(6*time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	if err := s.Done(id, o.N); err != nil {
		t.Fatal(err)
	}
	check("ouverture terminée", g, k.preuve)
	if _, err := s.Regrant(id, o.N, c.Now().Add(6*time.Hour)); !errors.Is(err, ErrGone) {
		t.Fatal("regrant après done", err)
	}
}

// Au plus 10 rechargements par ouverture ; budget de lecture (2 + r) × le fichier.
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
		t.Fatal("11ᵉ rechargement", err)
	}
	if left, issued, failed := opensOf(t, s, id); left != 2 || issued != 1 || failed != 0 {
		t.Fatal(left, issued, failed)
	}
	// 10 rechargements : 10 lectures complètes de plus (le compteur n'a pas été remis à zéro).
	for i := 0; i < MaxReopens; i++ {
		if err := readAll(); err != nil {
			t.Fatal(i, err)
		}
	}
	if err := readAll(); !errors.Is(err, ErrBudget) {
		t.Fatal("budget dépassé", err)
	}
}

// regrant : 30 min de plus, jamais au-delà du jeton de téléchargement.
func TestRegrantCapped(t *testing.T) {
	s, c := newSvc(t)
	k := newKeys()
	id := ready(t, s, k, 1, 24, 3)
	o, _ := s.UnlockGrant(id, k.acces, k.preuve, "")
	idb, _ := idBytes(id)
	c.Add(20 * time.Minute)
	g, err := s.Regrant(id, o.N, c.Now().Add(6*time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := VerifyGrant(s.grantKey, idb, g, c.Now().Add(GrantTTL-time.Second)); !ok {
		t.Fatal("30 min attendues")
	}
	g, err = s.Regrant(id, o.N, c.Now().Add(10*time.Minute))
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := VerifyGrant(s.grantKey, idb, g, c.Now().Add(10*time.Minute)); ok {
		t.Fatal("octroi au-delà du jeton")
	}
	if _, err := s.Regrant(id, o.N, c.Now()); !errors.Is(err, ErrGone) {
		t.Fatal("jeton échu", err)
	}
}

// Octroi expiré sans renouvellement : le balayage termine l'ouverture ; un « draining » est
// alors effacé. Une ouverture qui lit encore n'est pas terminée.
func TestGrantExpirySweep(t *testing.T) {
	s, c := newSvc(t)
	k, k2 := newKeys(), newKeys()
	drain := ready(t, s, k, 1, 24, 1)
	live := ready(t, s, k2, gb, 24, 2)
	o, _ := s.UnlockGrant(drain, k.acces, k.preuve, "")
	o2, _ := s.UnlockGrant(live, k2.acces, k2.preuve, "")
	c.Add(GrantTTL - time.Second)
	mustRead(t, s, live, 0, o2.N)
	if _, err := s.Sweep(); err != nil {
		t.Fatal(err)
	}
	if rowCount(t, s, drain) != 1 {
		t.Fatal("effacé avant l'expiration de l'octroi")
	}
	c.Add(time.Minute)
	if _, err := s.Sweep(); err != nil {
		t.Fatal(err)
	}
	gone(t, s, drain)
	if _, err := s.MetaGrant(k.acces, o.Grant); !errors.Is(err, ErrNotFound) {
		t.Fatal(err)
	}
	mustRead(t, s, live, 1, o2.N) // active : pas terminée
	c.Add(3 * time.Minute)
	if _, err := s.Sweep(); err != nil {
		t.Fatal(err)
	}
	mustGone(t, s, live, 2, o2.N)
	if s.GrantCount() != 0 {
		t.Fatal("octrois restants", s.GrantCount())
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
