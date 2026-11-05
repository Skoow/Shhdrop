package share

import (
	"bytes"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"errors"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/skoow/shhdrop/server/internal/blob"
	"github.com/skoow/shhdrop/server/internal/store"
)

// horloge simulée, sûre en parallèle
type clock struct {
	mu sync.Mutex
	t  time.Time
}

func (c *clock) Now() time.Time      { c.mu.Lock(); defer c.mu.Unlock(); return c.t }
func (c *clock) Add(d time.Duration) { c.mu.Lock(); c.t = c.t.Add(d); c.mu.Unlock() }

type keys struct{ acces, preuve, gestion []byte }

func rnd(n int) []byte {
	b := make([]byte, n)
	rand.Read(b)
	return b
}

func sum(b []byte) []byte { h := sha256.Sum256(b); return h[:] }

func newKeys() keys { return keys{rnd(32), rnd(32), rnd(32)} }

func (k keys) req(bucket, ttl, opens int) CreateReq {
	return CreateReq{Bucket: bucket, TTLHours: ttl, MaxOpens: opens, KdfOps: 3, KdfMem: 67108864,
		Salt: rnd(16), AccessV: sum(k.acces), ProofV: sum(k.preuve), ManageV: sum(k.gestion)}
}

func newSvc(t *testing.T) (*Service, *clock) {
	t.Helper()
	dir := t.TempDir()
	db, err := store.Open(filepath.Join(dir, "shares.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	c := &clock{t: time.Date(2026, 11, 4, 10, 2, 0, 0, time.UTC)}
	s, err := NewService(Config{DB: db, Blobs: &blob.Store{Dir: filepath.Join(dir, "blobs")}, Now: c.Now,
		StorageMax: 1 << 40, FrozenFile: filepath.Join(dir, "frozen")})
	if err != nil {
		t.Fatal(err)
	}
	return s, c
}

func segBody(bucket, n int, fill byte) []byte {
	return bytes.Repeat([]byte{fill}, SegmentSize(bucket, n))
}

// ready crée un partage complet (segments remplis de n+1) et le finalise.
func ready(t *testing.T, s *Service, k keys, bucket, ttl, opens int) string {
	t.Helper()
	id, segs, err := s.Create(k.req(bucket, ttl, opens))
	if err != nil {
		t.Fatal(err)
	}
	for n := 0; n < segs; n++ {
		if err := s.PutSegment(id, n, segBody(bucket, n, byte(n+1))); err != nil {
			t.Fatal(n, err)
		}
	}
	if _, err := s.Finalize(id); err != nil {
		t.Fatal(err)
	}
	return id
}

func rowCount(t *testing.T, s *Service, id string) int {
	t.Helper()
	var n int
	if err := s.DB.QueryRow("SELECT count(*) FROM shares WHERE id=?", id).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func gone(t *testing.T, s *Service, id string) {
	t.Helper()
	if rowCount(t, s, id) != 0 {
		t.Fatal("ligne encore présente")
	}
	if _, err := os.Stat(filepath.Join(s.Blobs.Dir, id)); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("fichier encore présent", err)
	}
}

func TestSizing(t *testing.T) {
	if got := SegmentSize(1600, 0); got != 48+64*65552 {
		t.Fatal(got)
	}
	if got := SegmentSize(16, 0); got != 48+16*65552 {
		t.Fatal(got)
	}
	if SegmentCount(1600) != 25 || SegmentCount(1) != 1 || SegmentCount(80) != 2 {
		t.Fatal("SegmentCount")
	}
	if SegmentSize(80, 1) != 16*65552 {
		t.Fatal("dernier segment partiel", SegmentSize(80, 1))
	}
	// Spec §24 : paliers jusqu'à 16 384 morceaux (1 Gio utile), 256 segments.
	want := []int{1, 16, 80, 160, 400, 800, 1600, 4000, 8000, 16384}
	if len(Buckets) != len(want) {
		t.Fatal("Buckets", Buckets)
	}
	for i := range want {
		if Buckets[i] != want[i] {
			t.Fatal("Buckets", Buckets)
		}
	}
	if SegmentCount(16384) != 256 || SegmentCount(4000) != 63 || SegmentCount(8000) != 125 {
		t.Fatal("SegmentCount grands paliers")
	}
	if SegmentSize(16384, 255) != 64*65552 || SegmentSize(4000, 62) != 32*65552 || SegmentSize(8000, 124) != 64*65552 {
		t.Fatal("SegmentSize grands paliers")
	}
	if totalSize(16384) != 48+16384*65552 || segOffset(16384, 255) != 48+255*64*65552 {
		t.Fatal("totalSize / segOffset 16384")
	}
	if m := fullMask(256); len(m) != 32 || !bytes.Equal(m, bytes.Repeat([]byte{0xff}, 32)) {
		t.Fatal("fullMask(256)", m)
	}
	for _, b := range Buckets {
		total := 0
		for n := 0; n < SegmentCount(b); n++ {
			if segOffset(b, n) != total {
				t.Fatal("offset", b, n)
			}
			total += SegmentSize(b, n)
		}
		if total != 48+b*65552 {
			t.Fatal(b, total)
		}
	}
}

func TestFullFlow(t *testing.T) {
	s, _ := newSvc(t)
	k := newKeys()
	id, segs, err := s.Create(k.req(1600, 1, 1))
	if err != nil {
		t.Fatal(err)
	}
	if segs != 25 || len(id) != 22 {
		t.Fatal(segs, id)
	}
	fi, err := os.Stat(filepath.Join(s.Blobs.Dir, id))
	if err != nil || fi.Size() != 48+1600*65552 {
		t.Fatal("réservation", err)
	}
	for n := 0; n < segs; n++ {
		if err := s.PutSegment(id, n, segBody(1600, n, byte(n+1))); err != nil {
			t.Fatal(n, err)
		}
	}
	exp, err := s.Finalize(id)
	if err != nil || exp != 73*time.Minute {
		t.Fatal(exp, err)
	}
	m, err := s.Meta(id, k.acces)
	if err != nil || m.Bucket != 1600 || m.Segments != 25 || m.KdfOps != 3 || m.KdfMem != 67108864 ||
		len(m.Salt) != 16 || m.ExpiresIn != 73*time.Minute {
		t.Fatalf("%+v %v", m, err)
	}
	openN, err := s.Unlock(id, k.acces, k.preuve)
	if err != nil || openN != 1 {
		t.Fatal(openN, err)
	}
	for _, n := range []int{0, 7, 24} {
		got, err := s.ReadSegment(id, n, openN)
		if err != nil || !bytes.Equal(got, segBody(1600, n, byte(n+1))) {
			t.Fatal("lecture", n, err)
		}
	}
	st, err := s.Status(id, k.gestion)
	if err != nil || st.State != "draining" || st.OpensUsed != 1 || st.MaxOpens != 1 {
		t.Fatalf("%+v %v", st, err)
	}
	if _, err := s.Unlock(id, k.acces, k.preuve); !errors.Is(err, ErrNotFound) {
		t.Fatal("2e ouverture", err)
	}
	if err := s.Done(id, openN); err != nil {
		t.Fatal(err)
	}
	gone(t, s, id)
}

func TestFinalizeRounding(t *testing.T) {
	s, _ := newSvc(t)
	k := newKeys()
	id := ready(t, s, k, 1, 1, 1)
	var exp int64
	s.DB.QueryRow("SELECT expires_at FROM shares WHERE id=?", id).Scan(&exp)
	if want := time.Date(2026, 11, 4, 11, 15, 0, 0, time.UTC).Unix(); exp != want {
		t.Fatal(time.Unix(exp, 0).UTC())
	}
	var dl *int64
	s.DB.QueryRow("SELECT upload_deadline FROM shares WHERE id=?", id).Scan(&dl)
	if dl != nil {
		t.Fatal("upload_deadline doit être effacé (révèle la date de création)")
	}
	if ceil15(900*10) != 900*10 || ceil15(900*10+1) != 900*11 {
		t.Fatal("ceil15")
	}
}

func TestFinalizeIncomplete(t *testing.T) {
	s, _ := newSvc(t)
	k := newKeys()
	id, _, _ := s.Create(k.req(80, 1, 1))
	s.PutSegment(id, 1, segBody(80, 1, 1))
	if _, err := s.Finalize(id); !errors.Is(err, ErrIncomplete) {
		t.Fatal(err)
	}
}

func TestPutSegmentRules(t *testing.T) {
	s, c := newSvc(t)
	k := newKeys()
	id, segs, _ := s.Create(k.req(80, 1, 1))
	if err := s.PutSegment(id, segs, segBody(80, 0, 1)); !errors.Is(err, ErrBadSegment) {
		t.Fatal("n hors palier", err)
	}
	if err := s.PutSegment(id, -1, segBody(80, 0, 1)); !errors.Is(err, ErrBadSegment) {
		t.Fatal("n négatif", err)
	}
	if err := s.PutSegment(id, 0, segBody(80, 0, 1)[1:]); !errors.Is(err, ErrBadSegment) {
		t.Fatal("taille - 1", err)
	}
	if err := s.PutSegment(id, 1, append(segBody(80, 1, 1), 0)); !errors.Is(err, ErrBadSegment) {
		t.Fatal("taille + 1", err)
	}
	// renvoi = remplacement
	s.PutSegment(id, 0, segBody(80, 0, 1))
	s.PutSegment(id, 0, segBody(80, 0, 9))
	s.PutSegment(id, 1, segBody(80, 1, 2))
	if _, err := s.Finalize(id); err != nil {
		t.Fatal(err)
	}
	if n, _ := s.Unlock(id, k.acces, k.preuve); n != 1 {
		t.Fatal("unlock", n)
	}
	if got, _ := s.ReadSegment(id, 0, 1); !bytes.Equal(got, segBody(80, 0, 9)) {
		t.Fatal("remplacement")
	}
	if err := s.PutSegment(id, 0, segBody(80, 0, 1)); !errors.Is(err, ErrNotFound) {
		t.Fatal("après finalize", err)
	}
	// envoi abandonné : délai de 3 h arrondi au quart d'heure (10:02 → 13:15)
	id2, _, _ := s.Create(k.req(1, 1, 1))
	c.Add(3*time.Hour + 12*time.Minute) // 13:14 : encore accepté
	if err := s.PutSegment(id2, 0, segBody(1, 0, 1)); err != nil {
		t.Fatal("avant délai", err)
	}
	c.Add(time.Minute) // 13:15
	if err := s.PutSegment(id2, 0, segBody(1, 0, 1)); !errors.Is(err, ErrNotFound) {
		t.Fatal("après délai", err)
	}
	if err := s.PutSegment("pas-un-id", 0, nil); !errors.Is(err, ErrNotFound) {
		t.Fatal("id invalide", err)
	}
}

func TestParallelPutSegments(t *testing.T) {
	s, _ := newSvc(t)
	k := newKeys()
	id, segs, _ := s.Create(k.req(1600, 1, 1))
	var wg sync.WaitGroup
	for n := 0; n < segs; n++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if err := s.PutSegment(id, n, segBody(1600, n, byte(n))); err != nil {
				t.Error(err)
			}
		}()
	}
	wg.Wait()
	if _, err := s.Finalize(id); err != nil {
		t.Fatal("masque incomplet après envois parallèles", err)
	}
}

