package api

import (
	"bufio"
	"bytes"
	"context"
	"encoding/binary"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"

	"github.com/skoow/shhdrop/server/internal/salon"
)

// ---- WebSocket du salon (plan C-2 Task 10) ----

const origineSalon = "https://shhdrop.app" // Origin de salonEnv

// wsBanc : serveur HTTP réel (httptest) devant le gestionnaire du salon.
type wsBanc struct {
	e    *env
	m    *salon.Manager
	url  string
	addr string // hôte:port du serveur (requêtes brutes)
	k    keys   // clés du dernier salon créé par membres
}

// nouveauWS : salonEnv servi par un vrai serveur HTTP ; cfg règle le http.Server (délais).
// À la fin : FermerTout, puis attente que chaque gestionnaire ait rendu sa place.
func nouveauWS(t *testing.T, cfg func(*http.Server)) *wsBanc {
	t.Helper()
	e, m := salonEnv(t)
	ts := httptest.NewUnstartedServer(e.h)
	if cfg != nil {
		cfg(ts.Config)
	}
	ts.Start()
	t.Cleanup(func() {
		m.FermerTout()
		attendre(t, 20*time.Second, func() bool { return e.srv.wsSlots.Len() == 0 })
		ts.Close()
	})
	return &wsBanc{e: e, m: m, url: "ws" + strings.TrimPrefix(ts.URL, "http") + "/api/salons/ws",
		addr: ts.Listener.Addr().String()}
}

// brut envoie la requête HTTP req telle quelle (TCP) et lit la réponse entière.
func (b *wsBanc) brut(t *testing.T, req string) *rawResp {
	t.Helper()
	c, err := net.Dial("tcp", b.addr)
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	c.SetDeadline(time.Now().Add(5 * time.Second))
	if _, err := io.WriteString(c, req); err != nil {
		t.Fatal(err)
	}
	var raw bytes.Buffer
	var hr *http.Request // HEAD : réponse sans corps
	if strings.HasPrefix(req, "HEAD ") {
		hr = &http.Request{Method: http.MethodHead}
	}
	resp, err := http.ReadResponse(bufio.NewReader(io.TeeReader(c, &raw)), hr)
	if err != nil {
		t.Fatal(err)
	}
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatal(err)
	}
	return &rawResp{StatusCode: resp.StatusCode, Header: resp.Header, Body: string(body), Raw: raw.String()}
}

type rawResp struct {
	StatusCode int
	Header     http.Header
	Body, Raw  string
}

// I1 : une requête refusée (bonne origine, corps annoncé) garde les délais HTTP. Corps envoyé
// au goutte-à-goutte : la connexion est coupée par ReadTimeout (1 s), pas tenue sans fin.
func TestRefusGardeLesDelais(t *testing.T) {
	b := nouveauWS(t, func(s *http.Server) { s.ReadTimeout, s.WriteTimeout = time.Second, time.Second })
	for nom, h := range map[string]string{
		"sans Upgrade": "",
		"avec Upgrade": "Upgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\n" +
			"Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n",
	} {
		c, err := net.Dial("tcp", b.addr)
		if err != nil {
			t.Fatal(err)
		}
		t0 := time.Now()
		io.WriteString(c, "GET /api/salons/ws HTTP/1.1\r\nHost: x\r\nOrigin: "+origineSalon+"\r\n"+h+
			"Content-Length: 100000\r\n\r\n")
		stop := make(chan struct{})
		go func() {
			for {
				select {
				case <-stop:
					return
				case <-time.After(100 * time.Millisecond):
					if _, err := c.Write([]byte{'x'}); err != nil {
						return
					}
				}
			}
		}()
		c.SetReadDeadline(time.Now().Add(5 * time.Second))
		_, err = io.Copy(io.Discard, c) // jusqu'à la coupure par le serveur
		d := time.Since(t0)
		close(stop)
		c.Close()
		if err != nil || d > 1500*time.Millisecond {
			t.Fatalf("%s : coupée après %v (%v), attendu moins de 1,5 s", nom, d, err)
		}
	}
	if n := b.e.srv.wsSlots.Len(); n != 0 {
		t.Fatalf("%d places prises", n)
	}
}

