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

// wantMaster : contenu exact de sqlite_master au schéma 2 (partages et salon), rien d'autre.
const wantMaster = "index:salon_pieces_salon,index:salons_access_v,index:salons_manage_v," +
	"index:shares_access_v,index:shares_manage_v,table:salon_pieces,table:salons,table:shares"

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
	if got := strings.Join(masterNames(t, db), ","); got != wantMaster {
		t.Fatalf("sqlite_master = %s, attendu %s", got, wantMaster)
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
	if got := strings.Join(masterNames(t, db), ","); got != wantMaster {
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
	if v := pragma(t, db, "user_version"); v != "2" {
		t.Fatalf("user_version = %s, attendu 2 (tables du salon)", v)
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

// tableColumns : noms des colonnes d'une table, dans l'ordre de déclaration.
func tableColumns(t *testing.T, db *sql.DB, table string) []string {
	t.Helper()
	rs, err := db.Query(`SELECT name FROM pragma_table_info(?) ORDER BY cid`, table)
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

// Spec §39.3.5 : la base ne garde du salon que ces 12 colonnes ; ni durée, ni sièges, ni
// nombre de messages (tout ce qui décrit les personnes reste en mémoire).
func TestSalonsColonnes(t *testing.T) {
	db, err := Open(filepath.Join(t.TempDir(), "s.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	want := "id,access_v,manage_v,proof_v,salt,kdf_ops,kdf_mem,expires_at,max_members," +
		"members_can_destroy,failed_attempts,pieces_bytes"
	if got := strings.Join(tableColumns(t, db, "salons"), ","); got != want {
		t.Fatalf("colonnes de salons = %s, attendu %s", got, want)
	}
	if got := strings.Join(tableColumns(t, db, "salon_pieces"), ","); got != "id,salon_id,bucket,state,segments_mask" {
		t.Fatalf("colonnes de salon_pieces = %s", got)
	}
}

// insSalon insère un salon valide (vérificateurs tirés au hasard par SQLite).
func insSalon(db *sql.DB, id string) error {
	_, err := db.Exec(`INSERT INTO salons(id,access_v,manage_v,proof_v,salt,kdf_ops,kdf_mem,expires_at,max_members,members_can_destroy)
		VALUES(?,randomblob(32),randomblob(32),randomblob(32),randomblob(16),3,67108864,900,10,0)`, id)
	return err
}

// Contraintes : longueurs exactes des vérificateurs et du sel, max_members de 2 à 10,
// members_can_destroy booléen, vérificateurs uniques, état des pièces fermé.
func TestSalonsContraintes(t *testing.T) {
	db, err := Open(filepath.Join(t.TempDir(), "s.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if err := insSalon(db, "a"); err != nil {
		t.Fatal("salon valide refusé :", err)
	}
	bad := map[string]string{
		"max_members 1":         `VALUES('b',randomblob(32),randomblob(32),randomblob(32),randomblob(16),3,67108864,900,1,0)`,
		"max_members 11":        `VALUES('b',randomblob(32),randomblob(32),randomblob(32),randomblob(16),3,67108864,900,11,0)`,
		"members_can_destroy 2": `VALUES('b',randomblob(32),randomblob(32),randomblob(32),randomblob(16),3,67108864,900,10,2)`,
		"access_v de 31":        `VALUES('b',randomblob(31),randomblob(32),randomblob(32),randomblob(16),3,67108864,900,10,0)`,
		"manage_v de 33":        `VALUES('b',randomblob(32),randomblob(33),randomblob(32),randomblob(16),3,67108864,900,10,0)`,
		"proof_v de 16":         `VALUES('b',randomblob(32),randomblob(32),randomblob(16),randomblob(16),3,67108864,900,10,0)`,
		"salt de 32":            `VALUES('b',randomblob(32),randomblob(32),randomblob(32),randomblob(32),3,67108864,900,10,0)`,
		"access_v en double":    `SELECT 'b',access_v,randomblob(32),randomblob(32),randomblob(16),3,67108864,900,10,0 FROM salons`,
		"manage_v en double":    `SELECT 'b',randomblob(32),manage_v,randomblob(32),randomblob(16),3,67108864,900,10,0 FROM salons`,
	}
	for name, v := range bad {
		if _, err := db.Exec(`INSERT INTO salons(id,access_v,manage_v,proof_v,salt,kdf_ops,kdf_mem,expires_at,max_members,members_can_destroy) ` + v); err == nil {
			t.Errorf("%s accepté", name)
		}
	}
	if _, err := db.Exec(`INSERT INTO salon_pieces(id,salon_id,bucket,state,segments_mask) VALUES('p','a',1,'draining',x'00')`); err == nil {
		t.Error("état de pièce invalide accepté")
	}
	for _, b := range []int{0, -1, 8001} {
		if _, err := db.Exec(`INSERT INTO salon_pieces(id,salon_id,bucket,state,segments_mask) VALUES(?,'a',?,'ready',x'00')`, "q"+strconv.Itoa(b), b); err == nil {
			t.Errorf("palier %d accepté", b)
		}
	}
	for _, b := range []int{1, 8000} {
		id := "p" + strconv.Itoa(b)
		if _, err := db.Exec(`INSERT INTO salon_pieces(id,salon_id,bucket,state,segments_mask) VALUES(?,'a',?,'ready',x'00')`, id, b); err != nil {
			t.Errorf("palier %d refusé : %v", b, err)
		}
	}
	for _, v := range []int64{-1, 1073741825} {
		if _, err := db.Exec(`UPDATE salons SET pieces_bytes=? WHERE id='a'`, v); err == nil {
			t.Errorf("pieces_bytes %d accepté", v)
		}
	}
	for _, v := range []int64{1073741824, 0} {
		if _, err := db.Exec(`UPDATE salons SET pieces_bytes=? WHERE id='a'`, v); err != nil {
			t.Errorf("pieces_bytes %d refusé : %v", v, err)
		}
	}
	if _, err := db.Exec(`INSERT INTO salon_pieces(id,salon_id,bucket,state,segments_mask) VALUES('p','inconnu',1,'ready',x'00')`); err == nil {
		t.Error("pièce d'un salon inconnu acceptée (clés étrangères)")
	}
	var fa, pb int
	if err := db.QueryRow(`SELECT failed_attempts, pieces_bytes FROM salons WHERE id='a'`).Scan(&fa, &pb); err != nil || fa != 0 || pb != 0 {
		t.Fatal("valeurs par défaut", fa, pb, err)
	}
}

// Supprimer la ligne du salon supprime ses pièces (ON DELETE CASCADE, foreign_keys(ON)).
func TestPiecesEffaceesAvecSalon(t *testing.T) {
	db, err := Open(filepath.Join(t.TempDir(), "s.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	for _, id := range []string{"a", "b"} {
		if err := insSalon(db, id); err != nil {
			t.Fatal(err)
		}
	}
	for _, p := range [][2]string{{"p1", "a"}, {"p2", "a"}, {"p3", "b"}} {
		if _, err := db.Exec(`INSERT INTO salon_pieces(id,salon_id,bucket,state,segments_mask) VALUES(?,?,16,'uploading',x'00')`, p[0], p[1]); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := db.Exec(`DELETE FROM salons WHERE id='a'`); err != nil {
		t.Fatal(err)
	}
	var n int
	if err := db.QueryRow(`SELECT count(*) FROM salon_pieces WHERE salon_id='a'`).Scan(&n); err != nil || n != 0 {
		t.Fatal("pièces du salon supprimé restantes :", n, err)
	}
	if err := db.QueryRow(`SELECT count(*) FROM salon_pieces`).Scan(&n); err != nil || n != 1 {
		t.Fatal("pièce de l'autre salon :", n, err)
	}
}

// Sans rowid : aucun compteur d'insertion ne trahit l'ordre de création des salons ni des pièces.
func TestSalonsWithoutRowid(t *testing.T) {
	db, err := Open(filepath.Join(t.TempDir(), "s.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	for _, table := range []string{"salons", "salon_pieces"} {
		var v int
		if err := db.QueryRow("SELECT rowid FROM " + table).Scan(&v); err == nil || !strings.Contains(err.Error(), "rowid") {
			t.Fatalf("la table %s ne doit pas avoir de rowid : %v", table, err)
		}
	}
}

// baseV1 : base du schéma 1 (partages seuls), comme l'écrivait le binaire précédent.
func baseV1(t *testing.T, path string, version int) {
	t.Helper()
	raw, err := sql.Open("sqlite", "file:"+path+"?_pragma=journal_mode(WAL)")
	if err != nil {
		t.Fatal(err)
	}
	defer raw.Close()
	// DDL du schéma 1 figé en littéral (comme TestMigratesDatesOutOfDB) : une évolution de
	// schema ou d'indexes ne doit pas changer la base « ancienne » du test.
	const v1 = `CREATE TABLE IF NOT EXISTS shares(
  id TEXT PRIMARY KEY, state TEXT NOT NULL CHECK(state IN ('uploading','ready','draining')),
  bucket INTEGER NOT NULL, ttl_hours INTEGER, max_opens INTEGER,
  opens_left INTEGER NOT NULL, opens_issued INTEGER NOT NULL DEFAULT 0, done_mask INTEGER NOT NULL DEFAULT 0,
  failed_attempts INTEGER NOT NULL DEFAULT 0, segments_mask BLOB NOT NULL,
  salt BLOB, kdf_ops INTEGER, kdf_mem INTEGER,
  access_v BLOB NOT NULL, proof_v BLOB, manage_v BLOB NOT NULL, envelope BLOB,
  expires_at INTEGER,
  CHECK(state='uploading' OR (max_opens IS NOT NULL AND salt IS NOT NULL AND
    kdf_ops IS NOT NULL AND kdf_mem IS NOT NULL AND proof_v IS NOT NULL AND envelope IS NOT NULL AND length(envelope)=60))) WITHOUT ROWID;
CREATE UNIQUE INDEX IF NOT EXISTS shares_access_v ON shares(access_v);
CREATE UNIQUE INDEX IF NOT EXISTS shares_manage_v ON shares(manage_v)`
	for _, stmt := range []string{v1, `PRAGMA user_version=` + strconv.Itoa(version)} {
		if _, err := raw.Exec(stmt); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := raw.Exec(`INSERT INTO shares(id,state,bucket,max_opens,opens_left,segments_mask,salt,kdf_ops,kdf_mem,access_v,proof_v,manage_v,envelope,expires_at)
		VALUES('r','ready',16,1,1,x'00',x'00',3,3,x'01',x'01',x'02',zeroblob(60),900)`); err != nil {
		t.Fatal(err)
	}
}

// Une base du schéma 1 avec un partage s'ouvre, garde le partage et passe au schéma 2.
func TestMigreV1VersV2(t *testing.T) {
	path := filepath.Join(t.TempDir(), "shares.db")
	baseV1(t, path, 1)
	db, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	var exp int64
	if err := db.QueryRow(`SELECT expires_at FROM shares WHERE id='r'`).Scan(&exp); err != nil || exp != 900 {
		t.Fatal("partage perdu :", exp, err)
	}
	if v := pragma(t, db, "user_version"); v != "2" {
		t.Fatalf("user_version = %s", v)
	}
	if err := insSalon(db, "a"); err != nil {
		t.Fatal("table salons absente après migration :", err)
	}
}

// Une base du schéma 3 (binaire plus récent) est refusée sans rien toucher : ni tables du
// salon créées, ni version réécrite.
func TestRefuseV3(t *testing.T) {
	path := filepath.Join(t.TempDir(), "shares.db")
	baseV1(t, path, 3)
	db, err := Open(path)
	if !errors.Is(err, ErrNewerSchema) {
		if db != nil {
			db.Close()
		}
		t.Fatal("base du schéma 3 acceptée :", err)
	}
	raw, err := sql.Open("sqlite", "file:"+path+"?mode=ro")
	if err != nil {
		t.Fatal(err)
	}
	defer raw.Close()
	if v := pragma(t, raw, "user_version"); v != "3" {
		t.Fatal("version touchée", v)
	}
	if got := strings.Join(masterNames(t, raw), ","); got != "index:shares_access_v,index:shares_manage_v,table:shares" {
		t.Fatal("schéma touché :", got)
	}
}
