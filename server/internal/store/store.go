// Package store ouvre la base SQLite des partages (métadonnées uniquement, jamais de contenu clair).
package store

import (
	"database/sql"
	"fmt"

	_ "modernc.org/sqlite"
)

// id : identifiant interne tiré par le serveur (share.NewID), jamais dérivé du lien ni montré
// dans un chemin. Les partages se trouvent par access_v (destinataire) ou manage_v
// (expéditeur), index uniques (spec §29.8, §32) : sans K_accès ni S_gestion, aucune
// requête ne désigne un partage, et une création ne peut heurter qu'un vérificateur dont
// l'auteur connaît le secret (aucun oracle d'existence, revue K1, I2).
// WITHOUT ROWID : pas de compteur d'insertion qui trahirait l'ordre de création (spec §9.1).
// Schéma v2 (spec §29.8) : max_opens, salt, kdf_*, proof_v et envelope (E, 60 octets)
// restent NULL jusqu'à finalize ; un partage « ready » les a tous (CHECK).
// Minimisation (spec §36 S5, S11, S12, Task M2) : aucune échéance d'envoi, de blocage ni de
// purge en base (elles vivent en mémoire, share.Service) ; ttl_hours reste NULL après
// finalize (il donnerait l'heure de création à 15 min près) ; seule date : expires_at.
const tableDef = `(
  id TEXT PRIMARY KEY, state TEXT NOT NULL CHECK(state IN ('uploading','ready','draining')),
  bucket INTEGER NOT NULL, ttl_hours INTEGER, max_opens INTEGER,
  opens_left INTEGER NOT NULL, opens_issued INTEGER NOT NULL DEFAULT 0, done_mask INTEGER NOT NULL DEFAULT 0,
  failed_attempts INTEGER NOT NULL DEFAULT 0, segments_mask BLOB NOT NULL,
  salt BLOB, kdf_ops INTEGER, kdf_mem INTEGER,
  access_v BLOB NOT NULL, proof_v BLOB, manage_v BLOB NOT NULL, envelope BLOB,
  expires_at INTEGER,
  CHECK(state='uploading' OR (max_opens IS NOT NULL AND salt IS NOT NULL AND
    kdf_ops IS NOT NULL AND kdf_mem IS NOT NULL AND proof_v IS NOT NULL AND envelope IS NOT NULL AND length(envelope)=60))) WITHOUT ROWID`

const schema = `CREATE TABLE IF NOT EXISTS shares` + tableDef

// keptColumns : colonnes recopiées par la migration (toutes celles du schéma actuel).
const keptColumns = `id,state,bucket,ttl_hours,max_opens,opens_left,opens_issued,done_mask,failed_attempts,
  segments_mask,salt,kdf_ops,kdf_mem,access_v,proof_v,manage_v,envelope,expires_at`

// indexes : créés après le contrôle du format (une base v1 n'a pas les mêmes colonnes).
const indexes = `CREATE UNIQUE INDEX IF NOT EXISTS shares_access_v ON shares(access_v);
CREATE UNIQUE INDEX IF NOT EXISTS shares_manage_v ON shares(manage_v)`

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
	if err := migrate(db); err != nil {
		db.Close()
		return nil, fmt.Errorf("migration du schéma : %w", err)
	}
	if _, err := db.Exec(indexes); err != nil {
		db.Close()
		return nil, fmt.Errorf("création des index : %w", err)
	}
	return db, nil
}

// migrate retire les colonnes de dates de l'ancien schéma v2 (Task M2) : copie dans une
// nouvelle table WITHOUT ROWID sans elles (ttl_hours mis à NULL hors envoi), remplacement
// de l'ancienne, puis VACUUM et vidage du WAL. secure_delete (DSN) efface les pages
// libérées : aucun octet des colonnes retirées ne reste dans le fichier. Sans ces colonnes,
// rien à faire.
func migrate(db *sql.DB) error {
	var old int
	q := `SELECT count(*) FROM pragma_table_info('shares') WHERE name IN ('upload_deadline','purge_at','progress_at')`
	if err := db.QueryRow(q).Scan(&old); err != nil {
		return err
	}
	if old == 0 {
		return nil
	}
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for _, stmt := range []string{
		`DROP TABLE IF EXISTS shares_m2`,
		`CREATE TABLE shares_m2` + tableDef,
		`INSERT INTO shares_m2(` + keptColumns + `) SELECT ` + keptColumns + ` FROM shares`,
		`UPDATE shares_m2 SET ttl_hours=NULL WHERE state<>'uploading'`,
		`DROP TABLE shares`, // ses index avec elle
		`ALTER TABLE shares_m2 RENAME TO shares`,
	} {
		if _, err := tx.Exec(stmt); err != nil {
			return err
		}
	}
	if err := tx.Commit(); err != nil {
		return err
	}
	if _, err := db.Exec(`VACUUM`); err != nil {
		return err
	}
	return Checkpoint(db)
}

// Checkpoint replie le WAL dans la base et le tronque.
func Checkpoint(db *sql.DB) error {
	_, err := db.Exec("PRAGMA wal_checkpoint(TRUNCATE)")
	return err
}