// Poignée de main invalide (bonne origine) : 400 bad_request fixe, avant toute place ; la
// réponse ne recopie rien de la requête.
func TestPoigneeInvalide(t *testing.T) {
	b := nouveauWS(t, nil)
	const m = "MARQUEURclient"
	const ok = "Upgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\n"
	const cle = "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n"
	debut := "GET /api/salons/ws HTTP/1.1\r\nHost: x\r\nOrigin: " + origineSalon + "\r\nX-Autre: " + m + "\r\n"
	for nom, r := range map[string]string{
		"sans Upgrade":    debut + "\r\n",
		"Upgrade faux":    debut + "Upgrade: " + m + "\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\n" + cle + "\r\n",
		"Connection faux": debut + "Upgrade: websocket\r\nConnection: " + m + "\r\nSec-WebSocket-Version: 13\r\n" + cle + "\r\n",
		"version fausse":  debut + "Upgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: " + m + "\r\n" + cle + "\r\n",
		"version absente": debut + "Upgrade: websocket\r\nConnection: Upgrade\r\n" + cle + "\r\n",
		"version 8":       debut + "Upgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 8\r\n" + cle + "\r\n",
		"version en double": debut + "Upgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\n" +
			"Sec-WebSocket-Version: 13\r\n" + cle + "\r\n",
		"clé fausse":      debut + ok + "Sec-WebSocket-Key: " + m + "\r\n\r\n",
		"clé courte":      debut + ok + "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ=\r\n\r\n",
		"clé 17 octets":   debut + ok + "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZSE=\r\n\r\n",
		"clé absente":     debut + ok + "\r\n",
		"clé en double":   debut + ok + cle + cle + "\r\n",
		"corps":           debut + ok + cle + "Content-Length: 3\r\n\r\nabc",
		"corps par blocs": debut + ok + cle + "Transfer-Encoding: chunked\r\n\r\n0\r\n\r\n",
		"HEAD":            strings.Replace(debut, "GET", "HEAD", 1) + ok + cle + "\r\n",
		"HTTP/1.0":        strings.Replace(debut, "HTTP/1.1", "HTTP/1.0", 1) + ok + cle + "\r\n",
	} {
		resp := b.brut(t, r)
		want := `{"error":"bad_request"}`
		if nom == "HEAD" {
			want = ""
		}
		if resp.StatusCode != 400 || resp.Body != want || resp.Header.Get("Upgrade") != "" {
			t.Errorf("%s : %d %q %v", nom, resp.StatusCode, resp.Body, resp.Header)
		}
		// RFC 6455 §4.2.2 : refus de version → Sec-WebSocket-Version des versions comprises
		// (constante) ; aucun autre refus ne l'annonce.
		v := resp.Header.Values("Sec-WebSocket-Version")
		if strings.HasPrefix(nom, "version") != (len(v) == 1 && v[0] == "13") || len(v) > 1 {
			t.Errorf("%s : Sec-WebSocket-Version %v", nom, v)
		}
		for _, x := range []string{m, "dGhl", "websocket", "Upgrade"} {
			if strings.Contains(resp.Raw, x) {
				t.Errorf("%s : la réponse recopie %q :\n%s", nom, x, resp.Raw)
			}
		}
	}
	if n := b.e.srv.wsSlots.Len(); n != 0 {
		t.Fatalf("%d places prises", n)
	}
}

