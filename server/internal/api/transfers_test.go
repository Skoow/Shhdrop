package api

import (
	"bufio"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/skoow/shhdrop/server/internal/limits"
	"github.com/skoow/shhdrop/server/internal/share"
)

// prodServer : serveur net/http réglé comme en production (cmd/shhdrop newHTTPServer).
func prodServer(t *testing.T, h http.Handler) *httptest.Server {
	t.Helper()
	srv := httptest.NewUnstartedServer(h)
	srv.Config = &http.Server{Handler: h, ReadHeaderTimeout: 10 * time.Second, ReadTimeout: 300 * time.Second,
		WriteTimeout: 300 * time.Second, IdleTimeout: 60 * time.Second, MaxHeaderBytes: 16 << 10}
	srv.Start()
	t.Cleanup(srv.Close)
	return srv
}

// slowGET envoie un GET de segment et ne lit jamais la réponse (petite fenêtre TCP).
// clientIP passe par X-Shh-Client-IP, cru d'un pair en boucle locale.
func slowGET(t *testing.T, srv *httptest.Server, id string, n int, tok, clientIP string) net.Conn {
	t.Helper()
	cn, err := net.Dial("tcp", srv.Listener.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { cn.Close() })
	if tc, ok := cn.(*net.TCPConn); ok {
		tc.SetReadBuffer(4096)
	}
	_ = id // le jeton désigne le partage (spec §32)
	fmt.Fprintf(cn, "GET /api/shares/segments/%d HTTP/1.1\r\nHost: x\r\nAuthorization: Bearer %s\r\nX-Shh-Client-IP: %s\r\n\r\n",
		n, tok, clientIP)
	return cn
}

// getSeg fait un GET complet (lu jusqu'au bout) et rend la réponse et son corps.
func getSeg(t *testing.T, srv *httptest.Server, id string, n int, tok, clientIP string) (*http.Response, []byte) {
	t.Helper()
	r, _ := http.NewRequest("GET", fmt.Sprintf("%s/api/shares/segments/%d", srv.URL, n), nil)
	r.Header.Set("Authorization", "Bearer "+tok)
	r.Header.Set("X-Shh-Client-IP", clientIP)
	resp, err := srv.Client().Do(r)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	b, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatal(err)
	}
	return resp, b
}

// tokens crée des partages du palier donné (10 ouvertures chacun) et rend count jetons
// de téléchargement, chacun avec son propre budget de lecture.
func (e *env) tokens(t *testing.T, bucket, count int) (ids, toks []string) {
	t.Helper()
	for len(toks) < count {
		k := newKeys()
		c := e.create(t, "", k, bucket, 10)
		e.upload(t, c, bucket)
		for i := 0; i < 10 && len(toks) < count; i++ {
			dl, _ := e.unlock(t, c.ID, k)
			ids, toks = append(ids, c.ID), append(toks, dl)
		}
		e.clk.Add(time.Minute) // limite générale : 60 requêtes par minute
	}
	return ids, toks
}

// waitFor réessaie f jusqu'à ce qu'il rende vrai (5 s au plus).
func waitFor(t *testing.T, what string, f func() bool) {
	t.Helper()
	for end := time.Now().Add(5 * time.Second); time.Now().Before(end); time.Sleep(20 * time.Millisecond) {
		if f() {
			return
		}
	}
	t.Fatal("délai dépassé :", what)
}

// Audit E1 (reproduction devenue test) : 200 GET de segments de 4 Mio que le client ne lit
// pas. Avant : chaque requête gardait le segment entier en mémoire (+805 Mio mesurés).
// Servis en flux, ils ne tiennent que leurs tampons de copie.
func TestSlowReadersHeapBounded(t *testing.T) {
	if testing.Short() {
		t.Skip("lent")
	}
	const N = 200
	x := defaultTransfers()
	x.dl = limits.NewSlots(1000, 1000, 1000) // pas de borne : seule la mémoire est mesurée
	e := newEnvFull(t, false, nil, nil, x)
	ids, toks := e.tokens(t, 80, N/4) // ≤ 4 lectures du segment 0 par jeton (budget)
	srv := prodServer(t, e.h)
	runtime.GC()
	var before runtime.MemStats
	runtime.ReadMemStats(&before)
	for i := 0; i < N; i++ {
		slowGET(t, srv, ids[i/4], 0, toks[i/4], "2001:db8::1")
	}
	time.Sleep(2 * time.Second)
	runtime.GC()
	var after runtime.MemStats
	runtime.ReadMemStats(&after)
	grow := int64(after.HeapInuse) - int64(before.HeapInuse)
	t.Logf("%d GET non lus : tas en usage %+d Kio", N, grow>>10)
	if grow > 48<<20 {
		t.Fatalf("tas en usage +%d Mio pour %d GET non lus (borne : 48 Mio)", grow>>20, N)
	}
	// Témoin : les requêtes étaient bien en cours (un GET lu en entier passe toujours).
	if resp, b := getSeg(t, srv, ids[N/4-1], 1, toks[N/4-1], "2001:db8:5::1"); resp.StatusCode != 200 ||
		len(b) != share.SegmentSize(80, 1) {
		t.Fatal(resp.Status, len(b))
	}
}

