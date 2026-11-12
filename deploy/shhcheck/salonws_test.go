package main

// Essai du WebSocket du salon à travers Caddy (plan C-2 Task 17, Review Focus 3 ; spec §36 S2),
// lancé par deploy/test-proxy.sh, qui pose les variables ci-dessous ; sans elles, le test est
// sauté (go vet et go test de ce module restent possibles hors du banc). Bibliothèque standard
// seulement, comme shhcheck : le client WebSocket (RFC 6455, HTTP/1.1, trames masquées) est
// écrit ici, minimal, pour ce seul essai ; rien n'en part dans le binaire shhcheck.
//
//	SHH_PROXY_URL     https://nom:port du site, à travers Caddy (aussi l'origine SHH_ORIGIN du serveur)
//	SHH_PROXY_ADDR    adresse TCP où joindre Caddy (127.0.0.1:port)
//	SHH_PROXY_CA      autorités du test (PEM)
//	SHH_PROXY_GARDE   durée de garde du WebSocket en secondes (défaut 75, au-delà de « idle 1m »)
//	SHH_PROXY_SOURCE  adresse source des connexions (facultative : l'adresse repère du client du
//	                  banc, cherchée ensuite dans tout ce que Caddy et le serveur ont écrit)
//
// Ce qui est prouvé : un salon se crée et s'ouvre à travers Caddy ; la mise à niveau passe ;
// l'en-tête Origin arrive au serveur Go (il refuse sinon, 403) ; le WebSocket reste ouvert
// SHH_PROXY_GARDE secondes avec les pings du serveur (toutes les 20 s), puis répond encore à un
// ping du client (0x04 → 0x08) ; une origine étrangère ou absente reçoit 403 à travers Caddy.

import (
	"bufio"
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha1"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"encoding/base64"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"strconv"
	"strings"
	"testing"
	"time"
)

var b64u = base64.RawURLEncoding

type banc struct {
	url, addr, nom string
	tls            *tls.Config
	http           *http.Client
	dialer         *net.Dialer
}

func nouveauBanc(t *testing.T) *banc {
	u, addr, ca := os.Getenv("SHH_PROXY_URL"), os.Getenv("SHH_PROXY_ADDR"), os.Getenv("SHH_PROXY_CA")
	if u == "" || addr == "" || ca == "" {
		t.Skip("hors de deploy/test-proxy.sh (SHH_PROXY_URL, SHH_PROXY_ADDR, SHH_PROXY_CA)")
	}
	pem, err := os.ReadFile(ca)
	if err != nil {
		t.Fatal(err)
	}
	pool := x509.NewCertPool()
	if !pool.AppendCertsFromPEM(pem) {
		t.Fatal("autorités illisibles")
	}
	nom := strings.TrimPrefix(u, "https://")
	if i := strings.LastIndexByte(nom, ':'); i >= 0 {
		nom = nom[:i]
	}
	cfg := &tls.Config{RootCAs: pool, ServerName: nom, MinVersion: tls.VersionTLS13}
	dialer := &net.Dialer{Timeout: 5 * time.Second}
	if src := os.Getenv("SHH_PROXY_SOURCE"); src != "" {
		ip := net.ParseIP(src)
		if ip == nil {
			t.Fatalf("SHH_PROXY_SOURCE %q", src)
		}
		dialer.LocalAddr = &net.TCPAddr{IP: ip}
	}
	tr := &http.Transport{
		Proxy:           nil,
		TLSClientConfig: cfg.Clone(),
		DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
			return dialer.DialContext(ctx, "tcp", addr)
		},
	}
	return &banc{url: u, addr: addr, nom: nom, tls: cfg, http: &http.Client{Transport: tr, Timeout: 20 * time.Second},
		dialer: dialer}
}

