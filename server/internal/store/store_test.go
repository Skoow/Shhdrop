package store

import (
	"bytes"
	"database/sql"
	"os"
	"path/filepath"
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
}

func TestOctetsRepere(t *testing.T) {
	path := filepath.Join(t.TempDir(), "shares.db")
	db, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	marker := []byte("OCTETS-REPERE")
	_, err = db.Exec(`INSERT INTO shares(id,state,bucket,ttl_hours,max_opens,opens_left,segments_mask,salt,kdf_ops,kdf_mem,access_v,proof_v,manage_v)
		VALUES('a','ready',1,1,1,1,x'00',?,1,1,x'01',?,x'02')`, marker, marker)
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
