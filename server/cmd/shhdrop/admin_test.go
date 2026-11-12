package main

import (
	"bytes"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/skoow/shhdrop/server/internal/blob"
	"github.com/skoow/shhdrop/server/internal/config"
	"github.com/skoow/shhdrop/server/internal/share"
	"github.com/skoow/shhdrop/server/internal/store"
)

func adminSetup(t *testing.T) (config.Config, *share.Service) {
	t.Helper()
	// Attente de la réponse du serveur (destroy, wipe) : écourtée, aucun serveur ne tourne ici.
	orig := adminKillWait
	adminKillWait = 300 * time.Millisecond
	t.Cleanup(func() { adminKillWait = orig })
	dir := t.TempDir()
	cfg := config.Config{DataDir: dir, Now: time.Now, StorageMaxBytes: 1 << 40}
	db, err := store.Open(filepath.Join(dir, "shares.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	s, err := share.NewService(share.Config{DB: db, Blobs: &blob.Store{Dir: filepath.Join(dir, "blobs")}, Now: time.Now,
		StorageMax: 1 << 40, FrozenFile: filepath.Join(dir, "frozen")})
	if err != nil {
		t.Fatal(err)
	}
	return cfg, s
}

// mk crée un envoi dont V_accès dérive d'une K_lien aléatoire, comme le client (spec
// §29.2) ; rend l'id interne et le lien de partage (spec §32).
func mk(t *testing.T, s *share.Service) string {
	id, _ := mkLink(t, s)
	return id
}

func mkLink(t *testing.T, s *share.Service) (string, string) {
	t.Helper()
	h := func() []byte { b := make([]byte, 8); rand.Read(b); x := sha256.Sum256(b); return x[:] }
	kLien := make([]byte, 32)
	rand.Read(kLien)
	link := "https://exemple.org/#" + base64.RawURLEncoding.EncodeToString(kLien)
	ka, ok := accessKeyOf(link)
	if !ok {
		t.Fatal("lien refusé")
	}
	id, _, err := s.Create(share.CreateReq{ID: share.NewID(), Bucket: 1, AccessV: share.Verifier(ka), ManageV: h()})
	if err != nil {
		t.Fatal(err)
	}
	return id, link
}

