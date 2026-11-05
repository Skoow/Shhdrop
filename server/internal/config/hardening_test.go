package config

import (
	"net/netip"
	"strings"
	"testing"
)

func env(t *testing.T, kv map[string]string) {
	t.Helper()
	for _, k := range []string{"SHH_DATA_DIR", "SHH_LISTEN", "SHH_STORAGE_MAX", "SHH_BEHIND_PROXY", "SHH_TRUSTED_PROXY", "SHH_STATIC_DIR"} {
		t.Setenv(k, kv[k])
	}
}

// Audit M3 : SHH_LISTEN=0.0.0.0:8080 (ou :8080) était accepté sans proxy.
func TestListenLoopbackOnly(t *testing.T) {
	for _, l := range []string{"127.0.0.1:8080", "127.0.0.1:0", "[::1]:8080", "localhost:8080", "127.5.6.7:1"} {
		env(t, map[string]string{"SHH_DATA_DIR": "/d", "SHH_LISTEN": l})
		if c, err := FromEnv(); err != nil || c.Listen != l {
			t.Fatalf("%q : %+v %v", l, c, err)
		}
	}
	for _, l := range []string{"0.0.0.0:8080", ":8080", "[::]:8080", "203.0.113.5:80", "exemple.org:80", "10.0.0.1:8080"} {
		env(t, map[string]string{"SHH_DATA_DIR": "/d", "SHH_LISTEN": l})
		if _, err := FromEnv(); err == nil {
			t.Fatalf("%q accepté sans proxy", l)
		}
		// SHH_BEHIND_PROXY=1 seul ne suffit pas : il faut aussi SHH_TRUSTED_PROXY.
		env(t, map[string]string{"SHH_DATA_DIR": "/d", "SHH_LISTEN": l, "SHH_BEHIND_PROXY": "1"})
		if _, err := FromEnv(); err == nil {
			t.Fatalf("%q accepté sans SHH_TRUSTED_PROXY", l)
		}
		env(t, map[string]string{"SHH_DATA_DIR": "/d", "SHH_LISTEN": l, "SHH_BEHIND_PROXY": "1", "SHH_TRUSTED_PROXY": "172.18.0.0/16"})
		if c, err := FromEnv(); err != nil || c.Listen != l {
			t.Fatalf("%q avec proxy : %+v %v", l, c, err)
		}
	}
	for _, l := range []string{"adresse-invalide", "127.0.0.1", "127.0.0.1:http", "127.0.0.1:99999", "127.0.0.1:-1", "127.0.0.1:"} {
		env(t, map[string]string{"SHH_DATA_DIR": "/d", "SHH_LISTEN": l})
		_, err := FromEnv()
		if err == nil || !strings.Contains(err.Error(), "SHH_LISTEN") {
			t.Fatalf("%q : %v", l, err)
		}
	}
}

func TestTrustedProxy(t *testing.T) {
	env(t, map[string]string{"SHH_DATA_DIR": "/d", "SHH_BEHIND_PROXY": "1", "SHH_TRUSTED_PROXY": "172.18.0.0/16, 2001:db8::/32"})
	c, err := FromEnv()
	if err != nil {
		t.Fatal(err)
	}
	want := []netip.Prefix{netip.MustParsePrefix("172.18.0.0/16"), netip.MustParsePrefix("2001:db8::/32")}
	if len(c.TrustedProxies) != 2 || c.TrustedProxies[0] != want[0] || c.TrustedProxies[1] != want[1] {
		t.Fatalf("%v", c.TrustedProxies)
	}
	for _, v := range []string{"172.18.0.1", "172.18.0.1/16", "pas-un-cidr", "172.18.0.0/16,", "0.0.0.0/0", "::/0"} {
		env(t, map[string]string{"SHH_DATA_DIR": "/d", "SHH_BEHIND_PROXY": "1", "SHH_TRUSTED_PROXY": v})
		if _, err := FromEnv(); err == nil {
			t.Fatalf("SHH_TRUSTED_PROXY=%q accepté", v)
		}
	}
	// Sans SHH_BEHIND_PROXY=1, SHH_TRUSTED_PROXY n'a pas de sens : refusé.
	env(t, map[string]string{"SHH_DATA_DIR": "/d", "SHH_TRUSTED_PROXY": "172.18.0.0/16"})
	if _, err := FromEnv(); err == nil {
		t.Fatal("SHH_TRUSTED_PROXY sans SHH_BEHIND_PROXY accepté")
	}
}

