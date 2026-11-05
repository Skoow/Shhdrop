package share

import (
	"crypto/sha256"
	"errors"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/skoow/shhdrop/server/internal/blob"
	"github.com/skoow/shhdrop/server/internal/store"
)

// Audit F3 : le base64 de Go ignore \r et \n, même en mode Strict.
func TestValidIDCanonical(t *testing.T) {
	id := strings.Repeat("A", 22)
	if !validID(id) {
		t.Fatal("id valide refusé")
	}
	for _, bad := range []string{
		id[:11] + "\n" + id[11:],
		id[:11] + "\r\n" + id[11:],
		id + "\n",
		"\n" + id,
		strings.Repeat("A", 21) + "\n" + "A",
		id[:21],
		id + "A",
		id[:21] + "=",
	} {
		if validID(bad) {
			t.Fatalf("%q accepté", bad)
		}
	}
	// DecodeB64 : longueur exacte en caractères, alphabet base64url seulement.
	k := strings.Repeat("B", 42) + "A"
	if b, err := DecodeB64(k, 32); err != nil || len(b) != 32 {
		t.Fatal(b, err)
	}
	for _, bad := range []string{k[:20] + "\n" + k[20:], k[:42], k + "A", k[:42] + "=", k[:42] + "+", k[:20] + "\r" + k[21:]} {
		if _, err := DecodeB64(bad, 32); err == nil {
			t.Fatalf("%q accepté", bad)
		}
	}
	if _, err := DecodeB64(k[:22], 16); err == nil {
		t.Fatal("bits de bourrage non nuls acceptés") // 22e caractère « B » : bits de poids faible non nuls
	}
}

// Audit F4 : match(nil, SHA-256("")) valait vrai.
func TestMatchRequires32Bytes(t *testing.T) {
	empty := sha256.Sum256(nil)
	if match(nil, empty[:]) || match([]byte{}, empty[:]) {
		t.Fatal("entrée vide acceptée")
	}
	x := make([]byte, 31)
	h := sha256.Sum256(x)
	if match(x, h[:]) {
		t.Fatal("31 octets acceptés")
	}
	y := make([]byte, 32)
	h = sha256.Sum256(y)
	if !match(y, h[:]) {
		t.Fatal("32 octets refusés")
	}
}

func TestValidateRefusesEmptyHashVerifier(t *testing.T) {
	k := newKeys()
	empty := sha256.Sum256(nil)
	for i := 0; i < 2; i++ {
		r := k.req(1, 1, 1)
		if i == 0 {
			r.AccessV = empty[:]
		} else {
			r.ManageV = empty[:]
		}
		if err := Validate(r); !errors.Is(err, ErrBadRequest) {
			t.Fatalf("vérificateur %d = SHA-256(\"\") accepté", i)
		}
	}
	f := fin(k.req(1, 1, 1).ID)
	f.ProofV = empty[:]
	if err := ValidateFinalize(f); !errors.Is(err, ErrBadRequest) {
		t.Fatal("V_preuve = SHA-256(\"\") accepté")
	}
	// Scénario de l'audit : partage dont les vérificateurs valent SHA-256("") ; rien ne
	// le crée, et même inséré à la main, {"manage": n'importe quoi} ne le détruit pas.
	s, _ := newSvc(t)
	if _, _, err := s.Create(k.req(1, 1, 1)); err != nil {
		t.Fatal(err)
	}
	if _, err := s.DB.Exec(`UPDATE shares SET access_v=?, proof_v=?, manage_v=?`, empty[:], empty[:], empty[:]); err != nil {
		t.Fatal(err)
	}
	if err := s.DestroyManaged(nil); !errors.Is(err, ErrNotFound) {
		t.Fatal("détruit avec des secrets vides", err)
	}
	if _, err := s.Status(nil); !errors.Is(err, ErrNotFound) {
		t.Fatal("statut lu avec un secret vide", err)
	}
	if _, err := s.Meta(nil); !errors.Is(err, ErrNotFound) {
		t.Fatal("meta lu avec un secret vide", err)
	}
	if err := s.DestroyWithProof(nil, nil); !errors.Is(err, ErrNotFound) {
		t.Fatal("détruit avec des secrets vides", err)
	}
}

// Audit F10 : valeurs zéro dangereuses ; NewService valide la configuration.
func TestNewService(t *testing.T) {
	dir := t.TempDir()
	db, err := store.Open(filepath.Join(dir, "shares.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	good := Config{DB: db, Blobs: &blob.Store{Dir: filepath.Join(dir, "blobs")}, Now: time.Now,
		StorageMax: 1 << 30, FrozenFile: filepath.Join(dir, "frozen")}
	if s, err := NewService(good); err != nil || s.StorageMax != 1<<30 || s.FrozenFile != good.FrozenFile {
		t.Fatal(s, err)
	}
	bad := map[string]func(c *Config){
		"FrozenFile vide":    func(c *Config) { c.FrozenFile = "" },
		"FrozenFile relatif": func(c *Config) { c.FrozenFile = "frozen" },
		"StorageMax nul":     func(c *Config) { c.StorageMax = 0 },
		"StorageMax négatif": func(c *Config) { c.StorageMax = -1 },
		"DB absente":         func(c *Config) { c.DB = nil },
		"Blobs absent":       func(c *Config) { c.Blobs = nil },
		"Blobs.Dir vide":     func(c *Config) { c.Blobs = &blob.Store{} },
		"horloge absente":    func(c *Config) { c.Now = nil },
	}
	for name, f := range bad {
		c := good
		f(&c)
		if _, err := NewService(c); err == nil {
			t.Fatalf("%s : accepté", name)
		}
	}
	// Une valeur zéro construite sans NewService échoue fermé : gelée.
	var z Service
	if !z.Frozen() {
		t.Fatal("FrozenFile vide : le gel est désactivé (échec ouvert)")
	}
}

// S1 : après la dernière ouverture (draining), le destinataire peut encore détruire ou
// signaler le partage avec K_accès + K_preuve.
func TestDestroyWhileDraining(t *testing.T) {
	s, _ := newSvc(t)
	k := newKeys()
	id := ready(t, s, k, 1, 1, 1)
	if _, _, err := s.Unlock(id, k.acces, k.preuve); err != nil {
		t.Fatal(err)
	}
	var state string
	s.DB.QueryRow(`SELECT state FROM shares WHERE id=?`, id).Scan(&state)
	if state != "draining" {
		t.Fatal(state)
	}
	if err := s.DestroyWithProof(k.acces, rnd(32)); !errors.Is(err, ErrNotFound) {
		t.Fatal("mauvais K_preuve accepté", err)
	}
	if err := s.DestroyWithProof(k.acces, k.preuve); err != nil {
		t.Fatal(err)
	}
	gone(t, s, id)
}