func (b *banc) json(t *testing.T, method, path string, h map[string]string, corps any, sortie any) {
	t.Helper()
	var r io.Reader
	if corps != nil {
		j, _ := json.Marshal(corps)
		r = bytes.NewReader(j)
	}
	req, err := http.NewRequest(method, b.url+path, r)
	if err != nil {
		t.Fatal(err)
	}
	if corps != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	for k, v := range h {
		req.Header.Set(k, v)
	}
	resp, err := b.http.Do(req)
	if err != nil {
		t.Fatalf("%s %s : %v", method, path, err)
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(resp.Body)
	if resp.StatusCode/100 != 2 {
		t.Fatalf("%s %s : %d %s", method, path, resp.StatusCode, data)
	}
	if sortie != nil {
		if err := json.Unmarshal(data, sortie); err != nil {
			t.Fatalf("%s %s : %v", method, path, err)
		}
	}
}

func alea(n int) []byte {
	b := make([]byte, n)
	rand.Read(b)
	return b
}

// salon crée un salon de deux places (défi ALTCHA résolu par force brute, 3 s d'attente comme
// exigé par le serveur) et y entre comme créateur ; rend le jeton de membre.
func (b *banc) salon(t *testing.T) string {
	var defi struct {
		Algorithm string `json:"algorithm"`
		Challenge string `json:"challenge"`
		MaxNumber int64  `json:"maxNumber"`
		Salt      string `json:"salt"`
		Signature string `json:"signature"`
		ShownAt   string `json:"shown_at"`
	}
	b.json(t, "GET", "/api/captcha", nil, nil, &defi)
	recu := time.Now()
	if defi.Algorithm != "SHA-256" {
		t.Fatalf("algorithme %q", defi.Algorithm)
	}
	n := int64(-1)
	for i := int64(0); i <= defi.MaxNumber; i++ {
		h := sha256.Sum256([]byte(defi.Salt + strconv.FormatInt(i, 10)))
		if hex.EncodeToString(h[:]) == defi.Challenge {
			n = i
			break
		}
	}
	if n < 0 {
		t.Fatal("défi ALTCHA sans solution")
	}
	preuve, _ := json.Marshal(map[string]any{"algorithm": defi.Algorithm, "challenge": defi.Challenge, "number": n,
		"salt": defi.Salt, "signature": defi.Signature})
	time.Sleep(time.Until(recu.Add(3100 * time.Millisecond)))
	acces, gestion, kPreuve := alea(32), alea(32), alea(32)
	vPreuve := sha256.Sum256(kPreuve)
	h := map[string]string{"X-Shh-Access": b64u.EncodeToString(acces), "X-Shh-Manage": b64u.EncodeToString(gestion)}
	b.json(t, "POST", "/api/salons", h, map[string]any{"ttl_hours": 1, "max_members": 2, "members_can_destroy": false,
		"salt": b64u.EncodeToString(alea(16)), "kdf_ops": 3, "kdf_mem": 67108864, "proof_v": b64u.EncodeToString(vPreuve[:]),
		"altcha": base64.StdEncoding.EncodeToString(preuve), "hp": "", "shown_at": defi.ShownAt}, nil)
	var e struct {
		Token string `json:"member_token"`
	}
	b.json(t, "POST", "/api/salons/rejoindre", h, map[string]string{"proof": b64u.EncodeToString(kPreuve)}, &e)
	if len(e.Token) != 43 {
		t.Fatalf("jeton de %d caractères", len(e.Token))
	}
	return e.Token
}

// ws : connexion WebSocket ouverte (après 101).
type ws struct {
	c net.Conn
	r *bufio.Reader
}

// poignee envoie la mise à niveau HTTP/1.1 (TLS, ALPN http/1.1) avec l'origine donnée (vide :
// aucun en-tête Origin). Rend la connexion si 101, sinon le code reçu.
func (b *banc) poignee(t *testing.T, origine string) (*ws, int) {
	t.Helper()
	cfg := b.tls.Clone()
	cfg.NextProtos = []string{"http/1.1"}
	c, err := tls.DialWithDialer(b.dialer, "tcp", b.addr, cfg)
	if err != nil {
		t.Fatal(err)
	}
	cle := base64.StdEncoding.EncodeToString(alea(16))
	var req strings.Builder
	fmt.Fprintf(&req, "GET /api/salons/ws HTTP/1.1\r\nHost: %s\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"+
		"Sec-WebSocket-Version: 13\r\nSec-WebSocket-Key: %s\r\n", strings.TrimPrefix(b.url, "https://"), cle)
	if origine != "" {
		fmt.Fprintf(&req, "Origin: %s\r\n", origine)
	}
	req.WriteString("\r\n")
	c.SetDeadline(time.Now().Add(10 * time.Second))
	if _, err := io.WriteString(c, req.String()); err != nil {
		t.Fatal(err)
	}
	r := bufio.NewReader(c)
	resp, err := http.ReadResponse(r, &http.Request{Method: "GET"})
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != http.StatusSwitchingProtocols {
		resp.Body.Close()
		c.Close()
		return nil, resp.StatusCode
	}
	h := sha1.Sum([]byte(cle + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"))
	if got := resp.Header.Get("Sec-WebSocket-Accept"); got != base64.StdEncoding.EncodeToString(h[:]) {
		t.Fatalf("Sec-WebSocket-Accept %q", got)
	}
	c.SetDeadline(time.Time{})
	return &ws{c: c, r: r}, resp.StatusCode
}

// ecrire envoie une trame (fin, opcode, masquée comme l'exige la RFC 6455 côté client).
func (w *ws) ecrire(op byte, p []byte) error {
	h := []byte{0x80 | op}
	switch n := len(p); {
	case n < 126:
		h = append(h, 0x80|byte(n))
	case n < 1<<16:
		h = append(h, 0x80|126, byte(n>>8), byte(n))
	default:
		h = append(h, 0x80|127)
		h = binary.BigEndian.AppendUint64(h, uint64(n))
	}
	m := alea(4)
	h = append(h, m...)
	q := make([]byte, len(p))
	for i := range p {
		q[i] = p[i] ^ m[i%4]
	}
	_, err := w.c.Write(append(h, q...))
	return err
}

// lire rend la trame suivante (opcode, données) ; refuse une trame masquée ou fragmentée.
func (w *ws) lire() (byte, []byte, error) {
	var h [2]byte
	if _, err := io.ReadFull(w.r, h[:]); err != nil {
		return 0, nil, err
	}
	if h[0]&0x80 == 0 || h[1]&0x80 != 0 {
		return 0, nil, errors.New("trame fragmentée ou masquée")
	}
	n := uint64(h[1] & 0x7f)
	switch n {
	case 126:
		var x [2]byte
		if _, err := io.ReadFull(w.r, x[:]); err != nil {
			return 0, nil, err
		}
		n = uint64(binary.BigEndian.Uint16(x[:]))
	case 127:
		var x [8]byte
		if _, err := io.ReadFull(w.r, x[:]); err != nil {
			return 0, nil, err
		}
		n = binary.BigEndian.Uint64(x[:])
	}
	if n > 1<<20 {
		return 0, nil, errors.New("trame trop grande")
	}
	p := make([]byte, n)
	_, err := io.ReadFull(w.r, p)
	return h[0] & 0x0f, p, err
}

// message lit jusqu'au prochain message binaire, en répondant aux pings du serveur ; compte
// les pings reçus.
func (w *ws) message(fin time.Time, pings *int) ([]byte, error) {
	w.c.SetReadDeadline(fin)
	for {
		op, p, err := w.lire()
		if err != nil {
			return nil, err
		}
		switch op {
		case 0x2:
			return p, nil
		case 0x9:
			*pings++
			if err := w.ecrire(0xA, p); err != nil {
				return nil, err
			}
		case 0x8:
			code := 0
			if len(p) >= 2 {
				code = int(binary.BigEndian.Uint16(p))
			}
			return nil, fmt.Errorf("fermé par le serveur (%d)", code)
		}
	}
}

func TestSalonWSDerriereCaddy(t *testing.T) {
	b := nouveauBanc(t)
	garde := 75 * time.Second
	if v := os.Getenv("SHH_PROXY_GARDE"); v != "" {
		s, err := strconv.Atoi(v)
		if err != nil || s < 1 {
			t.Fatalf("SHH_PROXY_GARDE %q", v)
		}
		garde = time.Duration(s) * time.Second
	}

	// Origine étrangère, ou absente : 403 du serveur Go, relayé par Caddy (Origin n'est donc
	// pas réécrit en chemin).
	for _, o := range []string{"https://origine-etrangere.example", ""} {
		if w, code := b.poignee(t, o); w != nil || code != http.StatusForbidden {
			t.Fatalf("Origin %q : %d, attendu 403", o, code)
		}
	}

	jeton := b.salon(t)
	w, code := b.poignee(t, b.url)
	if w == nil {
		t.Fatalf("mise à niveau à travers Caddy : %d, attendu 101", code)
	}
	defer w.c.Close()
	accueil := append([]byte(jeton), make([]byte, 8)...)
	if err := w.ecrire(0x2, accueil); err != nil {
		t.Fatal(err)
	}
	pings := 0
	for {
		m, err := w.message(time.Now().Add(10*time.Second), &pings)
		if err != nil {
			t.Fatal("accueil :", err)
		}
		if m[0] == 0x0D {
			break
		}
	}
	// Garde : rien d'autre que les pings du serveur (et la présence) pendant `garde`.
	debut := time.Now()
	for time.Since(debut) < garde {
		_, err := w.message(debut.Add(garde), &pings)
		if err != nil {
			var ne net.Error
			if errors.As(err, &ne) && ne.Timeout() {
				break
			}
			t.Fatalf("après %v : %v", time.Since(debut).Round(time.Second), err)
		}
	}
	if min := int(garde / (20 * time.Second)); pings < min {
		t.Fatalf("%d pings du serveur en %v, attendu au moins %d", pings, garde, min)
	}
	// Toujours ouvert : ping du client (0x04) → pong (0x08) avec les mêmes octets.
	n := alea(8)
	if err := w.ecrire(0x2, append([]byte{0x04}, n...)); err != nil {
		t.Fatal("ping après la garde :", err)
	}
	for {
		m, err := w.message(time.Now().Add(10*time.Second), &pings)
		if err != nil {
			t.Fatal("pong après la garde :", err)
		}
		if m[0] == 0x08 {
			if !bytes.Equal(m[9:], n) {
				t.Fatal("pong différent")
			}
			break
		}
	}
	w.ecrire(0x8, []byte{0x03, 0xE8}) // fermeture normale (1000)
	t.Logf("WebSocket à travers Caddy : ouvert %v, %d pings du serveur, pong reçu ensuite", garde, pings)
}
