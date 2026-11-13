package config

import (
	"math"
	"os"
	"path/filepath"
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
		// Sans GOMEMLIMIT ni limite connue : valeurs d'avant le 13 novembre (plafond global des
		// trames : defaultSalonFramesTotal).
		{"sans limites", math.MaxInt64, 0, Capacity{64, 256, 256, 2000, 64, 1500, 100000, 1000000, 16}},
		// compose.yaml : GOMEMLIMIT 900 Mio, nofile 65 536 (plafond global = 10 % / 48 o).
		{"production", 900 << 20, 65536, Capacity{67, 360, 360, 2000, 64, 1500, 100000, 1966080, 16}},
		// 4 Gio de mémoire : 307 envois, 1 638 lectures, le plafond global monte avec la mémoire.
		{"4 Gio", 4 << 30, 1 << 20, Capacity{307, 1638, 1638, 2000, 64, 1500, 100000, 8947848, 16}},
		// Descripteurs rares : nofile / 8 par catégorie (sans effet sur le plafond global).
		{"1 024 descripteurs", 4 << 30, 1024, Capacity{128, 128, 128, 128, 64, 1500, 100000, 8947848, 16}},
		// Très peu de mémoire : planchers.
		{"64 Mio", 64 << 20, 65536, Capacity{8, 25, 25, 2000, 64, 1500, 100000, 139810, 16}},
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
	t.Setenv("SHH_DISK_OPS_MAX", "16")
	t.Setenv("SHH_SEGMENTS_PER_MIN", "600")
	t.Setenv("SHH_SALON_FRAMES_MAX", "20000")
	// Plafond global réglé au-dessus de capMax (il monte avec la mémoire : borne framesTotalMax).
	t.Setenv("SHH_SALON_FRAMES_TOTAL", "3000000")
	c, err := capacityFromEnv(900<<20, 65536)
	if err != nil || c != (Capacity{200, 1000, 50, 5000, 16, 600, 20000, 3000000, 4}) {
		t.Fatal(c, err)
	}
	for _, v := range []string{"0", "-1", "012", "1e3", " 5", "x", "1048577"} {
		t.Setenv("SHH_UPLOADS_MAX", v)
		if _, err := capacityFromEnv(900<<20, 65536); err == nil || !strings.Contains(err.Error(), "SHH_UPLOADS_MAX") {
			t.Errorf("%q accepté : %v", v, err)
		}
	}
	t.Setenv("SHH_UPLOADS_MAX", "200")
	// Plafond global hors bornes (au-delà de framesTotalMax) : refus.
	t.Setenv("SHH_SALON_FRAMES_TOTAL", "134217729")
	if _, err := capacityFromEnv(900<<20, 65536); err == nil || !strings.Contains(err.Error(), "SHH_SALON_FRAMES_TOTAL") {
		t.Errorf("plafond global hors bornes accepté : %v", err)
	}
	t.Setenv("SHH_SALON_FRAMES_TOTAL", "3000000")
	// Plus de places que de descripteurs : refus au démarrage.
	t.Setenv("SHH_UPLOADS_MAX", "200")
	t.Setenv("SHH_DOWNLOADS_MAX", "129")
	if _, err := capacityFromEnv(900<<20, 1024); err == nil || !strings.Contains(err.Error(), "descripteurs") {
		t.Fatal("129 lectures pour 1 024 descripteurs acceptées :", err)
	}
}

