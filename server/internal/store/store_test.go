package store

import (
	"bytes"
	"database/sql"
	"errors"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

func pragma(t *testing.T, db *sql.DB, name string) string {
	t.Helper()
	var v string
	if err := db.QueryRow("PRAGMA " + name).Scan(&v); err != nil {
		t.Fatal(err)
	}
	return v
}

func TestPragmas(t *testing.T) {
	db, err := Open(filepath.Join(t.TempDir(), "shares.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if v := pragma(t, db, "secure_delete"); v != "1" {
		t.Fatalf("secure_delete = %s", v)
	}
	if v := pragma(t, db, "journal_mode"); v != "wal" {
		t.Fatalf("journal_mode = %s", v)
	}
	if v := pragma(t, db, "foreign_keys"); v != "1" {
		t.Fatalf("foreign_keys = %s", v)
	}
	if v := pragma(t, db, "busy_timeout"); v != "5000" {
		t.Fatalf("busy_timeout = %s", v)
	}
	// 2 = MEMORY : tables temporaires (tris, index transitoires) jamais sur disque.
	if v := pragma(t, db, "temp_store"); v != "2" {
		t.Fatalf("temp_store = %s", v)
	}
}

// Sans rowid : aucun compteur d'insertion ne trahit l'ordre de création des partages.
func TestWithoutRowid(t *testing.T) {
	db, err := Open(filepath.Join(t.TempDir(), "s.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	var v int
	if err := db.QueryRow("SELECT rowid FROM shares").Scan(&v); err == nil || !strings.Contains(err.Error(), "rowid") {
		t.Fatal("la table shares ne doit pas avoir de rowid", err)
	}
}

func TestOctetsRepere(t *testing.T) {
	path := filepath.Join(t.TempDir(), "shares.db")
	db, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	marker := []byte("OCTETS-REPERE")
	_, err = db.Exec(`INSERT INTO shares(id,state,bucket,ttl_hours,max_opens,opens_left,segments_mask,salt,kdf_ops,kdf_mem,access_v,proof_v,manage_v,envelope)
		VALUES('a','ready',1,1,1,1,x'00',?,1,1,x'01',?,x'02',?)`, marker, marker, append(append([]byte{}, marker...), make([]byte, 60-len(marker))...))
	if err != nil {
		t.Fatal(err)
	}
	read := func() []byte {
		b, _ := os.ReadFile(path)
		w, _ := os.ReadFile(path + "-wal")
		return append(b, w...)
	}
	// Garde-fou : le motif doit être visible après l'insertion, sinon le test ne prouve rien.
	if !bytes.Contains(read(), marker) {
		t.Fatal("le motif devrait être présent après insertion")
	}
	if _, err := db.Exec("DELETE FROM shares WHERE id='a'"); err != nil {
		t.Fatal(err)
	}
	if err := Checkpoint(db); err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(read(), marker) {
		t.Fatal("le motif subsiste après suppression et checkpoint")
	}
}

func TestStateCheck(t *testing.T) {
	db, err := Open(filepath.Join(t.TempDir(), "s.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	_, err = db.Exec(`INSERT INTO shares(id,state,bucket,ttl_hours,max_opens,opens_left,segments_mask,salt,kdf_ops,kdf_mem,access_v,proof_v,manage_v)
		VALUES('a','bogus',1,1,1,1,x'00',x'00',1,1,x'01',x'01',x'02')`)
	if err == nil {
		t.Fatal("état invalide accepté")
	}
}

// v2 : un envoi n'a ni sel, ni Argon2id, ni V_preuve, ni enveloppe ; un partage « ready »
// doit les avoir tous (enveloppe de 60 octets exactement).
func TestSchemaV2NullUntilFinalize(t *testing.T) {
	db, err := Open(filepath.Join(t.TempDir(), "s.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if _, err := db.Exec(`INSERT INTO shares(id,state,bucket,opens_left,segments_mask,access_v,manage_v)
		VALUES('u','uploading',16,0,x'00',x'01',x'02')`); err != nil {
		t.Fatal("envoi v2 refusé :", err)
	}
	for name, env := range map[string]any{"sans enveloppe": nil, "enveloppe de 59 octets": make([]byte, 59)} {
		_, err := db.Exec(`INSERT INTO shares(id,state,bucket,ttl_hours,max_opens,opens_left,segments_mask,salt,kdf_ops,kdf_mem,access_v,proof_v,manage_v,envelope)
			VALUES(?,'ready',16,1,1,1,x'00',x'00',3,3,randomblob(32),x'01',randomblob(32),?)`, name, env)
		if err == nil {
			t.Fatal(name, "accepté")
		}
	}
}

// Spec §29.8, §32 : les partages se trouvent par V_accès ou V_gestion ; deux lignes ne
// partagent jamais l'un ni l'autre (index uniques), même entre un envoi et un partage prêt.
func TestUniqueVerifiers(t *testing.T) {
	db, err := Open(filepath.Join(t.TempDir(), "s.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	ins := func(id string, access, manage byte) error {
		_, err := db.Exec(`INSERT INTO shares(id,state,bucket,opens_left,segments_mask,access_v,manage_v)
			VALUES(?,'uploading',16,0,x'00',?,?)`, id, []byte{access}, []byte{manage})
		return err
	}
	if err := ins("a", 1, 2); err != nil {
		t.Fatal(err)
	}
	if err := ins("b", 1, 3); err == nil || !strings.Contains(err.Error(), "UNIQUE") {
		t.Fatalf("access_v en double accepté : %v", err)
	}
	if err := ins("c", 4, 2); err == nil || !strings.Contains(err.Error(), "UNIQUE") {
		t.Fatalf("manage_v en double accepté : %v", err)
	}
	if err := ins("d", 4, 5); err != nil {
		t.Fatal(err)
	}
	var n int
	if err := db.QueryRow(`SELECT count(*) FROM sqlite_master WHERE type='index' AND name IN ('shares_access_v','shares_manage_v')`).Scan(&n); err != nil || n != 2 {
		t.Fatalf("index uniques : %d, %v", n, err)
	}
}

// Une base v1 (sans colonne envelope) est refusée sans être modifiée.
func TestRefusesV1Schema(t *testing.T) {
	path := filepath.Join(t.TempDir(), "shares.db")
	old := `CREATE TABLE shares(id TEXT PRIMARY KEY, state TEXT, progress_at INTEGER) WITHOUT ROWID`
	raw, err := sql.Open("sqlite", "file:"+path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := raw.Exec(old); err != nil {
		t.Fatal(err)
	}
	raw.Close()
	db, err := Open(path)
	if err == nil {
		db.Close()
		t.Fatal("base v1 acceptée")
	}
	if !strings.Contains(err.Error(), "v1") {
		t.Fatal(err)
	}
}

// columns : noms des colonnes de shares.
func columns(t *testing.T, db *sql.DB) map[string]bool {
	t.Helper()
	rs, err := db.Query(`SELECT name FROM pragma_table_info('shares')`)
	if err != nil {
		t.Fatal(err)
	}
	defer rs.Close()
	m := map[string]bool{}
	for rs.Next() {
		var n string
		if err := rs.Scan(&n); err != nil {
			t.Fatal(err)
		}
		m[n] = true
	}
	return m
}

// masterNames : tout ce que contient sqlite_master (tables, index, vues, déclencheurs).
func masterNames(t *testing.T, db *sql.DB) []string {
	t.Helper()
	rs, err := db.Query(`SELECT type || ':' || name FROM sqlite_master ORDER BY 1`)
	if err != nil {
		t.Fatal(err)
	}
	defer rs.Close()
	var out []string
	for rs.Next() {
		var n string
		if err := rs.Scan(&n); err != nil {
			t.Fatal(err)
		}
		out = append(out, n)
	}
	return out
}

// Spec §36 S5, S11, S12 (Task M2) : progress_at, upload_deadline et purge_at vivent en
// mémoire ; la base ne garde qu'une date (expires_at). sqlite_master : shares et ses index.
func TestSchemaMinimal(t *testing.T) {
	db, err := Open(filepath.Join(t.TempDir(), "s.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	cols := columns(t, db)
	for _, c := range []string{"progress_at", "upload_deadline", "purge_at"} {
		if cols[c] {
			t.Errorf("colonne %s encore présente", c)
		}
	}
	if !cols["expires_at"] || !cols["ttl_hours"] {
		t.Fatal("expires_at et ttl_hours attendus", cols)
	}
	want := "index:shares_access_v,index:shares_manage_v,table:shares"
	if got := strings.Join(masterNames(t, db), ","); got != want {
		t.Fatalf("sqlite_master = %s, attendu %s", got, want)
	}
	// Un partage prêt sans ttl_hours est accepté (ttl_hours à NULL après finalize, S11).
	if _, err := db.Exec(`INSERT INTO shares(id,state,bucket,max_opens,opens_left,segments_mask,salt,kdf_ops,kdf_mem,access_v,proof_v,manage_v,envelope,expires_at)
		VALUES('r','ready',16,1,1,x'00',x'00',3,3,x'01',x'01',x'02',zeroblob(60),900)`); err != nil {
		t.Fatal("ready sans ttl_hours refusé :", err)
	}
}

// Base de l'ancien schéma v2 (avec les trois colonnes) : migrée en place par copie dans
// une nouvelle table WITHOUT ROWID, puis VACUUM ; ttl_hours mis à NULL hors envoi ; aucun
// octet des colonnes retirées ne reste dans le fichier.
func TestMigratesDatesOutOfDB(t *testing.T) {
	path := filepath.Join(t.TempDir(), "shares.db")
	old := `CREATE TABLE shares(
  id TEXT PRIMARY KEY, state TEXT NOT NULL CHECK(state IN ('uploading','ready','draining')),
  bucket INTEGER NOT NULL, ttl_hours INTEGER, max_opens INTEGER,
  opens_left INTEGER NOT NULL, opens_issued INTEGER NOT NULL DEFAULT 0, done_mask INTEGER NOT NULL DEFAULT 0,
  failed_attempts INTEGER NOT NULL DEFAULT 0, segments_mask BLOB NOT NULL,
  salt BLOB, kdf_ops INTEGER, kdf_mem INTEGER,
  access_v BLOB NOT NULL, proof_v BLOB, manage_v BLOB NOT NULL, envelope BLOB,
  upload_deadline INTEGER, expires_at INTEGER, purge_at INTEGER, progress_at INTEGER) WITHOUT ROWID;
CREATE UNIQUE INDEX shares_access_v ON shares(access_v);
CREATE UNIQUE INDEX shares_manage_v ON shares(manage_v)`
	raw, err := sql.Open("sqlite", "file:"+path+"?_pragma=journal_mode(WAL)")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := raw.Exec(old); err != nil {
		t.Fatal(err)
	}
	marker := []byte("REPERE-DATE-RETIREE")
	if _, err := raw.Exec(`INSERT INTO shares(id,state,bucket,ttl_hours,max_opens,opens_left,segments_mask,salt,kdf_ops,kdf_mem,access_v,proof_v,manage_v,envelope,expires_at,purge_at,progress_at,upload_deadline)
		VALUES('r','ready',16,24,3,3,x'00',x'00',3,3,x'01',x'01',x'02',zeroblob(60),900,?,?,?)`, marker, marker, marker); err != nil {
		t.Fatal(err)
	}
	if _, err := raw.Exec(`INSERT INTO shares(id,state,bucket,opens_left,segments_mask,access_v,manage_v,upload_deadline)
		VALUES('u','uploading',16,0,x'00',x'03',x'04',1800)`); err != nil {
		t.Fatal(err)
	}
	raw.Exec("PRAGMA wal_checkpoint(TRUNCATE)")
	raw.Close()

	db, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	cols := columns(t, db)
	if cols["progress_at"] || cols["upload_deadline"] || cols["purge_at"] {
		t.Fatal("colonnes non retirées", cols)
	}
	var ttl sql.NullInt64
	var maxOpens, exp int64
	if err := db.QueryRow(`SELECT ttl_hours, max_opens, expires_at FROM shares WHERE id='r'`).Scan(&ttl, &maxOpens, &exp); err != nil {
		t.Fatal(err)
	}
	if ttl.Valid || maxOpens != 3 || exp != 900 {
		t.Fatal("ligne migrée", ttl, maxOpens, exp)
	}
	var n int
	db.QueryRow(`SELECT count(*) FROM shares`).Scan(&n)
	if n != 2 {
		t.Fatal("lignes copiées", n)
	}
	if got := strings.Join(masterNames(t, db), ","); got != "index:shares_access_v,index:shares_manage_v,table:shares" {
		t.Fatal("sqlite_master", got)
	}
	var rowid int
	if err := db.QueryRow("SELECT rowid FROM shares").Scan(&rowid); err == nil {
		t.Fatal("table migrée avec rowid")
	}
	if err := Checkpoint(db); err != nil {
		t.Fatal(err)
	}
	b, _ := os.ReadFile(path)
	w, _ := os.ReadFile(path + "-wal")
	if bytes.Contains(append(b, w...), marker) {
		t.Fatal("octets des colonnes retirées encore sur disque")
	}
}

// synchronous reste FULL (2) : un partage « ready » ne doit pas disparaître à une coupure de
// courant (optimisation NORMAL écartée, décision du 11 novembre).
func TestSynchronousFull(t *testing.T) {
	db, err := Open(filepath.Join(t.TempDir(), "shares.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if v := pragma(t, db, "synchronous"); v != "2" {
		t.Fatalf("synchronous = %s", v)
	}
}

// Audit F8 : un vidage du WAL bloqué par un lecteur (busy = 1) est une erreur : le WAL garde
// alors des pages de partages effacés (spec §9.1), il ne doit pas passer pour vidé.
func TestCheckpointBusy(t *testing.T) {
	path := filepath.Join(t.TempDir(), "shares.db")
	db, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if _, err := db.Exec(`PRAGMA busy_timeout=10`); err != nil { // une seule connexion (Open)
		t.Fatal(err)
	}
	if err := Checkpoint(db); err != nil {
		t.Fatal("vidage sans lecteur :", err)
	}
	other, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer other.Close()
	tx, err := other.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	var n int
	if err := tx.QueryRow(`SELECT count(*) FROM shares`).Scan(&n); err != nil { // lecteur ouvert
		t.Fatal(err)
	}
	if _, err := db.Exec(`INSERT INTO shares(id,state,bucket,opens_left,segments_mask,access_v,manage_v)
		VALUES('x','uploading',1,0,x'00',x'01',x'02')`); err != nil {
		t.Fatal(err)
	}
	if err := Checkpoint(db); !errors.Is(err, ErrCheckpointBusy) {
		t.Fatal("vidage bloqué par un lecteur non signalé :", err)
	}
	tx.Rollback()
	if err := Checkpoint(db); err != nil {
		t.Fatal("vidage après le lecteur :", err)
	}
}

// Version du schéma (PRAGMA user_version) : posée à la création et sur une base existante
// sans version ; une base d'une version plus récente est refusée sans rien toucher (retour
// arrière vers un binaire plus ancien), avec un message fixe.
func TestSchemaVersion(t *testing.T) {
	path := filepath.Join(t.TempDir(), "shares.db")
	db, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	if v := pragma(t, db, "user_version"); v != strconv.Itoa(SchemaVersion) {
		t.Fatalf("user_version = %s", v)
	}
	if _, err := db.Exec(`PRAGMA user_version=0`); err != nil { // base d'avant la version
		t.Fatal(err)
	}
	db.Close()
	if db, err = Open(path); err != nil {
		t.Fatal(err)
	}
	if v := pragma(t, db, "user_version"); v != strconv.Itoa(SchemaVersion) {
		t.Fatalf("user_version non posée sur une base existante : %s", v)
	}
	if _, err := db.Exec(`PRAGMA user_version=` + strconv.Itoa(SchemaVersion+1)); err != nil {
		t.Fatal(err)
	}
	db.Close()
	for name, open := range map[string]func(string) (*sql.DB, error){"Open": Open, "OpenExisting": OpenExisting} {
		db, err := open(path)
		if !errors.Is(err, ErrNewerSchema) {
			if db != nil {
				db.Close()
			}
			t.Fatalf("%s : base plus récente acceptée : %v", name, err)
		}
		if strings.Contains(err.Error(), path) {
			t.Fatalf("%s : message avec le chemin : %v", name, err)
		}
	}
	raw, err := sql.Open("sqlite", "file:"+path+"?mode=ro")
	if err != nil {
		t.Fatal(err)
	}
	defer raw.Close()
	if v := pragma(t, raw, "user_version"); v != strconv.Itoa(SchemaVersion+1) {
		t.Fatal("version touchée", v)
	}
}
