package api

import (
	"net/netip"
	"strings"
	"testing"
)

// Audit F2 : encoding/json ignore la casse des clés et garde le dernier doublon.
func TestJSONStrictKeys(t *testing.T) {
	e := newEnv(t, false, nil)
	k := newKeys()
	c := e.create(t, "", k, 1, 3)
	e.upload(t, c, 1)
	unlock := "/api/shares/" + c.ID + "/unlock"
	good := enc.EncodeToString(k.preuve)
	fake := enc.EncodeToString(rnd(32))
	for _, body := range []string{
		`{"proof":"` + fake + `","PROOF":"` + good + `"}`, // doublon (casse) : l'audit obtenait 200
		`{"proof":"` + fake + `","proof":"` + good + `"}`, // doublon exact
		`{"pRoOf":"` + good + `"}`,                        // casse différente
		`{"Proof":"` + good + `"}`,
	} {
		expect(t, e.do(req{method: "POST", path: unlock, hdr: access(k), body: []byte(body)}), 400, badRequest)
	}
	// Aucun essai consommé, aucune ouverture : la bonne forme passe toujours.
	e.unlock(t, c.ID, k)

	// Création : {"bucket":1,"Bucket":16000000} donnait 16000000 ; clés imbriquées vérifiées aussi.
	for _, mut := range []func(string) string{
		func(b string) string { return strings.Replace(b, `"bucket":1`, `"bucket":1,"Bucket":16`, 1) },
		func(b string) string { return strings.Replace(b, `"bucket":1`, `"BUCKET":1`, 1) },
		func(b string) string { return strings.Replace(b, `"ops":3`, `"ops":3,"OPS":10`, 1) },
		func(b string) string { return strings.Replace(b, `"ops":3`, `"Ops":3`, 1) },
	} {
		alt, shown := e.captchaFor(t, "")
		body := mut(string(mustJSON(k.createBody(1, 1, alt, shown))))
		expect(t, e.do(req{method: "POST", path: "/api/shares", body: []byte(body)}), 400, badRequest)
	}
	// Destruction : doublon de « manage » refusé, le partage reste.
	d := `{"manage":"` + fake + `","manage":"` + enc.EncodeToString(k.gestion) + `"}`
	expect(t, e.do(req{method: "POST", path: "/api/shares/" + c.ID + "/destroy", body: []byte(d)}), 400, badRequest)
	expect(t, e.do(req{method: "GET", path: "/api/shares/" + c.ID + "/meta", hdr: access(k)}), 200, "")
}

// Audit F3 : un « proof » contenant \n était accepté (200).
func TestSecretsRejectNewlines(t *testing.T) {
	e := newEnv(t, false, nil)
	k := newKeys()
	c := e.create(t, "", k, 1, 3)
	e.upload(t, c, 1)
	p := enc.EncodeToString(k.preuve)
	for _, bad := range []string{p[:20] + `\n` + p[20:], p[:20] + `\r\n` + p[20:], p + `\n`} {
		expect(t, e.do(req{method: "POST", path: "/api/shares/" + c.ID + "/unlock", hdr: access(k),
			body: []byte(`{"proof":"` + bad + `"}`)}), 400, badRequest)
	}
	a := enc.EncodeToString(k.acces)
	expect(t, e.do(req{method: "GET", path: "/api/shares/" + c.ID + "/meta",
		hdr: map[string]string{"X-Shh-Access": a[:21] + "\r" + a[21:]}}), 400, badRequest)
	// Identifiant avec \n dans le chemin (%0A) : introuvable, comme tout identifiant invalide.
	expect(t, e.do(req{method: "GET", path: "/api/shares/" + c.ID[:11] + "%0A" + c.ID[11:] + "/meta", hdr: access(k)}), 404, notFound)
}

// Audit M3 : derrière le proxy, seul un pair de SHH_TRUSTED_PROXY (ou local) est servi.
func TestBehindTrustedProxy(t *testing.T) {
	e := newEnvProxies(t, []netip.Prefix{netip.MustParsePrefix("172.18.0.0/16")})
	hdr := map[string]string{"X-Shh-Client-IP": "198.51.100.4"}
	expect(t, e.do(req{method: "GET", path: "/api/captcha", remote: "172.18.0.2:5000", hdr: hdr}), 200, "")
	expect(t, e.do(req{method: "GET", path: "/api/captcha", remote: "127.0.0.1:5000", hdr: hdr}), 200, "")
	expect(t, e.do(req{method: "GET", path: "/api/captcha", remote: "172.19.0.2:5000", hdr: hdr}), 500, `{"error":"internal"}`)
	expect(t, e.do(req{method: "GET", path: "/api/captcha", remote: "172.18.0.2:5000"}), 500, `{"error":"internal"}`)
}
