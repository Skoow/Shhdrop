package config

import "testing"

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
	if c.DataDir != "/tmp/x" || c.Listen != "127.0.0.1:8080" || c.StorageMaxBytes != 21474836480 {
		t.Fatalf("défauts inattendus: %+v", c)
	}
	if c.Now == nil || c.Now().IsZero() {
		t.Fatal("Now doit être renseigné")
	}
}

func TestFromEnvValeurs(t *testing.T) {
	t.Setenv("SHH_DATA_DIR", "/d")
	t.Setenv("SHH_LISTEN", "0.0.0.0:9")
	t.Setenv("SHH_STORAGE_MAX", "100")
	c, err := FromEnv()
	if err != nil || c.Listen != "0.0.0.0:9" || c.StorageMaxBytes != 100 {
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
