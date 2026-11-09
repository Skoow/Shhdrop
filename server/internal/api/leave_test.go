package api

import (
	"strings"
	"testing"
	"time"

	"github.com/skoow/shhdrop/server/internal/share"
)

// POST /api/shares/leave (D41-28) : jeton de téléchargement en Bearer, corps vide (motif
// fermé), réponse 204 vide sans écho ; seule la dernière ouverture arme la destruction.
func TestLeaveHTTP(t *testing.T) {
	e := newEnv(t, false, nil)
	leave := func(tok string, body []byte) req {
		return req{method: "POST", path: "/api/shares/leave", hdr: auth(tok), body: body}
	}
	k := newKeys()
	c := e.create(t, "", k, 1, 2)
	e.upload(t, c, 1)
	first, _ := e.unlock(t, c.ID, k)
	// Ouverture non dernière : 204, aucun effet.
	expect(t, e.do(leave(first, nil)), 204, "")
	if e.svc.LeaveCount() != 0 {
		t.Fatal("ouverture non dernière armée")
	}
	last, _ := e.unlock(t, c.ID, k)
	for name, r := range map[string]req{
		"corps":       leave(last, []byte("<script>")),
		"falsifié":    leave(last[:len(last)-2]+"AA", nil),
		"jeton envoi": leave(c.UploadToken, nil),
		"sans jeton":  {method: "POST", path: "/api/shares/leave"},
		"GET":         {method: "GET", path: "/api/shares/leave", hdr: auth(last)},
	} {
		w := e.do(r)
		if w.Code == 204 || strings.Contains(w.Body.String(), "script") || strings.Contains(w.Body.String(), last[:20]) {
			t.Fatal(name, w.Code, w.Body.String())
		}
	}
	if e.svc.LeaveCount() != 0 {
		t.Fatal("armé par une requête refusée")
	}
	w := e.do(leave(last, nil))
	expect(t, w, 204, "")
	if w.Body.Len() != 0 || e.svc.LeaveCount() != 1 {
		t.Fatal(w.Body.String(), e.svc.LeaveCount())
	}
	e.clk.Add(share.LeaveDelay * time.Second)
	if n, err := e.svc.SweepLeaves(); err != nil || n != 1 {
		t.Fatal(n, err)
	}
	expect(t, e.do(req{method: "GET", path: "/api/shares/meta", hdr: access(k)}), 404, "")
}
