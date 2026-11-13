package share

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/skoow/shhdrop/server/internal/blob"
	"github.com/skoow/shhdrop/server/internal/store"
)

// Audit adverse du 13 novembre, St1 : une destruction EXPLICITE (créateur, S_gestion) vide
// tout de suite shares.db-wal. Avant, les métadonnées du partage supprimé (V_accès, V_gestion,
// sel) y restaient jusqu'au prochain passage du janitor (≤ 60 s), lisibles à une saisie ou à
// un instantané du serveur EN MARCHE. Les destructions chaudes (fin de téléchargement, 5 essais)
// passent par retire() sans ce vidage, pour ne pas vider le WAL à chaque téléchargement.
func TestDestructionExpliciteVideLeWAL(t *testing.T) {
	dir := t.TempDir()
	db, err := store.Open(filepath.Join(dir, "shares.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	c := &clock{t: time.Date(2026, 11, 4, 10, 2, 0, 0, time.UTC)}
	s, err := NewService(Config{DB: db, Blobs: &blob.Store{Dir: filepath.Join(dir, "blobs")}, Now: c.Now,
		StorageMax: 1 << 40, FrozenFile: filepath.Join(dir, "frozen")})
	if err != nil {
		t.Fatal(err)
	}
	k := newKeys()
	ready(t, s, k, 1, 24, 1)
	acc, man := sum(k.acces), sum(k.gestion)
	wal := filepath.Join(dir, "shares.db-wal")
	// Partage vivant : ses vérificateurs sont dans le -wal (sanity : sinon le test ne prouve rien).
	if data, _ := os.ReadFile(wal); !bytes.Contains(data, acc) || !bytes.Contains(data, man) {
		t.Fatal("vérificateurs absents du -wal avant destruction : le test ne prouve rien")
	}
	if err := s.DestroyManaged(k.gestion); err != nil {
		t.Fatal("DestroyManaged :", err)
	}
	// Après destruction explicite : plus aucun vérificateur dans le -wal.
	data, err := os.ReadFile(wal)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(data, acc) {
		t.Fatal("V_accès encore dans shares.db-wal après destruction explicite")
	}
	if bytes.Contains(data, man) {
		t.Fatal("V_gestion encore dans shares.db-wal après destruction explicite")
	}
}
