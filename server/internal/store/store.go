// Package store ouvre la base SQLite des partages (métadonnées uniquement, jamais de contenu clair).
package store

import (
	"database/sql"
	"errors"
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

// salonsSchema (schéma 2, plan C-2 Task 4, spec §39.3.5) : seules colonnes du salon en base.
// Ni durée, ni sièges, ni nombre de messages, ni pseudonyme : tout ce qui décrit les
// personnes reste en mémoire. Comme shares : id interne jamais montré, salon trouvé par
// access_v ou manage_v (index uniques), WITHOUT ROWID (aucun ordre de création), seule date
// expires_at (arrondie au quart d'heure par l'appelant). salon_pieces : pièces jointes,
// effacées avec leur salon (ON DELETE CASCADE, foreign_keys(ON) dans le DSN).
// Bornes (plan C-2, Global Constraints) : pieces_bytes ≤ budget de 2 147 483 648 octets (hors
// vocaux ; 13 novembre, décision du propriétaire, 1 Gio avant ; schéma 2 jamais publié : changé
// sans migration), palier d'une pièce de 1 à 8 000. rotation_r : numéro de la dernière rotation de
// l'invitation (exclure, spec §39.13.1b ; 0 : aucune), en base pour qu'un ancien exclure
// rejoué après un redémarrage ne fasse pas revivre une invitation morte (relecture Task 14 ;
// colonne ajoutée au schéma 2 sans migration : jamais publié en production).
const salonsSchema = `CREATE TABLE IF NOT EXISTS salons(
  id TEXT PRIMARY KEY, access_v BLOB NOT NULL, manage_v BLOB NOT NULL, proof_v BLOB NOT NULL,
  salt BLOB NOT NULL, kdf_ops INTEGER NOT NULL, kdf_mem INTEGER NOT NULL, expires_at INTEGER NOT NULL,
  max_members INTEGER NOT NULL CHECK(max_members BETWEEN 2 AND 10),
  members_can_destroy INTEGER NOT NULL CHECK(members_can_destroy IN (0,1)),
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  pieces_bytes INTEGER NOT NULL DEFAULT 0 CHECK(pieces_bytes BETWEEN 0 AND 2147483648),
  rotation_r INTEGER NOT NULL DEFAULT 0 CHECK(rotation_r BETWEEN 0 AND 4294967295),
  CHECK(length(access_v)=32 AND length(manage_v)=32 AND length(proof_v)=32 AND length(salt)=16)) WITHOUT ROWID;
CREATE UNIQUE INDEX IF NOT EXISTS salons_access_v ON salons(access_v);
CREATE UNIQUE INDEX IF NOT EXISTS salons_manage_v ON salons(manage_v);
CREATE TABLE IF NOT EXISTS salon_pieces(
  id TEXT PRIMARY KEY, salon_id TEXT NOT NULL REFERENCES salons(id) ON DELETE CASCADE,
  bucket INTEGER NOT NULL CHECK(bucket BETWEEN 1 AND 8000), state TEXT NOT NULL CHECK(state IN ('uploading','ready')),
  segments_mask BLOB NOT NULL) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS salon_pieces_salon ON salon_pieces(salon_id)`

// Les PRAGMA passent par le DSN pour s'appliquer à chaque connexion. synchronous(FULL) :
// valeur par défaut, écrite pour qu'un changement du pilote ne l'abaisse pas en silence
// (NORMAL perdrait les dernières transactions à une coupure de courant).
// journal_size_limit(0) : le fichier -wal est ramené à zéro après CHAQUE point de contrôle, y
// compris les points de contrôle automatiques PASSIVE (tous les 1 000 blocs) ; sinon les blocs
// déjà repliés (dont les métadonnées d'un partage supprimé) restent écrits dans le fichier
// entre deux TRUNCATE du janitor (audit adverse du 13 novembre, St1).
const pragmas = "_pragma=journal_mode(WAL)&_pragma=synchronous(FULL)&_pragma=secure_delete(ON)" +
	"&_pragma=busy_timeout(" + busyTimeoutMs + ")&_pragma=foreign_keys(ON)&_pragma=temp_store(MEMORY)" +
	"&_pragma=journal_size_limit(0)"

// busyTimeoutMs : attente d'une base occupée par un autre processus (millisecondes), pour
// toutes les requêtes sauf les vidages regroupés (vidage.go : attente courte).
const busyTimeoutMs = "5000"

// SchemaVersion : version du schéma, écrite dans PRAGMA user_version. Un binaire refuse une
// base d'une version plus récente (ErrNewerSchema) : un retour arrière ne réécrit jamais une
// base qu'il ne connaît pas. À incrémenter avec toute migration.
// 1 : partages ; 2 : tables salons et salon_pieces (tables neuves, aucune donnée migrée).
const SchemaVersion = 2

var (
	// ErrNewerSchema : message fixe, sans chemin.
	ErrNewerSchema = errors.New("base créée par une version plus récente de Shhgone : refus d'ouvrir " +
		"(retour arrière : réinstaller la version récente, ou effacer la base)")
	// ErrSalonsPerimes : table salons du schéma 2 d'avant la colonne rotation_r (base de
	// développement, jamais publiée) ; message fixe, sans chemin.
	ErrSalonsPerimes = errors.New("base de développement au schéma du salon périmé (sans rotation_r) : " +
		"l'effacer avant de démarrer (rien n'a été fait)")
	// ErrOldSchema : base d'une version antérieure (commandes d'administration du salon) ;
	// message fixe, sans chemin.
	ErrOldSchema = errors.New("base d'une version antérieure de Shhgone (sans les tables du salon) : " +
		"démarrer le serveur une fois pour la mettre à jour (rien n'a été fait)")
	// ErrCheckpointBusy : le vidage du WAL n'a pas pu finir (lecteur ou écrivain en cours) ;
	// le WAL garde encore des pages, à revider au prochain passage (spec §9.1).
	ErrCheckpointBusy = errors.New("vidage du WAL incomplet (base occupée)")
)

// checkVersion refuse une base d'une version plus récente et rend la version lue.
func checkVersion(db *sql.DB) (int, error) {
	var v int
	if err := db.QueryRow(`PRAGMA user_version`).Scan(&v); err != nil {
		return 0, fmt.Errorf("lecture de la version du schéma : %w", err)
	}
	if v > SchemaVersion {
		return v, ErrNewerSchema
	}
	return v, nil
}

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
	if _, err := checkVersion(db); err != nil {
		db.Close()
		return nil, err
	}
	var n int
	if err := db.QueryRow(`SELECT count(*) FROM shares`).Scan(&n); err != nil {
		db.Close()
		return nil, fmt.Errorf("base %s illisible : %w", path, err)
	}
	return db, nil
}

