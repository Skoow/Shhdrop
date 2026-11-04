package api

import (
	"net/http/httptest"
	"net/netip"
	"testing"
)

func TestClientIP(t *testing.T) {
	cases := []struct {
		name, remote, shh, xff, want string
	}{
		{"distant ignore les en-têtes", "203.0.113.9:4444", "1.2.3.4", "1.2.3.4", "203.0.113.9"},
		{"local lit X-Shh-Client-IP", "127.0.0.1:5555", "1.2.3.4", "9.9.9.9", "1.2.3.4"},
		{"local ::1", "[::1]:5555", "2001:db8::1", "", "2001:db8::1"},
		{"local 127.0.0.0/8", "127.8.9.10:1", "1.2.3.4", "", "1.2.3.4"},
		{"local sans en-tête", "127.0.0.1:5555", "", "1.2.3.4", "127.0.0.1"},
		{"local en-tête invalide", "127.0.0.1:5555", "pas-une-ip", "1.2.3.4", "127.0.0.1"},
		{"local en-tête avec port", "127.0.0.1:5555", "1.2.3.4:80", "", "127.0.0.1"},
		{"IPv4 dans IPv6", "127.0.0.1:5555", "::ffff:1.2.3.4", "", "1.2.3.4"},
		{"distant IPv4 dans IPv6", "[::ffff:203.0.113.9]:1", "1.2.3.4", "", "203.0.113.9"},
		{"zone retirée", "127.0.0.1:1", "fe80::1%eth0", "", "fe80::1"},
		{"distant IPv6", "[2001:db8::5]:443", "1.2.3.4", "", "2001:db8::5"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			r := httptest.NewRequest("GET", "/", nil)
			r.RemoteAddr = c.remote
			if c.shh != "" {
				r.Header.Set("X-Shh-Client-IP", c.shh)
			}
			if c.xff != "" {
				r.Header.Set("X-Forwarded-For", c.xff)
			}
			if got := ClientIP(r); got != netip.MustParseAddr(c.want) {
				t.Fatalf("ClientIP = %v, attendu %v", got, c.want)
			}
		})
	}
}

func TestClientIPDuplicateHeader(t *testing.T) {
	r := httptest.NewRequest("GET", "/", nil)
	r.RemoteAddr = "127.0.0.1:1"
	r.Header.Add("X-Shh-Client-IP", "1.2.3.4")
	r.Header.Add("X-Shh-Client-IP", "5.6.7.8")
	if got := ClientIP(r); got != netip.MustParseAddr("127.0.0.1") {
		t.Fatalf("en-tête en double accepté : %v", got)
	}
}

func TestClientIPBadRemote(t *testing.T) {
	r := httptest.NewRequest("GET", "/", nil)
	r.RemoteAddr = "@"
	r.Header.Set("X-Shh-Client-IP", "1.2.3.4")
	if got := ClientIP(r); got.IsValid() {
		t.Fatalf("RemoteAddr illisible : %v", got)
	}
}
