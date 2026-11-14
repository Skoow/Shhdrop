package courriel

import (
	"bufio"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/base64"
	"math/big"
	"net"
	"net/textproto"
	"strings"
	"sync"
	"testing"
	"time"
)

// Faux serveur SMTP sur la boucle locale (aucun réseau) : TLS implicite, STARTTLS ou texte
// clair ; garde ce qu'il reçoit pour les tests.

type recu struct {
	from, to string
	data     []byte
	tls      bool // DATA reçu sous TLS
}

type fauxSMTP struct {
	ln      net.Listener
	port    int
	pool    *x509.CertPool
	tlsConf *tls.Config

	implicite      bool   // TLS dès la connexion (port 465)
	offrirStartTLS bool   // annonce STARTTLS (port 587)
	refuserRcpt    string // RCPT TO contenant ceci : 550
	refuserAccueil int    // nombre de premières connexions refusées (421 à l'accueil)
	muet           bool   // n'envoie jamais l'accueil

	mu         sync.Mutex
	recus      []recu
	connexions int
	auths      []bool // une entrée par AUTH : sous TLS ou non
	mails      int    // MAIL FROM reçus
	rcpts      []string
}

// certificat : autosigné pour localhost et, si ip, 127.0.0.1.
func certificat(t *testing.T, ip bool) (tls.Certificate, *x509.CertPool) {
	t.Helper()
	k, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	tpl := &x509.Certificate{
		SerialNumber: big.NewInt(1), Subject: pkix.Name{CommonName: "127.0.0.1"},
		NotBefore: time.Now().Add(-time.Hour), NotAfter: time.Now().Add(time.Hour),
		DNSNames: []string{"localhost"},
		KeyUsage: x509.KeyUsageDigitalSignature | x509.KeyUsageCertSign, IsCA: true, BasicConstraintsValid: true,
		ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
	}
	if ip {
		tpl.IPAddresses = []net.IP{net.ParseIP("127.0.0.1")}
	}
	der, err := x509.CreateCertificate(rand.Reader, tpl, tpl, &k.PublicKey, k)
	if err != nil {
		t.Fatal(err)
	}
	c, err := x509.ParseCertificate(der)
	if err != nil {
		t.Fatal(err)
	}
	pool := x509.NewCertPool()
	pool.AddCert(c)
	return tls.Certificate{Certificate: [][]byte{der}, PrivateKey: k}, pool
}

// nouveauFaux : prep règle le serveur avant qu'il accepte la première connexion.
func nouveauFaux(t *testing.T, prep func(f *fauxSMTP)) *fauxSMTP {
	t.Helper()
	cert, pool := certificat(t, true)
	f := &fauxSMTP{pool: pool, tlsConf: &tls.Config{Certificates: []tls.Certificate{cert}}}
	if prep != nil {
		prep(f)
	}
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	f.ln, f.port = ln, ln.Addr().(*net.TCPAddr).Port
	t.Cleanup(func() { ln.Close() })
	go func() {
		for {
			c, err := ln.Accept()
			if err != nil {
				return
			}
			go f.servir(c)
		}
	}()
	return f
}

func (f *fauxSMTP) servir(c net.Conn) {
	defer c.Close()
	c.SetDeadline(time.Now().Add(10 * time.Second))
	f.mu.Lock()
	f.connexions++
	n := f.connexions
	f.mu.Unlock()
	if f.muet {
		time.Sleep(5 * time.Second)
		return
	}
	sousTLS := false
	if f.implicite {
		tc := tls.Server(c, f.tlsConf)
		if err := tc.Handshake(); err != nil {
			return
		}
		c, sousTLS = tc, true
	}
	r := textproto.NewReader(bufio.NewReader(c))
	w := func(s string) { c.Write([]byte(s + "\r\n")) }
	if n <= f.refuserAccueil {
		w("421 occupé")
		return
	}
	w("220 faux ESMTP")
	var from string
	var to string
	for {
		l, err := r.ReadLine()
		if err != nil {
			return
		}
		cmd := strings.ToUpper(l)
		switch {
		case strings.HasPrefix(cmd, "EHLO"):
			w("250-faux")
			if f.offrirStartTLS && !sousTLS {
				w("250-STARTTLS")
			}
			w("250-AUTH PLAIN")
			w("250 8BITMIME")
		case cmd == "STARTTLS":
			if !f.offrirStartTLS || sousTLS {
				w("502 non")
				continue
			}
			w("220 vas-y")
			tc := tls.Server(c, f.tlsConf)
			if err := tc.Handshake(); err != nil {
				return
			}
			c, sousTLS = tc, true
			r = textproto.NewReader(bufio.NewReader(c))
		case strings.HasPrefix(cmd, "AUTH PLAIN "):
			b, _ := base64.StdEncoding.DecodeString(l[len("AUTH PLAIN "):])
			f.mu.Lock()
			f.auths = append(f.auths, sousTLS)
			f.mu.Unlock()
			if string(b) != "\x00utilisateur\x00mot-de-passe-smtp" {
				w("535 non")
				continue
			}
			w("235 ok")
		case strings.HasPrefix(cmd, "MAIL FROM:"):
			from = strings.Fields(l[len("MAIL FROM:"):])[0]
			f.mu.Lock()
			f.mails++
			f.mu.Unlock()
			w("250 ok")
		case strings.HasPrefix(cmd, "RCPT TO:"):
			to = l[len("RCPT TO:"):]
			f.mu.Lock()
			f.rcpts = append(f.rcpts, to)
			f.mu.Unlock()
			if f.refuserRcpt != "" && strings.Contains(to, f.refuserRcpt) {
				w("550 boîte inconnue")
				continue
			}
			w("250 ok")
		case cmd == "DATA":
			w("354 vas-y")
			d, err := r.ReadDotBytes()
			if err != nil {
				return
			}
			f.mu.Lock()
			f.recus = append(f.recus, recu{from: from, to: to, data: d, tls: sousTLS})
			f.mu.Unlock()
			w("250 reçu")
		case cmd == "QUIT":
			w("221 au revoir")
			return
		default:
			w("250 ok")
		}
	}
}

// attendre : au moins n messages reçus (5 s au plus).
func (f *fauxSMTP) attendre(t *testing.T, n int) []recu {
	t.Helper()
	for fin := time.Now().Add(5 * time.Second); time.Now().Before(fin); time.Sleep(5 * time.Millisecond) {
		f.mu.Lock()
		if len(f.recus) >= n {
			r := append([]recu(nil), f.recus...)
			f.mu.Unlock()
			return r
		}
		f.mu.Unlock()
	}
	t.Fatalf("faux SMTP : moins de %d messages reçus", n)
	return nil
}

// etat : copie des compteurs du faux serveur.
func (f *fauxSMTP) etat() (connexions, mails int, auths []bool, rcpts []string, recus int) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.connexions, f.mails, append([]bool(nil), f.auths...), append([]string(nil), f.rcpts...), len(f.recus)
}