// Audit adverse du 13 novembre, front serveur (F2) : contrôle croisé au démarrage entre les
// fils du système que les appels de fichiers peuvent tenir (partages et pièces, écritures et
// lectures des conversations) et pids_limit. Les valeurs par défaut tiennent sous le
// pids_limit de compose.yaml (1 024) ; une valeur réglée trop haut refuse le démarrage, avec
// un message qui dit quoi changer ; limite inconnue : pas de contrôle.
func TestFilsDuDisqueContrePids(t *testing.T) {
	c := computeCapacity(900<<20, 65536)
	if c.ConvDiskOps != 16 || c.DiskThreads() != 96 {
		t.Fatal("fils par défaut :", c.ConvDiskOps, c.DiskThreads())
	}
	if err := checkThreads(c, 1024); err != nil {
		t.Fatal("valeurs par défaut refusées sous pids_limit 1 024 :", err)
	}
	if err := checkThreads(c, 0); err != nil {
		t.Fatal("limite inconnue :", err)
	}
	if err := checkThreads(c, 192); err != nil {
		t.Fatal("96 fils pour 192 (la moitié juste) :", err)
	}
	err := checkThreads(c, 191)
	if err == nil || !strings.Contains(err.Error(), "SHH_DISK_OPS_MAX") || !strings.Contains(err.Error(), "pids_limit (191)") {
		t.Fatal("96 fils pour pids_limit 191 acceptés :", err)
	}
	t.Setenv("SHH_DISK_OPS_MAX", "512")
	c, err = capacityFromEnv(900<<20, 65536)
	if err != nil || c.ConvDiskOps != 128 || c.DiskThreads() != 768 {
		t.Fatal(c, err)
	}
	if err := checkThreads(c, 1024); err == nil {
		t.Fatal("768 fils du disque acceptés sous pids_limit 1 024")
	}
	t.Setenv("SHH_DISK_OPS_MAX", "1")
	if c, err = capacityFromEnv(900<<20, 65536); err != nil || c.ConvDiskOps != 1 {
		t.Fatal(c, err)
	}
}

// pidsMax : entier du fichier du cgroup ; « max », fichier absent ou contenu inattendu : 0.
func TestPidsMaxLu(t *testing.T) {
	dir := t.TempDir()
	for contenu, attendu := range map[string]int{"1024\n": 1024, "max\n": 0, "": 0, "-5": 0, "12x": 0, "256": 256} {
		f := filepath.Join(dir, "pids.max")
		if err := os.WriteFile(f, []byte(contenu), 0o600); err != nil {
			t.Fatal(err)
		}
		if got := pidsMax(f); got != attendu {
			t.Errorf("%q : %d, attendu %d", contenu, got, attendu)
		}
	}
	if got := pidsMax(filepath.Join(dir, "absent")); got != 0 {
		t.Error("fichier absent :", got)
	}
}

// Audit adverse du 13 novembre, front serveur (hypothèse H1 et garde-fou de démarrage) :
// SHH_SALONS_MAX croisé avec la mémoire. La configuration livrée (900 Mio, 200 salons) passe ;
// 10 000 salons avec 900 Mio sont refusés (journaux : ≈ 2,4 Gio) ; un plafond global trop
// petit pour garantir une part à chaque salon est refusé.
func TestSalonsContreMemoire(t *testing.T) {
	c := computeCapacity(900<<20, 65536)
	if err := checkSalons(200, c, 900<<20); err != nil {
		t.Fatal("configuration livrée refusée :", err)
	}
	if part := SalonFramesShare(c.SalonFramesTotal, 200, c.SalonFrames); part != 4915 {
		t.Fatal("part par salon :", part)
	}
	if err := checkSalons(360, c, 900<<20); err != nil {
		t.Fatal("360 salons (journaux : 90 Mio, 10 % de 900 Mio) :", err)
	}
	if err := checkSalons(361, c, 900<<20); err == nil || !strings.Contains(err.Error(), "au plus 360 salons") {
		t.Fatal("361 salons pour 900 Mio acceptés :", err)
	}
	err := checkSalons(10000, c, 900<<20)
	if err == nil || !strings.Contains(err.Error(), "SHH_SALONS_MAX=10000") || !strings.Contains(err.Error(), "GOMEMLIMIT") {
		t.Fatal("10 000 salons pour 900 Mio acceptés :", err)
	}
	// Sans GOMEMLIMIT : seul le contrôle de la part reste (1 000 000 de trames : 500 salons au plus).
	sans := computeCapacity(math.MaxInt64, 0)
	if err := checkSalons(500, sans, math.MaxInt64); err != nil {
		t.Fatal(err)
	}
	if err := checkSalons(501, sans, math.MaxInt64); err == nil || !strings.Contains(err.Error(), "trames garanties") {
		t.Fatal("part sous le minimum acceptée :", err)
	}
	// Plafond par salon plus petit que le minimum : la part vaut ce plafond, accepté.
	petit := sans
	petit.SalonFrames = 50
	if err := checkSalons(200, petit, math.MaxInt64); err != nil {
		t.Fatal(err)
	}
}
