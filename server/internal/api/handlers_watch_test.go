package api

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"net/http"
	"runtime"
	"sync"
	"testing"
	"time"

	"github.com/skoow/shhdrop/server/internal/limits"
	"github.com/skoow/shhdrop/server/internal/share"
	"github.com/skoow/shhdrop/server/internal/token"
)

const goneBody = `{"error":"gone"}`

func at(h, m, sec int) time.Time { return time.Date(2026, 11, 4, h, m, sec, 0, time.UTC) }

// fakeWait : attente de la surveillance pilotée par le test (horloge injectée).
type fakeWait struct {
	mu    sync.Mutex
	asked []time.Duration
	ch    chan time.Time
}

func newFakeWait() *fakeWait { return &fakeWait{ch: make(chan time.Time)} }

func (f *fakeWait) wait(d time.Duration) (<-chan time.Time, func() bool) {
	f.mu.Lock()
	f.asked = append(f.asked, d)
	f.mu.Unlock()
	return f.ch, func() bool { return true }
}

func (f *fakeWait) last() time.Duration {
	f.mu.Lock()
	defer f.mu.Unlock()
	if len(f.asked) == 0 {
		return 0
	}
	return f.asked[len(f.asked)-1]
}

func watchReq(tok string) req {
	return req{method: "GET", path: "/api/shares/watch", hdr: auth(tok)}
}

// Spec §41.8 : 410 {"error":"gone"} seulement pour un jeton signé valide (segment, done,
// watch) ; sans jeton valide, exactement la réponse d'un partage inconnu (aucun oracle).
func TestGoneOnlyWithValidToken(t *testing.T) {
	e := newEnv(t, false, nil)
	k := newKeys()
	c := e.create(t, "", k, 1, 2)
	e.upload(t, c, 1)
	dl, _ := e.unlock(t, c.ID, k)
	expect(t, e.do(req{method: "POST", path: "/api/manage/destroy", hdr: manage(k)}), 204, "")
	for _, r := range []req{
		{method: "GET", path: "/api/shares/segments/0", hdr: auth(dl)},
		{method: "POST", path: "/api/shares/done", hdr: auth(dl)},
		watchReq(dl),
	} {
		expect(t, e.do(r), 410, goneBody)
	}
	future := e.clk.Now().Add(time.Hour)
	forged := token.New(rnd(32), e.clk.Now).Issue(token.Download, c.ID, 1, future)
	expired := e.sig.Issue(token.Download, c.ID, 1, e.clk.Now().Add(time.Second))
	e.clk.Add(2 * time.Second)
	ref := e.do(req{method: "GET", path: "/api/shares/meta", hdr: access(newKeys())})
	expect(t, ref, 404, notFound)
	for name, tok := range map[string]string{"falsifié": forged, "expiré": expired, "illisible": "x.y"} {
		for _, r := range []req{
			{method: "GET", path: "/api/shares/segments/0", hdr: auth(tok)},
			{method: "POST", path: "/api/shares/done", hdr: auth(tok)},
			watchReq(tok),
		} {
			w := e.do(r)
			if w.Code != 404 || w.Body.String() != ref.Body.String() {
				t.Fatalf("%s %s : %d %q", name, r.path, w.Code, w.Body.String())
			}
		}
	}
}

