// Package store ouvre la base SQLite des partages (métadonnées uniquement, jamais de contenu clair).
package store

import (
	"database/sql"
	"fmt"

	_ "modernc.org/sqlite"
)

// WITHOUT ROWID : pas de compteur d'insertion qui trahirait l'ordre de création (spec §9.1).
// Schéma v2 (spec §29.8) : ttl_hours, max_opens, salt, kdf_*, proof_v et envelope (E,
// 60 octets) restent NULL jusqu'à finalize ; un partage « ready » les a tous (CHECK).
const schema = `CREATE TABLE IF NOT EXISTS shares(
  id TEXT PRIMARY KEY, state TEXT NOT NULL CHECK(state IN ('uploading','ready','draining')),
  bucket INTEGER NOT NULL, ttl_hours INTEGER, max_opens INTEGER,
  opens_left INTEGER NOT NULL, opens_issued INTEGER NOT NULL DEFAULT 0, done_mask INTEGER NOT NULL DEFAULT 0,
  failed_attempts INTEGER NOT NULL DEFAULT 0, segments_mask BLOB NOT NULL,
  salt BLOB, kdf_ops INTEGER, kdf_mem INTEGER,
  access_v BLOB NOT NULL, proof_v BLOB, manage_v BLOB NOT NULL, envelope BLOB,
  upload_deadline INTEGER, expires_at INTEGER, purge_at INTEGER, progress_at INTEGER,
  CHECK(state='uploading' OR (ttl_hours IS NOT NULL AND max_opens IS NOT NULL AND salt IS NOT NULL AND
    kdf_ops IS NOT NULL AND kdf_mem IS NOT NULL AND proof_v IS NOT NULL AND envelope IS NOT NULL AND length(envelope)=60))) WITHOUT ROWID`

// Les PRAGMA passent par le DSN pour s'appliquer à chaque connexion.
const pragmas = "_pragma=journal_mode(WAL)&_pragma=secure_delete(ON)" +
	"&_pragma=busy_timeout(5000)&_pragma=foreign_keys(ON)&_pragma=temp_store(MEMORY)"

func open(dsn string) (*sql.DB, error) {
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	return db, nil
}

// OpenExisting ouvre une base qui doit déjà exister et contenir la table shares, sans
// jamais rien créer (mode=rw) : pour les commandes d'administration (audit M2).
// path : chemin absolu sans « ? », « # » ni « % » (vérifié par config).
func OpenExisting(path string) (*sql.DB, error) {
	db, err := open("file:" + path + "?mode=rw&" + pragmas)
	if err != nil {
		return nil, err
	}
	var n int
	if err := db.QueryRow(`SELECT count(*) FROM shares`).Scan(&n); err != nil {
		db.Close()
		return nil, fmt.Errorf("base %s illisible : %w", path, err)
	}
	return db, nil
}

// Open ouvre (ou crée) la base : WAL, effacement sûr, temporaires en mémoire, une seule connexion.
func Open(path string) (*sql.DB, error) {
	db, err := open("file:" + path + "?" + pragmas)
	if err != nil {
		return nil, err
	}
	if _, err := db.Exec(schema); err != nil {
		db.Close()
		return nil, fmt.Errorf("création du schéma : %w", err)
	}
	// Base d'un serveur v1 (sans colonne envelope) : refus, sans rien toucher. Aucun partage
	// v1 n'existe en production ; un partage v1 serait illisible par le client v2.
	var has int
	if err := db.QueryRow(`SELECT count(*) FROM pragma_table_info('shares') WHERE name='envelope'`).Scan(&has); err != nil {
		db.Close()
		return nil, fmt.Errorf("lecture du schéma : %w", err)
	}
	if has == 0 {
		db.Close()
		return nil, fmt.Errorf("base au format v1 (sans colonne envelope) : à effacer avant de démarrer le serveur v2")
	}
	return db, nil
}

// Checkpoint replie le WAL dans la base et le tronque.
func Checkpoint(db *sql.DB) error {
	_, err := db.Exec("PRAGMA wal_checkpoint(TRUNCATE)")
	return err
}
