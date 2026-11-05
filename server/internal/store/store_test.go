package store

import (
	"bytes"
	"database/sql"
	"os"
	"path/filepath"
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
			VALUES(?,'ready',16,1,1,1,x'00',x'00',3,3,x'01',x'01',x'02',?)`, name, env)
		if err == nil {
			t.Fatal(name, "accepté")
		}
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