// Poignées de main réelles (navigateurs, mandataires, clients des apps) : 101 et le bon
// Sec-WebSocket-Accept (RFC 6455 §1.3 : clé de l'exemple de la RFC).
func TestPoigneesReelles(t *testing.T) {
	b := nouveauWS(t, nil)
	const accept = "s3pPLMBiTxaQ9kYGzzhZRbK+xOo="
	const cle = "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n"
	const v13 = "Sec-WebSocket-Version: 13\r\n"
	debut := "GET /api/salons/ws HTTP/1.1\r\nHost: x\r\nOrigin: " + origineSalon + "\r\n"
	for _, c := range []struct{ nom, entetes string }{
		{"Firefox", "Upgrade: websocket\r\nConnection: keep-alive, Upgrade\r\n" + v13 + cle +
			"Sec-WebSocket-Extensions: permessage-deflate\r\n"},
		{"casse", "Upgrade: WebSocket\r\nConnection: UPGRADE\r\n" + v13 + cle},
		{"deux lignes Connection", "Upgrade: websocket\r\nConnection: keep-alive\r\nConnection: Upgrade\r\n" + v13 + cle},
		{"Upgrade en liste", "Upgrade: h2c, websocket\r\nConnection: Upgrade\r\n" + v13 + cle},
		{"clé entourée d'espaces", "Upgrade: websocket\r\nConnection: Upgrade\r\n" + v13 +
			"Sec-WebSocket-Key:   dGhlIHNhbXBsZSBub25jZQ==  \r\n"},
		{"Content-Length: 0", "Upgrade: websocket\r\nConnection: Upgrade\r\n" + v13 + cle + "Content-Length: 0\r\n"},
		{"tabulations", "Upgrade:\th2c,\twebsocket\t\r\nConnection:\tkeep-alive,\tUpgrade\t\r\n" +
			"Sec-WebSocket-Version:\t13\r\nSec-WebSocket-Key:\tdGhlIHNhbXBsZSBub25jZQ==\t\r\n"},
		{"liste sans espaces", "Upgrade: h2c,websocket\r\nConnection: keep-alive,Upgrade\r\n" + v13 + cle},
	} {
		resp := b.brut(t, debut+c.entetes+"\r\n")
		if resp.StatusCode != http.StatusSwitchingProtocols || resp.Header.Get("Sec-WebSocket-Accept") != accept {
			t.Errorf("%s : %d %v", c.nom, resp.StatusCode, resp.Header)
		}
		if v := resp.Header.Values("Sec-WebSocket-Extensions"); len(v) != 0 {
			t.Errorf("%s : Sec-WebSocket-Extensions %v", c.nom, v)
		}
		// Connexion coupée par brut : la place est rendue avant le cas suivant (4 par adresse).
		attendre(t, 5*time.Second, func() bool { return b.e.srv.wsSlots.Len() == 0 })
	}
}

func attendre(t *testing.T, d time.Duration, ok func() bool) {
	t.Helper()
	fin := time.Now().Add(d)
	for !ok() {
		if time.Now().After(fin) {
			t.Fatalf("délai de %v dépassé", d)
		}
		time.Sleep(10 * time.Millisecond)
	}
}

// dial ouvre un WebSocket avec les en-têtes h (Origin du site si h est nil).
func (b *wsBanc) dial(t *testing.T, h http.Header, opts *websocket.DialOptions) (*websocket.Conn, *http.Response, error) {
	t.Helper()
	if h == nil {
		h = http.Header{"Origin": {origineSalon}}
	}
	if opts == nil {
		opts = &websocket.DialOptions{}
	}
	opts.HTTPHeader = h
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	c, resp, err := websocket.Dial(ctx, b.url, opts)
	if c != nil {
		t.Cleanup(func() { c.CloseNow() })
	}
	return c, resp, err
}

func (b *wsBanc) ouvrir(t *testing.T) *websocket.Conn {
	t.Helper()
	c, _, err := b.dial(t, nil, nil)
	if err != nil {
		t.Fatalf("Dial : %v", err)
	}
	return c
}

// membres crée un salon et y fait entrer n membres ; rend leurs jetons (base64url).
func (b *wsBanc) membres(t *testing.T, n int) []string {
	t.Helper()
	k := newKeys()
	b.k = k
	b.e.creerSalon(t, k, max(n, 2))
	var out []string
	for i := range n {
		w := b.e.rejoindre(k, i == 0)
		expect(t, w, 200, "")
		out = append(out, jsonOf(t, w)["member_token"].(string))
	}
	return out
}

