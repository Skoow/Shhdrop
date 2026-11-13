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
	// Spec §24, §41.2 : 6 Gio utiles par jour et par connexion (trois liens de 2 Gio).
	if BytesPer64 != 6<<30 {
		t.Fatal("BytesPer64", BytesPer64)
	}
	for i := 0; i < 3; i++ {
		if ok, _ := l.AllowCreate(ip("1.2.3.4"), 32768*65536); !ok {
			t.Fatalf("envoi %d refusé", i+1)
		}
	}
	if ok, ra := l.AllowCreate(ip("1.2.3.4"), 32768*65536); ok || ra <= 0 {
		t.Fatalf("4ᵉ partage de 2 Gio : ok=%v retryAfter=%v", ok, ra)
	}
	// Sept partages de 1 Gio : le 7ᵉ dépasse les 6 Gio.
	l2 := newLim(&now)
	for i := 0; i < 6; i++ {
		if ok, _ := l2.AllowCreate(ip("5.6.7.8"), 1<<30); !ok {
			t.Fatalf("partage de 1 Gio %d refusé", i+1)
		}
	}
	if ok, _ := l2.AllowCreate(ip("5.6.7.8"), 1<<30); ok {
		t.Fatal("7ᵉ partage de 1 Gio accepté")
	}
}

