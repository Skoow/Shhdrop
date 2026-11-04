// Package store ouvre la base SQLite des partages (métadonnées uniquement, jamais de contenu clair).
package store

import (
	"database/sql"
	"fmt"

	_ "modernc.org/sqlite"
)

// WITHOUT ROWID : pas de compteur d'insertion qui trahirait l'ordre de création (spec §9.1).
const schema = `CREATE TABLE IF NOT EXISTS shares(
  id TEXT PRIMARY KEY, state TEXT NOT NULL CHECK(state IN ('uploading','ready','draining')),
  bucket INTEGER NOT NULL, ttl_hours INTEGER NOT NULL, max_opens INTEGER NOT NULL,
  opens_left INTEGER NOT NULL, opens_issued INTEGER NOT NULL DEFAULT 0, done_mask INTEGER NOT NULL DEFAULT 0,
  failed_attempts INTEGER NOT NULL DEFAULT 0, segments_mask BLOB NOT NULL,
  salt BLOB NOT NULL, kdf_ops INTEGER NOT NULL, kdf_mem INTEGER NOT NULL,
  access_v BLOB NOT NULL, proof_v BLOB NOT NULL, manage_v BLOB NOT NULL,
  upload_deadline INTEGER, expires_at INTEGER, purge_at INTEGER) WITHOUT ROWID`

// Open ouvre (ou crée) la base : WAL, effacement sûr, temporaires en mémoire, une seule connexion.
func Open(path string) (*sql.DB, error) {
	// Les PRAGMA passent par le DSN pour s'appliquer à chaque connexion.
	dsn := "file:" + path +
		"?_pragma=journal_mode(WAL)&_pragma=secure_delete(ON)" +
		"&_pragma=busy_timeout(5000)&_pragma=foreign_keys(ON)&_pragma=temp_store(MEMORY)"
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	if _, err := db.Exec(schema); err != nil {
		db.Close()
		return nil, fmt.Errorf("création du schéma : %w", err)
	}
	return db, nil
}

// Checkpoint replie le WAL dans la base et le tronque.
func Checkpoint(db *sql.DB) error {
	_, err := db.Exec("PRAGMA wal_checkpoint(TRUNCATE)")
	return err
}
