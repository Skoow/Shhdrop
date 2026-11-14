package compte

import (
	"database/sql"
	"errors"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

func ouvrir(t *testing.T) (*sql.DB, string) {
	t.Helper()
	p := filepath.Join(t.TempDir(), "comptes.db")
	db, err := OuvrirBase(p)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	return db, p
}

func lignes(t *testing.T, db *sql.DB, q string, args ...any) []string {
	t.Helper()
	rs, err := db.Query(q, args...)
	if err != nil {
		t.Fatal(err)
	}
	defer rs.Close()
	var out []string
	for rs.Next() {
		var s string
		if err := rs.Scan(&s); err != nil {
			t.Fatal(err)
		}
		out = append(out, s)
	}
	return out
}

// Conception §21.6.1 et §15 : schéma exact de comptes.db (tables, colonnes, index), rien
// d'autre ; aucune colonne texte (une adresse ne peut pas y entrer) ; plus de v_s ni env_s.
func TestSchemaComptes(t *testing.T) {
	db, _ := ouvrir(t)
	const wantMaster = "index:bannis_e_canon,index:comptes_e_canon,index:comptes_p_empreinte," +
		"index:sessions_h,index:sessions_sid,table:bannis,table:comptes,table:sessions"
	if got := strings.Join(lignes(t, db, `SELECT type || ':' || name FROM sqlite_master ORDER BY 1`), ","); got != wantMaster {
		t.Fatalf("sqlite_master = %s\nattendu        %s", got, wantMaster)
	}
	want := map[string]string{
		"comptes": "h:BLOB,e_canon:BLOB,e_envoi:BLOB,v_mdp:BLOB,env_mdp:BLOB,cle_profil:BLOB,p_empreinte:BLOB," +
			"pseudo_jour:INTEGER,blob_profil:BLOB,gen_profil:INTEGER,blob_prive:BLOB,gen_prive:INTEGER,totp:BLOB," +
			"totp_retrait_jour:INTEGER,recup_jour:INTEGER,cree_jour:INTEGER,compte_des:INTEGER,vu_mois:INTEGER,banni:INTEGER",
		"sessions": "t_v:BLOB,sid:BLOB,h:BLOB,etiquette:BLOB,cree_mois:INTEGER,expire_jour:INTEGER,persistante:INTEGER",
		"bannis":   "id:BLOB,e_canon:BLOB,debut_jour:INTEGER,jusqu_jour:INTEGER,actif:INTEGER,motif:INTEGER,salons_fermes:INTEGER",
	}
	for table, w := range want {
		got := strings.Join(lignes(t, db, `SELECT name || ':' || type FROM pragma_table_info(?) ORDER BY cid`, table), ",")
		if got != w {
			t.Errorf("%s : %s\nattendu %s", table, got, w)
		}
		for _, c := range strings.Split(got, ",") {
			if ty := c[strings.IndexByte(c, ':')+1:]; ty != "BLOB" && ty != "INTEGER" {
				t.Errorf("%s.%s : type %s (seuls BLOB et INTEGER)", table, c, ty)
			}
			if n := c[:strings.IndexByte(c, ':')]; n == "v_s" || n == "env_s" || n == "blob" || n == "gen" {
				t.Errorf("%s.%s : colonne de la version 1", table, n)
			}
		}
	}
	if v := lignes(t, db, `PRAGMA user_version`); len(v) != 1 || v[0] != "1" {
		t.Fatalf("user_version = %v", v)
	}
	for p, w := range map[string]string{"secure_delete": "1", "journal_mode": "wal", "foreign_keys": "1", "temp_store": "2",
		"journal_size_limit": "0", "synchronous": "2"} {
		if v := lignes(t, db, "PRAGMA "+p); len(v) != 1 || v[0] != w {
			t.Errorf("PRAGMA %s = %v, attendu %s", p, v, w)
		}
	}
}

func TestComptesWithoutRowid(t *testing.T) {
	db, _ := ouvrir(t)
	for _, table := range []string{"comptes", "sessions", "bannis"} {
		var v int
		if err := db.QueryRow("SELECT rowid FROM " + table).Scan(&v); err == nil || !strings.Contains(err.Error(), "rowid") {
			t.Errorf("%s a un rowid : %v", table, err)
		}
	}
}

const (
	jour = 86400 * 20000 // 4 octobre 2024, minuit UTC
	mois = 1727740800    // 1er octobre 2024, minuit UTC
	p4k  = 4096 + 45     // coffre au palier 4 Kio (engine/vectors/compte.json)
)

// insCompte : une ligne comptes valide, colonne col remplacée par v (SQL) si col n'est pas vide.
func insCompte(db *sql.DB, h string, col, v string) error {
	vals := map[string]string{
		"h": "x'" + h + "'", "e_canon": "randomblob(32)", "e_envoi": "randomblob(32)", "v_mdp": "randomblob(32)",
		"env_mdp": "randomblob(60)", "cle_profil": "randomblob(60)", "p_empreinte": "randomblob(32)",
		"pseudo_jour": itoa(jour), "blob_profil": "randomblob(" + itoa(p4k) + ")", "gen_profil": "1",
		"blob_prive": "randomblob(" + itoa(p4k) + ")", "gen_prive": "1", "totp": "NULL", "totp_retrait_jour": "NULL",
		"recup_jour": "NULL", "cree_jour": itoa(jour), "compte_des": itoa(jour), "vu_mois": itoa(mois), "banni": "0",
	}
	if col != "" {
		vals[col] = v
	}
	cols := []string{"h", "e_canon", "e_envoi", "v_mdp", "env_mdp", "cle_profil", "p_empreinte", "pseudo_jour", "blob_profil",
		"gen_profil", "blob_prive", "gen_prive", "totp", "totp_retrait_jour", "recup_jour", "cree_jour", "compte_des", "vu_mois", "banni"}
	var vs []string
	for _, c := range cols {
		vs = append(vs, vals[c])
	}
	_, err := db.Exec(`INSERT INTO comptes(` + strings.Join(cols, ",") + `) VALUES(` + strings.Join(vs, ",") + `)`)
	return err
}

func itoa(n int64) string { return strconv.FormatInt(n, 10) }

const h1 = "00112233445566778899aabbccddeeff"

// Dates au jour (multiple de 86 400) ou au mois (premier du mois, minuit UTC), jamais d'heure ;
// longueurs exactes des empreintes, enveloppes et coffres (paliers 4, 16, 64, 256 Kio).
func TestDatesAuJour(t *testing.T) {
	db, _ := ouvrir(t)
	if err := insCompte(db, h1, "", ""); err != nil {
		t.Fatal("compte valide refusé :", err)
	}
	refus := map[string][2]string{
		"cree_jour 86 401":        {"cree_jour", itoa(jour + 1)},
		"compte_des à 1 h":        {"compte_des", itoa(jour + 3600)},
		"pseudo_jour négatif":     {"pseudo_jour", "-86400"},
		"recup_jour à la seconde": {"recup_jour", itoa(jour + 1)},
		"totp_retrait_jour 1 h":   {"totp_retrait_jour", itoa(jour + 3600)},
		"vu_mois au 2 du mois":    {"vu_mois", itoa(mois + 86400)},
		"vu_mois à 1 h":           {"vu_mois", itoa(mois + 3600)},
		"h de 15":                 {"h", "x'00112233445566778899aabbccddee'"},
		"e_canon de 31":           {"e_canon", "randomblob(31)"},
		"e_envoi NULL":            {"e_envoi", "NULL"},
		"v_mdp de 33":             {"v_mdp", "randomblob(33)"},
		"env_mdp de 59":           {"env_mdp", "randomblob(59)"},
		"cle_profil de 61":        {"cle_profil", "randomblob(61)"},
		"p_empreinte de 16":       {"p_empreinte", "randomblob(16)"},
		"blob_profil hors palier": {"blob_profil", "randomblob(4096)"},
		"blob_prive hors palier":  {"blob_prive", "randomblob(" + itoa(p4k+1) + ")"},
		"blob_prive de 512 Kio":   {"blob_prive", "randomblob(" + itoa(524288+45) + ")"},
		"gen_profil négatif":      {"gen_profil", "-1"},
		"totp de 47":              {"totp", "randomblob(47)"},
		"banni 2":                 {"banni", "2"},
		"h texte":                 {"h", "'0011223344556677'"},
	}
	for nom, c := range refus {
		h := "ffeeddccbbaa99887766554433221100"
		if err := insCompte(db, h, c[0], c[1]); err == nil {
			t.Errorf("%s accepté", nom)
			db.Exec(`DELETE FROM comptes WHERE h=x'` + h + `'`)
		}
	}
	for _, palier := range []int64{4096, 16384, 65536, 262144} {
		h := "aa" + h1[2:]
		if err := insCompte(db, h, "blob_prive", "randomblob("+itoa(palier+45)+")"); err != nil {
			t.Errorf("palier %d refusé : %v", palier, err)
		}
		db.Exec(`DELETE FROM comptes WHERE h=x'` + h + `'`)
	}
	if err := insCompte(db, "bb"+h1[2:], "totp", "randomblob(48)"); err != nil {
		t.Error("totp de 48 refusé :", err)
	}
}

func TestSessionsEtBannisContraintes(t *testing.T) {
	db, _ := ouvrir(t)
	if err := insCompte(db, h1, "", ""); err != nil {
		t.Fatal(err)
	}
	ins := func(v ...string) error {
		_, err := db.Exec(`INSERT INTO sessions(t_v,sid,h,etiquette,cree_mois,expire_jour,persistante) VALUES(` +
			strings.Join(v, ",") + `)`)
		return err
	}
	ok := []string{"randomblob(32)", "randomblob(16)", "x'" + h1 + "'", "randomblob(64)", itoa(mois), itoa(jour), "1"}
	if err := ins(ok...); err != nil {
		t.Fatal("session valide refusée :", err)
	}
	for i, bad := range []string{"randomblob(31)", "randomblob(17)", "x'" + strings.Repeat("00", 16) + "'", "randomblob(63)",
		itoa(mois + 86400), itoa(jour + 1), "2"} {
		v := append([]string(nil), ok...)
		v[i] = bad
		if err := ins(v...); err == nil {
			t.Errorf("session : colonne %d = %s acceptée", i, bad)
		}
	}
	// Session sans étiquette : permise. Compte supprimé : ses sessions avec lui.
	v := append([]string(nil), ok...)
	v[3] = "NULL"
	if err := ins(v...); err != nil {
		t.Error("étiquette NULL refusée :", err)
	}
	if _, err := db.Exec(`DELETE FROM comptes WHERE h=x'` + h1 + `'`); err != nil {
		t.Fatal(err)
	}
	if n := lignes(t, db, `SELECT count(*) FROM sessions`); n[0] != "0" {
		t.Error("sessions d'un compte supprimé restantes :", n)
	}
	insB := func(v ...string) error {
		_, err := db.Exec(`INSERT INTO bannis(id,e_canon,debut_jour,jusqu_jour,actif,motif,salons_fermes) VALUES(` +
			strings.Join(v, ",") + `)`)
		return err
	}
	okB := []string{"randomblob(8)", "x'" + strings.Repeat("ab", 32) + "'", itoa(jour), itoa(jour + 86400*1095), "1", "10", "0"}
	if err := insB(okB...); err != nil {
		t.Fatal("bannissement valide refusé :", err)
	}
	for i, bad := range []string{"randomblob(9)", "x'" + strings.Repeat("ab", 32) + "'", itoa(jour + 1), itoa(jour + 7200), "2", "0", "-1"} {
		v := append([]string(nil), okB...)
		v[i] = bad
		if i != 1 {
			v[1] = "randomblob(32)"
		}
		if err := insB(v...); err == nil {
			t.Errorf("bannis : colonne %d = %s acceptée", i, bad)
		}
	}
	v = append([]string(nil), okB...)
	v[1], v[5] = "randomblob(32)", "11"
	if err := insB(v...); err == nil {
		t.Error("motif 11 accepté")
	}
}

// Base d'une version plus récente : refusée sans rien toucher ; fichiers en 0600.
func TestBaseVersionEtDroits(t *testing.T) {
	db, p := ouvrir(t)
	if err := insCompte(db, h1, "", ""); err != nil {
		t.Fatal(err)
	}
	for _, f := range []string{p, p + "-wal"} {
		st, err := os.Stat(f)
		if err != nil {
			t.Fatal(err)
		}
		if st.Mode().Perm() != 0o600 {
			t.Errorf("%s : droits %o", filepath.Base(f), st.Mode().Perm())
		}
	}
	if _, err := db.Exec(`PRAGMA user_version=2`); err != nil {
		t.Fatal(err)
	}
	db.Close()
	if db2, err := OuvrirBase(p); !errors.Is(err, ErrBasePlusRecente) {
		if db2 != nil {
			db2.Close()
		}
		t.Fatal("base plus récente acceptée :", err)
	}
	// Réouverture d'une base existante au bon schéma : le compte est gardé (elle survit aux
	// redémarrages, contrairement à shares.db).
	raw, _ := sql.Open("sqlite", "file:"+p)
	raw.Exec(`PRAGMA user_version=1`)
	raw.Close()
	os.Chmod(p, 0o644)
	db3, err := OuvrirBase(p)
	if err != nil {
		t.Fatal(err)
	}
	defer db3.Close()
	if n := lignes(t, db3, `SELECT count(*) FROM comptes`); n[0] != "1" {
		t.Fatal("compte perdu à la réouverture", n)
	}
	if st, _ := os.Stat(p); st.Mode().Perm() != 0o600 {
		t.Errorf("droits non resserrés : %o", st.Mode().Perm())
	}
}
