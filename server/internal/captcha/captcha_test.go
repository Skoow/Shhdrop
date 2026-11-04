package captcha

import (
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/netip"
	"strconv"
	"strings"
	"testing"
	"time"

	altcha "github.com/altcha-org/altcha-lib-go"
)

var t0 = time.Date(2026, 11, 4, 12, 0, 0, 0, time.UTC)

var (
	ipA = netip.MustParseAddr("2001:db8:1:2::1")
	ipB = netip.MustParseAddr("2001:db8:1:3::1")
)

func newCap(now *time.Time) *Captcha {
	return New(bytes.Repeat([]byte{9}, 32), func() time.Time { return *now })
}

// solve trouve le nombre par force brute, comme le ferait le widget.
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

func payload(ch altcha.Challenge, n int64) string {
	b, _ := json.Marshal(map[string]any{"algorithm": ch.Algorithm, "challenge": ch.Challenge,
		"number": n, "salt": ch.Salt, "signature": ch.Signature, "took": 1234})
	return base64.StdEncoding.EncodeToString(b)
}

func solved(t *testing.T, c *Captcha, ip netip.Addr) (altcha.Challenge, string) {
	t.Helper()
	ch, err := c.Challenge(ip)
	if err != nil {
		t.Fatal(err)
	}
	return ch, payload(ch, solve(t, ch))
}

func TestChallengeFormat(t *testing.T) {
	now := t0
	c := newCap(&now)
	ch, err := c.Challenge(ipA)
	if err != nil {
		t.Fatal(err)
	}
	if ch.Algorithm != "SHA-256" || ch.MaxNumber != 50000 || len(ch.Signature) != 64 {
		t.Fatalf("défi : %+v", ch)
	}
	if !strings.HasSuffix(ch.Salt, "?expires="+strconv.FormatInt(t0.Add(2*time.Minute).Unix(), 10)) {
		t.Fatalf("expiration absente du sel : %q", ch.Salt)
	}
	// Compatibilité : la bibliothèque officielle accepte la solution.
	ok, err := altcha.VerifySolution(payload(ch, solve(t, ch)), string(c.sigKey), false)
	if err != nil || !ok {
		t.Fatalf("solution refusée par altcha-lib-go : %v %v", ok, err)
	}
}

func TestVerifyOnce(t *testing.T) {
	now := t0
	c := newCap(&now)
	_, p := solved(t, c, ipA)
	now = t0.Add(5 * time.Second)
	if err := c.Verify(p, ipA, "", t0); err != nil {
		t.Fatalf("premier usage : %v", err)
	}
	if err := c.Verify(p, ipA, "", t0); !errors.Is(err, ErrInvalid) {
		t.Fatalf("deuxième usage : %v", err)
	}
}

func TestHoneypot(t *testing.T) {
	now := t0
	c := newCap(&now)
	_, p := solved(t, c, ipA)
	now = t0.Add(5 * time.Second)
	if err := c.Verify(p, ipA, "x", t0); !errors.Is(err, ErrInvalid) {
		t.Fatalf("piège rempli : %v", err)
	}
	// Le refus n'a pas consommé le défi.
	if err := c.Verify(p, ipA, "", t0); err != nil {
		t.Fatalf("après piège : %v", err)
	}
}

func TestTooFast(t *testing.T) {
	now := t0
	c := newCap(&now)
	_, p := solved(t, c, ipA)
	now = t0.Add(2999 * time.Millisecond)
	if err := c.Verify(p, ipA, "", t0); !errors.Is(err, ErrInvalid) {
		t.Fatalf("moins de 3 s : %v", err)
	}
	if err := c.Verify(p, ipA, "", now.Add(time.Second)); !errors.Is(err, ErrInvalid) {
		t.Fatalf("affichage dans le futur : %v", err)
	}
	now = t0.Add(3 * time.Second)
	if err := c.Verify(p, ipA, "", t0); err != nil {
		t.Fatalf("3 s pile : %v", err)
	}
}

func TestExpired(t *testing.T) {
	now := t0
	c := newCap(&now)
	_, p := solved(t, c, ipA)
	now = t0.Add(2 * time.Minute)
	if err := c.Verify(p, ipA, "", t0); !errors.Is(err, ErrInvalid) {
		t.Fatalf("défi expiré : %v", err)
	}
}

func TestOtherClient(t *testing.T) {
	now := t0
	c := newCap(&now)
	_, p := solved(t, c, ipA)
	now = t0.Add(5 * time.Second)
	if err := c.Verify(p, ipB, "", t0); !errors.Is(err, ErrInvalid) {
		t.Fatalf("autre connexion : %v", err)
	}
	// Même /64 : accepté.
	if err := c.Verify(p, netip.MustParseAddr("2001:db8:1:2::ffff"), "", t0); err != nil {
		t.Fatalf("même /64 : %v", err)
	}
}

func TestOtherKey(t *testing.T) {
	now := t0
	c := newCap(&now)
	other := New(bytes.Repeat([]byte{1}, 32), func() time.Time { return now })
	_, p := solved(t, other, ipA)
	now = t0.Add(5 * time.Second)
	if err := c.Verify(p, ipA, "", t0); !errors.Is(err, ErrInvalid) {
		t.Fatalf("défi d'une autre clé : %v", err)
	}
}