// entrer : WebSocket ouvert et accueil envoyé (depuis 0).
func (b *wsBanc) entrer(t *testing.T, jeton string) *websocket.Conn {
	t.Helper()
	c := b.ouvrir(t)
	envoyer(t, c, append([]byte(jeton), make([]byte, 8)...))
	return c
}

func envoyer(t *testing.T, c *websocket.Conn, msg []byte) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := c.Write(ctx, websocket.MessageBinary, msg); err != nil {
		t.Fatalf("Write : %v", err)
	}
}

// lireJusqua lit jusqu'au premier message de type typ (premier octet).
func lireJusqua(t *testing.T, c *websocket.Conn, typ byte) []byte {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	for {
		mt, b, err := c.Read(ctx)
		if err != nil {
			t.Fatalf("Read (attendu 0x%02x) : %v", typ, err)
		}
		if mt != websocket.MessageBinary {
			t.Fatalf("message non binaire : %v", mt)
		}
		if len(b) > 0 && b[0] == typ {
			return b
		}
	}
}

// codeFermeture lit jusqu'à la fermeture et rend son code.
func codeFermeture(t *testing.T, c *websocket.Conn) websocket.StatusCode {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	for {
		if _, _, err := c.Read(ctx); err != nil {
			code := websocket.CloseStatus(err)
			if code == -1 {
				t.Fatalf("fermeture sans code : %v", err)
			}
			return code
		}
	}
}

func trameWS() []byte {
	tr := rnd(salon.TailleTrame)
	copy(tr, "SHC3")
	tr[4] = 0 // non volatile, règle désactivée
	return tr
}

func TestOrigineEtrangere(t *testing.T) {
	b := nouveauWS(t, nil)
	for nom, h := range map[string]http.Header{
		"étrangère": {"Origin": {"https://evil.test"}},
		"absente":   {},
		"en double": {"Origin": {origineSalon, origineSalon}},
		"casse":     {"Origin": {"https://SHHDROP.app"}},
		"barre":     {"Origin": {origineSalon + "/"}},
		"http":      {"Origin": {"http://shhdrop.app"}},
		"port 443":  {"Origin": {"https://shhdrop.app:443"}},
		"null":      {"Origin": {"null"}},
	} {
		c, resp, err := b.dial(t, h, nil)
		if err == nil || c != nil {
			t.Fatalf("%s : mise à niveau acceptée", nom)
		}
		if resp == nil || resp.StatusCode != http.StatusForbidden {
			t.Fatalf("%s : réponse %v (%v)", nom, resp, err)
		}
		body, _ := io.ReadAll(resp.Body)
		if string(body) != `{"error":"forbidden"}` || resp.Header.Get("Upgrade") != "" {
			t.Fatalf("%s : %q %v", nom, body, resp.Header)
		}
	}
	if n := b.e.srv.wsSlots.Len(); n != 0 {
		t.Fatalf("places prises : %d", n)
	}
}

func TestSansCompression(t *testing.T) {
	b := nouveauWS(t, nil)
	_, resp, err := b.dial(t, nil, &websocket.DialOptions{CompressionMode: websocket.CompressionContextTakeover})
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != http.StatusSwitchingProtocols {
		t.Fatalf("statut %d", resp.StatusCode)
	}
	if v := resp.Header.Values("Sec-WebSocket-Extensions"); len(v) != 0 {
		t.Fatalf("Sec-WebSocket-Extensions : %v", v)
	}
}

func TestMessageTropGrand(t *testing.T) {
	b := nouveauWS(t, nil)
	c := b.entrer(t, b.membres(t, 1)[0])
	lireJusqua(t, c, 0x0D)
	envoyer(t, c, append([]byte{0x01}, make([]byte, 4200)...)) // 4 201 octets
	if code := codeFermeture(t, c); code != websocket.StatusMessageTooBig {
		t.Fatalf("code %d, attendu 1009", code)
	}
	// 4 200 octets : lu (limite comprise), puis refusé par le salon (taille inexacte).
	c = b.entrer(t, b.membres(t, 1)[0])
	lireJusqua(t, c, 0x0D)
	envoyer(t, c, append([]byte{0x01}, make([]byte, 4199)...))
	if code := codeFermeture(t, c); code != salon.CodeInvalide {
		t.Fatalf("4 200 octets : code %d, attendu 4003", code)
	}
}

