package limits

import (
	"fmt"
	"net/netip"
	"testing"
	"time"
)

var t0 = time.Date(2026, 11, 4, 15, 30, 0, 0, time.UTC)

func ip(s string) netip.Addr { return netip.MustParseAddr(s) }

func newLim(now *time.Time) *Limiter { return New(func() time.Time { return *now }) }

func TestPrefixes(t *testing.T) {
	cases := []struct{ in, p64, p48 string }{
		{"1.2.3.4", "1.2.3.4", "1.2.3.4"},
		{"::ffff:1.2.3.4", "1.2.3.4", "1.2.3.4"},
		{"2001:db8:1:2:3:4:5:6", "2001:db8:1:2::/64", "2001:db8:1::/48"},
		{"fe80::1%eth0", "fe80::/64", "fe80::/48"},
	}
	for _, c := range cases {
		p64, p48 := Prefixes(ip(c.in))
		if p64 != c.p64 || p48 != c.p48 {
			t.Fatalf("Prefixes(%s) = %s, %s", c.in, p64, p48)
		}
	}
	if a, b := Prefixes(netip.Addr{}); a == "" || b == "" {
		t.Fatal("adresse invalide : préfixe vide")
	}
}

func TestKeyPseudonymous(t *testing.T) {
	now := t0
	l := newLim(&now)
	k64, k48 := l.Key(ip("2001:db8:1:2::1"))
	if len(k64) != 64 || len(k48) != 64 || k64 == k48 {
		t.Fatalf("clés : %q %q", k64, k48)
	}
	a, _ := l.Key(ip("2001:db8:1:2::ffff"))
	if a != k64 {
		t.Fatal("même /64, clés différentes")
	}
	if m, _ := l.Key(ip("::ffff:1.2.3.4")); m != func() string { k, _ := l.Key(ip("1.2.3.4")); return k }() {
		t.Fatal("IPv4 dans IPv6 traitée différemment")
	}
	now = t0.Add(24 * time.Hour)
	if b, _ := l.Key(ip("2001:db8:1:2::1")); b == k64 {
		t.Fatal("le secret du jour n'a pas tourné")
	}
}

func TestTenPerDay(t *testing.T) {
	now := t0
	l := newLim(&now)
	for i := 0; i < 10; i++ {
		// Deux adresses du même /64 partagent le compteur.
		addr := ip(fmt.Sprintf("2001:db8:0:1::%x", i+1))
		if ok, _ := l.AllowCreate(addr, 1); !ok {
			t.Fatalf("création %d refusée", i+1)
		}
	}
	ok, ra := l.AllowCreate(ip("2001:db8:0:1::abcd"), 1)
	if ok || ra <= 0 {
		t.Fatalf("11e création : ok=%v retryAfter=%v", ok, ra)
	}
	want := time.Date(2026, 11, 5, 0, 0, 0, 0, time.UTC).Sub(t0)
	if ra != want {
		t.Fatalf("retryAfter = %v, attendu %v", ra, want)
	}
	// Un autre /64 n'est pas touché.
	if ok, _ := l.AllowCreate(ip("2001:db8:0:2::1"), 1); !ok {
		t.Fatal("autre /64 refusé")
	}
}

func TestIPv4MappedSharesCounter(t *testing.T) {
	now := t0
	l := newLim(&now)
	for i := 0; i < 10; i++ {
		a := "1.2.3.4"
		if i%2 == 1 {
			a = "::ffff:1.2.3.4"
		}
		if ok, _ := l.AllowCreate(ip(a), 1); !ok {
			t.Fatalf("création %d refusée", i+1)
		}
	}
	if ok, _ := l.AllowCreate(ip("::ffff:1.2.3.4"), 1); ok {
		t.Fatal("contournement par IPv4 dans IPv6")
	}
	if ok, _ := l.AllowCreate(ip("1.2.3.5"), 1); !ok {
		t.Fatal("autre IPv4 refusée")
	}
}

func TestThirtyPer48(t *testing.T) {
	now := t0
	l := newLim(&now)
	for i := 0; i < 30; i++ {
		if ok, _ := l.AllowCreate(ip(fmt.Sprintf("2001:db8:7:%x::1", i)), 1); !ok {
			t.Fatalf("création %d refusée", i+1)
		}
	}
	ok, ra := l.AllowCreate(ip("2001:db8:7:ff::1"), 1)
	if ok || ra <= 0 {
		t.Fatalf("31e création du /48 : ok=%v retryAfter=%v", ok, ra)
	}
	if ok, _ := l.AllowCreate(ip("2001:db8:8::1"), 1); !ok {
		t.Fatal("autre /48 refusé")
	}
}

