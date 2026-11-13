package store

import (
	"context"
	"database/sql"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func baseVidage(t *testing.T) (*sql.DB, string) {
	t.Helper()
	dir := t.TempDir()
	db, err := Open(filepath.Join(dir, "shares.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	return db, dir
}

func tailleWAL(t *testing.T, dir string) int64 {
	t.Helper()
	fi, err := os.Stat(filepath.Join(dir, "shares.db-wal"))
	if err != nil {
		t.Fatal(err)
	}
	return fi.Size()
}

func ecrire(t *testing.T, db *sql.DB) {
	t.Helper()
	if _, err := db.Exec(`CREATE TABLE IF NOT EXISTS essai(x); INSERT INTO essai VALUES (1)`); err != nil {
		t.Fatal(err)
	}
}

// lecteurExterne : une autre connexion (autre processus : sqlite3, sauvegarde) qui tient une
// transaction de lecture ; rend la fonction qui la termine.
func lecteurExterne(t *testing.T, dir string) (partir func()) {
	t.Helper()
	other, err := sql.Open("sqlite", "file:"+filepath.Join(dir, "shares.db")+"?_pragma=busy_timeout(5000)")
	if err != nil {
		t.Fatal(err)
	}
	other.SetMaxOpenConns(1)
	tx, err := other.Begin()
	if err != nil {
		t.Fatal(err)
	}
	var n int
	if err := tx.QueryRow(`SELECT count(*) FROM shares`).Scan(&n); err != nil {
		t.Fatal(err)
	}
	fait := false
	partir = func() {
		if !fait {
			fait = true
			tx.Rollback()
			other.Close()
		}
	}
	t.Cleanup(partir)
	return partir
}

// Audit adverse du 13 novembre, stockage, F1 : un vidage demandé est fait par Run sans que
// l'appelant attende ; plusieurs demandes rapprochées ne font qu'un vidage par intervalle ;
// une valeur nil ne fait rien.
func TestVidageRegroupe(t *testing.T) {
	var absent *Vidage
	absent.Demander()
	if absent.Maintenant() != nil || absent.Rates() != 0 {
		t.Fatal("Vidage nil")
	}
	db, dir := baseVidage(t)
	v := NewVidage(db)
	ctx, cancel := context.WithCancel(context.Background())
	fini := make(chan struct{})
	go func() { v.Run(ctx); close(fini) }()
	defer func() { cancel(); <-fini }()
	ecrire(t, db)
	if tailleWAL(t, dir) == 0 {
		t.Fatal("témoin : WAL vide après une écriture")
	}
	t0 := time.Now()
	for range 1000 {
		v.Demander()
	}
	if d := time.Since(t0); d > 100*time.Millisecond {
		t.Fatal("Demander a attendu :", d)
	}
	attendre(t, "premier vidage", func() bool { return tailleWAL(t, dir) == 0 })
	// Nouvelle écriture juste après : le vidage suivant n'a lieu qu'après l'intervalle.
	ecrire(t, db)
	v.Demander()
	time.Sleep(VidageIntervalle / 4)
	if tailleWAL(t, dir) == 0 {
		t.Fatal("second vidage avant la fin de l'intervalle (pas de regroupement)")
	}
	attendre(t, "second vidage", func() bool { return tailleWAL(t, dir) == 0 })
	if v.Rates() != 0 {
		t.Fatal("vidages ratés :", v.Rates())
	}
}

// F3 : un lecteur d'un autre processus ne fige pas le vidage plus que l'attente courte ; le
// vidage raté est compté, puis refait par Run une fois le lecteur parti ; l'attente habituelle
// de la connexion (5 s) est remise.
func TestVidageBaseOccupee(t *testing.T) {
	db, dir := baseVidage(t)
	v := NewVidage(db)
	ecrire(t, db)
	partir := lecteurExterne(t, dir)
	t0 := time.Now()
	err := v.Maintenant()
	if d := time.Since(t0); !errors.Is(err, ErrCheckpointBusy) || d > time.Second {
		t.Fatalf("vidage, base occupée : %v en %v (attendu ErrCheckpointBusy en 100 ms environ)", err, d)
	}
	if v.Rates() != 1 {
		t.Fatal("vidage raté non compté :", v.Rates())
	}
	var ms int
	if err := db.QueryRow(`PRAGMA busy_timeout`).Scan(&ms); err != nil || ms != 5000 {
		t.Fatal("attente de la connexion non remise :", ms, err)
	}
	if tailleWAL(t, dir) == 0 {
		t.Fatal("témoin : WAL vidé malgré le lecteur")
	}
	ctx, cancel := context.WithCancel(context.Background())
	fini := make(chan struct{})
	go func() { v.Run(ctx); close(fini) }()
	defer func() { cancel(); <-fini }()
	partir()
	attendre(t, "vidage refait après le départ du lecteur", func() bool { return tailleWAL(t, dir) == 0 })
}

func attendre(t *testing.T, quoi string, ok func() bool) {
	t.Helper()
	for fin := time.Now().Add(5 * time.Second); time.Now().Before(fin); time.Sleep(10 * time.Millisecond) {
		if ok() {
			return
		}
	}
	t.Fatal("jamais arrivé :", quoi)
}