func TestWrongAccessKey(t *testing.T) {
	s, _ := newSvc(t)
	k := newKeys()
	id := ready(t, s, k, 1, 1, 1)
	if _, err := s.Meta(id, rnd(32)); !errors.Is(err, ErrNotFound) {
		t.Fatal(err)
	}
	if _, err := s.Unlock(id, rnd(32), k.preuve); !errors.Is(err, ErrNotFound) {
		t.Fatal(err)
	}
	if _, err := s.Unlock(id, rnd(32), rnd(32)); !errors.Is(err, ErrNotFound) {
		t.Fatal(err)
	}
	var fa int
	s.DB.QueryRow("SELECT failed_attempts FROM shares WHERE id=?", id).Scan(&fa)
	if fa != 0 {
		t.Fatal("failed_attempts", fa)
	}
	if _, err := s.Meta("AAAAAAAAAAAAAAAAAAAAAA", k.acces); !errors.Is(err, ErrNotFound) {
		t.Fatal(err)
	}
}

func TestWrongPasswordSequence(t *testing.T) {
	s, _ := newSvc(t)
	k := newKeys()
	id := ready(t, s, k, 1, 1, 1)
	for want := 4; want >= 0; want-- {
		_, err := s.Unlock(id, k.acces, rnd(32))
		var bp *BadPassword
		if !errors.As(err, &bp) || bp.AttemptsLeft != want {
			t.Fatal(want, err)
		}
	}
	gone(t, s, id)
	if _, err := s.Unlock(id, k.acces, k.preuve); !errors.Is(err, ErrNotFound) {
		t.Fatal(err)
	}
}

