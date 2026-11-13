package config

import (
	"strings"
	"testing"
)

func TestFromEnvSansDataDir(t *testing.T) {
	t.Setenv("SHH_DATA_DIR", "")
	if _, err := FromEnv(); err == nil {
		t.Fatal("erreur attendue sans SHH_DATA_DIR")
	}
}

func TestFromEnvDefauts(t *testing.T) {
	t.Setenv("SHH_DATA_DIR", "/tmp/x")
	t.Setenv("SHH_LISTEN", "")
	t.Setenv("SHH_STORAGE_MAX", "")
	c, err := FromEnv()
	if err != nil {
		t.Fatal(err)
	}
	if c.DataDir != "/tmp/x" || c.Listen != "127.0.0.1:8080" || c.StorageMaxBytes != 214748364800 { // 200 Gio (spec §24, §41.2)
		t.Fatalf("défauts inattendus: %+v", c)
	}
	if c.Now == nil || c.Now().IsZero() {
		t.Fatal("Now doit être renseigné")
	}
}

func TestFromEnvValeurs(t *testing.T) {
	t.Setenv("SHH_DATA_DIR", "/d")
	t.Setenv("SHH_LISTEN", "127.0.0.1:9")
	t.Setenv("SHH_STORAGE_MAX", "100")
	c, err := FromEnv()
	if err != nil || c.Listen != "127.0.0.1:9" || c.StorageMaxBytes != 100 {
		t.Fatalf("%+v %v", c, err)
	}
}

func TestFromEnvStorageMaxInvalide(t *testing.T) {
	t.Setenv("SHH_DATA_DIR", "/d")
	t.Setenv("SHH_STORAGE_MAX", "abc")
	if _, err := FromEnv(); err == nil {
		t.Fatal("erreur attendue")
	}
	t.Setenv("SHH_STORAGE_MAX", "-5")
	if _, err := FromEnv(); err == nil {
		t.Fatal("erreur attendue pour négatif")
	}
}

func TestFromEnvProxyEtStatique(t *testing.T) {
	t.Setenv("SHH_DATA_DIR", "/d")
	t.Setenv("SHH_BEHIND_PROXY", "")
	t.Setenv("SHH_STATIC_DIR", "")
	c, err := FromEnv()
	if err != nil || c.BehindProxy || c.StaticDir != "" {
		t.Fatalf("défauts: %+v %v", c, err)
	}
	t.Setenv("SHH_BEHIND_PROXY", "1")
	t.Setenv("SHH_STATIC_DIR", "/web/dist")
	c, err = FromEnv()
	if err != nil || !c.BehindProxy || c.StaticDir != "/web/dist" {
		t.Fatalf("valeurs: %+v %v", c, err)
	}
	t.Setenv("SHH_BEHIND_PROXY", "0")
	if c, err := FromEnv(); err != nil || c.BehindProxy {
		t.Fatalf("0: %+v %v", c, err)
	}
	for _, v := range []string{"true", "yes", "2", " 1"} {
		t.Setenv("SHH_BEHIND_PROXY", v)
		if _, err := FromEnv(); err == nil {
			t.Fatalf("%q accepté", v)
		}
	}
}

// Salon (plan C-2, Task 2) : désactivé par défaut, 200 salons vivants au plus (spec §39.3.2).
func TestSalonsDefautDesactive(t *testing.T) {
	env(t, map[string]string{"SHH_DATA_DIR": "/d"})
	c, err := FromEnv()
	if err != nil {
		t.Fatal(err)
	}
	if c.Salons || c.SalonsMax != 200 || c.Origin != "" {
		t.Fatalf("défauts du salon : Salons=%v SalonsMax=%d Origin=%q", c.Salons, c.SalonsMax, c.Origin)
	}
	env(t, map[string]string{"SHH_DATA_DIR": "/d", "SHH_SALONS": "0"})
	if c, err := FromEnv(); err != nil || c.Salons {
		t.Fatalf("SHH_SALONS=0 : %+v %v", c, err)
	}
	for _, v := range []string{"2", "true", " 1", "01"} {
		env(t, map[string]string{"SHH_DATA_DIR": "/d", "SHH_SALONS": v, "SHH_ORIGIN": "https://shhdrop.app"})
		if _, err := FromEnv(); err == nil {
			t.Errorf("SHH_SALONS=%q accepté", v)
		}
	}
	env(t, map[string]string{"SHH_DATA_DIR": "/d", "SHH_SALONS": "1", "SHH_ORIGIN": "https://shhdrop.app", "SHH_SALONS_MAX": "500"})
	c, err = FromEnv()
	if err != nil || !c.Salons || c.Origin != "https://shhdrop.app" || c.SalonsMax != 500 {
		t.Fatalf("salon activé : %+v %v", c, err)
	}
	// Audit adverse du 13 novembre, front serveur : SHH_SALONS_MAX est croisé avec la mémoire
	// au démarrage (checkSalons). 10 000 salons demandent un plafond global de trames à leur
	// mesure : refus sans lui, accepté avec ; sans effet si le salon est désactivé.
	env(t, map[string]string{"SHH_DATA_DIR": "/d", "SHH_SALONS": "1", "SHH_ORIGIN": "https://shhdrop.app", "SHH_SALONS_MAX": "10000"})
	if _, err := FromEnv(); err == nil || !strings.Contains(err.Error(), "SHH_SALONS_MAX=10000") {
		t.Fatal("10 000 salons sans la mémoire pour acceptés :", err)
	}
	t.Setenv("SHH_SALON_FRAMES_TOTAL", "20000000")
	if c, err = FromEnv(); err != nil || c.SalonsMax != 10000 {
		t.Fatalf("10 000 salons avec un plafond global à leur mesure : %+v %v", c, err)
	}
	t.Setenv("SHH_SALON_FRAMES_TOTAL", "")
	env(t, map[string]string{"SHH_DATA_DIR": "/d", "SHH_SALONS_MAX": "10000"})
	if c, err = FromEnv(); err != nil || c.Salons || c.SalonsMax != 10000 {
		t.Fatalf("salon désactivé : %+v %v", c, err)
	}
}