func TestTrameMauvaiseTaille(t *testing.T) {
	b := nouveauWS(t, nil)
	c := b.entrer(t, b.membres(t, 1)[0])
	lireJusqua(t, c, 0x0D)
	envoyer(t, c, append([]byte{0x01}, trameWS()[:4139]...))
	if code := codeFermeture(t, c); code != salon.CodeInvalide {
		t.Fatalf("code %d, attendu 4003", code)
	}
}

func TestMessageTexte(t *testing.T) {
	b := nouveauWS(t, nil)
	c := b.entrer(t, b.membres(t, 1)[0])
	lireJusqua(t, c, 0x0D)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := c.Write(ctx, websocket.MessageText, []byte("bonjour")); err != nil {
		t.Fatal(err)
	}
	if code := codeFermeture(t, c); code != salon.CodeInvalide {
		t.Fatalf("code %d, attendu 4003", code)
	}
}

func TestDeuxClientsEchangent(t *testing.T) {
	b := nouveauWS(t, nil)
	js := b.membres(t, 2)
	a, z := b.entrer(t, js[0]), b.entrer(t, js[1])
	lireJusqua(t, a, 0x0D)
	lireJusqua(t, z, 0x0D)
	tr := trameWS()
	envoyer(t, a, append([]byte{0x01}, tr...))
	got := lireJusqua(t, z, 0x01)
	if len(got) != 4158 || got[9] != 0 || !bytes.Equal(got[18:], tr) {
		t.Fatalf("trame reçue : %d octets, siège %d", len(got), got[9])
	}
	if seq := binary.BigEndian.Uint64(got[1:9]); seq == 0 {
		t.Fatal("seq nul")
	}
	// L'expéditeur la reçoit aussi (écho).
	if echo := lireJusqua(t, a, 0x01); !bytes.Equal(echo, got) {
		t.Fatal("écho différent")
	}
}

func TestWSPlaces(t *testing.T) {
	b := nouveauWS(t, nil)
	// Bonne origine, sans mise à niveau : refus, aucune place gardée.
	if r := b.brut(t, "GET /api/salons/ws HTTP/1.1\r\nHost: x\r\nOrigin: "+origineSalon+"\r\n\r\n"); r.StatusCode != 400 {
		t.Fatalf("sans Upgrade : %d", r.StatusCode)
	}
	if n := b.e.srv.wsSlots.Len(); n != 0 {
		t.Fatalf("sans Upgrade : %d places prises", n)
	}
	var cs []*websocket.Conn
	// 8 par adresse (revue finale C-2, I4 : une famille derrière un même NAT).
	for range 8 {
		cs = append(cs, b.ouvrir(t)) // sans accueil : tenus jusqu'à 5 s
	}
	attendre(t, 5*time.Second, func() bool { return b.e.srv.wsSlots.Len() == 8 })
	_, resp, err := b.dial(t, nil, nil)
	if err == nil || resp == nil || resp.StatusCode != http.StatusTooManyRequests || resp.Header.Get("Retry-After") == "" {
		t.Fatalf("9e WebSocket : %v %v", resp, err)
	}
	// Une place rendue à la fermeture : un nouveau WebSocket passe.
	cs[0].CloseNow()
	attendre(t, 5*time.Second, func() bool { return b.e.srv.wsSlots.Len() == 7 })
	b.ouvrir(t)
}

