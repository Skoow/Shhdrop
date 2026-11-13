package config

import (
	"math"
	"strings"
	"testing"
)

func TestCapaciteCalculee(t *testing.T) {
	cas := []struct {
		nom    string
		mem    int64
		nofile uint64
		want   Capacity
	}{
		// Sans GOMEMLIMIT ni limite connue : valeurs d'avant le 13 novembre.
		{"sans limites", math.MaxInt64, 0, Capacity{64, 256, 256, 2000}},
		// compose.yaml : GOMEMLIMIT 900 Mio, nofile 65 536.
		{"production", 900 << 20, 65536, Capacity{67, 360, 360, 2000}},
		// 4 Gio de mémoire : 307 envois, 1 638 lectures.
		{"4 Gio", 4 << 30, 1 << 20, Capacity{307, 1638, 1638, 2000}},
		// Descripteurs rares : nofile / 8 par catégorie.
		{"1 024 descripteurs", 4 << 30, 1024, Capacity{128, 128, 128, 128}},
		// Très peu de mémoire : planchers.
		{"64 Mio", 64 << 20, 65536, Capacity{8, 25, 25, 2000}},
	}
	for _, c := range cas {
		if got := computeCapacity(c.mem, c.nofile); got != c.want {
			t.Errorf("%s : %+v, attendu %+v", c.nom, got, c.want)
		}
	}
}

func TestCapaciteReglee(t *testing.T) {
	t.Setenv("SHH_UPLOADS_MAX", "200")
	t.Setenv("SHH_DOWNLOADS_MAX", "1000")
	t.Setenv("SHH_WATCH_MAX", "50")
	t.Setenv("SHH_WS_MAX", "5000")
	c, err := capacityFromEnv(900<<20, 65536)
	if err != nil || c != (Capacity{200, 1000, 50, 5000}) {
		t.Fatal(c, err)
	}
	for _, v := range []string{"0", "-1", "012", "1e3", " 5", "x", "1048577"} {
		t.Setenv("SHH_UPLOADS_MAX", v)
		if _, err := capacityFromEnv(900<<20, 65536); err == nil || !strings.Contains(err.Error(), "SHH_UPLOADS_MAX") {
			t.Errorf("%q accepté : %v", v, err)
		}
	}
	// Plus de places que de descripteurs : refus au démarrage.
	t.Setenv("SHH_UPLOADS_MAX", "200")
	t.Setenv("SHH_DOWNLOADS_MAX", "129")
	if _, err := capacityFromEnv(900<<20, 1024); err == nil || !strings.Contains(err.Error(), "descripteurs") {
		t.Fatal("129 lectures pour 1 024 descripteurs acceptées :", err)
	}
}
