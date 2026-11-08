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
	"net/netip"
	"os"
	"path/filepath"
	"sort"
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
	srv *server
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
	return newEnvWith(t, behindProxy, nil, static)
}

func newEnvProxies(t *testing.T, proxies []netip.Prefix) *env {
	t.Helper()
	return newEnvWith(t, true, proxies, nil)
}

func newEnvWith(t *testing.T, behindProxy bool, proxies []netip.Prefix, static http.Handler) *env {
	t.Helper()
	return newEnvFull(t, behindProxy, proxies, static, defaultTransfers())
}

func newEnvFull(t *testing.T, behindProxy bool, proxies []netip.Prefix, static http.Handler, x transfers) *env {
	t.Helper()
	dir := t.TempDir()
	db, err := store.Open(filepath.Join(dir, "shares.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	c := &clock{t: time.Date(2026, 11, 4, 10, 2, 0, 0, time.UTC)}
	lim := limits.New(c.Now)
	svc, err := share.NewService(share.Config{DB: db, Blobs: &blob.Store{Dir: filepath.Join(dir, "blobs")}, Now: c.Now,
		OnAbandon:  func(id string, _ int) { lim.AbandonUpload(id) },
		StorageMax: 1 << 40, FrozenFile: filepath.Join(dir, "frozen")})
	if err != nil {
		t.Fatal(err)
	}
	if static == nil {
		static = htmlStatic()
	}
	sig := token.New(rnd(32), c.Now)
	srv := newServer(svc, sig, lim, captcha.New(rnd(32), c.Now), behindProxy, proxies)
	srv.xfer = x
	h := newHandler(srv, static)
	return &env{h: h, srv: srv, svc: svc, sig: sig, clk: c, dir: dir}
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
	budgetBody = `{"error":"budget","retry_after_s":60}`
	notFound   = `{"error":"not_found"}`
	badRequest = `{"error":"bad_request"}`
	healthOK   = `{"ok":true,"reports_alert":false}`
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

// createBody : création v2, sans id ni vérificateur (spec §29.8). `opens` n'est plus envoyé
// à la création : il l'est à la finalisation (finBody), via created.Opens.
func (k keys) createBody(bucket, opens int, alt, shown string) map[string]any {
	_ = opens
	return map[string]any{"bucket": bucket, "altcha": alt, "hp": "", "shown_at": shown}
}

// createHdr : K_accès et S_gestion de la création, en en-tête ; le serveur en tire V_accès
// et V_gestion.
func (k keys) createHdr() map[string]string {
	return map[string]string{"X-Shh-Access": enc.EncodeToString(k.acces), "X-Shh-Manage": enc.EncodeToString(k.gestion)}
}

func manage(k keys) map[string]string {
	return map[string]string{"X-Shh-Manage": enc.EncodeToString(k.gestion)}
}

// finBody : finalisation v2 pour les clés k (V_preuve), bourrage vide.
func (k keys) finBody(opens, ttl int) map[string]any {
	return map[string]any{"salt": enc.EncodeToString(rnd(16)), "kdf_ops": 3, "kdf_mem": 67108864,
		"proof_v": v(k.preuve), "envelope": enc.EncodeToString(rnd(share.EnvelopeLen)),
		"ttl_hours": ttl, "max_opens": opens, "fill_from": 0, "fill_to": 0}
}

func mustJSON(x any) []byte { b, _ := json.Marshal(x); return b }

type created struct {
	ID          string `json:"-"` // id interne, lu dans le jeton d'envoi (jamais montré au client)
	UploadToken string `json:"upload_token"`
	Segments    int    `json:"segments"`
	k           keys
	opens       int
}

func (e *env) create(t *testing.T, remote string, k keys, bucket, opens int) created {
	t.Helper()
	alt, shown := e.captchaFor(t, remote)
	body := k.createBody(bucket, opens, alt, shown)
	w := e.do(req{method: "POST", path: "/api/shares", hdr: k.createHdr(), body: mustJSON(body), remote: remote})
	expect(t, w, 201, "")
	c := created{k: k, opens: opens}
	if err := json.Unmarshal(w.Body.Bytes(), &c); err != nil || c.UploadToken == "" {
		t.Fatalf("création: %q", w.Body.String())
	}
	c.ID = e.idOf(t, c.UploadToken, token.Upload)
	if m := jsonOf(t, w); len(m) != 2 {
		t.Fatalf("réponse de création : %v", m) // upload_token et segments seulement
	}
	return c
}

// idOf : id interne désigné par un jeton (pour les contrôles en base des tests).
func (e *env) idOf(t *testing.T, tok string, kind byte) string {
	t.Helper()
	id, _, err := e.sig.Subject(tok, kind)
	if err != nil {
		t.Fatal(err)
	}
	return id
}

func auth(tok string) map[string]string { return map[string]string{"Authorization": "Bearer " + tok} }

// upload envoie des segments aléatoires, finalise et rend leur contenu.
func (e *env) upload(t *testing.T, c created, bucket int) [][]byte {
	t.Helper()
	return e.uploadTTL(t, c, bucket, 1)
}

// uploadTTL : upload avec une durée de vie de ttl heures.
func (e *env) uploadTTL(t *testing.T, c created, bucket, ttl int) [][]byte {
	t.Helper()
	var segs [][]byte
	for n := 0; n < c.Segments; n++ {
		b := rnd(share.SegmentSize(bucket, n))
		segs = append(segs, b)
		expect(t, e.do(req{method: "PUT", path: fmt.Sprintf("/api/shares/segments/%d", n), body: b,
			hdr: auth(c.UploadToken)}), 204, "")
	}
	w := e.do(req{method: "POST", path: "/api/shares/finalize", hdr: auth(c.UploadToken),
		body: mustJSON(c.k.finBody(c.opens, ttl))})
	expect(t, w, 200, "")
	if s := jsonOf(t, w)["expires_in_s"].(float64); s < float64(ttl)*3600 || s > float64(ttl)*3600+900 {
		t.Fatalf("expires_in_s = %v", s)
	}
	return segs
}

func access(k keys) map[string]string {
	return map[string]string{"X-Shh-Access": enc.EncodeToString(k.acces)}
}

func (e *env) unlock(t *testing.T, id string, k keys) (string, int) {
	t.Helper()
	w := e.do(req{method: "POST", path: "/api/shares/unlock", hdr: access(k),
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

	w := e.do(req{method: "GET", path: "/api/shares/meta", hdr: access(k)})
	expect(t, w, 200, "")
	m := jsonOf(t, w)
	kdf := m["kdf"].(map[string]any)
	if m["bucket"].(float64) != bucket || m["segments"].(float64) != 2 || kdf["ops"].(float64) != 3 ||
		kdf["mem"].(float64) != 67108864 || m["expires_in_s"].(float64) < 3600 || m["opens_left"] != float64(2) {
		t.Fatalf("meta: %v", m)
	}
	if salt, err := b64.DecodeString(m["salt"].(string)); err != nil || len(salt) != 16 {
		t.Fatalf("sel: %v", m["salt"])
	}

	// Mauvais mot de passe : 403 avec essais restants.
	w = e.do(req{method: "POST", path: "/api/shares/unlock", hdr: access(k),
		body: mustJSON(map[string]string{"proof": enc.EncodeToString(rnd(32))})})
	expect(t, w, 403, `{"error":"bad_password","attempts_left":4}`)

	dl, n := e.unlock(t, c.ID, k)
	if n != 2 {
		t.Fatalf("segments = %d", n)
	}
	for i, want := range segs {
		w := e.do(req{method: "GET", path: fmt.Sprintf("/api/shares/segments/%d", i), hdr: auth(dl)})
		expect(t, w, 200, "")
		if !bytes.Equal(w.Body.Bytes(), want) || w.Header().Get("Content-Type") != "application/octet-stream" {
			t.Fatalf("segment %d différent", i)
		}
	}
	expect(t, e.do(req{method: "GET", path: "/api/shares/segments/2", hdr: auth(dl)}), 400, badRequest)
	expect(t, e.do(req{method: "POST", path: "/api/shares/done", hdr: auth(dl)}), 204, "")
	expect(t, e.do(req{method: "POST", path: "/api/shares/done", hdr: auth(dl)}), 204, "") // idempotent
	// Ouvertures restantes (ruling 5) : connues de qui a K_accès, une de moins après l'ouverture.
	if m := jsonOf(t, e.do(req{method: "GET", path: "/api/shares/meta", hdr: access(k)})); m["opens_left"] != float64(1) || len(m) != 6 {
		t.Fatalf("meta après ouverture : %v", m)
	}
	// Ouverture terminée : son jeton ne lit plus rien.
	expect(t, e.do(req{method: "GET", path: "/api/shares/segments/0", hdr: auth(dl)}), 410, goneBody) // ouverture terminée : plus de droit (spec §41.8)

	w = e.do(req{method: "GET", path: "/api/manage/status",
		hdr: map[string]string{"X-Shh-Manage": enc.EncodeToString(k.gestion)}})
	expect(t, w, 200, "")
	st := jsonOf(t, w)
	if st["opens_used"].(float64) != 1 || st["max_opens"].(float64) != 2 || st["state"] != "ready" ||
		st["expires_in_s"].(float64) < 3600 {
		t.Fatalf("status: %v", st)
	}

	// Destruction par le destinataire (K_accès + K_preuve).
	w = e.do(req{method: "POST", path: "/api/shares/destroy", hdr: access(k),
		body: mustJSON(map[string]string{"proof": enc.EncodeToString(k.preuve)})})
	expect(t, w, 204, "")
	expect(t, e.do(req{method: "GET", path: "/api/shares/meta", hdr: access(k)}), 404, notFound)
	// Ouverture déjà terminée (done) : aucune grâce, 410 avec son jeton.
	expect(t, e.do(req{method: "GET", path: "/api/shares/segments/0", hdr: auth(dl)}), 410, goneBody)
	if _, err := os.Stat(filepath.Join(e.dir, "blobs", c.ID)); !os.IsNotExist(err) {
		t.Fatal("fichier encore présent")
	}
}

// Spec §32 : gestion par S_gestion seul (en-tête), partage trouvé par V_gestion. Aucune
// route ne porte d'id ; l'ancienne route /api/shares/{id}/status n'existe plus.
func TestManageRoutes(t *testing.T) {
	e := newEnv(t, false, nil)
	k := newKeys()
	c := e.create(t, "", k, 1, 1)
	e.upload(t, c, 1)
	other := newKeys()
	e.upload(t, e.create(t, "", other, 1, 3), 1)
	for _, r := range []req{
		{method: "GET", path: "/api/shares/" + c.ID + "/status", hdr: manage(k)},
		{method: "POST", path: "/api/shares/" + c.ID + "/destroy", hdr: manage(k)},
		{method: "GET", path: "/api/shares/" + c.ID + "/meta", hdr: access(k)},
		{method: "GET", path: "/api/manage/" + c.ID + "/status", hdr: manage(k)},
	} {
		expect(t, e.do(r), 404, notFound)
	}
	for _, path := range []string{"/api/manage/status", "/api/manage/destroy"} {
		method := map[string]string{"/api/manage/status": "GET", "/api/manage/destroy": "POST"}[path]
		// Format : en-tête absent, en double, trop court ou trop long, alphabet faux → 400.
		expect(t, e.do(req{method: method, path: path}), 400, badRequest)
		for _, bad := range []string{enc.EncodeToString(rnd(31)), enc.EncodeToString(rnd(33)),
			strings.Repeat("*", 43), enc.EncodeToString(k.gestion)[:42] + "\n"} {
			expect(t, e.do(req{method: method, path: path, hdr: map[string]string{"X-Shh-Manage": bad}}), 400, badRequest)
		}
		// Corps non vide refusé : rien d'autre que S_gestion ne transite.
		expect(t, e.do(req{method: method, path: path, hdr: manage(k), body: []byte(`{}`)}), 400, badRequest)
		// Faux S_gestion, ou K_accès à sa place : 404 uniforme.
		expect(t, e.do(req{method: method, path: path, hdr: manage(newKeys())}), 404, notFound)
		expect(t, e.do(req{method: method, path: path, hdr: map[string]string{"X-Shh-Manage": enc.EncodeToString(k.acces)}}), 404, notFound)
		// Méthode inverse : 404 (route inconnue).
		inv := map[string]string{"GET": "POST", "POST": "GET"}[method]
		expect(t, e.do(req{method: inv, path: path, hdr: manage(k)}), 404, notFound)
	}
	w := e.do(req{method: "GET", path: "/api/manage/status", hdr: manage(k)})
	expect(t, w, 200, "")
	if st := jsonOf(t, w); st["max_opens"].(float64) != 1 || len(st) != 4 {
		t.Fatalf("status: %v", st)
	}
	// L'autre partage a son propre statut (V_gestion distincts).
	if st := jsonOf(t, e.do(req{method: "GET", path: "/api/manage/status", hdr: manage(other)})); st["max_opens"].(float64) != 3 {
		t.Fatalf("status de l'autre partage: %v", st)
	}
	expect(t, e.do(req{method: "POST", path: "/api/manage/destroy", hdr: manage(k)}), 204, "")
	expect(t, e.do(req{method: "GET", path: "/api/manage/status", hdr: manage(k)}), 404, notFound)
	expect(t, e.do(req{method: "POST", path: "/api/manage/destroy", hdr: manage(k)}), 404, notFound)
	expect(t, e.do(req{method: "GET", path: "/api/shares/meta", hdr: access(k)}), 404, notFound)
	expect(t, e.do(req{method: "GET", path: "/api/manage/status", hdr: manage(other)}), 200, "")
	// La destruction par le destinataire n'accepte plus S_gestion.
	expect(t, e.do(req{method: "POST", path: "/api/shares/destroy", hdr: access(other),
		body: mustJSON(map[string]string{"manage": enc.EncodeToString(other.gestion)})}), 400, badRequest)
	expect(t, e.do(req{method: "POST", path: "/api/shares/destroy", body: mustJSON(map[string]string{"proof": enc.EncodeToString(other.preuve)})}),
		400, badRequest) // K_preuve sans K_accès
}

func TestFifthBadPasswordIsNotFound(t *testing.T) {
	e := newEnv(t, false, nil)
	k := newKeys()
	c := e.create(t, "", k, 1, 1)
	e.upload(t, c, 1)
	for left := 4; left >= 1; left-- {
		w := e.do(req{method: "POST", path: "/api/shares/unlock", hdr: access(k),
			body: mustJSON(map[string]string{"proof": enc.EncodeToString(rnd(32))})})
		expect(t, w, 403, fmt.Sprintf(`{"error":"bad_password","attempts_left":%d}`, left))
	}
	w := e.do(req{method: "POST", path: "/api/shares/unlock", hdr: access(k),
		body: mustJSON(map[string]string{"proof": enc.EncodeToString(rnd(32))})})
	expect(t, w, 404, notFound)
	expect(t, e.do(req{method: "GET", path: "/api/shares/meta", hdr: access(k)}), 404, notFound)
}

var wantHeaders = map[string]string{
	"Content-Security-Policy": "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; " +
		"img-src 'self' blob:; media-src 'self' blob:; connect-src 'self'; frame-src 'self'; object-src 'none'; " +
		"base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
	"Referrer-Policy":              "no-referrer",
	"X-Content-Type-Options":       "nosniff",
	"Permissions-Policy":           "microphone=(self), camera=(self), geolocation=(), display-capture=(), clipboard-read=(), usb=(), serial=(), hid=(), payment=(), gyroscope=(), accelerometer=(), magnetometer=(), midi=(), xr-spatial-tracking=(), browsing-topics=(), interest-cohort=()",
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
	w = e.do(req{method: "GET", path: "/api/shares/meta",
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
		return e.do(req{method: "PUT", path: "/api/shares/segments/" + n, body: body, hdr: auth(tok)})
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
	expect(t, e.do(req{method: "POST", path: "/api/shares/finalize", hdr: auth(c.UploadToken), body: mustJSON(newKeys().finBody(1, 1))}),
		409, `{"error":"incomplete"}`)
	// Sans jeton, jeton malformé.
	expect(t, e.do(req{method: "PUT", path: "/api/shares/segments/0", body: make([]byte, size)}), 400, badRequest)
	expect(t, put("0", make([]byte, size), "n'importe.quoi"), 404, notFound)
	// Envoi après finalisation refusé.
	expect(t, put("0", make([]byte, size), c.UploadToken), 204, "")
	expect(t, e.do(req{method: "POST", path: "/api/shares/finalize", hdr: auth(c.UploadToken), body: mustJSON(newKeys().finBody(1, 1))}), 200, "")
	expect(t, put("0", make([]byte, size), c.UploadToken), 404, notFound)
}

// Spec §32 : aucun id dans le chemin ; le jeton signé désigne seul le partage. Le jeton de
// A n'agit que sur A ; changer l'id signé casse la signature ; les types ne s'échangent pas.
func TestTokenDesignatesShare(t *testing.T) {
	e := newEnv(t, false, nil)
	ka, kb := newKeys(), newKeys()
	a := e.create(t, "", ka, 1, 2)
	b := e.create(t, "", kb, 1, 2)
	size := share.SegmentSize(1, 0)
	fileB := filepath.Join(e.dir, "blobs", b.ID)
	beforeB, _ := os.ReadFile(fileB)
	e.upload(t, a, 1)
	if afterB, _ := os.ReadFile(fileB); !bytes.Equal(beforeB, afterB) {
		t.Fatal("le jeton de A a écrit dans B")
	}
	// Jeton de A dont l'id signé est remplacé par celui de B : signature invalide.
	p, sig, _ := strings.Cut(b.UploadToken, ".")
	raw, _ := enc.DecodeString(p)
	pa, _, _ := strings.Cut(a.UploadToken, ".")
	rawA, _ := enc.DecodeString(pa)
	copy(raw[2:2+16], rawA[2:2+16])
	forged := enc.EncodeToString(raw) + "." + sig
	expect(t, e.do(req{method: "PUT", path: "/api/shares/segments/0", body: make([]byte, size), hdr: auth(forged)}), 404, notFound)
	e.upload(t, b, 1)
	dlA, _ := e.unlock(t, a.ID, ka)
	// Jeton d'envoi refusé en lecture ; jeton de téléchargement refusé à l'envoi.
	expect(t, e.do(req{method: "GET", path: "/api/shares/segments/0", hdr: auth(a.UploadToken)}), 404, notFound)
	expect(t, e.do(req{method: "POST", path: "/api/shares/done", hdr: auth(a.UploadToken)}), 404, notFound)
	expect(t, e.do(req{method: "POST", path: "/api/shares/finalize", hdr: auth(dlA), body: mustJSON(newKeys().finBody(1, 1))}), 404, notFound)
	expect(t, e.do(req{method: "PUT", path: "/api/shares/segments/0", body: make([]byte, size), hdr: auth(dlA)}), 404, notFound)
	// Le jeton de A lit A, et seulement A.
	w := e.do(req{method: "GET", path: "/api/shares/segments/0", hdr: auth(dlA)})
	expect(t, w, 200, "")
	fileA, _ := os.ReadFile(filepath.Join(e.dir, "blobs", a.ID))
	if !bytes.Equal(w.Body.Bytes(), fileA[:size]) {
		t.Fatal("segment lu ailleurs que dans A")
	}
	expect(t, e.do(req{method: "POST", path: "/api/shares/done", hdr: auth(dlA)}), 204, "")
	if doneMask(t, e, b.ID) != 0 || doneMask(t, e, a.ID) != 1 {
		t.Fatal("done appliqué au mauvais partage")
	}
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
	expect(t, e.do(req{method: "POST", path: "/api/shares/done", hdr: auth(forged)}), 404, notFound)
	// Jeton bien formé mais signé avec une autre clé.
	other := token.New(rnd(32), e.clk.Now).Issue(token.Download, c.ID, 1, e.clk.Now().Add(time.Hour))
	expect(t, e.do(req{method: "POST", path: "/api/shares/done", hdr: auth(other)}), 404, notFound)
	if m := doneMask(t, e, c.ID); m != 0 {
		t.Fatalf("done_mask = %b après jetons falsifiés", m)
	}
	expect(t, e.do(req{method: "POST", path: "/api/shares/done", hdr: auth(dl2)}), 204, "")
	if m := doneMask(t, e, c.ID); m != 0b10 {
		t.Fatalf("done_mask = %b, attendu 10 (ouverture 2 seulement)", m)
	}
}

// Après l'échéance, un jeton jamais utilisé (ouverture non active) ne lit plus rien : 410.
func TestDownloadAfterExpiryNotActive(t *testing.T) {
	e := newEnv(t, false, nil)
	k := newKeys()
	c := e.create(t, "", k, 1, 1)
	e.upload(t, c, 1) // expire dans 1 h à 1 h 15
	e.clk.Add(50 * time.Minute)
	dl, _ := e.unlock(t, c.ID, k)
	e.clk.Add(30 * time.Minute) // au-delà de expires_at, avant 1 h de jeton
	expect(t, e.do(req{method: "GET", path: "/api/shares/segments/0", hdr: auth(dl)}), 410, goneBody)
}

// Spec §24, §41.2, §41.8 : jeton d'envoi 6 h ; jeton de téléchargement 6 h, plus plafonné
// à expires_at (il borne la grâce d'une ouverture active).
func TestTokenLifetimes(t *testing.T) {
	e := newEnv(t, false, nil)
	k := newKeys()
	alt, shown := e.captchaFor(t, "")
	body := k.createBody(1, 1, alt, shown)
	w := e.do(req{method: "POST", path: "/api/shares", hdr: k.createHdr(), body: mustJSON(body)})
	expect(t, w, 201, "")
	var c created
	json.Unmarshal(w.Body.Bytes(), &c)
	c.ID = e.idOf(t, c.UploadToken, token.Upload)
	if _, exp, err := e.sig.CheckExp(c.UploadToken, token.Upload, c.ID); err != nil || !exp.Equal(e.clk.Now().Add(6*time.Hour)) {
		t.Fatal("jeton d'envoi", exp, err)
	}
	e.clk.Add(5*time.Hour + 50*time.Minute) // 15:52 : l'envoi est encore accepté (échéance 16:15)
	expect(t, e.do(req{method: "PUT", path: "/api/shares/segments/0", body: rnd(share.SegmentSize(1, 0)),
		hdr: auth(c.UploadToken)}), 204, "")
	expect(t, e.do(req{method: "POST", path: "/api/shares/finalize", hdr: auth(c.UploadToken),
		body: mustJSON(k.finBody(1, 24))}), 200, "")
	dl, _ := e.unlock(t, c.ID, k)
	if _, exp, err := e.sig.CheckExp(dl, token.Download, c.ID); err != nil || !exp.Equal(e.clk.Now().Add(6*time.Hour)) {
		t.Fatal("jeton de téléchargement (24 h)", exp, err)
	}
	// Partage d'une heure : jeton de 6 h aussi (la grâce de §41.8 en dépend).
	k2 := newKeys()
	short := e.create(t, "", k2, 1, 1)
	e.upload(t, short, 1)
	dl2, _ := e.unlock(t, short.ID, k2)
	if _, exp, err := e.sig.CheckExp(dl2, token.Download, short.ID); err != nil || !exp.Equal(e.clk.Now().Add(6*time.Hour)) {
		t.Fatal("jeton de téléchargement", exp, err)
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
	seg := "/api/shares/segments/0"
	// Le budget de lecture du jeton (share.ReadBudget) s'épuise vite au palier 1 : une
	// réponse « budget » prouve elle aussi que la limite de débit a laissé passer.
	passed := func(w *httptest.ResponseRecorder) {
		t.Helper()
		if w.Code != 200 && strings.TrimSpace(w.Body.String()) != budgetBody {
			t.Fatalf("segment refusé par la limite de débit : %d %q", w.Code, w.Body.String())
		}
	}
	for i := 0; i < 100; i++ {
		passed(e.do(req{method: "GET", path: seg, hdr: auth(dl)}))
	}
	expect(t, e.do(req{method: "GET", path: "/api/captcha"}), 429, "")
	// Jeton invalide (autre partage, mauvais type, illisible) : limite générale, épuisée.
	for _, tok := range []string{c.UploadToken, "x", ""} {
		expect(t, e.do(req{method: "GET", path: seg, hdr: auth(tok)}), 429, "")
	}
	expect(t, e.do(req{method: "PUT", path: seg, hdr: auth(dl), body: rnd(10)}), 429, "")

	e.clk.Add(time.Minute)
	for i := 0; i < limits.SegmentsPerMin-1; i++ { // 1 de moins : le PUT ci-dessous
		passed(e.do(req{method: "GET", path: seg, hdr: auth(dl)}))
	}
	// PUT avec un jeton d'envoi valide : même compteur des segments (refusé après finalisation).
	expect(t, e.do(req{method: "PUT", path: seg, hdr: auth(c.UploadToken), body: rnd(share.SegmentSize(1, 0))}), 404, notFound)
	w := e.do(req{method: "GET", path: seg, hdr: auth(dl)})
	if expect(t, w, 429, ""); jsonOf(t, w)["error"] != "limit" {
		t.Fatalf("attendu la limite de débit : %q", w.Body.String())
	}
	expect(t, e.do(req{method: "GET", path: "/api/captcha"}), 200, "") // limite générale intacte
}

func TestCreateRefusals(t *testing.T) {
	e := newEnv(t, false, nil)
	k := newKeys()
	post := func(body map[string]any) *httptest.ResponseRecorder {
		w := e.do(req{method: "POST", path: "/api/shares", hdr: k.createHdr(), body: mustJSON(body)})
		if w.Code == 201 { // envoi détruit aussitôt : la limite de 2 envois en cours ne gêne pas
			expect(t, e.do(req{method: "POST", path: "/api/manage/destroy", hdr: manage(k)}), 204, "")
		}
		return w
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
	b["bucket"] = 2
	expect(t, post(b), 400, badRequest)
	// Plus grand palier gratuit : 32 770 refusé (le serveur ne connaît que les paliers, spec §41.2).
	b["bucket"] = 32770
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
		// Champs K1 : l'id et les vérificateurs ne sont plus envoyés (spec §29.8, §32).
		func(m map[string]any) { m["id"] = enc.EncodeToString(rnd(16)) },
		func(m map[string]any) { m["access_v"] = v(k.acces) },
		func(m map[string]any) { m["manage_v"] = v(k.gestion) },
		func(m map[string]any) { m["access"] = enc.EncodeToString(k.acces) }, // secret dans le corps
		func(m map[string]any) { m["inconnu"] = 1 },
		// Champs v1 : n'existent plus à la création (spec §29.8).
		func(m map[string]any) { m["proof_v"] = v(rnd(32)) },
		func(m map[string]any) { m["salt"] = enc.EncodeToString(rnd(16)) },
		func(m map[string]any) { m["ttl_hours"] = 1 },
		func(m map[string]any) { m["max_opens"] = 1 },
		func(m map[string]any) { m["kdf"] = map[string]int{"ops": 3, "mem": 67108864} },
	}
	for i, f := range bad {
		alt, shown := e.captchaFor(t, "")
		m := k.createBody(1, 1, alt, shown)
		f(m)
		if w := post(m); w.Code != 400 {
			t.Fatalf("cas %d : %d %q", i, w.Code, w.Body.String())
		}
	}
	// En-têtes des secrets : absents, mal formés, en double → 400, défi non consommé.
	alt, shown = e.captchaFor(t, "")
	for i, h := range []map[string]string{
		{},
		{"X-Shh-Access": enc.EncodeToString(k.acces)},
		{"X-Shh-Manage": enc.EncodeToString(k.gestion)},
		{"X-Shh-Access": enc.EncodeToString(rnd(31)), "X-Shh-Manage": enc.EncodeToString(k.gestion)},
		{"X-Shh-Access": enc.EncodeToString(k.acces), "X-Shh-Manage": base64.URLEncoding.EncodeToString(k.gestion)},
		{"X-Shh-Access": v(k.acces)[:42] + "\n", "X-Shh-Manage": enc.EncodeToString(k.gestion)},
	} {
		if w := e.do(req{method: "POST", path: "/api/shares", hdr: h, body: mustJSON(k.createBody(1, 1, alt, shown))}); w.Code != 400 {
			t.Fatalf("en-têtes %d : %d %q", i, w.Code, w.Body.String())
		}
	}
	hr := httptest.NewRequest("POST", "/api/shares", bytes.NewReader(mustJSON(k.createBody(1, 1, alt, shown))))
	hr.Header.Add("X-Shh-Access", enc.EncodeToString(k.acces))
	hr.Header.Add("X-Shh-Access", enc.EncodeToString(rnd(32)))
	hr.Header.Set("X-Shh-Manage", enc.EncodeToString(k.gestion))
	dw := httptest.NewRecorder()
	e.h.ServeHTTP(dw, hr)
	expect(t, dw, 400, badRequest)
	expect(t, post(k.createBody(1, 1, alt, shown)), 201, "")
	expect(t, e.do(req{method: "POST", path: "/api/shares", hdr: k.createHdr(), body: append(mustJSON(k.createBody(1, 1, "a", "b")), '{')}), 400, badRequest)
	expect(t, e.do(req{method: "POST", path: "/api/shares", hdr: k.createHdr(), body: bytes.Repeat([]byte(" "), 5000)}), 400, badRequest)
}

func TestCreateFrozenFull(t *testing.T) {
	e := newEnv(t, false, nil)
	k := newKeys()
	if err := os.WriteFile(e.svc.FrozenFile, nil, 0o600); err != nil {
		t.Fatal(err)
	}
	alt, shown := e.captchaFor(t, "")
	expect(t, e.do(req{method: "POST", path: "/api/shares", hdr: k.createHdr(), body: mustJSON(k.createBody(1, 1, alt, shown))}),
		503, `{"error":"frozen"}`)
	os.Remove(e.svc.FrozenFile)
	// Le défi n'a pas été consommé par le refus « gelé ».
	expect(t, e.do(req{method: "POST", path: "/api/shares", hdr: k.createHdr(), body: mustJSON(k.createBody(1, 1, alt, shown))}), 201, "")
	e.svc.StorageMax = 1000
	alt, shown = e.captchaFor(t, "")
	k2 := newKeys()
	expect(t, e.do(req{method: "POST", path: "/api/shares", hdr: k2.createHdr(), body: mustJSON(k2.createBody(1, 1, alt, shown))}),
		507, `{"error":"full"}`)
}

// Spec §29.5 : 2 envois non finalisés à la fois par connexion ; une fois finalisés,
// les créations comptent dans le quota du jour (10), qui refuse ensuite toute création.
func TestCreateQuota(t *testing.T) {
	e := newEnv(t, false, nil)
	k, ka := newKeys(), newKeys()
	e.create(t, "", ka, 1, 1)
	b := e.create(t, "", newKeys(), 1, 1)
	alt, shown := e.captchaFor(t, "")
	w := e.do(req{method: "POST", path: "/api/shares", hdr: k.createHdr(), body: mustJSON(k.createBody(1, 1, alt, shown))})
	expect(t, w, 429, "")
	if m := jsonOf(t, w); m["error"] != "limit" || m["retry_after_s"].(float64) != 60 {
		t.Fatalf("429: %v", m)
	}
	// Envoi détruit (abandon) : sa place est rendue et il ne compte pas comme création.
	expect(t, e.do(req{method: "POST", path: "/api/manage/destroy", hdr: manage(ka)}), 204, "")
	e.upload(t, b, 1)
	for i := 0; i < 9; i++ {
		e.upload(t, e.create(t, "", newKeys(), 1, 1), 1)
	}
	alt, shown = e.captchaFor(t, "")
	w = e.do(req{method: "POST", path: "/api/shares", hdr: k.createHdr(), body: mustJSON(k.createBody(1, 1, alt, shown))})
	expect(t, w, 429, "")
	if m := jsonOf(t, w); m["retry_after_s"].(float64) <= 60 {
		t.Fatalf("quota du jour : %v", m) // jusqu'à minuit UTC
	}
}

// Spec §29.8 : mêmes K_accès et S_gestion qu'un envoi existant → 400 sans toucher au
// partage ; finalize en JSON strict, longueurs exactes, bourrage contrôlé ; unlock rend l'enveloppe.
func TestCreateConflictAndFinalizeV2(t *testing.T) {
	e := newEnv(t, false, nil)
	k := newKeys()
	c := e.create(t, "", k, 400, 2) // 7 segments
	alt, shown := e.captchaFor(t, "")
	expect(t, e.do(req{method: "POST", path: "/api/shares", hdr: k.createHdr(), body: mustJSON(k.createBody(1, 1, alt, shown))}), 400, badRequest)
	segs := map[int][]byte{}
	for _, n := range []int{0, 1, 2, 6} {
		segs[n] = rnd(share.SegmentSize(400, n))
		expect(t, e.do(req{method: "PUT", path: fmt.Sprintf("/api/shares/segments/%d", n), body: segs[n],
			hdr: auth(c.UploadToken)}), 204, "")
	}
	fin := func(m map[string]any) *httptest.ResponseRecorder {
		return e.do(req{method: "POST", path: "/api/shares/finalize", hdr: auth(c.UploadToken), body: mustJSON(m)})
	}
	good := func() map[string]any {
		m := k.finBody(2, 1)
		m["fill_from"], m["fill_to"] = 3, 6
		return m
	}
	bad := []func(m map[string]any){
		func(m map[string]any) { m["envelope"] = enc.EncodeToString(rnd(59)) },
		func(m map[string]any) { m["envelope"] = enc.EncodeToString(rnd(61)) },
		func(m map[string]any) { m["envelope"] = enc.EncodeToString(rnd(60)) + "\n" },
		func(m map[string]any) { m["salt"] = enc.EncodeToString(rnd(15)) },
		func(m map[string]any) { m["proof_v"] = base64.StdEncoding.EncodeToString(rnd(32)) },
		func(m map[string]any) { m["kdf_ops"] = 2 },
		func(m map[string]any) { m["kdf_mem"] = 1 << 20 },
		func(m map[string]any) { m["ttl_hours"] = 2 },
		func(m map[string]any) { m["max_opens"] = 11 },
		func(m map[string]any) { m["fill_to"] = 7 },   // dernier segment
		func(m map[string]any) { m["fill_to"] = 8 },   // hors palier
		func(m map[string]any) { m["fill_from"] = 0 }, // segment 0
		func(m map[string]any) { delete(m, "fill_from") },
		func(m map[string]any) { m["fill_to"] = nil },
		func(m map[string]any) { m["fill_to"] = 5.5 },
		func(m map[string]any) { m["inconnu"] = 1 },
	}
	for i, f := range bad {
		m := good()
		f(m)
		if w := fin(m); w.Code != 400 {
			t.Fatalf("cas %d : %d %q", i, w.Code, w.Body.String())
		}
	}
	for _, mut := range []func(string) string{
		func(b string) string { return strings.Replace(b, `"fill_to":6`, `"fill_to":6,"FILL_TO":5`, 1) },
		func(b string) string { return strings.Replace(b, `"envelope"`, `"Envelope"`, 1) },
	} {
		w := e.do(req{method: "POST", path: "/api/shares/finalize", hdr: auth(c.UploadToken), body: []byte(mut(string(mustJSON(good()))))})
		expect(t, w, 400, badRequest)
	}
	m := good()
	m["fill_from"] = 4
	expect(t, fin(m), 409, `{"error":"incomplete"}`) // segment 3 attendu
	// Spec §36 S4, Q-MIN1 (mode « au clic ») : sans fill_from ni fill_to, aucun bourrage n'est
	// rempli par le serveur : tous les segments doivent avoir été envoyés.
	m = good()
	delete(m, "fill_from")
	delete(m, "fill_to")
	expect(t, fin(m), 409, `{"error":"incomplete"}`)
	g := good()
	expect(t, fin(g), 200, "")
	expect(t, fin(g), 404, notFound) // rejeu
	w := e.do(req{method: "POST", path: "/api/shares/unlock", hdr: access(k),
		body: mustJSON(map[string]string{"proof": enc.EncodeToString(k.preuve)})})
	expect(t, w, 200, "")
	r := jsonOf(t, w)
	if r["envelope"] != g["envelope"] || len(r) != 5 || len(r["grant"].(string)) != 54 || r["opens_left"] != 1.0 {
		t.Fatalf("unlock : %v", r)
	}
	dl := r["download_token"].(string)
	for n := 3; n < 6; n++ {
		w := e.do(req{method: "GET", path: fmt.Sprintf("/api/shares/segments/%d", n), hdr: auth(dl)})
		expect(t, w, 200, "")
		if bytes.Contains(w.Body.Bytes(), make([]byte, 4096)) {
			t.Fatal("bourrage non aléatoire", n)
		}
	}
	// Statut : rien d'autre que compteurs, échéance et état.
	w = e.do(req{method: "GET", path: "/api/manage/status", hdr: map[string]string{"X-Shh-Manage": enc.EncodeToString(k.gestion)}})
	expect(t, w, 200, "")
	keys := []string{}
	for key := range jsonOf(t, w) {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	if strings.Join(keys, ",") != "expires_in_s,max_opens,opens_used,state" {
		t.Fatal(keys)
	}
}

// Revue K1, I2, option (a) : l'oracle d'existence est fermé. Qui ne connaît que l'id du
// client (HKDF de K_lien) ou un vérificateur lu dans la base ne peut ni désigner un partage
// ni provoquer un refus qui dépende de son existence : l'id et les vérificateurs ne sont plus
// acceptés à la création, et une création avec d'autres secrets réussit pareil, partage
// existant ou non. Seul qui détient K_accès ou S_gestion d'un partage provoque un refus
// (400, compté au quota) : il connaît déjà le partage.
func TestCreateCannotProbeExistence(t *testing.T) {
	type answer struct {
		code       int
		body, keys string
	}
	shape := func(t *testing.T, w *httptest.ResponseRecorder) answer {
		t.Helper()
		keys := []string{}
		for k := range jsonOf(t, w) {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		hdr := []string{}
		for h := range w.Header() {
			hdr = append(hdr, h)
		}
		sort.Strings(hdr)
		body := ""
		if w.Code != 201 {
			body = w.Body.String()
		}
		return answer{w.Code, body, strings.Join(keys, ",") + "|" + strings.Join(hdr, ",")}
	}
	// Mêmes sondes face à un serveur où le partage existe, puis où il n'existe pas.
	run := func(exists bool) []answer {
		e := newEnv(t, false, nil)
		victim := newKeys()
		victimID := enc.EncodeToString(rnd(16)) // id côté client (jamais envoyé par un client honnête)
		if exists {
			e.upload(t, e.create(t, "", victim, 1, 1), 1)
		}
		var out []answer
		for _, f := range []func(m map[string]any){
			func(m map[string]any) { m["id"] = victimID },
			func(m map[string]any) { m["access_v"] = v(victim.acces) },
			func(m map[string]any) { m["manage_v"] = v(victim.gestion) },
			func(map[string]any) {}, // création ordinaire avec ses propres secrets
		} {
			alt, shown := e.captchaFor(t, "")
			atk := newKeys()
			b := atk.createBody(1, 1, alt, shown)
			f(b)
			w := e.do(req{method: "POST", path: "/api/shares", hdr: atk.createHdr(), body: mustJSON(b)})
			out = append(out, shape(t, w))
			if w.Code == 201 {
				expect(t, e.do(req{method: "POST", path: "/api/manage/destroy", hdr: manage(atk)}), 204, "")
			}
		}
		if exists { // le partage n'a pas été touché
			expect(t, e.do(req{method: "GET", path: "/api/shares/meta", hdr: access(victim)}), 200, "")
		}
		return out
	}
	with, without := run(true), run(false)
	if fmt.Sprint(with) != fmt.Sprint(without) {
		t.Fatalf("réponses différentes selon l'existence du partage :\n%v\n%v", with, without)
	}
	if with[3].code != 201 || with[0].code != 400 {
		t.Fatalf("réponses inattendues : %v", with)
	}

	// Détenteur des secrets (même lien deux fois) : refus ordinaire, compté au quota.
	e := newEnv(t, false, nil)
	k := newKeys()
	live := e.create(t, "", k, 1, 1)
	e.upload(t, live, 1)
	pending := e.create(t, "", newKeys(), 1, 1)
	dup := func(hdr map[string]string) *httptest.ResponseRecorder {
		alt, shown := e.captchaFor(t, "")
		return e.do(req{method: "POST", path: "/api/shares", hdr: hdr, body: mustJSON(k.createBody(1, 1, alt, shown))})
	}
	ref := func() *httptest.ResponseRecorder {
		alt, shown := e.captchaFor(t, "")
		b := k.createBody(1, 1, alt, shown)
		b["bucket"] = 2
		return e.do(req{method: "POST", path: "/api/shares", hdr: newKeys().createHdr(), body: mustJSON(b)})
	}()
	sameManage := newKeys()
	sameManage.gestion = k.gestion
	for i := 0; i < 8; i++ {
		h := k.createHdr()
		if i%2 == 1 {
			h = sameManage.createHdr()
		}
		w := dup(h)
		if w.Code != ref.Code || w.Body.String() != ref.Body.String() || len(w.Header()) != len(ref.Header()) {
			t.Fatalf("doublon %d : %d %q ; refus ordinaire : %d %q", i, w.Code, w.Body.String(), ref.Code, ref.Body.String())
		}
	}
	// 2 créations + 8 doublons = 10 : le quota du jour est atteint (l'envoi en cours compte).
	alt, shown := e.captchaFor(t, "")
	k3 := newKeys()
	w := e.do(req{method: "POST", path: "/api/shares", hdr: k3.createHdr(), body: mustJSON(k3.createBody(1, 1, alt, shown))})
	expect(t, w, 429, "")
	// Les doublons n'ont touché ni le partage prêt ni l'envoi en cours.
	expect(t, e.do(req{method: "GET", path: "/api/shares/meta", hdr: access(k)}), 200, "")
	expect(t, e.do(req{method: "PUT", path: "/api/shares/segments/0", body: rnd(share.SegmentSize(1, 0)),
		hdr: auth(pending.UploadToken)}), 204, "")
}

// Avant finalize : proof_v NULL, unlock et meta → 404 uniforme.
func TestUnlockBeforeFinalize(t *testing.T) {
	e := newEnv(t, false, nil)
	k := newKeys()
	c := e.create(t, "", k, 1, 1)
	expect(t, e.do(req{method: "PUT", path: "/api/shares/segments/0", body: rnd(share.SegmentSize(1, 0)),
		hdr: auth(c.UploadToken)}), 204, "")
	expect(t, e.do(req{method: "POST", path: "/api/shares/unlock", hdr: access(k),
		body: mustJSON(map[string]string{"proof": enc.EncodeToString(k.preuve)})}), 404, notFound)
	expect(t, e.do(req{method: "GET", path: "/api/shares/meta", hdr: access(k)}), 404, notFound)
}

func TestSecretsFormat(t *testing.T) {
	e := newEnv(t, false, nil)
	k := newKeys()
	c := e.create(t, "", k, 1, 1)
	e.upload(t, c, 1)
	path := "/api/shares/meta"
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
	expect(t, e.do(req{method: "POST", path: "/api/shares/unlock", hdr: access(k), body: big}), 400, badRequest)
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
	mk := func(k keys) (created, string) {
		c := e.create(t, "", k, 1, 2)
		e.upload(t, c, 1)
		dl, _ := e.unlock(t, c.ID, k)
		return c, dl
	}
	kExp, kDes, k := newKeys(), newKeys(), newKeys()
	expired, expTok := mk(kExp)
	_, desTok := mk(kDes)
	expect(t, e.do(req{method: "POST", path: "/api/manage/destroy", hdr: manage(kDes)}), 204, "")
	e.clk.Add(2 * time.Hour)
	live, _ := mk(k)

	future := e.clk.Now().Add(time.Hour)
	unknown, invalid := enc.EncodeToString(rnd(16)), "pas-un-id"
	cases := []struct {
		name, id string
		k        keys
		tok      string
	}{
		{"inexistant", unknown, newKeys(), e.sig.Issue(token.Download, unknown, 1, future)},
		{"id invalide", invalid, newKeys(), e.sig.Issue(token.Download, invalid, 1, future)},
		{"détruit", "", kDes, desTok},
		{"mauvaise clé", live.ID, newKeys(), token.New(rnd(32), e.clk.Now).Issue(token.Download, live.ID, 1, future)},
		{"expiré", expired.ID, kExp, expTok},
	}
	routes := map[string]func(id string, k keys, tok string) req{
		"meta": func(id string, k keys, _ string) req {
			return req{method: "GET", path: "/api/shares/meta", hdr: access(k)}
		},
		"unlock": func(id string, k keys, _ string) req {
			return req{method: "POST", path: "/api/shares/unlock", hdr: access(k),
				body: mustJSON(map[string]string{"proof": enc.EncodeToString(k.preuve)})}
		},
		"status": func(id string, k keys, _ string) req {
			return req{method: "GET", path: "/api/manage/status",
				hdr: map[string]string{"X-Shh-Manage": enc.EncodeToString(k.gestion)}}
		},
		"destroy gestion": func(id string, k keys, _ string) req {
			return req{method: "POST", path: "/api/manage/destroy", hdr: manage(k)}
		},
		"destroy preuve": func(id string, k keys, _ string) req {
			return req{method: "POST", path: "/api/shares/destroy", hdr: access(k),
				body: mustJSON(map[string]string{"proof": enc.EncodeToString(k.preuve)})}
		},
		"segment": func(id string, _ keys, tok string) req {
			return req{method: "GET", path: "/api/shares/segments/0", hdr: auth(tok)}
		},
		"done": func(id string, _ keys, tok string) req {
			return req{method: "POST", path: "/api/shares/done", hdr: auth(tok)}
		},
		"watch": func(id string, _ keys, tok string) req { return watchReq(tok) },
	}
	// Spec §41.8 : un jeton signé par le serveur, valide, d'un partage disparu → 410 « gone »
	// (seul le serveur a pu le signer : aucun oracle d'existence). Tout le reste : 404.
	tokenRoute := map[string]bool{"segment": true, "done": true, "watch": true}
	signedGone := map[string]bool{"inexistant": true, "détruit": true, "expiré": true}
	for rname, route := range routes {
		for _, c := range cases {
			w := e.do(route(c.id, c.k, c.tok))
			if tokenRoute[rname] && signedGone[c.name] {
				if w.Code != 410 || w.Body.String() != goneBody {
					t.Fatalf("%s / %s : %d %q", rname, c.name, w.Code, w.Body.String())
				}
				continue
			}
			if w.Code != 404 || w.Body.String() != notFound {
				t.Fatalf("%s / %s : %d %q", rname, c.name, w.Code, w.Body.String())
			}
		}
	}
	// Réponses octet pour octet identiques entre elles.
	e.clk.Add(time.Minute) // nouvelle fenêtre de débit
	ref := e.do(routes["meta"](unknown, newKeys(), "")).Body.String()
	for rname, route := range routes {
		for _, c := range cases {
			if tokenRoute[rname] && signedGone[c.name] {
				continue
			}
			if got := e.do(route(c.id, c.k, c.tok)).Body.String(); got != ref {
				t.Fatalf("%s / %s : %q ≠ %q", rname, c.name, got, ref)
			}
		}
	}
	// Aucun essai compté sur le partage vivant ; le partage expiré a été retiré à la première
	// lecture portant son jeton (aucune ouverture active : aucune grâce).
	var n int
	e.svc.DB.QueryRow(`SELECT count(*) FROM shares WHERE id=?`, expired.ID).Scan(&n)
	if n != 0 {
		t.Fatal("partage expiré encore en base")
	}
	for _, id := range []string{live.ID} {
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
			expect(t, w, 200, healthOK)
			checkHeaders(t, "healthz", w)
		}
		expect(t, e.do(req{method: "GET", path: "/healthz", remote: "[::1]:9"}), 200, healthOK)
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