// Audit F5 : chemin relatif accepté.
func TestDataDirAbsolute(t *testing.T) {
	for _, d := range []string{"data", "./data", "../x", "~/shh"} {
		env(t, map[string]string{"SHH_DATA_DIR": d})
		if _, err := FromEnv(); err == nil {
			t.Fatalf("SHH_DATA_DIR=%q accepté", d)
		}
	}
	// Caractères qui changeraient le sens de l'URI SQLite (file:…?mode=rw).
	for _, d := range []string{"/a?mode=rwc", "/a#b", "/a%20b"} {
		env(t, map[string]string{"SHH_DATA_DIR": d})
		if _, err := FromEnv(); err == nil {
			t.Fatalf("SHH_DATA_DIR=%q accepté", d)
		}
	}
	env(t, map[string]string{"SHH_DATA_DIR": "/srv/shh/../shh/"})
	if c, err := FromEnv(); err != nil || c.DataDir != "/srv/shh" {
		t.Fatalf("%+v %v", c, err)
	}
	env(t, map[string]string{"SHH_DATA_DIR": "/d", "SHH_STATIC_DIR": "web/dist"})
	if _, err := FromEnv(); err == nil {
		t.Fatal("SHH_STATIC_DIR relatif accepté")
	}
}

// Audit F6 : « +5 » était accepté.
func TestStorageMaxCanonical(t *testing.T) {
	for _, v := range []string{"+5", " 5", "5 ", "0x10", "1e9", "05"} {
		env(t, map[string]string{"SHH_DATA_DIR": "/d", "SHH_STORAGE_MAX": v})
		if _, err := FromEnv(); err == nil {
			t.Fatalf("SHH_STORAGE_MAX=%q accepté", v)
		}
	}
}

// Tâche M, point 3 : CIDR IPv4 écrits en IPv6 et préfixes trop larges.
func TestTrustedProxyShape(t *testing.T) {
	for _, v := range []string{
		"::ffff:10.0.0.0/104", "::ffff:172.18.0.0/112", "::ffff:0:0/96", // IPv4-dans-IPv6
		"10.0.0.0/7", "128.0.0.0/1", "64.0.0.0/2", "192.0.0.0/4", "11.0.0.0/7", // IPv4 trop large et public
		"2000::/3", "2001::/16", "2001:db8::/31", // IPv6 trop large et public
		"fc00::/6", // dépasse fc00::/7
	} {
		env(t, map[string]string{"SHH_DATA_DIR": "/d", "SHH_BEHIND_PROXY": "1", "SHH_TRUSTED_PROXY": v})
		if _, err := FromEnv(); err == nil {
			t.Errorf("SHH_TRUSTED_PROXY=%q accepté", v)
		}
	}
	for _, v := range []string{
		"10.0.0.0/8", "172.16.0.0/12", "172.18.0.0/16", "192.168.0.0/16", "192.168.1.5/32", "127.0.0.0/8", "127.0.0.1/32",
		"fc00::/7", "fd12:3456::/32", "::1/128", "8.0.0.0/8", "203.0.113.0/24", "2001:db8::/32", "2001:db8:1::/48",
	} {
		env(t, map[string]string{"SHH_DATA_DIR": "/d", "SHH_BEHIND_PROXY": "1", "SHH_TRUSTED_PROXY": v})
		if _, err := FromEnv(); err != nil {
			t.Errorf("SHH_TRUSTED_PROXY=%q refusé : %v", v, err)
		}
	}
}
