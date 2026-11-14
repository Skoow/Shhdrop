package compte

import (
	"database/sql"
	"errors"
	"fmt"
	"os"

	"github.com/skoow/shhdrop/server/internal/store"
)

// Schéma de comptes.db (conception §21.6.1 ; règles de §8.2 : mêmes PRAGMA que shares.db,
// WITHOUT ROWID, 0600). Seulement des BLOB et des INTEGER (aucune colonne texte : une adresse
// ne peut pas y entrer) ; longueurs exactes ; dates au jour (minuit UTC, multiple de 86 400)
// ou au mois (premier du mois, minuit UTC), jamais d'heure. Cette base survit aux
// redémarrages et est sauvegardée (§21.13), contrairement à shares.db.
//
// comptes : h (16, tiré par le serveur) ; e_canon, e_envoi (empreintes à clé de l'adresse) ;
// v_mdp (HMAC de A_auth) ; env_mdp (Env_mdp, 60) ; cle_profil (séquestre de s_profil, 60) ;
// p_empreinte (empreinte à clé du pseudo) ; coffres de profil et privé au palier exact
// (4, 16, 64 ou 256 Kio + 45 octets d'en-tête, de nonce et d'étiquette) avec leur gen ; totp
// (secret chiffré, 48) ; attentes de sécurité (R3, R4) ; ancienneté ; banni.
// sessions : t_v (SHA-256 du jeton) ; sid (identifiant montré) ; h (effacées avec le compte) ;
// etiquette (nom d'appareil chiffré par le client, 64) ; mois d'ajout ; jour d'échéance.
// bannis : id (8, montré au fondateur) ; e_canon ; début et échéance ; actif ; motif
// (catégorie 1 à 10, §21.10.1) ; salons fermés. Gardée après la suppression du compte.
var schemaComptes = `
CREATE TABLE IF NOT EXISTS comptes(
  h BLOB PRIMARY KEY CHECK(` + blobN("h", 16) + `),
  e_canon BLOB NOT NULL CHECK(` + blobN("e_canon", 32) + `),
  e_envoi BLOB NOT NULL CHECK(` + blobN("e_envoi", 32) + `),
  v_mdp BLOB NOT NULL CHECK(` + blobN("v_mdp", 32) + `),
  env_mdp BLOB NOT NULL CHECK(` + blobN("env_mdp", 60) + `),
  cle_profil BLOB NOT NULL CHECK(` + blobN("cle_profil", 60) + `),
  p_empreinte BLOB NOT NULL CHECK(` + blobN("p_empreinte", 32) + `),
  pseudo_jour INTEGER NOT NULL CHECK(` + jourCheck("pseudo_jour") + `),
  blob_profil BLOB NOT NULL CHECK(` + coffreCheck("blob_profil") + `),
  gen_profil INTEGER NOT NULL CHECK(gen_profil >= 0),
  blob_prive BLOB NOT NULL CHECK(` + coffreCheck("blob_prive") + `),
  gen_prive INTEGER NOT NULL CHECK(gen_prive >= 0),
  totp BLOB CHECK(totp IS NULL OR (` + blobN("totp", 48) + `)),
  totp_retrait_jour INTEGER CHECK(totp_retrait_jour IS NULL OR (` + jourCheck("totp_retrait_jour") + `)),
  recup_jour INTEGER CHECK(recup_jour IS NULL OR (` + jourCheck("recup_jour") + `)),
  cree_jour INTEGER NOT NULL CHECK(` + jourCheck("cree_jour") + `),
  compte_des INTEGER NOT NULL CHECK(` + jourCheck("compte_des") + `),
  vu_mois INTEGER NOT NULL CHECK(` + moisCheck("vu_mois") + `),
  banni INTEGER NOT NULL CHECK(banni IN (0,1))) WITHOUT ROWID;
CREATE UNIQUE INDEX IF NOT EXISTS comptes_e_canon ON comptes(e_canon);
CREATE UNIQUE INDEX IF NOT EXISTS comptes_p_empreinte ON comptes(p_empreinte);
CREATE TABLE IF NOT EXISTS sessions(
  t_v BLOB PRIMARY KEY CHECK(` + blobN("t_v", 32) + `),
  sid BLOB NOT NULL CHECK(` + blobN("sid", 16) + `),
  h BLOB NOT NULL REFERENCES comptes(h) ON DELETE CASCADE,
  etiquette BLOB CHECK(etiquette IS NULL OR (` + blobN("etiquette", 64) + `)),
  cree_mois INTEGER NOT NULL CHECK(` + moisCheck("cree_mois") + `),
  expire_jour INTEGER NOT NULL CHECK(` + jourCheck("expire_jour") + `),
  persistante INTEGER NOT NULL CHECK(persistante IN (0,1))) WITHOUT ROWID;
CREATE UNIQUE INDEX IF NOT EXISTS sessions_sid ON sessions(sid);
CREATE INDEX IF NOT EXISTS sessions_h ON sessions(h);
CREATE TABLE IF NOT EXISTS bannis(
  id BLOB PRIMARY KEY CHECK(` + blobN("id", 8) + `),
  e_canon BLOB NOT NULL CHECK(` + blobN("e_canon", 32) + `),
  debut_jour INTEGER NOT NULL CHECK(` + jourCheck("debut_jour") + `),
  jusqu_jour INTEGER NOT NULL CHECK(` + jourCheck("jusqu_jour") + `),
  actif INTEGER NOT NULL CHECK(actif IN (0,1)),
  motif INTEGER NOT NULL CHECK(motif BETWEEN 1 AND 10),
  salons_fermes INTEGER NOT NULL CHECK(salons_fermes >= 0)) WITHOUT ROWID;
CREATE UNIQUE INDEX IF NOT EXISTS bannis_e_canon ON bannis(e_canon)`