// Expiration : une ouverture non commencée est refusée (410 avec son jeton, 404 pour meta
// et unlock) ; une ouverture active continue. Le jeton de téléchargement n'est plus plafonné
// à expires_at : la grâce est bornée par sa durée (6 h), puis 404 comme un jeton expiré.
func TestExpiryGraceThroughAPI(t *testing.T) {
	for _, ttl := range []time.Duration{6 * time.Hour, 24 * time.Hour} {
		t.Run(ttl.String(), func(t *testing.T) {
			e := newEnv(t, false, nil)
			e.srv.dlTTL = ttl
			k := newKeys()
			c := e.create(t, "", k, 160, 2) // 3 segments
			e.upload(t, c, 160)             // expires_at = 11:15
			e.clk.Add(at(11, 14, 0).Sub(e.clk.Now()))
			active, _ := e.unlock(t, c.ID, k)
			idle, _ := e.unlock(t, c.ID, k)
			if _, exp, err := e.sig.CheckExp(active, token.Download, c.ID); err != nil || !exp.Equal(e.clk.Now().Add(ttl)) {
				t.Fatal("jeton non plafonné", exp, err)
			}
			seg := func(tok string, n int) *httpRec {
				return rec(e.do(req{method: "GET", path: fmt.Sprintf("/api/shares/segments/%d", n), hdr: auth(tok)}))
			}
			if w := seg(active, 0); w.code != 200 {
				t.Fatal(w.code, w.body)
			}
			e.clk.Add(90 * time.Second) // 11:15:30 : échu, segment servi il y a 90 s
			if w := seg(active, 1); w.code != 200 {
				t.Fatal("ouverture active refusée", w.code, w.body)
			}
			if w := seg(idle, 0); w.code != 410 || w.body != goneBody {
				t.Fatal("ouverture jamais commencée", w.code, w.body)
			}
			expect(t, e.do(req{method: "GET", path: "/api/shares/meta", hdr: access(k)}), 404, notFound)
			expect(t, e.do(req{method: "POST", path: "/api/shares/unlock", hdr: access(k),
				body: mustJSON(map[string]string{"proof": enc.EncodeToString(k.preuve)})}), 404, notFound)
			expect(t, e.do(watchReq(active)), 410, goneBody)
		})
	}
	// Grâce bornée par le jeton : ouvert à 10:02 (jeton 16:02), supprimé à 16:00.
	for _, tc := range []struct {
		ttl  time.Duration
		want int
	}{{6 * time.Hour, 404}, {24 * time.Hour, 200}} {
		t.Run("borne "+tc.ttl.String(), func(t *testing.T) {
			e := newEnv(t, false, nil)
			e.srv.dlTTL = tc.ttl
			k := newKeys()
			c := e.create(t, "", k, 160, 2) // 2 ouvertures : pas de purge « draining » à 6 h
			e.uploadTTL(t, c, 160, 24)
			dl, _ := e.unlock(t, c.ID, k)
			at6h := e.clk.Now().Add(6 * time.Hour)                 // échéance d'un jeton de 6 h
			e.clk.Add(at6h.Add(-3 * time.Minute).Sub(e.clk.Now())) // 6 h − 3 min
			expect(t, e.do(req{method: "GET", path: "/api/shares/segments/0", hdr: auth(dl)}), 200, "")
			e.clk.Add(30 * time.Second)
			expect(t, e.do(req{method: "POST", path: "/api/manage/destroy", hdr: manage(k)}), 204, "")
			e.clk.Add(60 * time.Second) // 6 h − 1 min 30
			expect(t, e.do(req{method: "GET", path: "/api/shares/segments/1", hdr: auth(dl)}), 200, "")
			e.clk.Add(90 * time.Second) // 6 h : fin du jeton de 6 h, pas de celui de 24 h
			if w := e.do(req{method: "GET", path: "/api/shares/segments/2", hdr: auth(dl)}); w.Code != tc.want {
				t.Fatal(w.Code, w.Body.String())
			}
		})
	}
}

type httpRec struct {
	code int
	body string
}

func rec(w interface {
	Result() *http.Response
}) *httpRec {
	r := w.Result()
	b, _ := io.ReadAll(r.Body)
	return &httpRec{r.StatusCode, string(b)}
}

// GET /api/shares/watch : 204 après 25 s (attente injectée) ; attente raccourcie à
// l'échéance, puis 410 ; 410 en moins d'une seconde après une suppression.
func TestWatchHold(t *testing.T) {
	e := newEnv(t, false, nil)
	fw := newFakeWait()
	e.srv.wait = fw.wait
	k := newKeys()
	c := e.create(t, "", k, 1, 1)
	e.upload(t, c, 1) // 11:15
	dl, _ := e.unlock(t, c.ID, k)
	srv := prodServer(t, e.h)
	get := func() (int, string) {
		r, _ := http.NewRequest("GET", srv.URL+"/api/shares/watch", nil)
		r.Header.Set("Authorization", "Bearer "+dl)
		resp, err := srv.Client().Do(r)
		if err != nil {
			t.Error(err)
			return 0, ""
		}
		defer resp.Body.Close()
		b, _ := io.ReadAll(resp.Body)
		return resp.StatusCode, string(b)
	}
	done := make(chan [2]any, 1)
	go func() { c, b := get(); done <- [2]any{c, b} }()
	waitFor(t, "attente demandée", func() bool { return fw.last() != 0 })
	if fw.last() != 25*time.Second {
		t.Fatal("attente", fw.last())
	}
	fw.ch <- time.Time{}
	if r := <-done; r[0] != 204 || r[1] != "" {
		t.Fatal(r)
	}
	// Échéance dans 10 s : attente raccourcie, puis 410.
	e.clk.Add(at(11, 14, 50).Sub(e.clk.Now()))
	fw.asked = nil
	go func() { c, b := get(); done <- [2]any{c, b} }()
	waitFor(t, "attente demandée", func() bool { return fw.last() != 0 })
	if fw.last() != 10*time.Second {
		t.Fatal("attente jusqu'à l'échéance", fw.last())
	}
	e.clk.Add(10 * time.Second)
	fw.ch <- time.Time{}
	if r := <-done; r[0] != 410 || r[1] != goneBody {
		t.Fatal(r)
	}

	// Suppression pendant une surveillance : 410 en moins d'une seconde.
	k2 := newKeys()
	c2 := e.create(t, "", k2, 1, 1)
	e.upload(t, c2, 1)
	dl = func() string { d, _ := e.unlock(t, c2.ID, k2); return d }()
	fw.asked = nil
	go func() { c, b := get(); done <- [2]any{c, b} }()
	waitFor(t, "attente demandée", func() bool { return fw.last() != 0 })
	start := time.Now()
	expect(t, e.do(req{method: "POST", path: "/api/manage/destroy", hdr: manage(k2)}), 204, "")
	if r := <-done; r[0] != 410 || r[1] != goneBody || time.Since(start) > time.Second {
		t.Fatal(r, time.Since(start))
	}
}

