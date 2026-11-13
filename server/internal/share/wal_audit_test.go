package share

import (
	"bytes"
	"context"
	"database/sql"
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

// svcVidage : service sur une vraie base (store.Open), vidages regroupés en marche comme dans
// le serveur (store.Vidage.Run).
func svcVidage(t *testing.T) (*Service, *clock, string) {
	t.Helper()
	dir := t.TempDir()
	db, err := store.Open(filepath.Join(dir, "shares.db"))
	if err != nil {
		t.Fatal(err)
	}
	c := &clock{t: time.Date(2026, 11, 4, 10, 2, 0, 0, time.UTC)}
	s, err := NewService(Config{DB: db, Blobs: &blob.Store{Dir: filepath.Join(dir, "blobs")}, Now: c.Now,
		StorageMax: 1 << 40, FrozenFile: filepath.Join(dir, "frozen")})
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	fini := make(chan struct{})
	go func() { s.Vidage.Run(ctx); close(fini) }()
	t.Cleanup(func() { cancel(); <-fini; db.Close() })
	return s, c, dir
}

// reperes : ce qui identifie le partage id dans les fichiers de la base.
func reperes(t *testing.T, s *Service, id string, k keys) map[string][]byte {
	t.Helper()
	var salt, env []byte
	if err := s.DB.QueryRow(`SELECT salt, envelope FROM shares WHERE id=?`, id).Scan(&salt, &env); err != nil {
		t.Fatal(err)
	}
	return map[string][]byte{"id": []byte(id), "V_accès": sum(k.acces), "V_gestion": sum(k.gestion), "V_preuve": sum(k.preuve),
		"sel": salt, "enveloppe": env}
}

// restes : repères encore lisibles dans shares.db ou shares.db-wal.
func restes(dir string, r map[string][]byte) []string {
	var l []string
	for _, f := range []string{"shares.db", "shares.db-wal"} {
		data, _ := os.ReadFile(filepath.Join(dir, f))
		for nom, b := range r {
			if len(b) > 0 && bytes.Contains(data, b) {
				l = append(l, f+" : "+nom)
			}
		}
	}
	return l
}

// plusRien : au bout d'un délai borné (les vidages sont regroupés, un par seconde au plus),
// plus aucun repère dans la base ni dans le -wal.
func plusRien(t *testing.T, quoi, dir string, r map[string][]byte) {
	t.Helper()
	var l []string
	for fin := time.Now().Add(5 * time.Second); time.Now().Before(fin); time.Sleep(20 * time.Millisecond) {
		if l = restes(dir, r); len(l) == 0 {
			return
		}
	}
	t.Errorf("%s : encore lisible 5 s après l'effacement : %v", quoi, l)
}

// Audit adverse du 13 novembre, 2e passage, stockage, F1 : TOUT effacement d'un partage vide
// le WAL dans un délai borné, pas seulement la destruction explicite. Pour chaque chemin, le
// partage est d'abord replié dans shares.db (plus vieux qu'un passage du janitor : le cas
// courant), puis effacé ; ni shares.db ni shares.db-wal ne gardent son identifiant, ses
// vérificateurs, son sel ou son enveloppe.
func TestToutEffacementVideLeWAL(t *testing.T) {
	for nom, effacer := range map[string]func(t *testing.T, s *Service, c *clock, id string, k keys){
		"fin de téléchargement (Done)": func(t *testing.T, s *Service, c *clock, id string, k keys) {
			n, _, err := s.Unlock(id, k.acces, k.preuve)
			if err != nil {
				t.Fatal(err)
			}
			if err := s.Done(id, n); err != nil {
				t.Fatal(err)
			}
		},
		"5 essais faux": func(t *testing.T, s *Service, c *clock, id string, k keys) {
			for range 5 {
				s.Unlock(id, k.acces, rnd(32))
			}
		},
		"destruction par le créateur": func(t *testing.T, s *Service, c *clock, id string, k keys) {
			if err := s.DestroyManaged(k.gestion); err != nil {
				t.Fatal(err)
			}
		},
		"échéance balayée (Sweep)": func(t *testing.T, s *Service, c *clock, id string, k keys) {
			c.Add(25 * time.Hour)
			if _, err := s.Sweep(); err != nil {
				t.Fatal(err)
			}
		},
	} {
		t.Run(nom, func(t *testing.T) {
			s, c, dir := svcVidage(t)
			k := newKeys()
			id := ready(t, s, k, 1, 24, 1)
			r := reperes(t, s, id, k)
			if err := store.Checkpoint(s.DB); err != nil {
				t.Fatal(err)
			}
			if len(restes(dir, r)) == 0 {
				t.Fatal("témoin : partage vivant absent de shares.db, le test ne prouve rien")
			}
			effacer(t, s, c, id, k)
			if rowCount(t, s, id) != 0 {
				t.Fatal("partage non effacé")
			}
			plusRien(t, nom, dir, r)
		})
	}
}

// F1, réécriture sensible : à la finalisation, ttl_hours (qui, avec l'échéance, donnerait
// l'heure de création à 15 min près, spec §36 S11) est retiré de la ligne ; un vidage est
// demandé, pour que l'ancienne valeur ne reste pas dans le -wal jusqu'au passage du janitor.
func TestFinalisationDemandeUnVidage(t *testing.T) {
	s, _, dir := svcVidage(t)
	ready(t, s, newKeys(), 1, 24, 1)
	wal := filepath.Join(dir, "shares.db-wal")
	for fin := time.Now().Add(5 * time.Second); time.Now().Before(fin); time.Sleep(20 * time.Millisecond) {
		if fi, err := os.Stat(wal); err == nil && fi.Size() == 0 {
			return
		}
	}
	t.Fatal("WAL jamais vidé après une finalisation")
}

// F3 : un autre processus qui lit la base (sqlite3, outil de sauvegarde) ne fige plus une
// destruction 5 s : elle répond tout de suite, le vidage raté est compté (tableau de bord), et
// il est refait dès que le lecteur est parti.
func TestDestructionBaseOccupeeSansAttendre(t *testing.T) {
	s, _, dir := svcVidage(t)
	k := newKeys()
	id := ready(t, s, k, 1, 24, 1)
	r := reperes(t, s, id, k)
	other, err := sql.Open("sqlite", "file:"+filepath.Join(dir, "shares.db")+"?_pragma=busy_timeout(5000)")
	if err != nil {
		t.Fatal(err)
	}
	defer other.Close()
	other.SetMaxOpenConns(1)
	tx, err := other.Begin()
	if err != nil {
		t.Fatal(err)
	}
	var n int
	if err := tx.QueryRow(`SELECT count(*) FROM shares`).Scan(&n); err != nil {
		t.Fatal(err)
	}
	t0 := time.Now()
	if err := s.DestroyManaged(k.gestion); err != nil {
		t.Fatal(err)
	}
	if d := time.Since(t0); d > time.Second {
		t.Fatalf("destruction figée %v par un lecteur d'un autre processus", d)
	}
	if s.Vidage.Rates() < 1 {
		t.Fatal("vidage raté non compté")
	}
	if len(restes(dir, r)) == 0 {
		t.Fatal("témoin : WAL vidé malgré le lecteur")
	}
	tx.Rollback()
	plusRien(t, "après le départ du lecteur", dir, r)
}