// Point 13 du plan : SHH_ORIGIN sert au contrôle d'Origin du WebSocket et à la CSP.
func TestOriginObligatoire(t *testing.T) {
	env(t, map[string]string{"SHH_DATA_DIR": "/d", "SHH_SALONS": "1"})
	if _, err := FromEnv(); err == nil {
		t.Fatal("SHH_SALONS=1 sans SHH_ORIGIN accepté")
	}
}

func TestOriginInvalide(t *testing.T) {
	for _, c := range []struct {
		v  string
		ok bool
	}{
		{"https://a.test/", false},
		{"https://a.test/x", false},
		{"ftp://a.test", false},
		{"http://a.test", false},
		{"https://a.test?x", false},
		{"https://user@a.test", false},
		{"https://a.test#x", false},
		{"https://a.test?", false},
		{"https://A.test", false},       // l'en-tête Origin est en minuscules
		{"HTTPS://a.test", false},       // idem
		{"https://a.test:443", false},   // le navigateur omet le port par défaut
		{"http://127.0.0.1:80", false},  // idem
		{"https://a.test:0", false},     // port hors limites
		{"https://a.test:65536", false}, // port hors limites
		{"https://a.test:08080", false}, // forme non canonique
		{"https://a.test:", false},
		{"https://a.test.", false},
		{"https://a..test", false},
		{"https://*.a.test", false},            // joker : il serait copié dans la CSP
		{"https://a.test;script-src", false},   // injection dans la CSP
		{"https://a.test wss://b.test", false}, // idem
		{"https://[::1]:8080", false},          // IPv6 : non pris en charge par la CSP (host-source)
		{"http://[::1]:8080", false},           // idem
		{"http://192.168.1.2:8080", false},     // http hors boucle locale
		{"https://", false},
		{"https:a.test", false},
		{"//a.test", false},
		{"a.test", false},
		{"https://shhdrop.app", true},
		{"https://shhdrop.app:8443", true},
		{"https://xn--bcher-kva.example", true},
		{"https://203.0.113.5", true},
		{"http://127.0.0.1:8080", true},
		{"http://localhost:5173", true},
		{"http://localhost", true},
	} {
		env(t, map[string]string{"SHH_DATA_DIR": "/d", "SHH_SALONS": "1", "SHH_ORIGIN": c.v})
		got, err := FromEnv()
		if c.ok && (err != nil || got.Origin != c.v) {
			t.Errorf("SHH_ORIGIN=%q refusé : %v", c.v, err)
		}
		if !c.ok && err == nil {
			t.Errorf("SHH_ORIGIN=%q accepté", c.v)
		}
	}
	// Une origine invalide est refusée même salon désactivé (erreur de configuration visible).
	env(t, map[string]string{"SHH_DATA_DIR": "/d", "SHH_ORIGIN": "https://a.test/"})
	if _, err := FromEnv(); err == nil {
		t.Error("SHH_ORIGIN invalide accepté avec SHH_SALONS=0")
	}
}

func TestSalonsMaxInvalide(t *testing.T) {
	for _, v := range []string{"0", "-1", "007", "x", "10001", "+5", " 5", "5 ", "1e3", "0x10"} {
		env(t, map[string]string{"SHH_DATA_DIR": "/d", "SHH_SALONS": "1", "SHH_ORIGIN": "https://shhdrop.app", "SHH_SALONS_MAX": v})
		if _, err := FromEnv(); err == nil {
			t.Errorf("SHH_SALONS_MAX=%q accepté", v)
		}
	}
	for _, v := range []string{"1", "50", "10000"} {
		env(t, map[string]string{"SHH_DATA_DIR": "/d", "SHH_SALONS_MAX": v})
		if _, err := FromEnv(); err != nil {
			t.Errorf("SHH_SALONS_MAX=%q refusé : %v", v, err)
		}
	}
}
