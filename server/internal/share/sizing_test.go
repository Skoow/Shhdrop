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

// Exports pour les pièces du salon (plan C-2 Task 13) : mêmes valeurs que les fonctions internes.
func TestExportsPieces(t *testing.T) {
	if TotalSize(8000) != 524416048 || TotalSize(1) != 65600 || TotalSize(16385) != totalSize(16385) {
		t.Fatal("TotalSize", TotalSize(8000), TotalSize(1))
	}
	if SegOffset(8000, 0) != 0 || SegOffset(8000, 1) != 48+64*65552 || SegOffset(8000, 124) != segOffset(8000, 124) {
		t.Fatal("SegOffset")
	}
	for _, c := range [][3]int{{0, 0, 2}, {1, 1, 2}, {1, 2, 3}, {0, 1, 3}, {1, 3, 3}, {2, 1, 4}, {-1, -1, 2}} {
		if ValidFill(c[0], c[1], c[2]) != validFill(c[0], c[1], c[2]) {
			t.Fatal("ValidFill", c)
		}
	}
	if !ValidFill(1, 2, 3) || ValidFill(0, 1, 3) || ValidFill(1, 3, 3) {
		t.Fatal("ValidFill : valeurs")
	}
}
