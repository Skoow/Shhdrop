package share

import (
	"bytes"
	"testing"
)

// Fuzz du décodage des secrets (base64url sans bourrage, forme canonique) : jamais de
// panique ; une valeur acceptée fait exactement n octets et se réencode à l'identique (une
// seule écriture possible pour un secret : pas de variante \r\n, de bourrage ni de bits de
// fin non nuls).
func FuzzDecodeB64(f *testing.F) {
	for _, s := range []string{"", "AAAA", "AAAAAAAAAAAAAAAAAAAAAA", "AAAAAAAAAAAAAAAAAAAAAB", "AAAAAAAAAAAAAAAAAAAA\r\n",
		"AAAAAAAAAAAAAAAAAAAAAA==", "+/AAAAAAAAAAAAAAAAAAAA", "__________________________________________8"} {
		for _, n := range []int{16, 32, 48} {
			f.Add(s, n)
		}
	}
	f.Fuzz(func(t *testing.T, s string, n int) {
		if n < 0 || n > 1<<16 {
			return
		}
		b, err := DecodeB64(s, n)
		if err != nil {
			return
		}
		if len(b) != n {
			t.Fatalf("%d octets pour n = %d", len(b), n)
		}
		if got := b64.EncodeToString(b); got != s {
			t.Fatalf("forme non canonique acceptée : %q (réencodé %q)", s, got)
		}
		if b2, err := DecodeB64(s, n); err != nil || !bytes.Equal(b, b2) {
			t.Fatal("décodage instable")
		}
	})
}
