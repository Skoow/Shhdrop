package share

import (
	"database/sql"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/skoow/shhdrop/server/internal/blob"
	"github.com/skoow/shhdrop/server/internal/store"
)

// upMem : échéances en mémoire d'un envoi (spec §36 S5, S12).
func upMem(s *Service, id string) (upload, bool) {
	s.mem.mu.Lock()
	defer s.mem.mu.Unlock()
	u, ok := s.mem.up[id]
	return u, ok
}

func purgeMem(s *Service, id string) (int64, bool) {
	s.mem.mu.Lock()
	defer s.mem.mu.Unlock()
	p, ok := s.mem.purge[id]
	return p, ok
}

// dbDates : toutes les valeurs entières non nulles de la ligne qui ressemblent à une date.
func dbRow(t *testing.T, s *Service, id string) (ttl sql.NullInt64, exp sql.NullInt64) {
	t.Helper()
	if err := s.DB.QueryRow(`SELECT ttl_hours, expires_at FROM shares WHERE id=?`, id).Scan(&ttl, &exp); err != nil {
		t.Fatal(err)
	}
	return
}

// S5, S11, S12 : après finalize, la base ne garde qu'une date (expires_at, multiple de
// 900) et ttl_hours est NULL ; les échéances d'envoi, de blocage et de purge vivent en mémoire.
func TestOnlyExpiresAtInDB(t *testing.T) {
	s, c := newSvc(t)
	k := newKeys()
	c.Add(37 * time.Second)
	id, _, err := s.createAny(k.req(1, 6, 1))
	if err != nil {
		t.Fatal(err)
	}
	u, ok := upMem(s, id)
	if !ok || u.deadline != time.Date(2026, 11, 4, 16, 15, 0, 0, time.UTC).Unix() || u.progress != 0 {
		t.Fatalf("échéance d'envoi en mémoire : %+v %v", u, ok)
	}
	ttl, exp := dbRow(t, s, id)
	if ttl.Valid || exp.Valid {
		t.Fatal("dates en base pendant l'envoi", ttl, exp)
	}
	if err := s.PutSegment(id, 0, segBody(1, 0, 1)); err != nil {
		t.Fatal(err)
	}
	if u, _ := upMem(s, id); u.progress != time.Date(2026, 11, 4, 10, 2, 0, 0, time.UTC).Unix() {
		t.Fatal("progress à la minute, en mémoire", u)
	}
	if _, err := s.Finalize(id, fin(id)); err != nil {
		t.Fatal(err)
	}
	if _, ok := upMem(s, id); ok {
		t.Fatal("échéance d'envoi gardée après finalize")
	}
	ttl, exp = dbRow(t, s, id)
	if ttl.Valid || !exp.Valid || exp.Int64%900 != 0 {
		t.Fatal("après finalize : ttl_hours NULL, expires_at multiple de 900", ttl, exp)
	}
	if _, _, err := s.Unlock(id, k.acces, k.preuve); err != nil { // dernière ouverture → draining
		t.Fatal(err)
	}
	p, ok := purgeMem(s, id)
	if !ok || p != exp.Int64 { // min(ceil15(now+6h), expires_at) = expires_at (6 h)
		t.Fatal("purge en mémoire", p, ok, exp.Int64)
	}
	ttl, exp2 := dbRow(t, s, id)
	if ttl.Valid || exp2 != exp {
		t.Fatal("draining : rien de plus en base", ttl, exp2)
	}
}

// Redémarrage simulé (nouveau Service sur la même base) : tout partage « uploading » ou
// « draining », ou expiré, est effacé, fichier compris (aucun jeton ne survit) ; un « ready »
// vivant reste.
func TestPurgeAtStart(t *testing.T) {
	dir := t.TempDir()
	db, err := store.Open(filepath.Join(dir, "shares.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	c := &clock{t: time.Date(2026, 11, 4, 10, 2, 0, 0, time.UTC)}
	cfg := Config{DB: db, Blobs: &blob.Store{Dir: filepath.Join(dir, "blobs")}, Now: c.Now,
		StorageMax: 1 << 40, FrozenFile: filepath.Join(dir, "frozen")}
	s, err := NewService(cfg)
	if err != nil {
		t.Fatal(err)
	}
	up, _, _ := s.createAny(newKeys().req(1, 1, 1))
	kd := newKeys()
	draining := ready(t, s, kd, 1, 24, 1)
	s.Unlock(draining, kd.acces, kd.preuve)
	alive := ready(t, s, newKeys(), 1, 24, 2)
	expired := ready(t, s, newKeys(), 1, 1, 2)
	c.Add(2 * time.Hour)

	s2, err := NewService(cfg)
	if err != nil {
		t.Fatal(err)
	}
	if n, err := s2.PurgeAtStart(); err != nil || n != 3 {
		t.Fatal(n, err)
	}
	for _, id := range []string{up, draining, expired} {
		gone(t, s2, id)
	}
	if rowCount(t, s2, alive) != 1 {
		t.Fatal("partage prêt effacé")
	}
	if _, err := os.Stat(filepath.Join(dir, "blobs", alive)); err != nil {
		t.Fatal(err)
	}
}

// Les règles d'envoi et de purge restent les mêmes avec des échéances en mémoire : un
// envoi inconnu de la mémoire (aucun Create dans ce processus) n'accepte aucun segment.
func TestUploadUnknownToMemory(t *testing.T) {
	s, _ := newSvc(t)
	id, _, err := s.createAny(newKeys().req(1, 1, 1))
	if err != nil {
		t.Fatal(err)
	}
	s.mem.mu.Lock()
	delete(s.mem.up, id)
	s.mem.mu.Unlock()
	if err := s.PutSegment(id, 0, segBody(1, 0, 1)); !errors.Is(err, ErrNotFound) {
		t.Fatal(err)
	}
	if _, err := s.Finalize(id, fin(id)); !errors.Is(err, ErrNotFound) {
		t.Fatal(err)
	}
}
