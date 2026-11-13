package share

// Audit de sécurité du 13 novembre, D8 : le dossier kill/ portait hex(V_accès) en nom de
// fichier, et ses dates n'étaient pas remises à l'epoch.

import (
	"encoding/hex"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestDemandeDeCoupureSansVAcces(t *testing.T) {
	s, _ := newSvc(t)
	if _, err := s.ensureKillKey(); err != nil { // premier passage du serveur
		t.Fatal(err)
	}
	admin := adminOf(t, s, 300*time.Millisecond)
	v := Verifier(rnd(32))
	done := make(chan error, 1)
	go func() { done <- admin.requestKill(v) }()
	dir := filepath.Join(filepath.Dir(s.FrozenFile), "kill")
	var names []string
	for end := time.Now().Add(time.Second); len(names) == 0 && time.Now().Before(end); time.Sleep(10 * time.Millisecond) {
		es, _ := os.ReadDir(dir)
		for _, e := range es {
			names = append(names, e.Name())
			if fi, err := e.Info(); err == nil && fi.ModTime().Unix() != 0 {
				t.Error("date de la demande :", fi.ModTime())
			}
		}
	}
	if len(names) != 1 {
		t.Fatal("demandes :", names)
	}
	if names[0] == hex.EncodeToString(v) {
		t.Fatal("hex(V_accès) en nom de fichier")
	}
	if err := <-done; err == nil {
		t.Fatal("aucun partage détaché : introuvable attendu")
	}
	for _, p := range []string{dir, s.killKeyFile()} {
		if fi, err := os.Stat(p); err != nil || fi.ModTime().Unix() != 0 {
			t.Fatal("date de", p, fi.ModTime(), err)
		}
	}
	// Nouvelle clé à chaque processus serveur : les noms d'avant ne se relient plus.
	s2 := adminOf(t, s, 0)
	k2, _ := s2.ensureKillKey()
	k1 := s.kill.key
	if string(k1) == string(k2) || killName(k1, v) == killName(k2, v) {
		t.Fatal("clé non renouvelée")
	}
}