func TestParallelWrongUnlock(t *testing.T) {
	s, _ := newSvc(t)
	k := newKeys()
	id := ready(t, s, k, 1, 1, 1)
	var wg sync.WaitGroup
	var mu sync.Mutex
	bad, zero := 0, 0
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := s.Unlock(id, k.acces, rnd(32))
			var bp *BadPassword
			mu.Lock()
			defer mu.Unlock()
			switch {
			case errors.As(err, &bp):
				bad++
				if bp.AttemptsLeft == 0 {
					zero++
				}
			case errors.Is(err, ErrNotFound):
			default:
				t.Error(err)
			}
		}()
	}
	wg.Wait()
	if bad > 5 || zero != 1 {
		t.Fatal("essais comptés", bad, zero)
	}
	gone(t, s, id)
}

func TestParallelCorrectUnlock(t *testing.T) {
	s, _ := newSvc(t)
	k := newKeys()
	id := ready(t, s, k, 1, 1, 3)
	var wg sync.WaitGroup
	var mu sync.Mutex
	got := map[int]bool{}
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			n, err := s.Unlock(id, k.acces, k.preuve)
			mu.Lock()
			defer mu.Unlock()
			if err == nil {
				if got[n] {
					t.Error("numéro d'ouverture en double", n)
				}
				got[n] = true
			} else if !errors.Is(err, ErrNotFound) {
				t.Error(err)
			}
		}()
	}
	wg.Wait()
	if len(got) != 3 || !got[1] || !got[2] || !got[3] {
		t.Fatal(got)
	}
	st, _ := s.Status(id, k.gestion)
	if st.State != "draining" || st.OpensUsed != 3 {
		t.Fatalf("%+v", st)
	}
}

func TestDoneIdempotent(t *testing.T) {
	s, _ := newSvc(t)
	k := newKeys()
	id := ready(t, s, k, 1, 1, 2)
	n1, _ := s.Unlock(id, k.acces, k.preuve)
	if err := s.Done(id, n1); err != nil {
		t.Fatal(err)
	}
	if err := s.Done(id, n1); err != nil {
		t.Fatal(err)
	}
	n2, err := s.Unlock(id, k.acces, k.preuve)
	if err != nil || n2 != 2 {
		t.Fatal(n2, err)
	}
	// Le doublon de Done(n1) ne doit pas compter pour n2.
	if err := s.Done(id, n1); err != nil {
		t.Fatal(err)
	}
	if rowCount(t, s, id) != 1 {
		t.Fatal("détruit alors que l'ouverture 2 n'a pas fini")
	}
	if err := s.Done(id, 3); !errors.Is(err, ErrNotFound) {
		t.Fatal("ouverture non délivrée", err)
	}
	if err := s.Done(id, 0); !errors.Is(err, ErrNotFound) {
		t.Fatal("ouverture 0", err)
	}
	if err := s.Done(id, n2); err != nil {
		t.Fatal(err)
	}
	gone(t, s, id)
}