func blobN(col string, n int) string {
	return fmt.Sprintf("typeof(%s)='blob' AND length(%s)=%d", col, col, n)
}

func jourCheck(col string) string {
	return fmt.Sprintf("typeof(%s)='integer' AND %s >= 0 AND %s %% 86400 = 0", col, col, col)
}

// moisCheck : premier du mois, minuit UTC (fonctions de date sans « now » : déterministes).
func moisCheck(col string) string {
	return fmt.Sprintf("typeof(%s)='integer' AND %s >= 0 AND strftime('%%d %%H:%%M:%%S', %s, 'unixepoch') = '01 00:00:00'",
		col, col, col)
}

// coffreCheck : « SHH-ACCT1 » ou « SHH-PROF1 » (9) ‖ gen (8) ‖ nonce (12) ‖ chiffré du clair
// bourré au palier ‖ étiquette (16) : palier + 45 octets (engine/vectors/compte.json).
func coffreCheck(col string) string {
	return fmt.Sprintf("typeof(%s)='blob' AND length(%s) IN (%d,%d,%d,%d)", col, col,
		4096+45, 16384+45, 65536+45, 262144+45)
}

// VersionBase : version du schéma de comptes.db (PRAGMA user_version).
const VersionBase = 1

// ErrBasePlusRecente : comptes.db écrite par une version plus récente ; message fixe, sans chemin.
var ErrBasePlusRecente = errors.New("comptes.db créée par une version plus récente de Shhgone : refus d'ouvrir " +
	"(retour arrière : réinstaller la version récente ; ne jamais effacer cette base, elle garde les comptes)")

// OuvrirBase ouvre (ou crée) comptes.db : fichier créé en 0600 avant SQLite, droits resserrés
// (base, -wal, -shm), mêmes PRAGMA que shares.db, une seule connexion, schéma exact. Une base
// d'une version plus récente n'est pas touchée. chemin : absolu, sans « ? », « # » ni « % »
// (SHH_DATA_DIR, vérifié par config).
func OuvrirBase(chemin string) (*sql.DB, error) {
	f, err := os.OpenFile(chemin, os.O_RDWR|os.O_CREATE, 0o600)
	if err != nil {
		return nil, err
	}
	f.Close()
	if err := serrer(chemin); err != nil {
		return nil, err
	}
	db, err := sql.Open("sqlite", "file:"+chemin+"?"+store.Pragmas)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	var v int
	if err := db.QueryRow(`PRAGMA user_version`).Scan(&v); err != nil {
		db.Close()
		return nil, fmt.Errorf("lecture de la version de comptes.db : %w", err)
	}
	if v > VersionBase {
		db.Close()
		return nil, ErrBasePlusRecente
	}
	if _, err := db.Exec(schemaComptes); err != nil {
		db.Close()
		return nil, fmt.Errorf("création du schéma de comptes.db : %w", err)
	}
	if _, err := db.Exec(fmt.Sprintf(`PRAGMA user_version=%d`, VersionBase)); err != nil {
		db.Close()
		return nil, err
	}
	if err := serrer(chemin); err != nil {
		db.Close()
		return nil, err
	}
	return db, nil
}

// serrer : base et annexes en 0600 (SQLite crée -wal et -shm avec les droits de la base).
func serrer(chemin string) error {
	for _, f := range []string{chemin, chemin + "-wal", chemin + "-shm"} {
		if err := os.Chmod(f, 0o600); err != nil && !errors.Is(err, os.ErrNotExist) {
			return err
		}
	}
	return nil
}
