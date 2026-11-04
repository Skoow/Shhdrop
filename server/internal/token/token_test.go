package token

import (
	"bytes"
	"strings"
	"testing"
	"time"
)

var t0 = time.Date(2026, 11, 4, 12, 0, 0, 0, time.UTC)

func newSigner(now *time.Time) *Signer {
	return New(bytes.Repeat([]byte{7}, 32), func() time.Time { return *now })
}

func TestValid(t *testing.T) {
	now := t0
	s := newSigner(&now)
	tok := s.Issue('d', "abc_-123", 4, now.Add(time.Hour))
	n, err := s.Check(tok, 'd', "abc_-123")
	if err != nil || n != 4 {
		t.Fatalf("Check = %d, %v", n, err)
	}
}

func TestExpired(t *testing.T) {
	now := t0
	s := newSigner(&now)
	tok := s.Issue('u', "id1", 0, now.Add(time.Minute))
	now = t0.Add(time.Minute) // exp == now : refusé
	if _, err := s.Check(tok, 'u', "id1"); err == nil {
		t.Fatal("jeton expiré accepté")
	}
}

func TestWrongIDKind(t *testing.T) {
	now := t0
	s := newSigner(&now)
	tok := s.Issue('u', "id1", 0, now.Add(time.Hour))
	if _, err := s.Check(tok, 'u', "id2"); err == nil {
		t.Fatal("autre id accepté")
	}
	if _, err := s.Check(tok, 'd', "id1"); err == nil {
		t.Fatal("autre type accepté")
	}
}

func TestOtherKey(t *testing.T) {
	now := t0
	s := newSigner(&now)
	other := New(bytes.Repeat([]byte{8}, 32), func() time.Time { return now })
	tok := other.Issue('d', "id1", 1, now.Add(time.Hour))
	if _, err := s.Check(tok, 'd', "id1"); err == nil {
		t.Fatal("jeton d'une autre clé accepté")
	}
}

func TestTampered(t *testing.T) {
	now := t0
	s := newSigner(&now)
	tok := s.Issue('d', "id1", 1, now.Add(time.Hour))
	p, m, _ := strings.Cut(tok, ".")
	flip := func(x string) string {
		b := []byte(x)
		if b[0] == 'A' {
			b[0] = 'B'
		} else {
			b[0] = 'A'
		}
		return string(b)
	}
	// openN modifié dans la partie signée : il est couvert par le MAC.
	forged := s.Issue('d', "id1", 2, now.Add(time.Hour))
	fp, _, _ := strings.Cut(forged, ".")
	for _, bad := range []string{p + "." + flip(m), flip(p) + "." + m, fp + "." + m} {
		if _, err := s.Check(bad, 'd', "id1"); err == nil {
			t.Fatalf("jeton modifié accepté : %q", bad)
		}
	}
}

func TestMalformed(t *testing.T) {
	now := t0
	s := newSigner(&now)
	for _, bad := range []string{"", ".", "abc", "abc.", ".abc", "!!!.###", "a.b.c",
		strings.Repeat("A", 5000) + ".x", "AA.AA"} {
		if _, err := s.Check(bad, 'd', "id1"); err == nil {
			t.Fatalf("jeton malformé accepté : %q", bad)
		}
	}
}

// Une charge valide mais de longueur incohérente (signée avec la bonne clé) est refusée sans panique.
func TestBadLayoutSigned(t *testing.T) {
	now := t0
	s := newSigner(&now)
	for _, raw := range [][]byte{{}, {'d'}, {'d', 5, 'a'}, {'d', 0, 1, 2, 3}} {
		tok := s.encode(raw)
		if _, err := s.Check(tok, 'd', ""); err == nil {
			t.Fatalf("charge %v acceptée", raw)
		}
	}
}

func FuzzCheck(f *testing.F) {
	now := t0
	s := newSigner(&now)
	f.Add(s.Issue('d', "id1", 1, now.Add(time.Hour)))
	f.Add("x.y")
	f.Fuzz(func(t *testing.T, tok string) {
		_, _ = s.Check(tok, 'd', "id1")
	})
}

func TestCheckExp(t *testing.T) {
	now := t0
	s := newSigner(&now)
	exp := t0.Add(2 * time.Minute)
	tok := s.Issue(CaptchaShown, "captcha", 0, exp)
	n, got, err := s.CheckExp(tok, CaptchaShown, "captcha")
	if err != nil || n != 0 || !got.Equal(exp) {
		t.Fatalf("CheckExp = %d %v %v", n, got, err)
	}
	if _, got, err := s.CheckExp(tok, Upload, "captcha"); err == nil || !got.IsZero() {
		t.Fatal("type faux accepté")
	}
}

// Audit F8 : la comparaison à math.MaxUint32 ne compilait pas en 32 bits ; le jeton
// contenant \n (ignoré par le base64 de Go) est refusé.
func TestTokenRejectsNewline(t *testing.T) {
	now := t0
	s := newSigner(&now)
	tok := s.Issue('d', "id", 1, now.Add(time.Hour))
	for _, bad := range []string{tok[:5] + "\n" + tok[5:], tok + "\n", tok[:5] + "\r" + tok[5:]} {
		if _, err := s.Check(bad, 'd', "id"); err == nil {
			t.Fatalf("%q accepté", bad)
		}
	}
}