func TestPurgeAt(t *testing.T) {
	s, c := newSvc(t)
	k := newKeys()
	id := ready(t, s, k, 1, 1, 1) // expires_at = 11:15
	c.Add(50 * time.Minute)       // 10:52
	s.Unlock(id, k.acces, k.preuve)
	var purge int64
	s.DB.QueryRow("SELECT purge_at FROM shares WHERE id=?", id).Scan(&purge)
	if want := time.Date(2026, 11, 4, 11, 15, 0, 0, time.UTC).Unix(); purge != want {
		t.Fatal("purge_at = min(now+3h, expires_at)", time.Unix(purge, 0).UTC())
	}
	id2 := ready(t, s, k, 1, 24, 1)
	s.Unlock(id2, k.acces, k.preuve) // 10:52 + 3 h = 13:52, arrondi au quart d'heure supérieur
	s.DB.QueryRow("SELECT purge_at FROM shares WHERE id=?", id2).Scan(&purge)
	if want := time.Date(2026, 11, 4, 14, 0, 0, 0, time.UTC).Unix(); purge != want {
		t.Fatal("purge_at = ceil15(now+3h)", time.Unix(purge, 0).UTC())
	}
	id3 := ready(t, s, k, 1, 6, 1) // expires_at = ceil15(10:52 + 6 h) = 17:00
	c.Add(5 * time.Hour)           // 15:52 : now + 3 h dépasse expires_at
	s.Unlock(id3, k.acces, k.preuve)
	s.DB.QueryRow("SELECT purge_at FROM shares WHERE id=?", id3).Scan(&purge)
	if want := time.Date(2026, 11, 4, 17, 0, 0, 0, time.UTC).Unix(); purge != want {
		t.Fatal("purge_at plafonné à expires_at", time.Unix(purge, 0).UTC())
	}
}

// Palier 16 384 (1 Gio utile, 256 segments) : le masque des segments couvre les 256 bits.
func TestLargestBucket(t *testing.T) {
	if testing.Short() {
		t.Skip("écrit 1 Gio")
	}
	s, _ := newSvc(t)
	k := newKeys()
	id, segs, err := s.Create(k.req(16384, 1, 1))
	if err != nil || segs != 256 {
		t.Fatal(segs, err)
	}
	body := make([]byte, SegmentSize(16384, 1))
	for n := 1; n < segs; n++ {
		if err := s.PutSegment(id, n, body); err != nil {
			t.Fatal(n, err)
		}
	}
	if err := s.PutSegment(id, 256, body); !errors.Is(err, ErrBadSegment) {
		t.Fatal("segment 256", err)
	}
	if _, err := s.Finalize(id); !errors.Is(err, ErrIncomplete) {
		t.Fatal("segment 0 manquant", err)
	}
	if err := s.PutSegment(id, 0, make([]byte, SegmentSize(16384, 0))); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Finalize(id); err != nil {
		t.Fatal(err)
	}
	fi, err := os.Stat(filepath.Join(s.Blobs.Dir, id))
	if err != nil || fi.Size() != 48+16384*65552 {
		t.Fatal(fi, err)
	}
}

// Les dates stockées sont arrondies au quart d'heure : elles ne donnent pas la minute de création.
func TestUploadDeadlineRounded(t *testing.T) {
	s, _ := newSvc(t)
	k := newKeys()
	id, _, err := s.Create(k.req(1, 1, 1)) // 10:02
	if err != nil {
		t.Fatal(err)
	}
	var dl int64
	s.DB.QueryRow("SELECT upload_deadline FROM shares WHERE id=?", id).Scan(&dl)
	if want := time.Date(2026, 11, 4, 13, 15, 0, 0, time.UTC).Unix(); dl != want {
		t.Fatal("upload_deadline = ceil15(now+3h)", time.Unix(dl, 0).UTC())
	}
}

// Un envoi sans aucun segment est balayé dès upload_deadline − 2 h 55 (5 à 20 min après
// la création, selon l'arrondi) : une réservation vide ne bloque pas l'espace 3 heures.
func TestSweepEmptyUpload(t *testing.T) {
	s, c := newSvc(t)
	k := newKeys()
	empty, _, err := s.Create(k.req(16, 1, 1)) // 10:02, échéance 13:15, balayage vide à 10:20
	if err != nil {
		t.Fatal(err)
	}
	started, _, err := s.Create(k.req(16, 1, 1))
	if err != nil {
		t.Fatal(err)
	}
	if err := s.PutSegment(started, 0, segBody(16, 0, 1)); err != nil {
		t.Fatal(err)
	}
	c.Add(10 * time.Minute) // 10:12 : l'envoi commencé progresse (reprise du segment 0)
	if err := s.PutSegment(started, 0, segBody(16, 0, 1)); err != nil {
		t.Fatal(err)
	}
	c.Add(7 * time.Minute) // 10:19
	if n, err := s.Sweep(); err != nil || n != 0 {
		t.Fatal("trop tôt", n, err)
	}
	c.Add(time.Minute) // 10:20
	if n, err := s.Sweep(); err != nil || n != 1 {
		t.Fatal(n, err)
	}
	gone(t, s, empty)
	if rowCount(t, s, started) != 1 {
		t.Fatal("envoi commencé effacé")
	}
	// Un envoi qui progresse (un segment toutes les 14 min) vit jusqu'à l'échéance de 3 h, pas plus.
	for c.Now().Before(time.Date(2026, 11, 4, 13, 0, 0, 0, time.UTC)) {
		c.Add(14 * time.Minute)
		if err := s.PutSegment(started, 0, segBody(16, 0, 1)); err != nil {
			t.Fatal(c.Now(), err)
		}
		if n, err := s.Sweep(); err != nil || n != 0 {
			t.Fatal(c.Now(), n, err)
		}
	}
	c.Add(time.Date(2026, 11, 4, 13, 14, 0, 0, time.UTC).Sub(c.Now())) // 13:14
	if n, err := s.Sweep(); err != nil || n != 0 {
		t.Fatal(n, err)
	}
	c.Add(time.Minute) // 13:15 = upload_deadline
	if n, err := s.Sweep(); err != nil || n != 1 {
		t.Fatal(n, err)
	}
	gone(t, s, started)
}

