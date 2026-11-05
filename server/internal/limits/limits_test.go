package limits

import (
	"errors"
	"fmt"
	"net/netip"
	"sync/atomic"
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

// Anti-saturation : 6 Gio utiles par jour et par /48, en plus des 3 Gio par /64.
func TestBytesPer48(t *testing.T) {
	now := t0
	l := newLim(&now)
	if BytesPer48 != 6<<30 {
		t.Fatal("BytesPer48", BytesPer48)
	}
	const gib = 16384 * 65536
	for i := 0; i < 6; i++ {
		a := ip(fmt.Sprintf("2001:db8:1:%x::1", i)) // six /64 du même /48
		if ok, _ := l.AllowCreate(a, gib); !ok {
			t.Fatalf("lien %d refusé", i+1)
		}
	}
	if ok, ra := l.AllowCreate(ip("2001:db8:1:ff::1"), 1); ok || ra <= 0 {
		t.Fatalf("6 Gio + 1 octet par /48 : ok=%v retryAfter=%v", ok, ra)
	}
	if ok, _ := l.AllowCreate(ip("2001:db8:2::1"), gib); !ok {
		t.Fatal("autre /48 refusé")
	}
	// Un refus par /48 ne consomme rien sur le /64.
	if ok, _ := l.AllowCreate(ip("2001:db8:1:ff::1"), 1); ok {
		t.Fatal("toujours refusé")
	}
	now = now.Add(24 * time.Hour)
	if ok, _ := l.AllowCreate(ip("2001:db8:1:ff::1"), gib); !ok {
		t.Fatal("remise à zéro quotidienne")
	}
}

// Requêtes de segments à jeton valide : 600 par minute et par connexion, compteur à part.
func TestSegmentRate(t *testing.T) {
	now := t0
	l := newLim(&now)
	for i := 0; i < SegmentsPerMin; i++ {
		if !l.AllowSegment(ip("1.2.3.4")) {
			t.Fatalf("segment %d refusé", i+1)
		}
	}
	if SegmentsPerMin != 600 || l.AllowSegment(ip("1.2.3.4")) {
		t.Fatal("601ᵉ segment accepté")
	}
	if !l.AllowRequest(ip("1.2.3.4")) {
		t.Fatal("compteur général touché par les segments")
	}
	if !l.AllowSegment(ip("1.2.3.5")) {
		t.Fatal("autre connexion refusée")
	}
	now = now.Add(time.Minute)
	if !l.AllowSegment(ip("1.2.3.4")) {
		t.Fatal("pas de remise à zéro à la minute")
	}
}

// Audit M1 : les /64 d'un même /48 partagent un compteur de 6 000 segments par minute.
func TestSegmentRatePer48(t *testing.T) {
	now := t0
	l := newLim(&now)
	if SegmentsPer48Min != 6000 {
		t.Fatal(SegmentsPer48Min)
	}
	for p := 0; p < SegmentsPer48Min/SegmentsPerMin; p++ {
		a := ip(fmt.Sprintf("2001:db8:7:%x::1", p))
		for i := 0; i < SegmentsPerMin; i++ {
			if !l.AllowSegment(a) {
				t.Fatalf("/64 n° %d, segment %d refusé", p, i+1)
			}
		}
	}
	if l.AllowSegment(ip("2001:db8:7:ff::1")) {
		t.Fatal("/48 plein mais segment accepté depuis un /64 neuf")
	}
	if !l.AllowSegment(ip("2001:db8:8::1")) {
		t.Fatal("autre /48 refusé")
	}
	now = now.Add(time.Minute)
	if !l.AllowSegment(ip("2001:db8:7:ff::1")) {
		t.Fatal("pas de remise à zéro à la minute")
	}
}

var testUploadN atomic.Int64

// AllowCreate (tests) : une création réservée puis finalisée aussitôt.
func (l *Limiter) AllowCreate(ip netip.Addr, bytes int64) (bool, time.Duration) {
	id := fmt.Sprintf("test-%d", testUploadN.Add(1))
	ra, err := l.BeginUpload(ip, id, bytes)
	if err != nil {
		return false, ra
	}
	l.FinishUpload(id)
	return true, 0
}

// Spec §29.5 : quotas débités à la finalisation (un envoi abandonné ne les consomme pas),
// création refusée quand ils sont atteints, 2 envois en cours par connexion (6 par /48),
// octets abandonnés débités à l'effacement (6 Gio par jour, puis 429).
func TestUploadQuotas(t *testing.T) {
	const gib = 1 << 30
	t.Run("10 créations finalisées par jour, puis refus", func(t *testing.T) {
		l := New(fixed(time.Date(2026, 11, 5, 10, 0, 0, 0, time.UTC)))
		for i := 0; i < CreatesPer64; i++ {
			if ok, _ := l.AllowCreate(ip("1.2.3.4"), 1); !ok {
				t.Fatal(i)
			}
		}
		ra, err := l.BeginUpload(ip("1.2.3.4"), "x", 1)
		if !errors.Is(err, ErrQuota) || ra != 14*time.Hour {
			t.Fatal(ra, err)
		}
	})
	t.Run("envoi abandonné ou annulé : ne compte pas dans les créations", func(t *testing.T) {
		l := New(fixed(time.Date(2026, 11, 5, 10, 0, 0, 0, time.UTC)))
		for i := 0; i < 3*CreatesPer64; i++ {
			id := fmt.Sprint("a", i)
			if _, err := l.BeginUpload(ip("1.2.3.4"), id, 1); err != nil {
				t.Fatal(i, err)
			}
			if i%2 == 0 {
				l.AbandonUpload(id)
			} else {
				l.CancelUpload(id)
			}
		}
		if ok, _ := l.AllowCreate(ip("1.2.3.4"), 1); !ok {
			t.Fatal("quota consommé par des envois non finalisés")
		}
	})
	t.Run("2 envois en cours par connexion, 6 par /48", func(t *testing.T) {
		l := New(fixed(time.Date(2026, 11, 5, 10, 0, 0, 0, time.UTC)))
		for _, id := range []string{"p1", "p2"} {
			if _, err := l.BeginUpload(ip("1.2.3.4"), id, 1); err != nil {
				t.Fatal(err)
			}
		}
		if ra, err := l.BeginUpload(ip("1.2.3.4"), "p3", 1); !errors.Is(err, ErrQuota) || ra != time.Minute {
			t.Fatal(ra, err)
		}
		l.FinishUpload("p1")
		if _, err := l.BeginUpload(ip("1.2.3.4"), "p3", 1); err != nil {
			t.Fatal("place libérée par la finalisation", err)
		}
		for i := 0; i < PendingPer48; i++ {
			if _, err := l.BeginUpload(ip(fmt.Sprintf("2001:db8:9:%x::1", i)), fmt.Sprint("q", i), 1); err != nil {
				t.Fatal(i, err)
			}
		}
		if _, err := l.BeginUpload(ip("2001:db8:9:ff::1"), "q-de-trop", 1); !errors.Is(err, ErrQuota) {
			t.Fatal(err)
		}
	})
	t.Run("octets abandonnés : 6 Gio par jour, puis 429", func(t *testing.T) {
		l := New(fixed(time.Date(2026, 11, 5, 10, 0, 0, 0, time.UTC)))
		for i := 0; i < 6; i++ {
			id := fmt.Sprint("g", i)
			if _, err := l.BeginUpload(ip("1.2.3.4"), id, gib); err != nil {
				t.Fatal(i, err)
			}
			l.AbandonUpload(id)
		}
		if _, err := l.BeginUpload(ip("1.2.3.4"), "g6", 1); !errors.Is(err, ErrQuota) {
			t.Fatal("7ᵉ Gio abandonné accepté", err)
		}
		if _, err := l.BeginUpload(ip("1.2.3.5"), "autre", 1); err != nil {
			t.Fatal("autre connexion touchée", err)
		}
	})
	t.Run("id déjà en cours : ErrDuplicate, compté comme une création (sonde), l'envoi existant intact", func(t *testing.T) {
		l := New(fixed(time.Date(2026, 11, 5, 10, 0, 0, 0, time.UTC)))
		if _, err := l.BeginUpload(ip("1.2.3.4"), "d", 1); err != nil {
			t.Fatal(err)
		}
		for i := 0; i < CreatesPer64; i++ {
			if _, err := l.BeginUpload(ip("5.6.7.8"), "d", 1); !errors.Is(err, ErrDuplicate) {
				t.Fatal(i, err)
			}
		}
		if _, err := l.BeginUpload(ip("5.6.7.8"), "d", 1); !errors.Is(err, ErrQuota) {
			t.Fatal("11ᵉ sonde : le quota devrait être épuisé", err)
		}
		if ok, _ := l.AllowCreate(ip("5.6.7.8"), 1); ok {
			t.Fatal("les sondes ne comptent pas dans le quota")
		}
		if _, err := l.BeginUpload(ip("1.2.3.4"), "e", 1); err != nil {
			t.Fatal(err)
		}
		if _, err := l.BeginUpload(ip("1.2.3.4"), "f", 1); !errors.Is(err, ErrQuota) {
			t.Fatal("l'envoi d est toujours en cours", err)
		}
	})
	t.Run("minuit : compteurs et envois en cours oubliés", func(t *testing.T) {
		c := &stepClock{t: time.Date(2026, 11, 5, 23, 59, 0, 0, time.UTC)}
		l := New(c.Now)
		for _, id := range []string{"m1", "m2"} {
			if _, err := l.BeginUpload(ip("1.2.3.4"), id, 1); err != nil {
				t.Fatal(err)
			}
		}
		c.t = c.t.Add(2 * time.Minute)
		if _, err := l.BeginUpload(ip("1.2.3.4"), "m3", 1); err != nil {
			t.Fatal(err)
		}
		l.FinishUpload("m1") // inconnu depuis minuit : ignoré
	})
}

func fixed(t time.Time) func() time.Time { return func() time.Time { return t } }

type stepClock struct{ t time.Time }

func (c *stepClock) Now() time.Time { return c.t }