// Review Focus 3 : les délais HTTP (ReadTimeout, WriteTimeout) posés avant la mise à niveau ne
// coupent pas le WebSocket.
func TestWSSurvitAuxDelaisHTTP(t *testing.T) {
	b := nouveauWS(t, func(s *http.Server) { s.ReadTimeout, s.WriteTimeout = time.Second, time.Second })
	c := b.entrer(t, b.membres(t, 1)[0])
	lireJusqua(t, c, 0x0D)
	fin := time.Now().Add(3 * time.Second)
	for i := uint64(0); time.Now().Before(fin); i++ {
		p := binary.BigEndian.AppendUint64([]byte{0x04}, i)
		envoyer(t, c, p)
		pong := lireJusqua(t, c, 0x08)
		if !bytes.Equal(pong[9:], p[1:]) {
			t.Fatalf("pong %x pour %x", pong, p)
		}
		time.Sleep(200 * time.Millisecond)
	}
	// Trame aussi, après les délais.
	envoyer(t, c, append([]byte{0x01}, trameWS()...))
	lireJusqua(t, c, 0x01)
}

func TestArretFerme1001(t *testing.T) {
	b := nouveauWS(t, nil)
	js := b.membres(t, 2)
	a, z := b.entrer(t, js[0]), b.entrer(t, js[1])
	lireJusqua(t, a, 0x0D)
	lireJusqua(t, z, 0x0D)
	b.m.FermerTout()
	for _, c := range []*websocket.Conn{a, z} {
		if code := codeFermeture(t, c); code != websocket.StatusGoingAway {
			t.Fatalf("code %d, attendu 1001", code)
		}
	}
	// Après l'arrêt, un nouveau membre est fermé en 1001 dès son accueil.
	c := b.entrer(t, js[0])
	if code := codeFermeture(t, c); code != websocket.StatusGoingAway {
		t.Fatalf("après l'arrêt : code %d, attendu 1001", code)
	}
}

// L'état du salon et les places des WebSocket ne gardent aucune adresse : seules des clés HMAC
// (limits.Limiter.Key) servent aux places.
func TestAucuneIPDansLeSalon(t *testing.T) {
	b := nouveauWS(t, nil)
	js := b.membres(t, 2)
	a, z := b.entrer(t, js[0]), b.entrer(t, js[1])
	lireJusqua(t, a, 0x0D)
	lireJusqua(t, z, 0x0D)
	envoyer(t, a, append([]byte{0x01}, trameWS()...))
	lireJusqua(t, z, 0x01)
	lireJusqua(t, a, 0x01)
	ip := netip.MustParseAddr("127.0.0.1")
	// Places, connexions ouvertes : Len prend le verrou des places, qui ne changent plus
	// ensuite (aucun WebSocket ouvert ni fermé pendant la lecture).
	if b.e.srv.wsSlots.Len() != 2 {
		t.Fatal("places")
	}
	k64, k48 := b.e.srv.lim.Key(ip)
	if cles := clesSlots(b.e.srv.wsSlots); !reflect.DeepEqual(cles, map[string]bool{k64: true, k48: true}) {
		t.Fatalf("clés des places : %v", cles)
	}
	parcourirSansAdresse(t, "places", b.e.srv.wsSlots, ip)
	// État du salon : parcouru une fois toutes les connexions finies (places rendues après la
	// fin de Servir et de ses goroutines) ; aucune goroutine ne l'écrit plus pendant le parcours.
	b.m.FermerTout()
	for _, c := range []*websocket.Conn{a, z} {
		if code := codeFermeture(t, c); code != websocket.StatusGoingAway {
			t.Fatalf("code %d, attendu 1001", code)
		}
	}
	attendre(t, 20*time.Second, func() bool { return b.e.srv.wsSlots.Len() == 0 })
	if g := b.e.do(req{method: "GET", path: "/api/salons/gestion", hdr: manage(b.k)}); g.Code != 200 {
		t.Fatalf("gestion : %s", g.Body)
	}
	parcourirSansAdresse(t, "gestionnaire", b.m, ip)

	// Le parcours voit bien une adresse gardée (témoin).
	var w marcheur
	w.vu = map[uintptr]bool{}
	w.marcher(reflect.ValueOf(&struct {
		a netip.Addr
		s string
	}{ip, "x"}))
	if w.adresse == "" || len(w.octets) != 1 || string(w.octets[0]) != "x" {
		t.Fatalf("témoin : %+v", w)
	}
}

