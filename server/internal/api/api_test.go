package api

import (
	"bytes"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	altcha "github.com/altcha-org/altcha-lib-go"

	"github.com/skoow/shhdrop/server/internal/blob"
	"github.com/skoow/shhdrop/server/internal/captcha"
	"github.com/skoow/shhdrop/server/internal/limits"
	"github.com/skoow/shhdrop/server/internal/share"
	"github.com/skoow/shhdrop/server/internal/store"
	"github.com/skoow/shhdrop/server/internal/token"
)

var enc = base64.RawURLEncoding

type clock struct {
	mu sync.Mutex
	t  time.Time
}

func (c *clock) Now() time.Time      { c.mu.Lock(); defer c.mu.Unlock(); return c.t }
func (c *clock) Add(d time.Duration) { c.mu.Lock(); c.t = c.t.Add(d); c.mu.Unlock() }

type env struct {
	h   http.Handler
	svc *share.Service
	sig *token.Signer
	clk *clock
	dir string
}

func rnd(n int) []byte {
	b := make([]byte, n)
	rand.Read(b)
	return b
}

func htmlStatic() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Write([]byte("<!doctype html><title>Shhdrop</title>"))
	})
}

func newEnv(t *testing.T, behindProxy bool, static http.Handler) *env {
	t.Helper()
	dir := t.TempDir()
	db, err := store.Open(filepath.Join(dir, "shares.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	c := &clock{t: time.Date(2026, 11, 4, 10, 2, 0, 0, time.UTC)}
	svc := &share.Service{DB: db, Blobs: &blob.Store{Dir: filepath.Join(dir, "blobs")}, Now: c.Now,
		StorageMax: 1 << 40, FrozenFile: filepath.Join(dir, "frozen")}
	if static == nil {
		static = htmlStatic()
	}
	sig := token.New(rnd(32), c.Now)
	h := New(svc, sig, limits.New(c.Now), captcha.New(rnd(32), c.Now), static, behindProxy)
	return &env{h: h, svc: svc, sig: sig, clk: c, dir: dir}
}

type req struct {
	method, path string
	body         []byte
	hdr          map[string]string
	remote       string
}

func (e *env) do(r req) *httptest.ResponseRecorder {
	var body *bytes.Reader
	if r.body != nil {
		body = bytes.NewReader(r.body)
	} else {
		body = bytes.NewReader(nil)
	}
	hr := httptest.NewRequest(r.method, r.path, body)
	hr.RemoteAddr = "203.0.113.7:4444"
	if r.remote != "" {
		hr.RemoteAddr = r.remote
	}
	for k, v := range r.hdr {
		hr.Header.Set(k, v)
	}
	w := httptest.NewRecorder()
	e.h.ServeHTTP(w, hr)
	return w
}

func jsonOf(t *testing.T, w *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var m map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &m); err != nil {
		t.Fatalf("JSON invalide (%d): %q", w.Code, w.Body.String())
	}
	return m
}

func expect(t *testing.T, w *httptest.ResponseRecorder, code int, body string) {
	t.Helper()
	if w.Code != code || (body != "" && strings.TrimSpace(w.Body.String()) != body) {
		t.Fatalf("attendu %d %s, reçu %d %q", code, body, w.Code, w.Body.String())
	}
}

const (
	notFound   = `{"error":"not_found"}`
	badRequest = `{"error":"bad_request"}`
)

// solve trouve le nombre par force brute, comme le widget ALTCHA.
func solve(t *testing.T, ch altcha.Challenge) int64 {
	t.Helper()
	for n := int64(0); n <= ch.MaxNumber; n++ {
		h := sha256.Sum256([]byte(ch.Salt + strconv.FormatInt(n, 10)))
		if hex.EncodeToString(h[:]) == ch.Challenge {
			return n
		}
	}
	t.Fatal("défi insoluble")
	return 0
}

// captchaFor rend une solution ALTCHA et le jeton shown_at, après les 3 s minimales.
func (e *env) captchaFor(t *testing.T, remote string) (string, string) {
	t.Helper()
	w := e.do(req{method: "GET", path: "/api/captcha", remote: remote})
	expect(t, w, 200, "")
	var c struct {
		altcha.Challenge
		ShownAt string `json:"shown_at"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &c); err != nil || c.ShownAt == "" || c.Salt == "" {
		t.Fatalf("défi: %q %v", w.Body.String(), err)
	}
	n := solve(t, c.Challenge)
	p, _ := json.Marshal(map[string]any{"algorithm": c.Algorithm, "challenge": c.Challenge.Challenge,
		"number": n, "salt": c.Salt, "signature": c.Signature})
	e.clk.Add(3 * time.Second)
	return base64.StdEncoding.EncodeToString(p), c.ShownAt
}

type keys struct{ acces, preuve, gestion []byte }

func newKeys() keys { return keys{rnd(32), rnd(32), rnd(32)} }

func v(b []byte) string { h := sha256.Sum256(b); return enc.EncodeToString(h[:]) }

func (k keys) createBody(bucket, opens int, alt, shown string) map[string]any {
	return map[string]any{"bucket": bucket, "ttl_hours": 1, "max_opens": opens,
		"salt": enc.EncodeToString(rnd(16)), "kdf": map[string]int{"ops": 3, "mem": 67108864},
		"access_v": v(k.acces), "proof_v": v(k.preuve), "manage_v": v(k.gestion),
		"altcha": alt, "hp": "", "shown_at": shown}
}

func mustJSON(x any) []byte { b, _ := json.Marshal(x); return b }

type created struct {
	ID          string `json:"id"`
	UploadToken string `json:"upload_token"`
	Segments    int    `json:"segments"`
}

func (e *env) create(t *testing.T, remote string, k keys, bucket, opens int) created {
	t.Helper()
	alt, shown := e.captchaFor(t, remote)
	w := e.do(req{method: "POST", path: "/api/shares", body: mustJSON(k.createBody(bucket, opens, alt, shown)), remote: remote})
	expect(t, w, 201, "")
	var c created
	if err := json.Unmarshal(w.Body.Bytes(), &c); err != nil || c.ID == "" || c.UploadToken == "" {
		t.Fatalf("création: %q", w.Body.String())
	}
	return c
}

func auth(tok string) map[string]string { return map[string]string{"Authorization": "Bearer " + tok} }

// upload envoie des segments aléatoires, finalise et rend leur contenu.
func (e *env) upload(t *testing.T, c created, bucket int) [][]byte {
	t.Helper()
	var segs [][]byte
	for n := 0; n < c.Segments; n++ {
		b := rnd(share.SegmentSize(bucket, n))
		segs = append(segs, b)
		expect(t, e.do(req{method: "PUT", path: fmt.Sprintf("/api/shares/%s/segments/%d", c.ID, n), body: b,
			hdr: auth(c.UploadToken)}), 204, "")
	}
	w := e.do(req{method: "POST", path: "/api/shares/" + c.ID + "/finalize", hdr: auth(c.UploadToken)})
	expect(t, w, 200, "")
	if s := jsonOf(t, w)["expires_in_s"].(float64); s < 3600 || s > 3600+900 {
		t.Fatalf("expires_in_s = %v", s)
	}
	return segs
}

func access(k keys) map[string]string {
	return map[string]string{"X-Shh-Access": enc.EncodeToString(k.acces)}
}

func (e *env) unlock(t *testing.T, id string, k keys) (string, int) {
	t.Helper()
	w := e.do(req{method: "POST", path: "/api/shares/" + id + "/unlock", hdr: access(k),
		body: mustJSON(map[string]string{"proof": enc.EncodeToString(k.preuve)})})
	expect(t, w, 200, "")
	var r struct {
		DownloadToken string `json:"download_token"`
		Segments      int    `json:"segments"`
	}
	json.Unmarshal(w.Body.Bytes(), &r)
	if r.DownloadToken == "" {
		t.Fatalf("unlock: %q", w.Body.String())
	}
	return r.DownloadToken, r.Segments
}

func TestFullFlow(t *testing.T) {
	e := newEnv(t, false, nil)
	k := newKeys()
	const bucket = 80 // 2 segments
	c := e.create(t, "", k, bucket, 2)
	if c.Segments != 2 {
		t.Fatalf("segments = %d", c.Segments)
	}
	segs := e.upload(t, c, bucket)

	w := e.do(req{method: "GET", path: "/api/shares/" + c.ID + "/meta", hdr: access(k)})
	expect(t, w, 200, "")
	m := jsonOf(t, w)
	kdf := m["kdf"].(map[string]any)
	if m["bucket"].(float64) != bucket || m["segments"].(float64) != 2 || kdf["ops"].(float64) != 3 ||
		kdf["mem"].(float64) != 67108864 || m["expires_in_s"].(float64) < 3600 {
		t.Fatalf("meta: %v", m)
	}
	if salt, err := b64.DecodeString(m["salt"].(string)); err != nil || len(salt) != 16 {
		t.Fatalf("sel: %v", m["salt"])
	}

	// Mauvais mot de passe : 403 avec essais restants.
	w = e.do(req{method: "POST", path: "/api/shares/" + c.ID + "/unlock", hdr: access(k),
		body: mustJSON(map[string]string{"proof": enc.EncodeToString(rnd(32))})})
	expect(t, w, 403, `{"error":"bad_password","attempts_left":4}`)

	dl, n := e.unlock(t, c.ID, k)
	if n != 2 {
		t.Fatalf("segments = %d", n)
	}
	for i, want := range segs {
		w := e.do(req{method: "GET", path: fmt.Sprintf("/api/shares/%s/segments/%d", c.ID, i), hdr: auth(dl)})
		expect(t, w, 200, "")
		if !bytes.Equal(w.Body.Bytes(), want) || w.Header().Get("Content-Type") != "application/octet-stream" {
			t.Fatalf("segment %d différent", i)
		}
	}
	expect(t, e.do(req{method: "GET", path: "/api/shares/" + c.ID + "/segments/2", hdr: auth(dl)}), 400, badRequest)
	expect(t, e.do(req{method: "POST", path: "/api/shares/" + c.ID + "/done", hdr: auth(dl)}), 204, "")
	expect(t, e.do(req{method: "POST", path: "/api/shares/" + c.ID + "/done", hdr: auth(dl)}), 204, "") // idempotent
	// Ouverture terminée : son jeton ne lit plus rien.
	expect(t, e.do(req{method: "GET", path: "/api/shares/" + c.ID + "/segments/0", hdr: auth(dl)}), 404, notFound)

	w = e.do(req{method: "GET", path: "/api/shares/" + c.ID + "/status",
		hdr: map[string]string{"X-Shh-Manage": enc.EncodeToString(k.gestion)}})
	expect(t, w, 200, "")
	st := jsonOf(t, w)
	if st["opens_used"].(float64) != 1 || st["max_opens"].(float64) != 2 || st["state"] != "ready" ||
		st["expires_in_s"].(float64) < 3600 {
		t.Fatalf("status: %v", st)
	}

	// Destruction par le destinataire (K_accès + K_preuve).
	w = e.do(req{method: "POST", path: "/api/shares/" + c.ID + "/destroy", hdr: access(k),
		body: mustJSON(map[string]string{"proof": enc.EncodeToString(k.preuve), "reason": "malware"})})
	expect(t, w, 204, "")
	expect(t, e.do(req{method: "GET", path: "/api/shares/" + c.ID + "/meta", hdr: access(k)}), 404, notFound)
	expect(t, e.do(req{method: "GET", path: "/api/shares/" + c.ID + "/segments/0", hdr: auth(dl)}), 404, notFound)
	if _, err := os.Stat(filepath.Join(e.dir, "blobs", c.ID)); !os.IsNotExist(err) {
		t.Fatal("fichier encore présent")
	}
}

func TestDestroyByManage(t *testing.T) {
	e := newEnv(t, false, nil)
	k := newKeys()
	c := e.create(t, "", k, 1, 1)
	e.upload(t, c, 1)
	path := "/api/shares/" + c.ID + "/destroy"
	expect(t, e.do(req{method: "POST", path: path, body: []byte(`{}`)}), 400, badRequest)
	expect(t, e.do(req{method: "POST", path: path, // K_preuve sans K_accès
		body: mustJSON(map[string]string{"proof": enc.EncodeToString(k.preuve)})}), 400, badRequest)
	expect(t, e.do(req{method: "POST", path: path,
		body: mustJSON(map[string]string{"manage": enc.EncodeToString(rnd(32))})}), 404, notFound)
	expect(t, e.do(req{method: "POST", path: path,
		body: mustJSON(map[string]string{"manage": enc.EncodeToString(k.gestion)})}), 204, "")
	expect(t, e.do(req{method: "GET", path: "/api/shares/" + c.ID + "/status",
		hdr: map[string]string{"X-Shh-Manage": enc.EncodeToString(k.gestion)}}), 404, notFound)
}

func TestFifthBadPasswordIsNotFound(t *testing.T) {
	e := newEnv(t, false, nil)
	k := newKeys()
	c := e.create(t, "", k, 1, 1)
	e.upload(t, c, 1)
	for left := 4; left >= 1; left-- {
		w := e.do(req{method: "POST", path: "/api/shares/" + c.ID + "/unlock", hdr: access(k),
			body: mustJSON(map[string]string{"proof": enc.EncodeToString(rnd(32))})})
		expect(t, w, 403, fmt.Sprintf(`{"error":"bad_password","attempts_left":%d}`, left))
	}
	w := e.do(req{method: "POST", path: "/api/shares/" + c.ID + "/unlock", hdr: access(k),
		body: mustJSON(map[string]string{"proof": enc.EncodeToString(rnd(32))})})
	expect(t, w, 404, notFound)
	expect(t, e.do(req{method: "GET", path: "/api/shares/" + c.ID + "/meta", hdr: access(k)}), 404, notFound)
}

var wantHeaders = map[string]string{
	"Content-Security-Policy": "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; " +
		"img-src 'self' blob:; media-src 'self' blob:; connect-src 'self'; frame-src 'self'; object-src 'none'; " +
		"base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
	"Referrer-Policy":              "no-referrer",
	"X-Content-Type-Options":       "nosniff",
	"Permissions-Policy":           "microphone=(self), camera=(), geolocation=()",
	"Cross-Origin-Opener-Policy":   "same-origin",
	"Cross-Origin-Resource-Policy": "same-origin",
	"Strict-Transport-Security":    "max-age=63072000; includeSubDomains; preload",
	"Cache-Control":                "no-store",
}

func checkHeaders(t *testing.T, name string, w *httptest.ResponseRecorder) {
	t.Helper()
	for k, want := range wantHeaders {
		if got := w.Header().Values(k); len(got) != 1 || got[0] != want {
			t.Errorf("%s : %s = %q, attendu %q", name, k, got, want)
		}
	}
}

func TestSecurityHeaders(t *testing.T) {
	e := newEnv(t, false, nil)
	w := e.do(req{method: "GET", path: "/"})
	expect(t, w, 200, "")
	checkHeaders(t, "/", w)
	w = e.do(req{method: "GET", path: "/api/captcha"})
	expect(t, w, 200, "")
	checkHeaders(t, "/api/captcha", w)
	if ct := w.Header().Get("Content-Type"); ct != "application/json" {
		t.Errorf("Content-Type = %q", ct)
	}
	w = e.do(req{method: "GET", path: "/api/shares/" + enc.EncodeToString(rnd(16)) + "/meta",
		hdr: access(newKeys())})
	expect(t, w, 404, notFound)
	checkHeaders(t, "404", w)
	w = e.do(req{method: "GET", path: "/api/nope"})
	checkHeaders(t, "404 route", w)
}

func TestPanicRecovered(t *testing.T) {
	e := newEnv(t, false, http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		panic("secret détail 1.2.3.4")
	}))
	w := e.do(req{method: "GET", path: "/"})
	expect(t, w, 500, `{"error":"internal"}`)
	checkHeaders(t, "panic", w)
}

func TestPutWrongSize(t *testing.T) {
	e := newEnv(t, false, nil)
	c := e.create(t, "", newKeys(), 16, 1) // 1 segment
	size := share.SegmentSize(16, 0)
	file := filepath.Join(e.dir, "blobs", c.ID)
	before, err := os.ReadFile(file)
	if err != nil {
		t.Fatal(err)
	}
	put := func(n string, body []byte, tok string) *httptest.ResponseRecorder {
		return e.do(req{method: "PUT", path: "/api/shares/" + c.ID + "/segments/" + n, body: body, hdr: auth(tok)})
	}
	expect(t, put("0", bytes.Repeat([]byte{7}, size+1), c.UploadToken), 400, badRequest)
	expect(t, put("0", bytes.Repeat([]byte{7}, size-1), c.UploadToken), 400, badRequest)
	expect(t, put("0", bytes.Repeat([]byte{7}, 64*share.ChunkCT+share.Header+1), c.UploadToken), 400, badRequest)
	expect(t, put("1", bytes.Repeat([]byte{7}, size), c.UploadToken), 400, badRequest)
	for _, n := range []string{"+0", "-0", "00", "x", "99999999999999999999"} {
		expect(t, put(n, bytes.Repeat([]byte{7}, size), c.UploadToken), 400, badRequest)
	}
	after, _ := os.ReadFile(file)
	if !bytes.Equal(before, after) {
		t.Fatal("fichier modifié par un envoi refusé")
	}
	// Finalisation incomplète.
	expect(t, e.do(req{method: "POST", path: "/api/shares/" + c.ID + "/finalize", hdr: auth(c.UploadToken)}),
		409, `{"error":"incomplete"}`)
	// Sans jeton, jeton malformé.
	expect(t, e.do(req{method: "PUT", path: "/api/shares/" + c.ID + "/segments/0", body: make([]byte, size)}), 400, badRequest)
	expect(t, put("0", make([]byte, size), "n'importe.quoi"), 404, notFound)
	// Envoi après finalisation refusé.
	expect(t, put("0", make([]byte, size), c.UploadToken), 204, "")
	expect(t, e.do(req{method: "POST", path: "/api/shares/" + c.ID + "/finalize", hdr: auth(c.UploadToken)}), 200, "")
	expect(t, put("0", make([]byte, size), c.UploadToken), 404, notFound)
}

func TestTokensBoundToShare(t *testing.T) {
	e := newEnv(t, false, nil)
	ka, kb := newKeys(), newKeys()
	a := e.create(t, "", ka, 1, 2)
	b := e.create(t, "", kb, 1, 2)
	size := share.SegmentSize(1, 0)
	// Jeton d'envoi de A refusé sur B.
	expect(t, e.do(req{method: "PUT", path: "/api/shares/" + b.ID + "/segments/0", body: make([]byte, size),
		hdr: auth(a.UploadToken)}), 404, notFound)
	expect(t, e.do(req{method: "POST", path: "/api/shares/" + b.ID + "/finalize", hdr: auth(a.UploadToken)}), 404, notFound)
	e.upload(t, a, 1)
	e.upload(t, b, 1)
	dlA, _ := e.unlock(t, a.ID, ka)
	// Jeton de téléchargement de A refusé sur B ; jeton d'envoi refusé en lecture.
	expect(t, e.do(req{method: "GET", path: "/api/shares/" + b.ID + "/segments/0", hdr: auth(dlA)}), 404, notFound)
	expect(t, e.do(req{method: "POST", path: "/api/shares/" + b.ID + "/done", hdr: auth(dlA)}), 404, notFound)
	expect(t, e.do(req{method: "GET", path: "/api/shares/" + a.ID + "/segments/0", hdr: auth(a.UploadToken)}), 404, notFound)
	// Jeton de téléchargement refusé à l'envoi.
	expect(t, e.do(req{method: "POST", path: "/api/shares/" + a.ID + "/finalize", hdr: auth(dlA)}), 404, notFound)
}

func doneMask(t *testing.T, e *env, id string) int64 {
	t.Helper()
	var m int64
	if err := e.svc.DB.QueryRow(`SELECT done_mask FROM shares WHERE id=?`, id).Scan(&m); err != nil {
		t.Fatal(err)
	}
	return m
}

func TestForgedOpenN(t *testing.T) {
	e := newEnv(t, false, nil)
	k := newKeys()
	c := e.create(t, "", k, 1, 2)
	e.upload(t, c, 1)
	e.unlock(t, c.ID, k) // ouverture 1
	dl2, _ := e.unlock(t, c.ID, k)
	// Ouverture 2 (dernière) ; on tente de faire passer le jeton pour l'ouverture 1.
	p, sig, _ := strings.Cut(dl2, ".")
	raw, _ := enc.DecodeString(p)
	l := int(raw[1])
	binary.BigEndian.PutUint32(raw[2+l:], 1)
	forged := enc.EncodeToString(raw) + "." + sig
	expect(t, e.do(req{method: "POST", path: "/api/shares/" + c.ID + "/done", hdr: auth(forged)}), 404, notFound)
	// Jeton bien formé mais signé avec une autre clé.
	other := token.New(rnd(32), e.clk.Now).Issue(token.Download, c.ID, 1, e.clk.Now().Add(time.Hour))
	expect(t, e.do(req{method: "POST", path: "/api/shares/" + c.ID + "/done", hdr: auth(other)}), 404, notFound)
	if m := doneMask(t, e, c.ID); m != 0 {
		t.Fatalf("done_mask = %b après jetons falsifiés", m)
	}
	expect(t, e.do(req{method: "POST", path: "/api/shares/" + c.ID + "/done", hdr: auth(dl2)}), 204, "")
	if m := doneMask(t, e, c.ID); m != 0b10 {
		t.Fatalf("done_mask = %b, attendu 10 (ouverture 2 seulement)", m)
	}
}

func TestDownloadTokenCappedAtExpiry(t *testing.T) {
	e := newEnv(t, false, nil)
	k := newKeys()
	c := e.create(t, "", k, 1, 1)
	e.upload(t, c, 1) // expire dans 1 h à 1 h 15
	e.clk.Add(50 * time.Minute)
	dl, _ := e.unlock(t, c.ID, k)
	e.clk.Add(30 * time.Minute) // au-delà de expires_at, avant 1 h de jeton
	expect(t, e.do(req{method: "GET", path: "/api/shares/" + c.ID + "/segments/0", hdr: auth(dl)}), 404, notFound)
}

// Spec §24 : jeton d'envoi 3 h ; jeton de téléchargement min(3 h, expires_at).
func TestTokenLifetimes(t *testing.T) {
	e := newEnv(t, false, nil)
	k := newKeys()
	alt, shown := e.captchaFor(t, "")
	body := k.createBody(1, 1, alt, shown)
	body["ttl_hours"] = 24
	w := e.do(req{method: "POST", path: "/api/shares", body: mustJSON(body)})
	expect(t, w, 201, "")
	var c created
	json.Unmarshal(w.Body.Bytes(), &c)
	if _, exp, err := e.sig.CheckExp(c.UploadToken, token.Upload, c.ID); err != nil || !exp.Equal(e.clk.Now().Add(3*time.Hour)) {
		t.Fatal("jeton d'envoi", exp, err)
	}
	e.clk.Add(2*time.Hour + 50*time.Minute) // 12:52 : l'envoi est encore accepté (échéance 13:15)
	expect(t, e.do(req{method: "PUT", path: "/api/shares/" + c.ID + "/segments/0", body: rnd(share.SegmentSize(1, 0)),
		hdr: auth(c.UploadToken)}), 204, "")
	expect(t, e.do(req{method: "POST", path: "/api/shares/" + c.ID + "/finalize", hdr: auth(c.UploadToken)}), 200, "")
	dl, _ := e.unlock(t, c.ID, k)
	if _, exp, err := e.sig.CheckExp(dl, token.Download, c.ID); err != nil || !exp.Equal(e.clk.Now().Add(3*time.Hour)) {
		t.Fatal("jeton de téléchargement (24 h)", exp, err)
	}
	// Partage d'une heure : jeton plafonné à expires_at.
	short := e.create(t, "", k, 1, 1)
	e.upload(t, short, 1)
	dl2, _ := e.unlock(t, short.ID, k)
	if _, exp, err := e.sig.CheckExp(dl2, token.Download, short.ID); err != nil ||
		!exp.Equal(time.Date(2026, 11, 4, 14, 0, 0, 0, time.UTC)) {
		t.Fatal("jeton de téléchargement plafonné", exp, err)
	}
}

func TestRateLimit(t *testing.T) {
	e := newEnv(t, false, nil)
	for i := 0; i < limits.RequestsPerMin; i++ {
		expect(t, e.do(req{method: "GET", path: "/api/nope"}), 404, notFound)
	}
	w := e.do(req{method: "GET", path: "/api/captcha"})
	expect(t, w, 429, `{"error":"limit","retry_after_s":60}`)
	checkHeaders(t, "429", w)
	expect(t, e.do(req{method: "GET", path: "/"}), 200, "")                                      // le site n'est pas limité
	expect(t, e.do(req{method: "GET", path: "/api/captcha", remote: "198.51.100.1:1"}), 200, "") // autre connexion
	e.clk.Add(time.Minute)
	expect(t, e.do(req{method: "GET", path: "/api/captcha"}), 200, "")
}

// Segments à jeton valide : hors de la limite de 60/min, avec leur propre limite de 600/min.
// Un jeton invalide compte dans la limite générale.
func TestSegmentRateLimit(t *testing.T) {
	e := newEnv(t, false, nil)
	k := newKeys()
	c := e.create(t, "", k, 1, 1)
	e.upload(t, c, 1)
	dl, _ := e.unlock(t, c.ID, k) // 4 requêtes générales (captcha, create, finalize, unlock) ; le PUT est à part
	for i := 0; i < limits.RequestsPerMin-4; i++ {
		expect(t, e.do(req{method: "GET", path: "/api/nope"}), 404, notFound)
	}
	seg := "/api/shares/" + c.ID + "/segments/0"
	for i := 0; i < 100; i++ {
		expect(t, e.do(req{method: "GET", path: seg, hdr: auth(dl)}), 200, "")
	}
	expect(t, e.do(req{method: "GET", path: "/api/captcha"}), 429, "")
	// Jeton invalide (autre partage, mauvais type, illisible) : limite générale, épuisée.
	for _, tok := range []string{c.UploadToken, "x", ""} {
		expect(t, e.do(req{method: "GET", path: seg, hdr: auth(tok)}), 429, "")
	}
	expect(t, e.do(req{method: "PUT", path: seg, hdr: auth(dl), body: rnd(10)}), 429, "")

	e.clk.Add(time.Minute)
	for i := 0; i < limits.SegmentsPerMin-1; i++ { // 1 de moins : le PUT ci-dessous
		expect(t, e.do(req{method: "GET", path: seg, hdr: auth(dl)}), 200, "")
	}
	// PUT avec un jeton d'envoi valide : même compteur des segments (refusé après finalisation).
	expect(t, e.do(req{method: "PUT", path: seg, hdr: auth(c.UploadToken), body: rnd(share.SegmentSize(1, 0))}), 404, notFound)
	expect(t, e.do(req{method: "GET", path: seg, hdr: auth(dl)}), 429, "")
	expect(t, e.do(req{method: "GET", path: "/api/captcha"}), 200, "") // limite générale intacte
}

func TestCreateRefusals(t *testing.T) {
	e := newEnv(t, false, nil)
	k := newKeys()
	post := func(body map[string]any) *httptest.ResponseRecorder {
		return e.do(req{method: "POST", path: "/api/shares", body: mustJSON(body)})
	}
	alt, shown := e.captchaFor(t, "")
	expect(t, post(k.createBody(1, 1, "", shown)), 400, badRequest) // sans défi
	b := k.createBody(1, 1, alt, shown)
	b["hp"] = "robot"
	expect(t, post(b), 400, badRequest) // piège rempli

	alt, shown = e.captchaFor(t, "")
	expect(t, post(k.createBody(1, 1, alt, "")), 400, badRequest)        // sans shown_at
	expect(t, post(k.createBody(1, 1, alt, shown+"x")), 400, badRequest) // shown_at falsifié
	alt, shown = e.captchaFor(t, "")
	expect(t, post(k.createBody(1, 1, alt, shown)), 201, "")
	expect(t, post(k.createBody(1, 1, alt, shown)), 400, badRequest) // défi réutilisé

	// shown_at lié à son défi : réutilisé avec un autre défi → refusé.
	// (le défi 1 n'est pas utilisé : après une création, un défi plus ancien est refusé.)
	_, shown1 := e.captchaFor(t, "")
	alt2, shown2 := e.captchaFor(t, "")
	expect(t, post(k.createBody(1, 1, alt2, shown1)), 400, badRequest)
	expect(t, post(k.createBody(1, 1, alt2, shown2)), 201, "")

	// Une requête invalide ne consomme pas le défi.
	alt, shown = e.captchaFor(t, "")
	b = k.createBody(1, 1, alt, shown)
	b["ttl_hours"] = 2
	expect(t, post(b), 400, badRequest)
	expect(t, post(k.createBody(1, 1, alt, shown)), 201, "")

	// Jeton shown_at expiré (plus de 2 min) : refusé.
	alt, shown = e.captchaFor(t, "")
	e.clk.Add(2 * time.Minute)
	expect(t, post(k.createBody(1, 1, alt, shown)), 400, badRequest)

	// Formats invalides.
	bad := []func(m map[string]any){
		func(m map[string]any) { m["bucket"] = 2 },
		func(m map[string]any) { m["bucket"] = 1.5 },
		func(m map[string]any) { m["salt"] = enc.EncodeToString(rnd(15)) },
		func(m map[string]any) { m["salt"] = base64.URLEncoding.EncodeToString(rnd(16)) }, // avec bourrage
		func(m map[string]any) { m["access_v"] = base64.StdEncoding.EncodeToString(rnd(32)) },
		func(m map[string]any) { m["proof_v"] = nil },
		func(m map[string]any) { m["inconnu"] = 1 },
		func(m map[string]any) { m["ttl_hours"] = 3 },
		func(m map[string]any) { m["max_opens"] = 11 },
		func(m map[string]any) { m["kdf"] = map[string]int{"ops": 2, "mem": 67108864} },
	}
	for i, f := range bad {
		alt, shown := e.captchaFor(t, "")
		m := k.createBody(1, 1, alt, shown)
		f(m)
		if w := post(m); w.Code != 400 {
			t.Fatalf("cas %d : %d %q", i, w.Code, w.Body.String())
		}
	}
	expect(t, e.do(req{method: "POST", path: "/api/shares", body: append(mustJSON(k.createBody(1, 1, "a", "b")), '{')}), 400, badRequest)
	expect(t, e.do(req{method: "POST", path: "/api/shares", body: bytes.Repeat([]byte(" "), 5000)}), 400, badRequest)
}

func TestCreateFrozenFull(t *testing.T) {
	e := newEnv(t, false, nil)
	k := newKeys()
	if err := os.WriteFile(e.svc.FrozenFile, nil, 0o600); err != nil {
		t.Fatal(err)
	}
	alt, shown := e.captchaFor(t, "")
	expect(t, e.do(req{method: "POST", path: "/api/shares", body: mustJSON(k.createBody(1, 1, alt, shown))}),
		503, `{"error":"frozen"}`)
	os.Remove(e.svc.FrozenFile)
	// Le défi n'a pas été consommé par le refus « gelé ».
	expect(t, e.do(req{method: "POST", path: "/api/shares", body: mustJSON(k.createBody(1, 1, alt, shown))}), 201, "")
	e.svc.StorageMax = 1000
	alt, shown = e.captchaFor(t, "")
	expect(t, e.do(req{method: "POST", path: "/api/shares", body: mustJSON(k.createBody(1, 1, alt, shown))}),
		507, `{"error":"full"}`)
}

func TestCreateQuota(t *testing.T) {
	e := newEnv(t, false, nil)
	k := newKeys()
	// Quota en capacité utile (16 384 × 64 Kio = 1 Gio) : 3 partages max par jour, le 4ᵉ refusé.
	for i := 0; i < 3; i++ {
		e.create(t, "", k, 16384, 1)
	}
	alt, shown := e.captchaFor(t, "")
	w := e.do(req{method: "POST", path: "/api/shares", body: mustJSON(k.createBody(16384, 1, alt, shown))})
	expect(t, w, 429, "")
	m := jsonOf(t, w)
	if m["error"] != "limit" || m["retry_after_s"].(float64) <= 0 {
		t.Fatalf("429: %v", m)
	}
}

func TestSecretsFormat(t *testing.T) {
	e := newEnv(t, false, nil)
	k := newKeys()
	c := e.create(t, "", k, 1, 1)
	e.upload(t, c, 1)
	path := "/api/shares/" + c.ID + "/meta"
	for _, h := range []string{"", "abc", base64.URLEncoding.EncodeToString(k.acces), enc.EncodeToString(rnd(31))} {
		expect(t, e.do(req{method: "GET", path: path, hdr: map[string]string{"X-Shh-Access": h}}), 400, badRequest)
	}
	// Deux en-têtes X-Shh-Access : refusé.
	hr := httptest.NewRequest("GET", path, nil)
	hr.Header.Add("X-Shh-Access", enc.EncodeToString(k.acces))
	hr.Header.Add("X-Shh-Access", enc.EncodeToString(k.acces))
	w := httptest.NewRecorder()
	e.h.ServeHTTP(w, hr)
	expect(t, w, 400, badRequest)
	// Corps JSON trop gros.
	big := mustJSON(map[string]string{"proof": strings.Repeat("A", 5000)})
	expect(t, e.do(req{method: "POST", path: "/api/shares/" + c.ID + "/unlock", hdr: access(k), body: big}), 400, badRequest)
}

func TestBehindProxy(t *testing.T) {
	e := newEnv(t, true, nil)
	expect(t, e.do(req{method: "GET", path: "/api/captcha", remote: "127.0.0.1:5000"}), 500, `{"error":"internal"}`)
	expect(t, e.do(req{method: "GET", path: "/api/captcha", remote: "127.0.0.1:5000",
		hdr: map[string]string{"X-Shh-Client-IP": "pas-une-ip"}}), 500, `{"error":"internal"}`)
	expect(t, e.do(req{method: "GET", path: "/api/captcha", remote: "127.0.0.1:5000",
		hdr: map[string]string{"X-Shh-Client-IP": "198.51.100.4"}}), 200, "")
	// Pair distant (Caddy contourné) : refusé, avec ou sans en-tête.
	expect(t, e.do(req{method: "GET", path: "/api/captcha", remote: "198.51.100.9:443"}), 500, `{"error":"internal"}`)
	expect(t, e.do(req{method: "GET", path: "/api/captcha", remote: "198.51.100.9:443",
		hdr: map[string]string{"X-Shh-Client-IP": "198.51.100.4"}}), 500, `{"error":"internal"}`)
	// Chaque client derrière le proxy a sa propre limite.
	for i := 0; i < limits.RequestsPerMin; i++ {
		e.do(req{method: "GET", path: "/api/nope", remote: "127.0.0.1:5000",
			hdr: map[string]string{"X-Shh-Client-IP": "198.51.100.5"}})
	}
	expect(t, e.do(req{method: "GET", path: "/api/captcha", remote: "127.0.0.1:5000",
		hdr: map[string]string{"X-Shh-Client-IP": "198.51.100.5"}}), 429, "")
	expect(t, e.do(req{method: "GET", path: "/api/captcha", remote: "127.0.0.1:5000",
		hdr: map[string]string{"X-Shh-Client-IP": "198.51.100.6"}}), 200, "")

	plain := newEnv(t, false, nil)
	expect(t, plain.do(req{method: "GET", path: "/api/captcha", remote: "127.0.0.1:5000"}), 200, "")
}

func TestUniformNotFoundAllRoutes(t *testing.T) {
	e := newEnv(t, false, nil)
	k := newKeys()
	mk := func() (created, string) {
		c := e.create(t, "", k, 1, 2)
		e.upload(t, c, 1)
		dl, _ := e.unlock(t, c.ID, k)
		return c, dl
	}
	expired, expTok := mk()
	destroyed, desTok := mk()
	expect(t, e.do(req{method: "POST", path: "/api/shares/" + destroyed.ID + "/destroy",
		body: mustJSON(map[string]string{"manage": enc.EncodeToString(k.gestion)})}), 204, "")
	e.clk.Add(2 * time.Hour)
	live, _ := mk()

	future := e.clk.Now().Add(time.Hour)
	unknown, invalid := enc.EncodeToString(rnd(16)), "pas-un-id"
	cases := []struct {
		name, id string
		k        keys
		tok      string
	}{
		{"inexistant", unknown, k, e.sig.Issue(token.Download, unknown, 1, future)},
		{"id invalide", invalid, k, e.sig.Issue(token.Download, invalid, 1, future)},
		{"détruit", destroyed.ID, k, desTok},
		{"mauvaise clé", live.ID, newKeys(), token.New(rnd(32), e.clk.Now).Issue(token.Download, live.ID, 1, future)},
		{"expiré", expired.ID, k, expTok},
	}
	routes := map[string]func(id string, k keys, tok string) req{
		"meta": func(id string, k keys, _ string) req {
			return req{method: "GET", path: "/api/shares/" + id + "/meta", hdr: access(k)}
		},
		"unlock": func(id string, k keys, _ string) req {
			return req{method: "POST", path: "/api/shares/" + id + "/unlock", hdr: access(k),
				body: mustJSON(map[string]string{"proof": enc.EncodeToString(k.preuve)})}
		},
		"status": func(id string, k keys, _ string) req {
			return req{method: "GET", path: "/api/shares/" + id + "/status",
				hdr: map[string]string{"X-Shh-Manage": enc.EncodeToString(k.gestion)}}
		},
		"destroy gestion": func(id string, k keys, _ string) req {
			return req{method: "POST", path: "/api/shares/" + id + "/destroy",
				body: mustJSON(map[string]string{"manage": enc.EncodeToString(k.gestion)})}
		},
		"destroy preuve": func(id string, k keys, _ string) req {
			return req{method: "POST", path: "/api/shares/" + id + "/destroy", hdr: access(k),
				body: mustJSON(map[string]string{"proof": enc.EncodeToString(k.preuve)})}
		},
		"segment": func(id string, _ keys, tok string) req {
			return req{method: "GET", path: "/api/shares/" + id + "/segments/0", hdr: auth(tok)}
		},
		"done": func(id string, _ keys, tok string) req {
			return req{method: "POST", path: "/api/shares/" + id + "/done", hdr: auth(tok)}
		},
	}
	for rname, route := range routes {
		for _, c := range cases {
			w := e.do(route(c.id, c.k, c.tok))
			if w.Code != 404 || w.Body.String() != notFound {
				t.Fatalf("%s / %s : %d %q", rname, c.name, w.Code, w.Body.String())
			}
		}
	}
	// Réponses octet pour octet identiques entre elles.
	e.clk.Add(time.Minute) // nouvelle fenêtre de débit
	ref := e.do(routes["meta"](unknown, k, "")).Body.String()
	for rname, route := range routes {
		for _, c := range cases {
			if got := e.do(route(c.id, c.k, c.tok)).Body.String(); got != ref {
				t.Fatalf("%s / %s : %q ≠ %q", rname, c.name, got, ref)
			}
		}
	}
	// Aucun essai compté sur le partage expiré ; le partage vivant intact.
	for _, id := range []string{expired.ID, live.ID} {
		var f int
		if err := e.svc.DB.QueryRow(`SELECT failed_attempts FROM shares WHERE id=?`, id).Scan(&f); err != nil || f != 0 {
			t.Fatalf("failed_attempts = %d %v", f, err)
		}
	}
	// Route inconnue et mauvaise méthode : même corps JSON.
	expect(t, e.do(req{method: "GET", path: "/api/nope"}), 404, notFound)
	expect(t, e.do(req{method: "DELETE", path: "/api/shares"}), 404, notFound)
}

func TestHealthz(t *testing.T) {
	for _, proxy := range []bool{false, true} {
		e := newEnv(t, proxy, nil)
		for i := 0; i < limits.RequestsPerMin+5; i++ { // non limité
			w := e.do(req{method: "GET", path: "/healthz", remote: "127.0.0.1:9"})
			expect(t, w, 200, "ok")
			checkHeaders(t, "healthz", w)
		}
		expect(t, e.do(req{method: "GET", path: "/healthz", remote: "[::1]:9"}), 200, "ok")
		expect(t, e.do(req{method: "GET", path: "/healthz", remote: "198.51.100.1:9"}), 404, notFound)
		// Relayé par Caddy (en-tête posé) : refusé même si le pair est local.
		expect(t, e.do(req{method: "GET", path: "/healthz", remote: "127.0.0.1:9",
			hdr: map[string]string{"X-Shh-Client-IP": "198.51.100.1"}}), 404, notFound)
	}
}

func TestPanicAfterWriteAborts(t *testing.T) {
	for name, h := range map[string]http.HandlerFunc{
		"après écriture": func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(200)
			w.Write([]byte("partiel"))
			panic("boum")
		},
		"ErrAbortHandler": func(http.ResponseWriter, *http.Request) { panic(http.ErrAbortHandler) },
	} {
		e := newEnv(t, false, h)
		w := httptest.NewRecorder()
		func() {
			defer func() {
				if v := recover(); v != http.ErrAbortHandler {
					t.Fatalf("%s : panic %v, attendu ErrAbortHandler", name, v)
				}
			}()
			e.h.ServeHTTP(w, httptest.NewRequest("GET", "/", nil))
		}()
		if strings.Contains(w.Body.String(), "internal") {
			t.Fatalf("%s : corps ajouté %q", name, w.Body.String())
		}
	}
}
