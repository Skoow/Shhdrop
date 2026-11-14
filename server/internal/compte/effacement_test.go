package compte

import (
	"bytes"
	"errors"
	"os"
	"testing"
	"time"
)

// Lot 5 du plan du compte : suppression du compte et effacements (conception §8.5, §12.4,
// §21.12 ; décision du propriétaire du 14 novembre : on supprime ce dont la personne est
// l'auteur ou l'admin).

// Suppression : lignes du compte et de ses sessions, coffres, séquestre, empreintes et pseudo
// effacés (fichier et WAL, après fermeture) ; salons du compte fermés par le crochet ; ligne
// bannis gardée ; pseudo et adresse libres aussitôt.
func TestSuppressionEfface(t *testing.T) {
	b := nouveauBanc(t)
	var fermes [][16]byte
	b.s.fermerSalons = func(h [16]byte) (int, error) {
		fermes = append(fermes, h)
		if len(fermes) > 1 {
			return 0, nil // seconde passe (lot 6), après l'effacement : plus rien
		}
		return 2, nil
	}
	_, jLeo, _ := b.inscrire(t, ipN(1), "leo@exemple.fr", "leo")
	h, j, d := b.inscrire(t, ipA, "lea@exemple.fr", "lea")
	b.s.Connexion(ipA, "lea@exemple.fr", d.AAuth, OptionsSession{Persistante: true, Etiquette: bytes.Repeat([]byte{9}, 64)}, false)
	canon, _ := b.cles.Empreintes(mustAdresse(t, "lea@exemple.fr"))
	if _, err := b.db.Exec(`INSERT INTO bannis VALUES(?,?,?,?,1,4,0)`, alea8(), canon[:], jourDe(b.clk.Now()),
		jourDe(b.clk.Now())+30*jourS); err != nil {
		t.Fatal(err)
	}
	var ligne struct{ envoi, vm, cle, pe []byte }
	b.db.QueryRow(`SELECT e_envoi, v_mdp, cle_profil, p_empreinte FROM comptes WHERE h=?`, h[:]).Scan(
		&ligne.envoi, &ligne.vm, &ligne.cle, &ligne.pe)
	b.clk.Add(5 * time.Minute)
	if _, err := b.s.Supprimer(b.session(t, j)); !errors.Is(err, ErrRecent) {
		t.Fatal("non récente :", err)
	}
	if err := b.s.Reauth(ipA, b.session(t, j), d.AAuth, ""); err != nil {
		t.Fatal(err)
	}
	n, err := b.s.Supprimer(b.session(t, j))
	if err != nil || n != 2 || len(fermes) != 2 || fermes[0] != h || fermes[1] != h {
		t.Fatal(n, err, fermes)
	}
	var nc, ns, nb int
	b.db.QueryRow(`SELECT count(*) FROM comptes WHERE h=?`, h[:]).Scan(&nc)
	b.db.QueryRow(`SELECT count(*) FROM sessions WHERE h=?`, h[:]).Scan(&ns)
	b.db.QueryRow(`SELECT count(*) FROM bannis WHERE e_canon=?`, canon[:]).Scan(&nb)
	if nc != 0 || ns != 0 || nb != 1 {
		t.Fatal(nc, ns, nb)
	}
	if _, err := b.s.Session(j); !errors.Is(err, ErrSession) {
		t.Fatal(err)
	}
	// Pseudo libre aussitôt.
	if libre, err := b.s.PseudoVerifier(b.session(t, jLeo), []byte("lea")); err != nil || !libre {
		t.Fatal("pseudo encore pris :", err)
	}
	b.db.Close()
	f := b.fichiers(t)
	for nom, v := range map[string][]byte{"h": h[:], "e_envoi": ligne.envoi, "v_mdp": ligne.vm, "cle_profil": ligne.cle,
		"p_empreinte": ligne.pe, "env_mdp": d.EnvMdp[:], "blob_profil": d.BlobProfil[45:1045], "blob_prive": d.BlobPrive[45:1045]} {
		if bytes.Contains(f, v) {
			t.Errorf("%s encore dans les fichiers", nom)
		}
	}
	if st, err := os.Stat(b.chemin + "-wal"); err == nil && st.Size() != 0 {
		t.Errorf("WAL de %d octets", st.Size())
	}
}