func count(t *testing.T, s *share.Service) int {
	var n int
	if err := s.DB.QueryRow("SELECT count(*) FROM shares").Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func run(cfg config.Config, args ...string) (int, string, string) {
	var o, e bytes.Buffer
	c := runAdmin(args, cfg, strings.NewReader(""), &o, &e)
	return c, o.String(), e.String()
}

// Spec §29.2 : K_accès = HKDF-SHA-256(K_lien, sel vide, « shhdrop/v2/acces »), 32 octets ;
// vecteur calculé par node:crypto hkdfSync (même construction que WebCrypto côté client).
func TestAccessKeyOfVector(t *testing.T) {
	const key = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8" // octets 0, 1, …, 31
	const want = "c021279bfb2924a22803b05414cc9b1e1f57d7ad6d4072caa74511c92108b8af"
	for _, in := range []string{key, "https://shhdrop.app/#" + key, "https://skoow.github.io/Shhdrop/#" + key} {
		ka, ok := accessKeyOf(in)
		if !ok || hex.EncodeToString(ka) != want {
			t.Fatalf("%q : %x %v", in, ka, ok)
		}
	}
	for _, bad := range []string{"", "#", key[:42], key + "A", "https://x/#m" + key, key[:42] + "*",
		"https://exemple.org/s/AAAAAAAAAAAAAAAAAAAAAA", "AAAAAAAAAAAAAAAAAAAAAA"} {
		if _, ok := accessKeyOf(bad); ok {
			t.Fatalf("%q accepté", bad)
		}
	}
}

func TestAdminDestroy(t *testing.T) {
	cfg, s := adminSetup(t)
	id, link := mkLink(t, s)
	other := mk(t, s)
	code, out, errOut := runIn(cfg, link+"\n", "destroy", "-")
	if code != 0 {
		t.Fatal(code, errOut)
	}
	key := link[strings.LastIndexByte(link, '#')+1:]
	if strings.Contains(out+errOut, key) || strings.Contains(out+errOut, id) {
		t.Fatal("la sortie reprend le lien")
	}
	if count(t, s) != 1 {
		t.Fatal("partage non détruit, ou un autre détruit")
	}
	if _, err := os.Stat(filepath.Join(s.Blobs.Dir, id)); err == nil {
		t.Fatal("fichier présent")
	}
	if _, err := os.Stat(filepath.Join(s.Blobs.Dir, other)); err != nil {
		t.Fatal("autre partage touché", err)
	}
	// Clé seule (sans l'adresse) : acceptée aussi.
	id2, link2 := mkLink(t, s)
	if code, _, errOut := runIn(cfg, link2[strings.LastIndexByte(link2, '#')+1:]+"\n", "destroy", "-"); code != 0 || rowExists(t, s, id2) {
		t.Fatal(code, errOut)
	}
	// Lien bien formé d'un partage inexistant : introuvable (code 1).
	code, _, errOut = runIn(cfg, link+"\n", "destroy", "-")
	if code != 1 || !strings.Contains(errOut, "introuvable") {
		t.Fatal(code, errOut)
	}
	// Spec §32 : le lien ne contient que la clé ; en argument, elle irait dans l'historique du
	// shell. Tout argument autre que « - » est une erreur d'usage, et rien n'est détruit.
	_, link3 := mkLink(t, s)
	for _, args := range [][]string{{"destroy", link3}, {"destroy", other}, {"destroy"}, {"destroy", "-", "x"}} {
		code, out, errOut := runIn(cfg, link3+"\n", args...)
		if code != 2 || strings.Contains(out+errOut, link3[len(link3)-43:]) {
			t.Fatalf("%v : code %d %q", args, code, errOut)
		}
	}
	if count(t, s) != 2 {
		t.Fatal("détruit malgré l'erreur d'usage")
	}
	for _, bad := range []string{"court", "https://exemple.org/s/AAAAAAAAAAAAAAAAAAAAAA#k", "../../etc/passwd", other} {
		if code, _, _ := runIn(cfg, bad+"\n", "destroy", "-"); code != 2 {
			t.Fatalf("%q: code %d", bad, code)
		}
	}
}

func rowExists(t *testing.T, s *share.Service, id string) bool {
	t.Helper()
	var n int
	if err := s.DB.QueryRow("SELECT count(*) FROM shares WHERE id=?", id).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n != 0
}

func TestAdminWipe(t *testing.T) {
	cfg, s := adminSetup(t)
	id1, id2 := mk(t, s), mk(t, s)
	code, _, errOut := run(cfg, "wipe")
	if code != 2 || !strings.Contains(errOut, "tous les partages et tous les salons") || count(t, s) != 2 {
		t.Fatal("wipe sans --yes doit refuser", code)
	}
	if _, err := os.Stat(filepath.Join(cfg.DataDir, "frozen")); err == nil {
		t.Fatal("wipe refusé ne doit pas geler")
	}
	code, out, e := run(cfg, "wipe", "--yes")
	if code != 0 {
		t.Fatal(code, e)
	}
	// Le gel est posé avant l'effacement et laissé en place : aucune création pendant
	// ni après le wipe, jusqu'à un unfreeze explicite.
	if fi, err := os.Stat(filepath.Join(cfg.DataDir, "frozen")); err != nil || fi.Mode().Perm() != 0o600 {
		t.Fatal("fichier de gel absent après wipe", err)
	}
	if !strings.Contains(out, "suspendues") || !strings.Contains(out, "unfreeze") {
		t.Fatalf("sortie : %q", out)
	}
	if _, _, err := s.Create(share.CreateReq{}); !errors.Is(err, share.ErrFrozen) {
		t.Fatal("création acceptée après wipe")
	}
	if count(t, s) != 0 {
		t.Fatal("lignes restantes")
	}
	for _, id := range []string{id1, id2} {
		if _, err := os.Stat(filepath.Join(s.Blobs.Dir, id)); err == nil {
			t.Fatal("fichier restant")
		}
	}
}

func TestAdminFreeze(t *testing.T) {
	cfg, _ := adminSetup(t)
	f := filepath.Join(cfg.DataDir, "frozen")
	if code, _, e := run(cfg, "freeze"); code != 0 {
		t.Fatal(code, e)
	}
	fi, err := os.Stat(f)
	if err != nil || fi.Mode().Perm() != 0o600 {
		t.Fatal(err, fi)
	}
	if code, _, _ := run(cfg, "freeze"); code != 0 {
		t.Fatal("freeze idempotent")
	}
	if code, _, e := run(cfg, "unfreeze"); code != 0 {
		t.Fatal(code, e)
	}
	if _, err := os.Stat(f); err == nil {
		t.Fatal("fichier encore là")
	}
	if code, _, _ := run(cfg, "unfreeze"); code != 0 {
		t.Fatal("unfreeze idempotent")
	}
}

func TestAdminUsage(t *testing.T) {
	cfg, _ := adminSetup(t)
	for _, a := range [][]string{{}, {"inconnu"}, {"freeze", "x"}, {"wipe", "--yes", "x"}} {
		if code, _, _ := run(cfg, a...); code != 2 {
			t.Fatalf("%v: code %d", a, code)
		}
	}
}