// RequireCurrent : la base est au schéma courant (SchemaVersion), sinon ErrOldSchema. Pour les
// commandes d'administration du salon : OpenExisting accepte une base plus ancienne, que
// seul le serveur met à jour (plan C-2 Task 15).
func RequireCurrent(db *sql.DB) error {
	v, err := checkVersion(db)
	if err != nil {
		return err
	}
	if v != SchemaVersion {
		return ErrOldSchema
	}
	return nil
}

// Open ouvre (ou crée) la base : WAL, effacement sûr, temporaires en mémoire, une seule connexion.
func Open(path string) (*sql.DB, error) {
	db, err := open("file:" + path + "?" + pragmas)
	if err != nil {
		return nil, err
	}
	// Version d'abord : une base plus récente n'est pas touchée (ni schéma, ni migration).
	version, err := checkVersion(db)
	if err != nil {
		db.Close()
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
	if _, err := db.Exec(salonsSchema); err != nil {
		db.Close()
		return nil, fmt.Errorf("création des tables du salon : %w", err)
	}
	// CREATE TABLE IF NOT EXISTS ne touche pas une table salons plus ancienne : sans
	// rotation_r, exclure échouerait plus tard (relecture Task 15).
	var rot int
	if err := db.QueryRow(`SELECT count(*) FROM pragma_table_info('salons') WHERE name='rotation_r'`).Scan(&rot); err != nil {
		db.Close()
		return nil, fmt.Errorf("lecture du schéma du salon : %w", err)
	}
	if rot == 0 {
		db.Close()
		return nil, ErrSalonsPerimes
	}
	if version < SchemaVersion {
		if _, err := db.Exec(fmt.Sprintf(`PRAGMA user_version=%d`, SchemaVersion)); err != nil {
			db.Close()
			return nil, fmt.Errorf("écriture de la version du schéma : %w", err)
		}
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

// Checkpoint replie le WAL dans la base et le tronque. Le PRAGMA ne rend pas d'erreur quand
// un lecteur l'empêche de finir : il le dit dans sa première colonne (busy), lue ici (audit
// F8) ; ErrCheckpointBusy alors.
func Checkpoint(db *sql.DB) error {
	var busy, logFrames, done int
	if err := db.QueryRow("PRAGMA wal_checkpoint(TRUNCATE)").Scan(&busy, &logFrames, &done); err != nil {
		return err
	}
	if busy != 0 {
		return ErrCheckpointBusy
	}
	return nil
}