func TestBytesPerDay(t *testing.T) {
	now := t0
	l := newLim(&now)
	// Spec §24 : 3 Gio utiles par jour et par connexion (trois liens de 1 Gio).
	if BytesPer64 != 3<<30 {
		t.Fatal("BytesPer64", BytesPer64)
	}
	for i := 0; i < 3; i++ {
		if ok, _ := l.AllowCreate(ip("1.2.3.4"), 16384*65536); !ok {
			t.Fatalf("envoi %d refusé", i+1)
		}
	}
	if ok, ra := l.AllowCreate(ip("1.2.3.4"), 1); ok || ra <= 0 {
		t.Fatalf("3 Gio + 1 octet : ok=%v retryAfter=%v", ok, ra)
	}
}

func TestRefusalDoesNotCount(t *testing.T) {
	now := t0
	l := newLim(&now)
	if ok, _ := l.AllowCreate(ip("1.2.3.4"), BytesPer64+1); ok {
		t.Fatal("3 Gio + 1 octet accepté")
	}
	if ok, _ := l.AllowCreate(ip("1.2.3.4"), -1); ok {
		t.Fatal("taille négative acceptée")
	}
	if ok, _ := l.AllowCreate(ip("1.2.3.4"), 1<<62); ok {
		t.Fatal("taille énorme acceptée")
	}
	// Les refus n'ont rien consommé : 10 créations et 3 Gio restent possibles.
	for i := 0; i < 10; i++ {
		if ok, _ := l.AllowCreate(ip("1.2.3.4"), BytesPer64/10); !ok {
			t.Fatalf("création %d refusée", i+1)
		}
	}
}

func TestDailyReset(t *testing.T) {
	now := t0
	l := newLim(&now)
	for i := 0; i < 10; i++ {
		l.AllowCreate(ip("1.2.3.4"), 30<<20)
	}
	if ok, _ := l.AllowCreate(ip("1.2.3.4"), 1); ok {
		t.Fatal("11e acceptée")
	}
	now = time.Date(2026, 11, 4, 23, 59, 59, 0, time.UTC)
	if ok, ra := l.AllowCreate(ip("1.2.3.4"), 1); ok || ra != time.Second {
		t.Fatalf("avant minuit : ok=%v retryAfter=%v", ok, ra)
	}
	now = time.Date(2026, 11, 5, 0, 0, 0, 0, time.UTC)
	if ok, _ := l.AllowCreate(ip("1.2.3.4"), 1); !ok {
		t.Fatal("pas de remise à zéro le lendemain")
	}
	if len(l.count64) != 1 || len(l.count48) != 1 || len(l.bytes64) != 1 {
		t.Fatal("anciens compteurs conservés")
	}
}

// Une horloge locale non UTC ne décale pas la remise à zéro.
func TestResetAtUTCMidnight(t *testing.T) {
	paris := time.FixedZone("CET", 3600)
	now := time.Date(2026, 11, 5, 0, 30, 0, 0, paris) // 23:30 UTC le 4
	l := newLim(&now)
	if _, ra := l.AllowCreate(ip("1.2.3.4"), BytesPer64+1); ra != 30*time.Minute {
		t.Fatalf("retryAfter = %v", ra)
	}
}

func TestRequestRate(t *testing.T) {
	now := t0
	l := newLim(&now)
	for i := 0; i < 60; i++ {
		if !l.AllowRequest(ip(fmt.Sprintf("2001:db8::%x", i+1))) {
			t.Fatalf("requête %d refusée", i+1)
		}
	}
	if l.AllowRequest(ip("2001:db8::ffff")) {
		t.Fatal("61e requête du /64 acceptée")
	}
	if !l.AllowRequest(ip("1.2.3.4")) {
		t.Fatal("autre connexion refusée")
	}
	now = t0.Add(time.Minute)
	if !l.AllowRequest(ip("2001:db8::1")) {
		t.Fatal("pas de remise à zéro à la minute suivante")
	}
	if len(l.req) != 1 {
		t.Fatalf("compteurs de la minute passée conservés : %d", len(l.req))
	}
}

func TestConcurrent(t *testing.T) {
	now := t0
	l := newLim(&now)
	done := make(chan bool, 50)
	for i := 0; i < 50; i++ {
		go func() {
			ok, _ := l.AllowCreate(ip("1.2.3.4"), 1)
			l.AllowRequest(ip("1.2.3.4"))
			done <- ok
		}()
	}
	n := 0
	for i := 0; i < 50; i++ {
		if <-done {
			n++
		}
	}
	if n != 10 {
		t.Fatalf("%d créations acceptées en parallèle, attendu 10", n)
	}
}