func TestReadAfterExpiry(t *testing.T) {
	s, c := newSvc(t)
	k := newKeys()
	id := ready(t, s, k, 16, 1, 2)
	s.Unlock(id, k.acces, k.preuve)
	if _, err := s.ReadSegment(id, 1, 1); !errors.Is(err, ErrBadSegment) {
		t.Fatal("n hors palier", err)
	}
	if _, err := s.ReadSegment(id, 0, 1); err != nil {
		t.Fatal(err)
	}
	c.Add(73 * time.Minute) // = expires_at
	if _, err := s.ReadSegment(id, 0, 1); !errors.Is(err, ErrNotFound) {
		t.Fatal(err)
	}
	if _, err := s.Meta(id, k.acces); !errors.Is(err, ErrNotFound) {
		t.Fatal(err)
	}
	if _, err := s.Unlock(id, k.acces, k.preuve); !errors.Is(err, ErrNotFound) {
		t.Fatal(err)
	}
}

func TestReadUploading(t *testing.T) {
	s, _ := newSvc(t)
	k := newKeys()
	id, _, _ := s.Create(k.req(1, 1, 1))
	if _, err := s.ReadSegment(id, 0, 1); !errors.Is(err, ErrNotFound) {
		t.Fatal(err)
	}
	if _, err := s.Meta(id, k.acces); !errors.Is(err, ErrNotFound) {
		t.Fatal(err)
	}
}

func TestDestroy(t *testing.T) {
	s, _ := newSvc(t)
	k := newKeys()
	id := ready(t, s, k, 1, 1, 1)
	if err := s.Destroy(id, nil, nil, rnd(32)); !errors.Is(err, ErrNotFound) {
		t.Fatal(err)
	}
	if err := s.Destroy(id, k.acces, rnd(32), nil); !errors.Is(err, ErrNotFound) {
		t.Fatal(err)
	}
	if err := s.Destroy(id, rnd(32), k.preuve, nil); !errors.Is(err, ErrNotFound) {
		t.Fatal(err)
	}
	if rowCount(t, s, id) != 1 {
		t.Fatal("détruit à tort")
	}
	if err := s.Destroy(id, nil, nil, k.gestion); err != nil {
		t.Fatal(err)
	}
	gone(t, s, id)
	if err := s.Destroy(id, nil, nil, k.gestion); !errors.Is(err, ErrNotFound) {
		t.Fatal(err)
	}
	id2 := ready(t, s, k, 1, 1, 1)
	if err := s.Destroy(id2, k.acces, k.preuve, nil); err != nil {
		t.Fatal(err)
	}
	gone(t, s, id2)
}

func TestDestroyAdmin(t *testing.T) {
	s, _ := newSvc(t)
	k := newKeys()
	id := ready(t, s, k, 1, 1, 1)
	if err := s.DestroyAdmin(id); err != nil {
		t.Fatal(err)
	}
	gone(t, s, id)
	if err := s.DestroyAdmin(id); !errors.Is(err, ErrNotFound) {
		t.Fatal(err)
	}
	if err := s.DestroyAdmin("../../etc/passwd"); !errors.Is(err, ErrNotFound) {
		t.Fatal(err)
	}
}

func TestStatus(t *testing.T) {
	s, _ := newSvc(t)
	k := newKeys()
	id, _, _ := s.Create(k.req(1, 6, 4))
	st, err := s.Status(id, k.gestion)
	if err != nil || st.State != "uploading" || st.MaxOpens != 4 || st.OpensUsed != 0 {
		t.Fatalf("%+v %v", st, err)
	}
	if _, err := s.Status(id, rnd(32)); !errors.Is(err, ErrNotFound) {
		t.Fatal(err)
	}
	s.PutSegment(id, 0, segBody(1, 0, 1))
	s.Finalize(id)
	s.Unlock(id, k.acces, k.preuve)
	st, err = s.Status(id, k.gestion)
	if err != nil || st.State != "ready" || st.OpensUsed != 1 || st.ExpiresIn != 6*time.Hour+13*time.Minute {
		t.Fatalf("%+v %v", st, err)
	}
}

func TestCreateLimits(t *testing.T) {
	s, _ := newSvc(t)
	k := newKeys()
	s.StorageMax = 2*(48+16*65552) + 48 + 65552
	if _, _, err := s.Create(k.req(16, 1, 1)); err != nil {
		t.Fatal(err)
	}
	if _, _, err := s.Create(k.req(16, 1, 1)); err != nil {
		t.Fatal(err)
	}
	if _, _, err := s.Create(k.req(16, 1, 1)); !errors.Is(err, ErrFull) {
		t.Fatal(err)
	}
	if _, _, err := s.Create(k.req(1, 1, 1)); err != nil {
		t.Fatal("encore de la place pour un petit", err)
	}
	if err := os.WriteFile(s.FrozenFile, nil, 0o600); err != nil {
		t.Fatal(err)
	}
	s.StorageMax = 1 << 40
	if _, _, err := s.Create(k.req(1, 1, 1)); !errors.Is(err, ErrFrozen) {
		t.Fatal(err)
	}
}