func TestRefusalDoesNotCount(t *testing.T) {
	now := t0
	l := newLim(&now)
	if ok, _ := l.AllowCreate(ip("1.2.3.4"), BytesPer64+1); ok {
		t.Fatal("6 Gio + 1 octet accepté")
	}
	if ok, _ := l.AllowCreate(ip("1.2.3.4"), -1); ok {
		t.Fatal("taille négative acceptée")
	}
	if ok, _ := l.AllowCreate(ip("1.2.3.4"), 1<<62); ok {
		t.Fatal("taille énorme acceptée")
	}
	// Les refus n'ont rien consommé : 10 créations et 6 Gio restent possibles.
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

// Anti-saturation : 12 Gio utiles par jour et par /48, en plus des 6 Gio par /64.
func TestBytesPer48(t *testing.T) {
	now := t0
	l := newLim(&now)
	if BytesPer48 != 12<<30 {
		t.Fatal("BytesPer48", BytesPer48)
	}
	const gib = 2 * 16384 * 65536 // 2 Gio
	for i := 0; i < 6; i++ {
		a := ip(fmt.Sprintf("2001:db8:1:%x::1", i)) // six /64 du même /48
		if ok, _ := l.AllowCreate(a, gib); !ok {
			t.Fatalf("lien %d refusé", i+1)
		}
	}
	if ok, ra := l.AllowCreate(ip("2001:db8:1:ff::1"), 1); ok || ra <= 0 {
		t.Fatalf("12 Gio + 1 octet par /48 : ok=%v retryAfter=%v", ok, ra)
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

// Requêtes de segments à jeton valide : 1 500 par minute et par connexion (600 avant le
// 13 novembre), compteur à part.
func TestSegmentRate(t *testing.T) {
	now := t0
	l := newLim(&now)
	for i := 0; i < SegmentsPerMin; i++ {
		if !l.AllowSegment(ip("1.2.3.4")) {
			t.Fatalf("segment %d refusé", i+1)
		}
	}
	if SegmentsPerMin != 1500 || l.AllowSegment(ip("1.2.3.4")) {
		t.Fatal("1 501ᵉ segment accepté")
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

// Audit M1 : les /64 d'un même /48 partagent un compteur de 15 000 segments par minute.
func TestSegmentRatePer48(t *testing.T) {
	now := t0
	l := newLim(&now)
	if SegmentsPer48Min != 15000 {
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
	l.FinishUpload(id, ip)
	return true, 0
}

// Spec §29.5 : quotas débités à la finalisation (un envoi abandonné ne les consomme pas),
// création refusée quand ils sont atteints, 2 envois en cours par connexion (6 par /48),
// octets abandonnés débités à l'effacement (12 Gio par jour, puis 429).
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
		l.FinishUpload("p1", ip("1.2.3.4"))
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
	t.Run("octets abandonnés : 12 Gio par jour, puis 429", func(t *testing.T) {
		l := New(fixed(time.Date(2026, 11, 5, 10, 0, 0, 0, time.UTC)))
		for i := 0; i < 12; i++ {
			id := fmt.Sprint("g", i)
			if _, err := l.BeginUpload(ip("1.2.3.4"), id, gib); err != nil {
				t.Fatal(i, err)
			}
			l.AbandonUpload(id)
		}
		if _, err := l.BeginUpload(ip("1.2.3.4"), "g12", 1); !errors.Is(err, ErrQuota) {
			t.Fatal("13ᵉ Gio abandonné accepté", err)
		}
		if _, err := l.BeginUpload(ip("1.2.3.5"), "autre", 1); err != nil {
			t.Fatal("autre connexion touchée", err)
		}
	})
	t.Run("trois partages de 2 Gio finalisés, le 4ᵉ refusé ; sept de 1 Gio, le 7ᵉ refusé (6 Gio par jour)", func(t *testing.T) {
		l := New(fixed(time.Date(2026, 11, 5, 10, 0, 0, 0, time.UTC)))
		for i := 0; i < 3; i++ {
			id := fmt.Sprint("b", i)
			if _, err := l.BeginUpload(ip("1.2.3.4"), id, 2*gib); err != nil {
				t.Fatal(i, err)
			}
			l.FinishUpload(id, ip("1.2.3.4"))
		}
		if ra, err := l.BeginUpload(ip("1.2.3.4"), "b3", 2*gib); !errors.Is(err, ErrQuota) || ra <= 0 {
			t.Fatal("4ᵉ partage de 2 Gio accepté", ra, err)
		}
		for i := 0; i < 6; i++ {
			id := fmt.Sprint("c", i)
			if _, err := l.BeginUpload(ip("5.6.7.8"), id, gib); err != nil {
				t.Fatal(i, err)
			}
			l.FinishUpload(id, ip("1.2.3.4"))
		}
		if _, err := l.BeginUpload(ip("5.6.7.8"), "c6", gib); !errors.Is(err, ErrQuota) {
			t.Fatal("7ᵉ partage de 1 Gio accepté", err)
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
	t.Run("minuit : envois en cours gardés (places et octets), envois terminés oubliés", func(t *testing.T) {
		c := &stepClock{t: time.Date(2026, 11, 5, 23, 59, 0, 0, time.UTC)}
		l := New(c.Now)
		for _, id := range []string{"m1", "m2"} {
			if _, err := l.BeginUpload(ip("1.2.3.4"), id, 1); err != nil {
				t.Fatal(err)
			}
		}
		c.t = c.t.Add(2 * time.Minute)
		if ra, err := l.BeginUpload(ip("1.2.3.4"), "m3", 1); !errors.Is(err, ErrQuota) || ra != pendingRetry {
			t.Fatal("3ᵉ envoi en cours accepté après minuit", ra, err)
		}
		l.FinishUpload("m1", ip("1.2.3.4")) // toujours connu après minuit : sa place est rendue
		if _, err := l.BeginUpload(ip("1.2.3.4"), "m3", 1); err != nil {
			t.Fatal(err)
		}
	})
}

// Minuit UTC (revue du 10 novembre) : un envoi en cours à minuit reste compté le lendemain
// (création, octets, place d'envoi en cours) sous sa clé de la veille, retrouvée par le
// secret de la veille, gardé en mémoire tant qu'un tel envoi vit. Les envois terminés la
// veille, eux, sont oubliés à minuit comme avant.
func TestMidnightCarriesInFlightUploads(t *testing.T) {
	const gib = int64(1) << 30
	eve := time.Date(2026, 11, 5, 23, 59, 0, 0, time.UTC)
	t.Run("octets d'un envoi en cours comptés le lendemain, Reserve et Receive aussi", func(t *testing.T) {
		now := eve
		l := newLim(&now)
		if _, err := l.BeginUpload(ip("2001:db8:1:1::1"), "a", 2*gib); err != nil {
			t.Fatal(err)
		}
		if _, err := l.BeginUpload(ip("2001:db8:1:1::1"), "fini", 4*gib); err != nil {
			t.Fatal(err)
		}
		l.FinishUpload("fini", ip("1.2.3.4")) // terminé la veille : oublié à minuit
		now = now.Add(2 * time.Minute)
		if _, err := l.Reserve("a", 4*gib); err != nil {
			t.Fatal("grow d'un envoi de la veille", err)
		}
		if ra, err := l.BeginUpload(ip("2001:db8:1:1::2"), "b", 3*gib); !errors.Is(err, ErrQuota) || ra <= pendingRetry {
			t.Fatal("4 Gio en cours depuis la veille + 3 Gio acceptés", ra, err)
		}
		// Même /48, autre /64 : le bloc compte aussi l'envoi de la veille (12 Gio par /48).
		if _, err := l.BeginUpload(ip("2001:db8:1:2::1"), "c", 6*gib); err != nil {
			t.Fatal(err)
		}
		l.FinishUpload("c", ip("1.2.3.4"))
		if _, err := l.BeginUpload(ip("2001:db8:1:3::1"), "d", 3*gib); !errors.Is(err, ErrQuota) {
			t.Fatal("/48 : 4 Gio de la veille + 6 Gio + 3 Gio acceptés", err)
		}
		if _, err := l.BeginUpload(ip("2001:db8:1:1::2"), "b", 2*gib); err != nil {
			t.Fatal("4 Gio en cours + 2 Gio refusés", err)
		}
		if _, err := l.Receive("a", 6*gib); err != nil {
			t.Fatal(err)
		}
		// Le morceau du manifeste (64 Kio) n'est pas compté (audit F1).
		if ra, err := l.Receive("a", ManifestChunk+1); !errors.Is(err, ErrQuota) || ra <= 0 {
			t.Fatal("octets reçus par un envoi de la veille non comptés", ra, err)
		}
	})
	t.Run("le secret de la veille est jeté dès le dernier envoi de la veille terminé", func(t *testing.T) {
		now := eve
		l := newLim(&now)
		old := l.secret
		for _, id := range []string{"a", "b"} {
			if _, err := l.BeginUpload(ip("1.2.3.4"), id, 2*gib); err != nil {
				t.Fatal(err)
			}
		}
		now = now.Add(2 * time.Minute)
		l.Key(ip("1.2.3.4")) // rotation
		if string(l.prev) != string(old) || string(l.secret) == string(old) {
			t.Fatal("secret de la veille non gardé pendant un envoi en cours")
		}
		l.AbandonUpload("a")
		if l.prev == nil {
			t.Fatal("secret de la veille jeté alors qu'un envoi de la veille vit encore")
		}
		l.FinishUpload("b", ip("1.2.3.4"))
		if l.prev != nil {
			t.Fatal("secret de la veille gardé sans envoi de la veille")
		}
		// Audit M5 (décision du propriétaire, 11 novembre ; attente changée) : b, fini
		// aujourd'hui, compte dans les quotas du jour sous la clé du jour (création et octets,
		// par connexion et par bloc : 4 entrées) ; plus rien sous la clé de la veille.
		if n := len(l.count64) + len(l.count48) + len(l.bytes64) + len(l.bytes48) + len(l.uploads) +
			len(l.pend64) + len(l.pend48) + len(l.aband64) + len(l.aband48); n != 4 {
			t.Fatal("compteurs après le report", n)
		}
		k64, _ := l.Key(ip("1.2.3.4"))
		if l.count64[k64] != 1 || l.bytes64[k64] != 2*gib {
			t.Fatal("envoi b non compté sous la clé du jour", l.count64[k64], l.bytes64[k64])
		}
		if _, err := l.BeginUpload(ip("1.2.3.4"), "c", 6*gib); !errors.Is(err, ErrQuota) {
			t.Fatal("2 Gio finis aujourd'hui + 6 Gio acceptés", err)
		}
		if _, err := l.BeginUpload(ip("1.2.3.4"), "c", 4*gib); err != nil {
			t.Fatal(err)
		}
	})
	t.Run("aucun envoi en cours à minuit : aucun secret gardé", func(t *testing.T) {
		now := eve
		l := newLim(&now)
		if _, err := l.BeginUpload(ip("1.2.3.4"), "a", gib); err != nil {
			t.Fatal(err)
		}
		l.FinishUpload("a", ip("1.2.3.4"))
		now = now.Add(2 * time.Minute)
		l.Key(ip("1.2.3.4"))
		if l.prev != nil {
			t.Fatal("secret de la veille gardé sans envoi en cours")
		}
	})
	t.Run("un envoi de la veille jamais terminé est oublié après la vie maximale d'un envoi", func(t *testing.T) {
		now := eve
		l := newLim(&now)
		for _, id := range []string{"a", "b"} {
			if _, err := l.BeginUpload(ip("1.2.3.4"), id, 2*gib); err != nil {
				t.Fatal(err)
			}
		}
		now = eve.Add(UploadLife - time.Second)
		if _, err := l.BeginUpload(ip("1.2.3.4"), "c", 1); !errors.Is(err, ErrQuota) || l.prev == nil {
			t.Fatal("envois de la veille oubliés trop tôt", err)
		}
		now = eve.Add(UploadLife)
		if _, err := l.BeginUpload(ip("1.2.3.4"), "c", 6*gib); err != nil {
			t.Fatal(err)
		}
		if l.prev != nil || len(l.uploads) != 1 || len(l.pend64) != 1 || len(l.bytes64) != 1 {
			t.Fatal("secret ou compteurs de la veille gardés", len(l.uploads), len(l.pend64), len(l.bytes64))
		}
		l.FinishUpload("a", ip("1.2.3.4")) // oublié : ignoré
	})
	t.Run("deux minuits : un envoi de l'avant-veille n'est pas gardé", func(t *testing.T) {
		now := eve
		l := newLim(&now)
		if _, err := l.BeginUpload(ip("1.2.3.4"), "a", gib); err != nil {
			t.Fatal(err)
		}
		now = eve.Add(48 * time.Hour)
		l.Key(ip("1.2.3.4"))
		if l.prev != nil || len(l.uploads) != 0 {
			t.Fatal("envoi de l'avant-veille gardé")
		}
	})
}

func fixed(t time.Time) func() time.Time { return func() time.Time { return t } }

type stepClock struct{ t time.Time }

func (c *stepClock) Now() time.Time { return c.t }

// Spec §9.5, §35.1 (Task M2) : chaque compteur est vide après sa durée de vie (horloge
// injectée) : ceux de la minute à la minute suivante, ceux du jour à minuit UTC ; une place
// de transfert est rendue à la fin du transfert. Revue du 10 novembre : un envoi encore en
// cours à minuit reste compté jusqu'à sa fin (6 h 15 au plus), avec le secret de la veille.
func TestCountersEmptyAfterRotation(t *testing.T) {
	now := time.Date(2026, 11, 4, 23, 58, 10, 0, time.UTC)
	l := newLim(&now)
	lens := func() (minute, day int) {
		l.mu.Lock()
		defer l.mu.Unlock()
		l.rotateLocked(now)
		minute = len(l.req) + len(l.seg) + len(l.seg48)
		day = len(l.count64) + len(l.count48) + len(l.bytes64) + len(l.bytes48) + len(l.uploads) +
			len(l.pend64) + len(l.pend48) + len(l.aband64) + len(l.aband48)
		return
	}
	for i, a := range []string{"2001:db8:1:1::1", "2001:db8:2:1::1", "198.51.100.9"} {
		l.AllowRequest(ip(a))
		l.AllowSegment(ip(a))
		if _, err := l.BeginUpload(ip(a), fmt.Sprintf("id-%d", i), 1<<20); err != nil {
			t.Fatal(err)
		}
	}
	l.AbandonUpload("id-0")
	l.FinishUpload("id-1", ip("1.2.3.4"))
	if m, d := lens(); m == 0 || d == 0 {
		t.Fatal("compteurs non remplis", m, d)
	}
	now = now.Add(time.Minute) // 23:59:10
	if m, d := lens(); m != 0 || d == 0 {
		t.Fatal("minute", m, d)
	}
	now = time.Date(2026, 11, 5, 0, 0, 0, 0, time.UTC) // minuit UTC
	// Seul l'envoi encore en cours (id-2) reste compté : lui-même, sa création, ses octets et
	// sa place, par connexion et par bloc (7 entrées), sous le secret de la veille.
	if m, d := lens(); m != 0 || d != 7 || l.prev == nil {
		t.Fatal("minuit UTC", m, d)
	}
	l.FinishUpload("id-2", ip("198.51.100.9"))
	// Audit M5 : fini aujourd'hui, id-2 compte sous la clé du jour (création et octets, par
	// connexion et par bloc : 4 entrées), jusqu'au prochain minuit ; le secret de la veille est jeté.
	if m, d := lens(); m != 0 || d != 4 || l.prev != nil {
		t.Fatal("après le dernier envoi de la veille", m, d)
	}
	s := NewSlots(3, 2, 3)
	rel, err := s.Acquire("a", "b")
	if err != nil || s.Len() != 1 {
		t.Fatal(err, s.Len())
	}
	rel()
	s.mu.Lock()
	n := len(s.c64) + len(s.c48)
	s.mu.Unlock()
	if s.Len() != 0 || n != 0 {
		t.Fatal("place non rendue", s.Len(), n)
	}
}

// Envoi dès l'ajout (spec §41.14) : les octets reçus comptent au quota du jour, même
// effacés ou abandonnés ; la réservation (création, grow) est débitée d'avance et couvre
// les octets reçus jusqu'à elle (compte = max(réservé, reçus)).
func TestReceivedBytesCount(t *testing.T) {
	now := t0
	l := newLim(&now)
	const gib = int64(1) << 30
	if _, err := l.BeginUpload(ip("1.2.3.4"), "a", 0); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 5; i++ {
		if _, err := l.Receive("a", gib); err != nil {
			t.Fatal(i, err)
		}
	}
	l.AbandonUpload("a") // reçus puis abandonnés : toujours comptés
	if _, err := l.BeginUpload(ip("1.2.3.4"), "b", 0); err != nil {
		t.Fatal(err)
	}
	if _, err := l.Receive("b", gib/2); err != nil {
		t.Fatal(err)
	}
	if ra, err := l.Receive("b", gib); !errors.Is(err, ErrQuota) || ra <= 0 {
		t.Fatal("au-delà de 6 Gio reçus", ra, err)
	}
	// Envoi inconnu (fini, abandonné, plus vieux qu'UploadLife) : refusé, jamais gratuit
	// (audit du 13 novembre, D1 : un jeton d'envoi finalisé lisait des Gio hors quota).
	if _, err := l.Receive("inconnu", gib); !errors.Is(err, ErrQuota) {
		t.Fatal("envoi inconnu : ErrQuota attendu", err)
	}
	if _, err := l.Receive("a", 1); !errors.Is(err, ErrQuota) {
		t.Fatal("envoi abandonné : ErrQuota attendu", err)
	}
}

func TestReserveDebitsQuota(t *testing.T) {
	now := t0
	l := newLim(&now)
	const gib = int64(1) << 30
	if _, err := l.BeginUpload(ip("1.2.3.4"), "a", gib); err != nil {
		t.Fatal(err)
	}
	if _, err := l.Reserve("a", 5*gib); err != nil {
		t.Fatal(err)
	}
	if _, err := l.Receive("a", 4*gib); err != nil { // couverts par la réservation
		t.Fatal(err)
	}
	if ra, err := l.Reserve("a", 7*gib); !errors.Is(err, ErrQuota) || ra <= 0 {
		t.Fatal("réservation au-delà du quota", err)
	}
	if _, err := l.Receive("a", 2*gib); err != nil { // 6 Gio reçus : +1 Gio
		t.Fatal(err)
	}
	// Le morceau du manifeste n'est pas compté (audit F1) : 64 Kio de plus passent, pas au-delà.
	if _, err := l.Receive("a", ManifestChunk+1); !errors.Is(err, ErrQuota) {
		t.Fatal(err)
	}
	l.AbandonUpload("a") // tout a été reçu : rien à rendre
	if _, err := l.BeginUpload(ip("1.2.3.4"), "b", ManifestChunk+1); !errors.Is(err, ErrQuota) {
		t.Fatal("quota rendu à tort", err)
	}
	// Réservation non remplie, abandonnée : rendue.
	if _, err := l.BeginUpload(ip("5.6.7.8"), "c", 0); err != nil {
		t.Fatal(err)
	}
	if _, err := l.Reserve("c", 6*gib); err != nil {
		t.Fatal(err)
	}
	if _, err := l.Receive("c", gib); err != nil {
		t.Fatal(err)
	}
	l.AbandonUpload("c")
	if _, err := l.BeginUpload(ip("5.6.7.8"), "d", 5*gib); err != nil {
		t.Fatal("réservation non remplie non rendue", err)
	}
}

// Audit M5 (décision du propriétaire, 11 novembre) : un envoi commencé la veille et finalisé
// après minuit compte dans les quotas du jour où il se termine (création et octets), sous la
// clé du jour de l'adresse qui le finalise ; aucune adresse n'est gardée.
func TestMidnightFinishedUploadCountsToday(t *testing.T) {
	now := time.Date(2026, 11, 4, 23, 59, 0, 0, time.UTC)
	l := newLim(&now)
	a := ip("1.2.3.4")
	small := int64(399) * 65536
	for _, id := range []string{"a", "b"} {
		if _, err := l.BeginUpload(a, id, small); err != nil {
			t.Fatal(err)
		}
	}
	now = now.Add(2 * time.Minute) // après minuit
	for _, id := range []string{"a", "b"} {
		if _, err := l.Reserve(id, 2<<30); err != nil {
			t.Fatal("reserve", err)
		}
		l.FinishUpload(id, a)
	}
	if l.prev != nil {
		t.Fatal("secret de la veille gardé après le dernier envoi reporté")
	}
	got := 0
	for i := 0; i < 3; i++ {
		id := string(rune('c' + i))
		if _, err := l.BeginUpload(a, id, 2<<30); err == nil {
			got++
			l.FinishUpload(id, a)
		}
	}
	if got != 1 {
		t.Fatalf("partages de 2 Gio acceptés après 4 Gio reportés : %d, attendu 1 (6 Gio par jour)", got)
	}
	// Créations reportées aussi : 2 reportées + 1 = 3 ; il en reste 7.
	for i := 0; i < CreatesPer64-3; i++ {
		if ok, _ := l.AllowCreate(a, 0); !ok {
			t.Fatal("création", i)
		}
	}
	if ok, _ := l.AllowCreate(a, 0); ok {
		t.Fatal("créations reportées non comptées")
	}
}

// Deux envois de la veille sous la même clé : le premier fini passe au jour sans rester
// compté sous la clé de la veille (pas de double compte tant que le second vit).
func TestMidnightFinishNoDoubleCount(t *testing.T) {
	now := time.Date(2026, 11, 4, 23, 59, 0, 0, time.UTC)
	l := newLim(&now)
	a := ip("1.2.3.4")
	for _, id := range []string{"a", "b"} {
		if _, err := l.BeginUpload(a, id, 2<<30); err != nil {
			t.Fatal(err)
		}
	}
	now = now.Add(2 * time.Minute)
	l.FinishUpload("a", a)
	// Comptés : a (2 Gio, jour) + b (2 Gio, veille) = 4 Gio ; 2 Gio restent.
	if _, err := l.BeginUpload(a, "c", 2<<30); err != nil {
		t.Fatal("double compte de l'envoi fini", err)
	}
	if _, err := l.BeginUpload(ip("1.2.3.5"), "d", 1); err != nil {
		t.Fatal(err)
	}
}

// Audit F1 : un partage plein (palier de 32 769 morceaux) envoie le morceau du manifeste en
// plus de ses 2 Gio de données : il n'est pas compté, et trois partages pleins tiennent dans
// les 6 Gio du jour (spec §24, §41.2).
func TestFullBucketThreePerDay(t *testing.T) {
	now := t0
	l := newLim(&now)
	a := ip("1.2.3.5")
	const bucket = 32769
	content := int64(bucket-1) * 65536
	payload := int64(bucket) * 65536 // morceaux reçus, manifeste compris, en données utiles
	for i := 0; i < 3; i++ {
		id := fmt.Sprint("x", i)
		if _, err := l.BeginUpload(a, id, content); err != nil {
			t.Fatal(i, err)
		}
		if _, err := l.Receive(id, payload); err != nil {
			t.Fatal("partage plein refusé", i, err)
		}
		l.FinishUpload(id, a)
	}
	if _, err := l.BeginUpload(a, "x3", 1); !errors.Is(err, ErrQuota) {
		t.Fatal("4ᵉ partage accepté", err)
	}
}

// Salon (plan C-2 Task 7, spec §39.3.6) : créations de salons, 5 par jour par connexion et
// 15 par /48 ; un refus n'est compté nulle part ; remise à zéro à minuit UTC.
func TestAllowSalonCreateJour(t *testing.T) {
	if SalonCreatesPer64 != 5 || SalonCreatesPer48 != 15 {
		t.Fatal(SalonCreatesPer64, SalonCreatesPer48)
	}
	now := time.Date(2026, 11, 4, 23, 0, 0, 0, time.UTC)
	l := newLim(&now)
	for i := 0; i < 5; i++ {
		// Deux adresses du même /64 partagent le compteur.
		if !l.AllowSalonCreate(ip(fmt.Sprintf("2001:db8:5:1::%x", i+1))) {
			t.Fatalf("création %d refusée", i+1)
		}
	}
	if l.AllowSalonCreate(ip("2001:db8:5:1::ff")) {
		t.Fatal("6e création du /64 acceptée")
	}
	// /48 découpé en /64 : 15 au plus pour le bloc.
	for p := 2; p <= 3; p++ {
		for i := 0; i < 5; i++ {
			if !l.AllowSalonCreate(ip(fmt.Sprintf("2001:db8:5:%x::1", p))) {
				t.Fatalf("/64 n° %d, création %d refusée", p, i+1)
			}
		}
	}
	if l.AllowSalonCreate(ip("2001:db8:5:ff::1")) {
		t.Fatal("/48 plein mais création acceptée depuis un /64 neuf")
	}
	if !l.AllowSalonCreate(ip("2001:db8:6::1")) || !l.AllowSalonCreate(ip("198.51.100.1")) {
		t.Fatal("autre bloc refusé")
	}
	// Une heure plus tard, même jour : toujours refusé ; minuit UTC : remis à zéro.
	now = time.Date(2026, 11, 4, 23, 59, 59, 0, time.UTC)
	if l.AllowSalonCreate(ip("2001:db8:5:1::1")) {
		t.Fatal("quota du jour remis à zéro avant minuit")
	}
	now = time.Date(2026, 11, 5, 0, 0, 0, 0, time.UTC)
	if !l.AllowSalonCreate(ip("2001:db8:5:1::1")) {
		t.Fatal("pas de remise à zéro à minuit UTC")
	}
	// Indépendant des créations de partages (compteurs à part).
	if ok, _ := l.AllowCreate(ip("2001:db8:5:1::1"), 1); !ok {
		t.Fatal("créations de partages touchées par les salons")
	}
}

// Entrées (rejoindre) : 20 par heure par connexion, 60 par /48, fenêtre horaire fixe UTC.
func TestAllowJoinHeure(t *testing.T) {
	if JoinsPer64 != 20 || JoinsPer48 != 60 {
		t.Fatal(JoinsPer64, JoinsPer48)
	}
	now := time.Date(2026, 11, 4, 10, 0, 0, 0, time.UTC)
	l := newLim(&now)
	for i := 0; i < 20; i++ {
		if !l.AllowJoin(ip(fmt.Sprintf("2001:db8:9:1::%x", i+1))) {
			t.Fatalf("entrée %d refusée", i+1)
		}
	}
	if l.AllowJoin(ip("2001:db8:9:1::ff")) {
		t.Fatal("21e entrée de l'heure acceptée")
	}
	for p := 2; p <= 3; p++ {
		for i := 0; i < 20; i++ {
			if !l.AllowJoin(ip(fmt.Sprintf("2001:db8:9:%x::1", p))) {
				t.Fatalf("/64 n° %d, entrée %d refusée", p, i+1)
			}
		}
	}
	if l.AllowJoin(ip("2001:db8:9:ff::1")) {
		t.Fatal("/48 plein mais entrée acceptée depuis un /64 neuf")
	}
	if !l.AllowJoin(ip("2001:db8:a::1")) {
		t.Fatal("autre /48 refusé")
	}
	// Fenêtre fixe : 10:59:59 encore refusé, 11:00:00 remis à zéro.
	now = time.Date(2026, 11, 4, 10, 59, 59, 0, time.UTC)
	if l.AllowJoin(ip("2001:db8:9:1::1")) {
		t.Fatal("remis à zéro avant l'heure")
	}
	now = time.Date(2026, 11, 4, 11, 0, 0, 0, time.UTC)
	if !l.AllowJoin(ip("2001:db8:9:1::1")) {
		t.Fatal("pas de remise à zéro à l'heure UTC")
	}
	if got := l.JoinRetry(); got != time.Hour {
		t.Fatalf("JoinRetry à 11:00:00 = %v", got)
	}
	now = time.Date(2026, 11, 4, 11, 59, 30, 0, time.UTC)
	if got := l.JoinRetry(); got != 30*time.Second {
		t.Fatalf("JoinRetry à 11:59:30 = %v", got)
	}
}

// Trames montantes : 480 par minute par connexion, 960 par /48 (revue finale C-2, I4 : une
// famille ou un bureau derrière un même NAT, environ 48 trames par minute et par membre actif).
func TestAllowFrameMinute(t *testing.T) {
	if FramesPer64 != 480 || FramesPer48 != 960 {
		t.Fatal(FramesPer64, FramesPer48)
	}
	now := time.Date(2026, 11, 4, 10, 0, 0, 0, time.UTC)
	l := newLim(&now)
	for i := 0; i < 480; i++ {
		if !l.AllowFrame(ip("2001:db8:b:1::1")) {
			t.Fatalf("trame %d refusée", i+1)
		}
	}
	if l.AllowFrame(ip("2001:db8:b:1::2")) {
		t.Fatal("481e trame de la minute acceptée")
	}
	for i := 0; i < 480; i++ {
		if !l.AllowFrame(ip("2001:db8:b:2::1")) {
			t.Fatalf("second /64, trame %d refusée", i+1)
		}
	}
	if l.AllowFrame(ip("2001:db8:b:ff::1")) {
		t.Fatal("/48 plein mais trame acceptée depuis un /64 neuf")
	}
	if !l.AllowFrame(ip("2001:db8:c::1")) {
		t.Fatal("autre /48 refusé")
	}
	// Indépendant des requêtes HTTP (compteur à part).
	if !l.AllowRequest(ip("2001:db8:b:1::1")) {
		t.Fatal("requêtes touchées par les trames")
	}
	now = now.Add(59 * time.Second)
	if l.AllowFrame(ip("2001:db8:b:1::1")) {
		t.Fatal("remis à zéro avant la minute")
	}
	now = now.Add(time.Second)
	if !l.AllowFrame(ip("2001:db8:b:1::1")) {
		t.Fatal("pas de remise à zéro à la minute")
	}
}

// IPv4 (revue finale C-2, I4) : l'adresse est à la fois la connexion et le bloc ; 480 trames
// par minute pour tout un NAT, la 481ᵉ refusée.
func TestAllowFrameIPv4(t *testing.T) {
	now := time.Date(2026, 11, 4, 10, 0, 0, 0, time.UTC)
	l := newLim(&now)
	for i := 0; i < 480; i++ {
		if !l.AllowFrame(ip("198.51.100.7")) {
			t.Fatalf("trame %d refusée", i+1)
		}
	}
	if l.AllowFrame(ip("198.51.100.7")) {
		t.Fatal("481e trame de la minute acceptée")
	}
}

// Les compteurs du salon sont oubliés à leur fenêtre (minute, heure, jour) : aucune clé de
// la veille ne survit.
func TestCompteursSalonEffaces(t *testing.T) {
	now := time.Date(2026, 11, 4, 23, 58, 10, 0, time.UTC)
	l := newLim(&now)
	lens := func() (minute, hour, day int) {
		l.mu.Lock()
		defer l.mu.Unlock()
		l.rotateLocked(now)
		return len(l.frame64) + len(l.frame48), len(l.join64) + len(l.join48), len(l.salon64) + len(l.salon48)
	}
	for _, a := range []string{"2001:db8:1:1::1", "198.51.100.9"} {
		l.AllowFrame(ip(a))
		l.AllowJoin(ip(a))
		l.AllowSalonCreate(ip(a))
	}
	if m, h, d := lens(); m != 4 || h != 4 || d != 4 {
		t.Fatal("compteurs non remplis", m, h, d)
	}
	now = now.Add(time.Minute) // 23:59:10
	if m, h, d := lens(); m != 0 || h != 4 || d != 4 {
		t.Fatal("minute", m, h, d)
	}
	now = time.Date(2026, 11, 5, 0, 0, 0, 0, time.UTC)
	if m, h, d := lens(); m != 0 || h != 0 || d != 0 {
		t.Fatal("minuit UTC", m, h, d)
	}
}

// Création refusée par le gestionnaire (service occupé) : le quota du jour est rendu, sans
// jamais descendre sous zéro ni toucher une autre connexion.
func TestRefundSalonCreate(t *testing.T) {
	now := time.Date(2026, 11, 12, 10, 0, 0, 0, time.UTC)
	l := newLim(&now)
	a := ip("2001:db8:7:1::1")
	for i := 0; i < SalonCreatesPer64; i++ {
		if !l.AllowSalonCreate(a) {
			t.Fatal("création", i+1)
		}
	}
	if l.AllowSalonCreate(a) {
		t.Fatal("6e création acceptée")
	}
	l.RefundSalonCreate(a)
	if !l.AllowSalonCreate(a) {
		t.Fatal("quota non rendu")
	}
	if l.AllowSalonCreate(a) {
		t.Fatal("rendu deux fois")
	}
	// Rendre sans création comptée : sans effet (aucun compteur négatif, aucune clé gardée).
	b := ip("198.51.100.77")
	l.RefundSalonCreate(b)
	l.mu.Lock()
	k64, k48 := l.keyLocked(b)
	_, ok64 := l.salon64[k64]
	_, ok48 := l.salon48[k48]
	l.mu.Unlock()
	if ok64 || ok48 {
		t.Fatal("compteur créé par un remboursement")
	}
	for i := 0; i < SalonCreatesPer64; i++ {
		if !l.AllowSalonCreate(b) {
			t.Fatal("autre connexion, création", i+1)
		}
	}
	if l.AllowSalonCreate(b) {
		t.Fatal("remboursement à vide compté comme crédit")
	}
}

// CleBloc : HMAC-SHA-256 du /48 (de l'adresse en IPv4) sous une clé de processus : même bloc →
// même clé, y compris après minuit ; autre bloc ou autre processus → autre clé ; jamais
// l'adresse en clair.
func TestCleBloc(t *testing.T) {
	now := time.Date(2026, 11, 12, 23, 59, 0, 0, time.UTC)
	l := newLim(&now)
	a := l.CleBloc(ip("2001:db8:9:1::1"))
	if a != l.CleBloc(ip("2001:db8:9:ffff::2")) {
		t.Fatal("même /48, clés différentes")
	}
	if a == l.CleBloc(ip("2001:db8:a::1")) {
		t.Fatal("autre /48, même clé")
	}
	v4 := l.CleBloc(ip("198.51.100.1"))
	if v4 == l.CleBloc(ip("198.51.100.2")) {
		t.Fatal("IPv4 : deux adresses, même clé")
	}
	if v4 != l.CleBloc(ip("::ffff:198.51.100.1")) {
		t.Fatal("IPv4 mappée : clé différente")
	}
	now = now.Add(2 * time.Minute) // lendemain : la clé ne tourne pas (salon de 24 h au plus)
	if a != l.CleBloc(ip("2001:db8:9:1::1")) {
		t.Fatal("clé changée à minuit")
	}
	if a == newLim(&now).CleBloc(ip("2001:db8:9:1::1")) {
		t.Fatal("deux processus, même clé")
	}
	if a == ([32]byte{}) {
		t.Fatal("clé nulle")
	}
}

// Pièce jointe du salon (BeginPiece) : pas une création de partage (le quota de 10 n'est ni
// consulté ni débité, même à travers minuit) ; ses octets utiles et sa place d'envoi en cours
// comptent comme ceux d'un partage.
func TestBeginPieceSansCreation(t *testing.T) {
	now := t0
	l := newLim(&now)
	a := ip("203.0.113.9")
	for i := range CreatesPer64 {
		id := fmt.Sprintf("p%d", i)
		if _, err := l.BeginUpload(a, id, 1); err != nil {
			t.Fatal("partage", i, err)
		}
		l.FinishUpload(id, a)
	}
	if _, err := l.BeginUpload(a, "trop", 1); !errors.Is(err, ErrQuota) {
		t.Fatal("11e partage :", err)
	}
	for i := range 3 * CreatesPer64 {
		id := fmt.Sprintf("piece%d", i)
		if _, err := l.BeginPiece(a, id, 1<<20); err != nil {
			t.Fatal("pièce", i, err)
		}
		if i%2 == 0 {
			l.FinishUpload(id, a)
		} else {
			l.CancelUpload(id) // rendue : jamais de création à rendre
		}
	}
	k64, _ := l.Key(a)
	l.mu.Lock()
	n, b := l.count64[k64], l.bytes64[k64]
	l.mu.Unlock()
	if n != CreatesPer64 || b != CreatesPer64+15<<20 {
		t.Fatal("créations, octets :", n, b)
	}
	// Envois en cours : 2 par connexion, pièces et partages confondus.
	for i := range PendingPer64 {
		if _, err := l.BeginPiece(a, fmt.Sprintf("enc%d", i), 0); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := l.BeginPiece(a, "enc9", 0); !errors.Is(err, ErrQuota) {
		t.Fatal("3e envoi en cours :", err)
	}
	// Octets du jour : refus au-delà de BytesPer64.
	l.CancelUpload("enc0")
	if _, err := l.BeginPiece(a, "gros", BytesPer64); !errors.Is(err, ErrQuota) {
		t.Fatal("octets :", err)
	}
	// Envoi en cours à cheval sur minuit : la pièce n'est pas recomptée comme création.
	now = time.Date(2026, 11, 5, 0, 0, 1, 0, time.UTC)
	l.Key(a) // rotation
	l.FinishUpload("enc1", a)
	k64, _ = l.Key(a)
	l.mu.Lock()
	n = l.count64[k64]
	l.mu.Unlock()
	if n != 0 {
		t.Fatal("pièce de la veille comptée comme création :", n)
	}
}

// Audit du 13 novembre, D2 : part équitable du stockage. Avec 20 Gio de stockage, une
// adresse ne réserve plus 6 Gio par jour, mais 20/8 = 2,5 Gio.
func TestPartEquitableStockage(t *testing.T) {
	now := t0
	l := newLim(&now)
	const gib = int64(1) << 30
	l.SetStorage(20 * gib)
	if _, err := l.BeginUpload(ip("1.2.3.4"), "a", 2*gib); err != nil {
		t.Fatal(err)
	}
	if _, err := l.BeginUpload(ip("1.2.3.4"), "b", gib); !errors.Is(err, ErrQuota) {
		t.Fatal("au-delà de 2,5 Gio :", err)
	}
	if _, err := l.Receive("a", 3*gib); !errors.Is(err, ErrQuota) {
		t.Fatal("reçus au-delà de 2,5 Gio :", err)
	}
	// 200 Gio (production) : les quotas par personne restent les plus bas.
	l.SetStorage(200 * gib)
	if _, err := l.BeginUpload(ip("5.6.7.8"), "c", 6*gib); err != nil {
		t.Fatal(err)
	}
}

func TestNouveauVenu(t *testing.T) {
	now := t0
	l := newLim(&now)
	a := ip("1.2.3.4")
	if !l.Newcomer(a) {
		t.Fatal("adresse neuve")
	}
	if _, err := l.BeginUpload(a, "a", 1); err != nil {
		t.Fatal(err)
	}
	l.CancelUpload("a") // création rendue : de nouveau rien aujourd'hui
	if !l.Newcomer(a) {
		t.Fatal("création annulée")
	}
	if _, err := l.BeginUpload(a, "b", 1); err != nil {
		t.Fatal(err)
	}
	if l.Newcomer(a) {
		t.Fatal("envoi en cours")
	}
	l.FinishUpload("b", a)
	if l.Newcomer(a) || !l.Newcomer(ip("1.2.3.5")) {
		t.Fatal("après une création")
	}
	now = now.Add(24 * time.Hour)
	if !l.Newcomer(a) {
		t.Fatal("jour suivant")
	}
}

// Point D8 du rapport de performance : SegmentsPerMin réglable (SHH_SEGMENTS_PER_MIN).
func TestSegmentRateReglable(t *testing.T) {
	now := t0
	l := newLim(&now)
	l.SetSegmentsPerMin(3)
	for range 3 {
		if !l.AllowSegment(ip("1.2.3.4")) {
			t.Fatal("refusé sous 3")
		}
	}
	if l.AllowSegment(ip("1.2.3.4")) {
		t.Fatal("4ᵉ accepté")
	}
	// /48 : 10 × 3.
	n := 0
	for p := range 20 {
		for range 3 {
			if l.AllowSegment(ip(fmt.Sprintf("2001:db8:9:%x::1", p))) {
				n++
			}
		}
	}
	if n != 30 {
		t.Fatal("/48 :", n)
	}
}