// Sans crochet de salons (avant le lot 6) : aucune fermeture, 0 ; un échec du crochet arrête
// la suppression (le compte reste, on peut réessayer).
func TestSuppressionCrochetSalons(t *testing.T) {
	b := nouveauBanc(t)
	_, j, _ := b.inscrire(t, ipA, "lea@exemple.fr", "lea")
	b.s.fermerSalons = func([16]byte) (int, error) { return 0, errors.New("salons") }
	if _, err := b.s.Supprimer(b.session(t, j)); err == nil || b.nComptes(t) != 1 {
		t.Fatal("suppression malgré l'échec du crochet :", err)
	}
	b.s.fermerSalons = nil
	if n, err := b.s.Supprimer(b.session(t, j)); err != nil || n != 0 || b.nComptes(t) != 0 {
		t.Fatal(n, err)
	}
}

// Comptes sans connexion depuis 13 mois (vu_mois au mois : effacés au début du 14e mois, jamais
// avant 13 mois pleins) ; sessions échues effacées.
func TestInactifs13Mois(t *testing.T) {
	b := nouveauBanc(t)
	h, j, _ := b.inscrire(t, ipA, "lea@exemple.fr", "lea") // vu en novembre 2026
	h2, _, d2 := b.inscrire(t, ipN(1), "leo@exemple.fr", "leo")
	b.s.Connexion(ipN(1), "leo@exemple.fr", d2.AAuth, OptionsSession{Persistante: true}, false)
	_ = j
	b.clk.Add(time.Date(2027, 12, 31, 23, 0, 0, 0, time.UTC).Sub(b.clk.Now()))
	// leo se connecte en décembre 2027.
	b.s.Connexion(ipN(1), "leo@exemple.fr", d2.AAuth, OptionsSession{}, false)
	if n, err := b.s.Effacer(b.clk.Now()); err != nil || n != 0 || b.nComptes(t) != 2 {
		t.Fatal("décembre 2027 :", n, err)
	}
	b.clk.Add(time.Hour)
	n, err := b.s.Effacer(b.clk.Now())
	if err != nil || n != 1 {
		t.Fatal("janvier 2028 :", n, err)
	}
	var x int
	if b.db.QueryRow(`SELECT 1 FROM comptes WHERE h=?`, h[:]).Scan(&x) == nil {
		t.Fatal("inactif gardé")
	}
	if b.db.QueryRow(`SELECT 1 FROM comptes WHERE h=?`, h2[:]).Scan(&x) != nil {
		t.Fatal("actif effacé")
	}
	// Sessions échues (celles de 2026) effacées ; reste la session simple de décembre 2027.
	if ns := b.nSessions(t); ns != 1 {
		t.Fatal(ns, "sessions échues gardées")
	}
}

// Bannissements échus (échéance passée, suspendus compris) effacés ; les autres gardés.
func TestBannisEchus(t *testing.T) {
	b := nouveauBanc(t)
	aujourd := jourDe(b.clk.Now())
	for i, v := range []struct {
		jusqu int64
		actif int
	}{{aujourd, 1}, {aujourd - jourS, 0}, {aujourd + jourS, 1}, {aujourd + jourS, 0}} {
		canon := alea32()
		if _, err := b.db.Exec(`INSERT INTO bannis VALUES(?,?,?,?,?,10,0)`, []byte{byte(i), 1, 2, 3, 4, 5, 6, 7}, canon[:],
			aujourd-30*jourS, v.jusqu, v.actif); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := b.s.Effacer(b.clk.Now()); err != nil {
		t.Fatal(err)
	}
	var n int
	b.db.QueryRow(`SELECT count(*) FROM bannis WHERE jusqu_jour > ?`, aujourd).Scan(&n)
	var tous int
	b.db.QueryRow(`SELECT count(*) FROM bannis`).Scan(&tous)
	if n != 2 || tous != 2 {
		t.Fatal(n, tous)
	}
}

func alea8() []byte { k := alea32(); return k[:8] }