func TestParallelCreateFull(t *testing.T) {
	s, _ := newSvc(t)
	k := newKeys()
	s.StorageMax = 3 * (48 + 16*65552)
	var wg sync.WaitGroup
	var mu sync.Mutex
	ok := 0
	for i := 0; i < 10; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, _, err := s.Create(k.req(16, 1, 1))
			mu.Lock()
			defer mu.Unlock()
			if err == nil {
				ok++
			} else if !errors.Is(err, ErrFull) {
				t.Error(err)
			}
		}()
	}
	wg.Wait()
	if ok != 3 {
		t.Fatal("réservations au-delà du plafond", ok)
	}
}

func TestCreateValidation(t *testing.T) {
	s, _ := newSvc(t)
	k := newKeys()
	bad := []func(*CreateReq){
		func(r *CreateReq) { r.Bucket = 17 },
		func(r *CreateReq) { r.Bucket = 0 },
		func(r *CreateReq) { r.TTLHours = 2 },
		func(r *CreateReq) { r.TTLHours = 48 },
		func(r *CreateReq) { r.MaxOpens = 0 },
		func(r *CreateReq) { r.MaxOpens = 11 },
		func(r *CreateReq) { r.KdfOps = 2 },
		func(r *CreateReq) { r.KdfOps = 11 },
		func(r *CreateReq) { r.KdfMem = 67108863 },
		func(r *CreateReq) { r.KdfMem = 268435457 },
		func(r *CreateReq) { r.Salt = rnd(15) },
		func(r *CreateReq) { r.AccessV = rnd(31) },
		func(r *CreateReq) { r.ProofV = rnd(33) },
		func(r *CreateReq) { r.ManageV = nil },
	}
	for i, f := range bad {
		r := k.req(1, 1, 1)
		f(&r)
		if _, _, err := s.Create(r); !errors.Is(err, ErrBadRequest) {
			t.Fatal(i, err)
		}
	}
	for _, b := range Buckets {
		for _, ttl := range []int{1, 6, 12, 24} {
			r := k.req(b, ttl, 10)
			r.KdfOps, r.KdfMem = 10, 268435456
			if b > 16 {
				continue // évite de réserver 100 Mio par cas
			}
			if _, _, err := s.Create(r); err != nil {
				t.Fatal(b, ttl, err)
			}
		}
	}
	ids, _ := s.Blobs.List()
	if len(ids) != 8 {
		t.Fatal("refus sans réservation", len(ids))
	}
}

func TestSweep(t *testing.T) {
	s, c := newSvc(t)
	k := newKeys()
	abandoned, _, _ := s.Create(k.req(1, 1, 1))
	expired := ready(t, s, k, 1, 1, 1)  // 11:15
	long := ready(t, s, k, 1, 24, 2)    // 10:15 le lendemain
	drained := ready(t, s, k, 1, 24, 1) // draining, purge à ceil15(10:02 + 3 h) = 13:15
	s.Unlock(drained, k.acces, k.preuve)
	if n, err := s.Sweep(); err != nil || n != 0 {
		t.Fatal(n, err)
	}
	c.Add(time.Hour) // 11:02 : l'envoi abandonné (vide) est déjà échu
	if n, err := s.Sweep(); err != nil || n != 1 {
		t.Fatal(n, err)
	}
	gone(t, s, abandoned)
	c.Add(13 * time.Minute) // 11:15
	if n, err := s.Sweep(); err != nil || n != 1 {
		t.Fatal(n, err)
	}
	gone(t, s, expired)
	c.Add(2*time.Hour - time.Minute) // 13:14
	if n, err := s.Sweep(); err != nil || n != 0 {
		t.Fatal(n, err)
	}
	c.Add(time.Minute) // 13:15
	if n, err := s.Sweep(); err != nil || n != 1 {
		t.Fatal(n, err)
	}
	gone(t, s, drained)
	if rowCount(t, s, long) != 1 {
		t.Fatal("partage vivant effacé")
	}
}

// --- Correctifs, tour 1 ---

func failed(t *testing.T, s *Service, id string) int {
	t.Helper()
	var n int
	s.DB.QueryRow("SELECT failed_attempts FROM shares WHERE id=?", id).Scan(&n)
	return n
}

// blocage rend le fichier impossible à supprimer (dossier non vide à sa place).
func blocage(t *testing.T, s *Service, id string) func() {
	t.Helper()
	p := filepath.Join(s.Blobs.Dir, id)
	if err := os.Remove(p); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(p, "x"), 0o700); err != nil {
		t.Fatal(err)
	}
	return func() { os.RemoveAll(p) }
}

func TestDestroyCountsAttempts(t *testing.T) {
	s, _ := newSvc(t)
	k := newKeys()
	id := ready(t, s, k, 1, 1, 1)
	for i := 1; i <= 4; i++ {
		if err := s.Destroy(id, k.acces, rnd(32), nil); !errors.Is(err, ErrNotFound) {
			t.Fatal(err)
		}
		if failed(t, s, id) != i {
			t.Fatal("essai non compté", i)
		}
	}
	// kAcces faux : ne compte pas.
	s.Destroy(id, rnd(32), rnd(32), nil)
	if failed(t, s, id) != 4 {
		t.Fatal("kAcces faux compté")
	}
	if err := s.Destroy(id, k.acces, rnd(32), nil); !errors.Is(err, ErrNotFound) {
		t.Fatal(err)
	}
	gone(t, s, id)
	if err := s.Destroy(id, k.acces, rnd(32), nil); !errors.Is(err, ErrNotFound) {
		t.Fatal(err)
	}
	if _, err := s.Unlock(id, k.acces, k.preuve); !errors.Is(err, ErrNotFound) {
		t.Fatal(err)
	}
}