func TestForged(t *testing.T) {
	now := t0
	c := newCap(&now)
	ch, err := c.Challenge(ipA)
	if err != nil {
		t.Fatal(err)
	}
	n := solve(t, ch)
	now = t0.Add(5 * time.Second)
	bad := []string{
		"", "%%%", base64.StdEncoding.EncodeToString([]byte("{")),
		payload(ch, n+1),
		payload(altcha.Challenge{Algorithm: "SHA-1", Challenge: ch.Challenge, Salt: ch.Salt, Signature: ch.Signature}, n),
		payload(altcha.Challenge{Algorithm: ch.Algorithm, Challenge: ch.Challenge, Salt: ch.Salt, Signature: strings.Repeat("0", 64)}, n),
		strings.Repeat("A", 10000),
	}
	// Déplacer un chiffre du nombre vers l'expiration (même chaîne hachée) : refusé.
	s := strconv.FormatInt(n, 10)
	if len(s) > 1 {
		shifted := ch
		shifted.Salt = ch.Salt + s[:1]
		m, _ := strconv.ParseInt(s[1:], 10, 64)
		if strconv.FormatInt(m, 10) == s[1:] {
			bad = append(bad, payload(shifted, m))
		}
	}
	// Défi recalculé avec un sel de notre choix (sans la clé) : refusé.
	forgedSalt := strings.Replace(ch.Salt, "?expires=", "x?expires=", 1)
	h := sha256.Sum256([]byte(forgedSalt + "1"))
	bad = append(bad, payload(altcha.Challenge{Algorithm: "SHA-256", Challenge: hex.EncodeToString(h[:]),
		Salt: forgedSalt, Signature: ch.Signature}, 1))
	for _, p := range bad {
		if err := c.Verify(p, ipA, "", t0); !errors.Is(err, ErrInvalid) {
			t.Fatalf("charge falsifiée acceptée : %q → %v", p, err)
		}
	}
	if err := c.Verify(payload(ch, n), ipA, "", t0); err != nil {
		t.Fatalf("vraie solution après les essais : %v", err)
	}
}

func TestDifficulty(t *testing.T) {
	now := t0
	c := newCap(&now)
	want := []int64{50000, 100000, 200000, 400000, 800000, 1600000, 1600000, 1600000}
	for i, w := range want {
		ch, err := c.Challenge(ipA)
		if err != nil {
			t.Fatal(err)
		}
		if ch.MaxNumber != w {
			t.Fatalf("après %d créations : maxNumber = %d, attendu %d", i, ch.MaxNumber, w)
		}
		c.RecordCreate(ipA)
		now = now.Add(time.Minute)
	}
	// Une autre connexion garde la difficulté de base.
	if ch, _ := c.Challenge(ipB); ch.MaxNumber != 50000 {
		t.Fatalf("autre connexion : %d", ch.MaxNumber)
	}
	// Une heure après la dernière création, tout est oublié.
	now = now.Add(time.Hour)
	if ch, _ := c.Challenge(ipA); ch.MaxNumber != 50000 {
		t.Fatalf("après une heure : %d", ch.MaxNumber)
	}
}

// Un défi facile obtenu avant une création ne sert plus après : la difficulté
// ne peut pas être contournée en stockant des défis à l'avance.
func TestStockpiledChallenge(t *testing.T) {
	now := t0
	c := newCap(&now)
	_, p1 := solved(t, c, ipA)
	_, p2 := solved(t, c, ipA)
	now = t0.Add(5 * time.Second)
	if err := c.Verify(p1, ipA, "", t0); err != nil {
		t.Fatal(err)
	}
	c.RecordCreate(ipA)
	if err := c.Verify(p2, ipA, "", t0); !errors.Is(err, ErrInvalid) {
		t.Fatalf("défi trop facile accepté : %v", err)
	}
	ch, p3 := solved(t, c, ipA)
	if ch.MaxNumber != 100000 {
		t.Fatalf("maxNumber = %d", ch.MaxNumber)
	}
	if err := c.Verify(p3, ipA, "", t0); err != nil {
		t.Fatalf("défi au bon niveau : %v", err)
	}
}

func TestUsedForgotten(t *testing.T) {
	now := t0
	c := newCap(&now)
	_, p := solved(t, c, ipA)
	now = t0.Add(5 * time.Second)
	if err := c.Verify(p, ipA, "", t0); err != nil {
		t.Fatal(err)
	}
	c.RecordCreate(ipA)
	now = t0.Add(2 * time.Hour)
	c.Challenge(ipB) // déclenche le nettoyage
	c.mu.Lock()
	defer c.mu.Unlock()
	if len(c.used) != 0 || len(c.creates) != 0 {
		t.Fatalf("mémoire non nettoyée : used=%d creates=%d", len(c.used), len(c.creates))
	}
}

func TestConcurrentSingleUse(t *testing.T) {
	now := t0
	c := newCap(&now)
	_, p := solved(t, c, ipA)
	now = t0.Add(5 * time.Second)
	res := make(chan error, 20)
	for i := 0; i < 20; i++ {
		go func() { res <- c.Verify(p, ipA, "", t0) }()
	}
	ok := 0
	for i := 0; i < 20; i++ {
		if <-res == nil {
			ok++
		}
	}
	if ok != 1 {
		t.Fatalf("%d usages acceptés", ok)
	}
}