// parcourirSansAdresse : aucune adresse (type ou octets de ip, ::1) dans v.
func parcourirSansAdresse(t *testing.T, nom string, v any, ip netip.Addr) {
	t.Helper()
	interdits := [][]byte{[]byte(ip.String()), ip.AsSlice(), []byte(netip.MustParseAddr("::1").String())}
	{
		var w marcheur
		w.vu = map[uintptr]bool{}
		w.marcher(reflect.ValueOf(v))
		if len(w.octets) < 2 {
			t.Fatalf("%s : parcours vide (%d)", nom, len(w.octets))
		}
		if w.adresse != "" {
			t.Fatalf("%s : adresse gardée (%s)", nom, w.adresse)
		}
		for _, s := range w.octets {
			for _, x := range interdits {
				if bytes.Contains(s, x) {
					t.Fatalf("%s : %q contient %q", nom, s, x)
				}
			}
		}
	}
}

// marcheur parcourt une valeur (champs non exportés compris) et en rassemble les chaînes et
// octets ; il s'arrête au WebSocket lui-même (la socket connaît son pair, en mémoire seulement)
// et à la base de données.
type marcheur struct {
	vu      map[uintptr]bool
	octets  [][]byte
	adresse string
}

var typesAdresse = map[reflect.Type]bool{
	reflect.TypeFor[netip.Addr](): true, reflect.TypeFor[netip.AddrPort](): true, reflect.TypeFor[netip.Prefix](): true,
}

func (w *marcheur) marcher(v reflect.Value) {
	if !v.IsValid() {
		return
	}
	t := v.Type()
	if typesAdresse[t] {
		w.adresse = t.String()
		return
	}
	pkg := t.PkgPath()
	if t.Kind() == reflect.Pointer {
		pkg = t.Elem().PkgPath()
	}
	if strings.HasPrefix(pkg, "github.com/coder/websocket") || pkg == "database/sql" || pkg == "net" ||
		strings.HasPrefix(pkg, "sync") || pkg == "time" || pkg == "context" {
		return
	}
	switch v.Kind() {
	case reflect.Pointer, reflect.Map, reflect.Slice:
		if v.IsNil() {
			return
		}
		if v.Kind() != reflect.Slice {
			if p := v.Pointer(); w.vu[p] {
				return
			} else {
				w.vu[p] = true
			}
		}
	}
	switch v.Kind() {
	case reflect.Pointer, reflect.Interface:
		w.marcher(v.Elem())
	case reflect.Struct:
		for i := range v.NumField() {
			w.marcher(v.Field(i))
		}
	case reflect.Map:
		it := v.MapRange()
		for it.Next() {
			w.marcher(it.Key())
			w.marcher(it.Value())
		}
	case reflect.Slice, reflect.Array:
		if t.Elem().Kind() == reflect.Uint8 {
			b := make([]byte, v.Len())
			for i := range b {
				b[i] = byte(v.Index(i).Uint())
			}
			w.octets = append(w.octets, b)
			return
		}
		for i := range v.Len() {
			w.marcher(v.Index(i))
		}
	case reflect.String:
		w.octets = append(w.octets, []byte(v.String()))
	}
}

// clesSlots : clés des places prises (champs c64 et c48 de limits.Slots).
func clesSlots(s any) map[string]bool {
	out := map[string]bool{}
	v := reflect.ValueOf(s).Elem()
	for _, f := range []string{"c64", "c48"} {
		for _, k := range v.FieldByName(f).MapKeys() {
			out[k.String()] = true
		}
	}
	return out
}

func TestOrigineHote(t *testing.T) {
	for o, want := range map[string]string{
		"https://shhdrop.app": "shhdrop.app", "http://127.0.0.1:8080": "127.0.0.1:8080",
		"": "", "shhdrop.app": "", "ftp://x": "", "https://*.app": "", "https://a[b": "", "https://": "",
	} {
		if got := origineHote(o); got != want {
			t.Errorf("origineHote(%q) = %q, attendu %q", o, got, want)
		}
	}
}