func TestMixedAttemptsShareCounter(t *testing.T) {
	s, _ := newSvc(t)
	k := newKeys()
	id := ready(t, s, k, 1, 1, 1)
	s.Unlock(id, k.acces, rnd(32))
	s.Destroy(id, k.acces, rnd(32), nil)
	s.Unlock(id, k.acces, rnd(32))
	s.Destroy(id, k.acces, rnd(32), nil)
	_, err := s.Unlock(id, k.acces, rnd(32))
	var bp *BadPassword
	if !errors.As(err, &bp) || bp.AttemptsLeft != 0 {
		t.Fatal(err)
	}
	gone(t, s, id)
}

func TestSweepContinuesOnError(t *testing.T) {
	s, c := newSvc(t)
	k := newKeys()
	a := ready(t, s, k, 1, 1, 1)
	b := ready(t, s, k, 1, 1, 1)
	d := ready(t, s, k, 1, 1, 1)
	defer blocage(t, s, b)()
	c.Add(2 * time.Hour)
	n, err := s.Sweep()
	if err == nil || n != 2 {
		t.Fatal(n, err)
	}
	gone(t, s, a)
	gone(t, s, d)
	if rowCount(t, s, b) != 1 {
		t.Fatal("ligne effacée alors que le fichier reste")
	}
}

func TestFailedDestructionRetried(t *testing.T) {
	s, _ := newSvc(t)
	k := newKeys()
	id := ready(t, s, k, 1, 24, 1)
	unblock := blocage(t, s, id)
	for i := 0; i < 5; i++ {
		s.Unlock(id, k.acces, rnd(32))
	}
	if failed(t, s, id) != 5 || rowCount(t, s, id) != 1 {
		t.Fatal("la destruction aurait dû échouer")
	}
	if _, err := s.Meta(id, k.acces); !errors.Is(err, ErrNotFound) {
		t.Fatal("Meta", err)
	}
	if _, err := s.ReadSegment(id, 0, 1); !errors.Is(err, ErrNotFound) {
		t.Fatal("ReadSegment", err)
	}
	if _, err := s.Unlock(id, k.acces, k.preuve); !errors.Is(err, ErrNotFound) {
		t.Fatal("Unlock", err)
	}
	unblock()
	if n, err := s.Sweep(); err != nil || n != 1 {
		t.Fatal(n, err)
	}
	gone(t, s, id)
}

// Sweep revérifie la condition avant d'effacer : un envoi finalisé entre la
// sélection et l'effacement n'est jamais détruit.
func TestSweepRechecksFinalized(t *testing.T) {
	s, _ := newSvc(t)
	k := newKeys()
	id := ready(t, s, k, 1, 24, 1)
	deadline := time.Date(2026, 11, 4, 13, 15, 0, 0, time.UTC).Unix() // l'ancien upload_deadline
	ok, err := s.sweepOne(id, deadline)
	if err != nil || ok {
		t.Fatal(ok, err)
	}
	if rowCount(t, s, id) != 1 {
		t.Fatal("partage finalisé détruit")
	}
	if _, err := s.Unlock(id, k.acces, k.preuve); err != nil {
		t.Fatal("unlock", err)
	}
	if _, err := s.ReadSegment(id, 0, 1); err != nil {
		t.Fatal("fichier détruit", err)
	}
}

func TestCreateCleansUpOnInsertError(t *testing.T) {
	s, _ := newSvc(t)
	k := newKeys()
	s.DB.Close()
	if _, _, err := s.Create(k.req(1, 1, 1)); err == nil {
		t.Fatal("erreur attendue")
	}
	if ids, _ := s.Blobs.List(); len(ids) != 0 {
		t.Fatal("réservation orpheline", ids)
	}
}

// Le n° d'ouverture du jeton limite la lecture : ouverture émise, pas encore terminée.
func TestReadSegmentOpenN(t *testing.T) {
	s, _ := newSvc(t)
	k := newKeys()
	id := ready(t, s, k, 1, 24, 3)
	if _, err := s.ReadSegment(id, 0, 1); !errors.Is(err, ErrNotFound) {
		t.Fatal("avant toute ouverture", err)
	}
	n1, _ := s.Unlock(id, k.acces, k.preuve)
	n2, _ := s.Unlock(id, k.acces, k.preuve)
	for _, n := range []int{n1, n2} {
		if _, err := s.ReadSegment(id, 0, n); err != nil {
			t.Fatal(n, err)
		}
	}
	for _, n := range []int{0, -1, 3, 11} {
		if _, err := s.ReadSegment(id, 0, n); !errors.Is(err, ErrNotFound) {
			t.Fatal("ouverture non émise", n, err)
		}
	}
	if err := s.Done(id, n1); err != nil {
		t.Fatal(err)
	}
	if _, err := s.ReadSegment(id, 0, n1); !errors.Is(err, ErrNotFound) {
		t.Fatal("jeton mort après done", err)
	}
	if _, err := s.ReadSegment(id, 0, n2); err != nil {
		t.Fatal("autre ouverture", err)
	}
}

