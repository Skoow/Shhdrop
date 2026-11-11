package share

import "testing"

func TestPayloadBytes(t *testing.T) {
	tests := []struct {
		name string
		n    int64
		want int64
	}{
		{name: "rien", n: 0, want: 0},
		{name: "négatif", n: -5, want: 0},
		{name: "segment 0 plein (en-tête compris)", n: int64(SegmentSize(80, 0)), want: 64 * 65536},
		{name: "segment plein", n: int64(SegmentSize(80, 1)), want: 16 * 65536},
		{name: "un morceau", n: ChunkCT, want: 65536},
		{name: "en-tête seul", n: Header, want: 0},
		{name: "corps mal formé : 1 octet", n: Header + 1, want: 65536},
		{name: "corps mal formé : morceau + 49", n: ChunkCT + Header + 1, want: 2 * 65536},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := PayloadBytes(tt.n); got != tt.want {
				t.Fatalf("PayloadBytes(%d) = %d, want %d", tt.n, got, tt.want)
			}
		})
	}
	// Un partage plein : morceau du manifeste compris, ContentBytes + 64 Kio (non compté par
	// limits.ManifestChunk).
	var sum int64
	for n := 0; n < SegmentCount(32769); n++ {
		sum += PayloadBytes(int64(SegmentSize(32769, n)))
	}
	if sum != ContentBytes(32769)+65536 {
		t.Fatal(sum)
	}
}