// 2 surveillances par connexion (la 3ᵉ → 429), un total borné (au-delà → 503) ; hors des
// 60 requêtes par minute ; client parti : ni goroutine, ni abonnement, ni place de reste.
func TestWatchLimits(t *testing.T) {
	e := newEnv(t, false, nil)
	e.srv.watchSlots = limits.NewSlots(3, 2, 3)
	fw := newFakeWait()
	e.srv.wait = fw.wait
	k := newKeys()
	c := e.create(t, "", k, 1, 3)
	e.upload(t, c, 1)
	var toks []string
	for i := 0; i < 3; i++ {
		d, _ := e.unlock(t, c.ID, k)
		toks = append(toks, d)
	}
	srv := prodServer(t, e.h)
	base := runtime.NumGoroutine()
	type held struct {
		cancel context.CancelFunc
		res    chan int
	}
	open := func(tok, ip string) held {
		ctx, cancel := context.WithCancel(context.Background())
		r, _ := http.NewRequestWithContext(ctx, "GET", srv.URL+"/api/shares/watch", nil)
		r.Header.Set("Authorization", "Bearer "+tok)
		r.Header.Set("X-Shh-Client-IP", ip)
		res := make(chan int, 1)
		go func() {
			resp, err := srv.Client().Do(r)
			if err != nil {
				res <- 0
				return
			}
			io.Copy(io.Discard, resp.Body)
			resp.Body.Close()
			res <- resp.StatusCode
		}()
		return held{cancel, res}
	}
	waiting := func(n int) func() bool {
		return func() bool { fw.mu.Lock(); defer fw.mu.Unlock(); return len(fw.asked) >= n }
	}
	a1 := open(toks[0], "198.51.100.1")
	a2 := open(toks[1], "198.51.100.1")
	waitFor(t, "deux surveillances tenues", waiting(2))
	if code := <-open(toks[2], "198.51.100.1").res; code != 429 {
		t.Fatal("3ᵉ surveillance de la connexion", code)
	}
	b1 := open(toks[2], "198.51.100.2")
	waitFor(t, "troisième surveillance", waiting(3))
	if code := <-open(toks[2], "198.51.100.3").res; code != 503 {
		t.Fatal("au-delà du total", code)
	}
	for _, h := range []held{a1, a2, b1} {
		h.cancel()
		<-h.res
	}
	waitFor(t, "places et abonnements rendus", func() bool {
		return e.srv.watchSlots.Len() == 0 && e.svc.WatchCount() == 0
	})
	srv.Client().Transport.(*http.Transport).CloseIdleConnections()
	waitFor(t, "goroutines rendues", func() bool { return runtime.NumGoroutine() <= base })

	// Hors des 60 requêtes par minute : 70 surveillances d'un partage disparu → 410.
	expect(t, e.do(req{method: "POST", path: "/api/manage/destroy", hdr: manage(k)}), 204, "")
	for i := 0; i < limits.RequestsPerMin+10; i++ {
		expect(t, e.do(watchReq(toks[0])), 410, goneBody)
	}
}

// Signalement pendant un téléchargement : le flux en cours est coupé (octets reçus < taille).
func TestReportCutsStream(t *testing.T) {
	e := newEnv(t, false, nil)
	k := newKeys()
	c := e.create(t, "", k, 80, 2)
	e.upload(t, c, 80)
	dl, _ := e.unlock(t, c.ID, k)
	srv := prodServer(t, e.h)
	cn := slowGET(t, srv, c.ID, 0, dl, "2001:db8::1")
	br := bufio.NewReader(cn)
	resp, err := http.ReadResponse(br, nil)
	if err != nil || resp.StatusCode != 200 {
		t.Fatal(resp, err)
	}
	expect(t, e.do(req{method: "POST", path: "/api/shares/destroy", hdr: access(k),
		body: mustJSON(map[string]string{"proof": enc.EncodeToString(k.preuve), "reason": "report"})}), 204, "")
	cn.SetReadDeadline(time.Now().Add(5 * time.Second))
	n, _ := io.Copy(io.Discard, resp.Body)
	if n >= int64(share.SegmentSize(80, 0)) {
		t.Fatal("flux non coupé", n)
	}
	expect(t, e.do(req{method: "GET", path: "/api/shares/segments/1", hdr: auth(dl)}), 410, goneBody)
}