// Destroy respecte l'expiration comme Status : 404 et aucun essai compté.
func TestDestroyExpired(t *testing.T) {
	s, c := newSvc(t)
	k := newKeys()
	id := ready(t, s, k, 1, 1, 1)
	up, _, _ := s.Create(k.req(1, 1, 1))
	c.Add(3*time.Hour + 15*time.Minute) // 13:17 : partage expiré, envoi échu (13:15)
	for _, x := range []string{id, up} {
		if err := s.Destroy(x, k.acces, rnd(32), nil); !errors.Is(err, ErrNotFound) {
			t.Fatal(err)
		}
		if err := s.Destroy(x, nil, nil, k.gestion); !errors.Is(err, ErrNotFound) {
			t.Fatal("gestion après expiration", err)
		}
		if failed(t, s, x) != 0 || rowCount(t, s, x) != 1 {
			t.Fatal("essai compté ou ligne effacée hors Sweep")
		}
	}
}

func TestValidateAndFrozen(t *testing.T) {
	s, _ := newSvc(t)
	k := newKeys()
	if err := Validate(k.req(1, 1, 1)); err != nil {
		t.Fatal(err)
	}
	bad := k.req(1, 1, 1)
	bad.TTLHours = 2
	if err := Validate(bad); !errors.Is(err, ErrBadRequest) {
		t.Fatal(err)
	}
	if s.Frozen() {
		t.Fatal("gelé sans fichier")
	}
	os.WriteFile(s.FrozenFile, nil, 0o600)
	if !s.Frozen() {
		t.Fatal("non gelé")
	}
}

func progressAt(t *testing.T, s *Service, id string) sql.NullInt64 {
	t.Helper()
	var p sql.NullInt64
	if err := s.DB.QueryRow("SELECT progress_at FROM shares WHERE id=?", id).Scan(&p); err != nil {
		t.Fatal(err)
	}
	return p
}

// Envoi bloqué : aucun nouveau segment depuis 15 min → effacé (avant l'échéance de 3 h).
// progress_at (minute du dernier segment reçu) n'existe que pendant l'envoi : NULL à la
// création (la minute de création n'est pas stockée) et remis à NULL à la finalisation.
func TestSweepStalledUpload(t *testing.T) {
	s, c := newSvc(t)
	k := newKeys()
	c.Add(30 * time.Second) // 10:02:30
	id, _, err := s.Create(k.req(80, 1, 1))
	if err != nil {
		t.Fatal(err)
	}
	if p := progressAt(t, s, id); p.Valid {
		t.Fatal("progress_at renseigné à la création", p)
	}
	if err := s.PutSegment(id, 0, segBody(80, 0, 1)); err != nil {
		t.Fatal(err)
	}
	if p := progressAt(t, s, id); !p.Valid || p.Int64 != time.Date(2026, 11, 4, 10, 2, 0, 0, time.UTC).Unix() {
		t.Fatal("progress_at à la minute", p)
	}
	c.Add(10 * time.Minute) // 10:12:30 : nouveau segment (remplacement compris)
	if err := s.PutSegment(id, 0, segBody(80, 0, 2)); err != nil {
		t.Fatal(err)
	}
	c.Add(14 * time.Minute) // 10:26:30 : 14 min 30 sans segment
	if n, err := s.Sweep(); err != nil || n != 0 {
		t.Fatal("trop tôt", n, err)
	}
	c.Add(30 * time.Second) // 10:27 = 10:12 + 15 min
	if n, err := s.Sweep(); err != nil || n != 1 {
		t.Fatal(n, err)
	}
	gone(t, s, id)

	// Finalisé : progress_at effacé, et le partage n'est jamais balayé comme envoi bloqué.
	done := ready(t, s, k, 1, 24, 1)
	if p := progressAt(t, s, done); p.Valid {
		t.Fatal("progress_at conservé après finalisation", p)
	}
	c.Add(time.Hour)
	if n, err := s.Sweep(); err != nil || n != 0 {
		t.Fatal(n, err)
	}
}

// Tâche M, point 8 : un système de fichiers qui ne sait pas allouer (ErrNoAllocate, mode
// SHH_BEHIND_PROXY=1) est refusé comme un disque plein, et ne laisse ni fichier ni ligne.
func TestCreateNoAllocateIsFull(t *testing.T) {
	s, _ := newSvc(t)
	orig := reserveBlob
	t.Cleanup(func() { reserveBlob = orig })
	reserveBlob = func(*blob.Store, string, int64) error { return blob.ErrNoAllocate }
	k := newKeys()
	_, _, err := s.Create(k.req(1, 1, 1))
	if !errors.Is(err, ErrFull) || errors.Is(err, blob.ErrNoAllocate) {
		t.Fatal(err)
	}
	if ids, _ := s.Blobs.List(); len(ids) != 0 {
		t.Fatal("fichier laissé", ids)
	}
	var n int
	if err := s.DB.QueryRow(`SELECT COUNT(*) FROM shares`).Scan(&n); err != nil || n != 0 {
		t.Fatal("ligne laissée", n, err)
	}
	// Une autre erreur n'est pas convertie en « plein ».
	boom := errors.New("boum")
	reserveBlob = func(*blob.Store, string, int64) error { return boom }
	if _, _, err := s.Create(k.req(1, 1, 1)); !errors.Is(err, boom) || errors.Is(err, ErrFull) {
		t.Fatal(err)
	}
}
