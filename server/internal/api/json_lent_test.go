package api

// Audit de sécurité du 13 novembre, D5 (test offensif de l'audit, inversé) : un corps JSON
// envoyé au goutte-à-goutte n'avait pas de débit minimal et tenait sa connexion 300 s
// (ReadTimeout) : 50 POST /api/shares/unlock à 0,5 octet/s restaient ouverts après 20 s.

import (
	"bufio"
	"fmt"
	"net"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestCorpsJSONGoutteAGoutteCoupe(t *testing.T) {
	old := jsonReadTimeout
	jsonReadTimeout = time.Second
	t.Cleanup(func() { jsonReadTimeout = old })
	e := newEnv(t, false, nil)
	srv := prodServer(t, e.h)
	const n = 20
	var conns []net.Conn
	for range n {
		cn, err := net.Dial("tcp", srv.Listener.Addr().String())
		if err != nil {
			t.Fatal(err)
		}
		defer cn.Close()
		fmt.Fprintf(cn, "POST /api/shares/unlock HTTP/1.1\r\nHost: x\r\nContent-Length: 4000\r\nX-Shh-Access: %s\r\n\r\n{", enc.EncodeToString(rnd(32)))
		conns = append(conns, cn)
	}
	// Goutte-à-goutte : un octet toutes les 200 ms, bien en dessous de tout débit utile.
	stop := make(chan struct{})
	defer close(stop)
	go func() {
		for {
			select {
			case <-stop:
				return
			case <-time.After(200 * time.Millisecond):
				for _, cn := range conns {
					cn.Write([]byte(" "))
				}
			}
		}
	}()
	var wg sync.WaitGroup
	errs := make(chan string, n)
	for i, cn := range conns {
		wg.Go(func() {
			cn.SetReadDeadline(time.Now().Add(5 * time.Second))
			line, err := bufio.NewReader(cn).ReadString('\n')
			if err != nil || !strings.HasPrefix(line, "HTTP/1.1 400") {
				errs <- fmt.Sprintf("connexion %d : %q %v (attendu 400 au bout d'environ 1 s)", i, line, err)
			}
		})
	}
	wg.Wait()
	close(errs)
	for e := range errs {
		t.Error(e)
	}
}

// Un corps JSON envoyé normalement passe toujours, même en deux morceaux espacés de moins
// que l'échéance.
func TestCorpsJSONEnDeuxMorceaux(t *testing.T) {
	old := jsonReadTimeout
	jsonReadTimeout = 2 * time.Second
	t.Cleanup(func() { jsonReadTimeout = old })
	e := newEnv(t, false, nil)
	srv := prodServer(t, e.h)
	cn, err := net.Dial("tcp", srv.Listener.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	defer cn.Close()
	body := `{"proof":"` + enc.EncodeToString(rnd(32)) + `"}`
	fmt.Fprintf(cn, "POST /api/shares/unlock HTTP/1.1\r\nHost: x\r\nContent-Length: %d\r\nX-Shh-Access: %s\r\n\r\n%s",
		len(body), enc.EncodeToString(rnd(32)), body[:5])
	time.Sleep(500 * time.Millisecond)
	cn.Write([]byte(body[5:]))
	cn.SetReadDeadline(time.Now().Add(5 * time.Second))
	line, err := bufio.NewReader(cn).ReadString('\n')
	// Partage inconnu : 404 uniforme (le corps a été lu en entier, puis jugé).
	if err != nil || !strings.HasPrefix(line, "HTTP/1.1 404") {
		t.Fatalf("réponse %q %v", line, err)
	}
}