// Audit E1 : transferts simultanés bornés par connexion (/64), par /48 et au total, avec
// 429 ou 503 et Retry-After ; les places reviennent quand les clients partent.
func TestSegmentConcurrencyCap(t *testing.T) {
	x := defaultTransfers()
	x.dl = limits.NewSlots(4, 2, 3)
	e := newEnvFull(t, false, nil, nil, x)
	ids, toks := e.tokens(t, 80, 10)
	srv := prodServer(t, e.h)
	const a1, a2, a3, b = "2001:db8:1:1::1", "2001:db8:1:2::1", "2001:db8:1:3::1", "2001:db8:2::1"
	refused := func(ip string, code int, e string) func() bool {
		return func() bool {
			// Segment hors palier : une place libre donne 400 sans rien lire, donc sans
			// entamer le budget de lecture du jeton (qui s'épuiserait pendant l'attente).
			resp, body := getSeg(t, srv, ids[9], 7, toks[9], ip)
			return resp.StatusCode == code && strings.Contains(string(body), `"error":"`+e+`"`) &&
				resp.Header.Get("Retry-After") == "5"
		}
	}
	var held []net.Conn
	held = append(held, slowGET(t, srv, ids[0], 0, toks[0], a1), slowGET(t, srv, ids[1], 0, toks[1], a1))
	waitFor(t, "3ᵉ transfert de la connexion refusé (429)", refused(a1, 429, "limit"))
	held = append(held, slowGET(t, srv, ids[2], 0, toks[2], a2))
	waitFor(t, "4ᵉ transfert du /48 refusé (429)", refused(a3, 429, "limit"))
	held = append(held, slowGET(t, srv, ids[3], 0, toks[3], b))
	waitFor(t, "5ᵉ transfert du serveur refusé (503)", refused("2001:db8:3::1", 503, "busy"))
	for _, cn := range held {
		cn.Close()
	}
	waitFor(t, "places rendues", func() bool {
		resp, body := getSeg(t, srv, ids[9], 1, toks[9], a1)
		return resp.StatusCode == 200 && len(body) == share.SegmentSize(80, 1)
	})
}

// Audit E1 : un client plus lent que le débit minimal est coupé à l'échéance et rend sa
// place, sans attendre le WriteTimeout de 300 s ; il ne reçoit jamais un segment complet.
func TestSlowReaderCutOff(t *testing.T) {
	x := defaultTransfers()
	x.dl = limits.NewSlots(1, 1, 1)
	x.base, x.minRate = time.Second, 1<<40
	e := newEnvFull(t, false, nil, nil, x)
	ids, toks := e.tokens(t, 80, 2)
	srv := prodServer(t, e.h)
	start := time.Now()
	cn := slowGET(t, srv, ids[0], 0, toks[0], "2001:db8::1")
	waitFor(t, "place prise par le client lent", func() bool {
		resp, _ := getSeg(t, srv, ids[1], 1, toks[1], "2001:db8::1")
		return resp.StatusCode == 429
	})
	waitFor(t, "place rendue après l'échéance", func() bool {
		resp, _ := getSeg(t, srv, ids[1], 1, toks[1], "2001:db8::1")
		return resp.StatusCode == 200
	})
	if d := time.Since(start); d < time.Second || d > 4*time.Second {
		t.Fatalf("coupé après %v (échéance : 1 s)", d)
	}
	// La place rendue prouve que le gestionnaire est sorti. Le noyau finit d'envoyer ce qu'il
	// avait déjà en file (hors du tas Go), mais le client ne reçoit jamais le segment entier.
	cn.SetReadDeadline(time.Now().Add(2 * time.Second))
	resp, err := http.ReadResponse(bufio.NewReader(cn), nil)
	if err != nil {
		t.Fatal(err)
	}
	k, _ := io.Copy(io.Discard, resp.Body)
	if k >= int64(share.SegmentSize(80, 0)) {
		t.Fatalf("segment reçu en entier (%d octets)", k)
	}
}

// Audit M1 : un jeton lit au plus share.ReadBudget octets. Une lecture complète et un
// nouvel essai de chaque segment passent ; relire au-delà donne 429 « budget ».
func TestDownloadBudget(t *testing.T) {
	e := newEnv(t, false, nil)
	k := newKeys()
	const bucket = 160 // 3 segments
	c := e.create(t, "", k, bucket, 2)
	segs := e.upload(t, c, bucket)
	dl, n := e.unlock(t, c.ID, k)
	seg := func(i int) string { return fmt.Sprintf("/api/shares/segments/%d", i) }
	var served int64
	for pass := 0; pass < 2; pass++ {
		for i := 0; i < n; i++ {
			w := e.do(req{method: "GET", path: seg(i), hdr: auth(dl)})
			expect(t, w, 200, "")
			if string(w.Body.Bytes()) != string(segs[i]) {
				t.Fatalf("segment %d altéré", i)
			}
			served += int64(w.Body.Len())
		}
	}
	var w *httptest.ResponseRecorder
	for i := 0; i < 10; i++ {
		if w = e.do(req{method: "GET", path: seg(1), hdr: auth(dl)}); w.Code != 200 {
			break
		}
		served += int64(w.Body.Len())
	}
	expect(t, w, 429, budgetBody)
	if w.Header().Get("Retry-After") != "60" {
		t.Fatalf("Retry-After = %q", w.Header().Get("Retry-After"))
	}
	if served > share.ReadBudget(bucket) {
		t.Fatalf("%d octets servis, budget %d", served, share.ReadBudget(bucket))
	}
	// Une nouvelle ouverture a son propre budget.
	dl2, _ := e.unlock(t, c.ID, k)
	expect(t, e.do(req{method: "GET", path: seg(1), hdr: auth(dl2)}), 200, "")
}

func TestTransferDeadline(t *testing.T) {
	x := defaultTransfers()
	if got := x.deadline(maxSegmentLen); got < 130*time.Second || got > 140*time.Second {
		t.Fatalf("échéance d'un segment de 4 Mio : %v", got)
	}
	if got := x.deadline(0); got != xferBase {
		t.Fatal(got)
	}
}
