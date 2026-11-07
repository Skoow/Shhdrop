package janitor

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/skoow/shhdrop/server/internal/blob"
	"github.com/skoow/shhdrop/server/internal/share"
	"github.com/skoow/shhdrop/server/internal/store"
)

type clock struct {
	mu sync.Mutex
	t  time.Time
}

func (c *clock) Now() time.Time      { c.mu.Lock(); defer c.mu.Unlock(); return c.t }
func (c *clock) Add(d time.Duration) { c.mu.Lock(); c.t = c.t.Add(d); c.mu.Unlock() }

func newSvc(t *testing.T) (*share.Service, *clock) {
	t.Helper()
	dir := t.TempDir()
	db, err := store.Open(filepath.Join(dir, "shares.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	c := &clock{t: time.Date(2026, 11, 4, 10, 2, 0, 0, time.UTC)}
	s, err := share.NewService(share.Config{DB: db, Blobs: &blob.Store{Dir: filepath.Join(dir, "blobs")}, Now: c.Now,
		StorageMax: 1 << 40, FrozenFile: filepath.Join(dir, "frozen")})
	if err != nil {
		t.Fatal(err)
	}
	return s, c
}

func rnd(n int) []byte    { b := make([]byte, n); rand.Read(b); return b }
func sum(b []byte) []byte { h := sha256.Sum256(b); return h[:] }

func create(t *testing.T, s *share.Service) (string, int) {
	t.Helper()
	id, segs, err := s.Create(share.CreateReq{ID: base64.RawURLEncoding.EncodeToString(rnd(16)), Bucket: 1,
		AccessV: sum(rnd(8)), ManageV: sum(rnd(8))})
	if err != nil {
		t.Fatal(err)
	}
	return id, segs
}

func ready(t *testing.T, s *share.Service) string {
	t.Helper()
	id, segs := create(t, s)
	for n := 0; n < segs; n++ {
		if err := s.PutSegment(id, n, bytes.Repeat([]byte{1}, share.SegmentSize(1, n))); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := s.Finalize(id, share.FinalizeReq{TTLHours: 1, MaxOpens: 1, KdfOps: 3, KdfMem: 67108864,
		Salt: rnd(16), ProofV: sum(rnd(8)), Envelope: rnd(share.EnvelopeLen)}); err != nil {
		t.Fatal(err)
	}
	return id
}

func rows(t *testing.T, s *share.Service, id string) int {
	t.Helper()
	var n int
	if err := s.DB.QueryRow("SELECT count(*) FROM shares WHERE id=?", id).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func fileExists(s *share.Service, id string) bool {
	_, err := os.Stat(filepath.Join(s.Blobs.Dir, id))
	return !errors.Is(err, os.ErrNotExist)
}

func TestSweepExpired(t *testing.T) {
	s, c := newSvc(t)
	id := ready(t, s)
	var e int64
	s.DB.QueryRow("SELECT expires_at FROM shares WHERE id=?", id).Scan(&e)
	exp := time.Unix(e, 0)
	c.Add(exp.Sub(c.Now()) - time.Second)
	if n, err := s.Sweep(); err != nil || n != 0 {
		t.Fatal("trop tôt", n, err)
	}
	c.Add(2 * time.Second)
	if n, err := s.Sweep(); err != nil || n != 1 {
		t.Fatal(n, err)
	}
	if rows(t, s, id) != 0 || fileExists(s, id) {
		t.Fatal("partage expiré encore présent")
	}
}

func TestSweepUnfinishedUpload(t *testing.T) {
	s, c := newSvc(t)
	id, _ := create(t, s) // 10:02 : upload_deadline = 16:15
	// Un segment toutes les 10 min : l'envoi n'est ni « vide » ni bloqué, il vit jusqu'à l'échéance.
	for i := 0; i < 37; i++ { // 10:02 … 16:02
		if err := s.PutSegment(id, 0, bytes.Repeat([]byte{1}, share.SegmentSize(1, 0))); err != nil {
			t.Fatal(err)
		}
		if i < 36 {
			c.Add(10 * time.Minute)
		}
	}
	c.Add(12 * time.Minute) // 16:14
	s.Sweep()
	if rows(t, s, id) != 1 {
		t.Fatal("effacé avant upload_deadline")
	}
	c.Add(time.Minute) // 16:15
	if n, err := s.Sweep(); err != nil || n != 1 {
		t.Fatal(n, err)
	}
	if rows(t, s, id) != 0 || fileExists(s, id) {
		t.Fatal("envoi abandonné encore présent")
	}
}

func TestReconcile(t *testing.T) {
	s, _ := newSvc(t)
	keep := ready(t, s)
	noFile, _ := create(t, s) // ligne dont on supprime le fichier
	if err := s.Blobs.Delete(noFile); err != nil {
		t.Fatal(err)
	}
	orphan := "AAAAAAAAAAAAAAAAAAAAAA"
	if err := s.Blobs.Reserve(orphan, 100); err != nil {
		t.Fatal(err)
	}
	foreign := filepath.Join(s.Blobs.Dir, "notes.txt")
	os.WriteFile(foreign, []byte("x"), 0o600)

	if err := Reconcile(s); err != nil {
		t.Fatal(err)
	}
	if fileExists(s, orphan) {
		t.Fatal("fichier orphelin conservé")
	}
	if rows(t, s, noFile) != 0 {
		t.Fatal("ligne orpheline conservée")
	}
	if rows(t, s, keep) != 1 || !fileExists(s, keep) {
		t.Fatal("partage valide touché")
	}
	if _, err := os.Stat(foreign); err != nil {
		t.Fatal("fichier étranger touché")
	}
}

func TestRun(t *testing.T) {
	s, c := newSvc(t)
	id, _ := create(t, s)
	c.Add(2 * time.Hour)
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() { Run(ctx, s, s.DB, 10*time.Millisecond); close(done) }()
	deadline := time.Now().Add(5 * time.Second)
	for rows(t, s, id) != 0 {
		if time.Now().After(deadline) {
			t.Fatal("Run n'a rien nettoyé")
		}
		time.Sleep(10 * time.Millisecond)
	}
	cancel()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("Run ne s'arrête pas")
	}
}
