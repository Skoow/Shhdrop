package salon

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/binary"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/skoow/shhdrop/server/internal/store"
)

// Audit adverse du 13 novembre, 2e passage, stockage, F1 : aucune fin de salon ne vidait le
// WAL (seuls la purge au démarrage, la destruction par l'administrateur et le wipe le
// faisaient) : identifiant, vérificateurs, sel et échéance restaient dans shares.db-wal et dans
// shares.db jusqu'au passage du janitor (60 s au plus). Toute fin de salon et tout
// renouvellement demandent maintenant un vidage regroupé (store.Vidage), fait dans la seconde.

// bancVidage : banc dont la boucle des vidages regroupés tourne, comme dans le serveur.
func bancVidage(t *testing.T) *banc {
	t.Helper()
	b := nouveauBanc(t, 10)
	ctx, cancel := context.WithCancel(context.Background())
	fini := make(chan struct{})
	go func() { b.m.vidage.Run(ctx); close(fini) }()
	t.Cleanup(func() { cancel(); <-fini })
	return b
}

// creerRepere : salon créé (sel aléatoire), replié dans shares.db, et ce qui l'identifie dans
// les fichiers de la base.
func (b *banc) creerRepere(t *testing.T) (cles, map[string][]byte) {
	t.Helper()
	c := nouvellesCles()
	r := reqValide(c)
	r.Salt = make([]byte, 16)
	rand.Read(r.Salt)
	if _, err := b.m.Creer(r); err != nil {
		t.Fatal(err)
	}
	var id string
	var exp int64
	if err := b.db.QueryRow(`SELECT id, expires_at FROM salons WHERE access_v=?`, r.AccessV).Scan(&id, &exp); err != nil {
		t.Fatal(err)
	}
	return c, map[string][]byte{"id": []byte(id), "V_accès": r.AccessV, "V_gestion": r.ManageV, "V_preuve": r.ProofV,
		"sel": r.Salt, "échéance": binary.BigEndian.AppendUint32(nil, uint32(exp))}
}

func restesBase(dir string, r map[string][]byte) []string {
	var l []string
	for _, f := range []string{"shares.db", "shares.db-wal"} {
		data, _ := os.ReadFile(filepath.Join(dir, f))
		for nom, v := range r {
			if bytes.Contains(data, v) {
				l = append(l, f+" : "+nom)
			}
		}
	}
	return l
}

func (b *banc) plusRienEnBase(t *testing.T, quoi string, r map[string][]byte) {
	t.Helper()
	var l []string
	for fin := time.Now().Add(5 * time.Second); time.Now().Before(fin); time.Sleep(20 * time.Millisecond) {
		if l = restesBase(b.dir, r); len(l) == 0 {
			return
		}
	}
	t.Errorf("%s : encore lisible 5 s après : %v", quoi, l)
}

func TestTouteFinDeSalonVideLeWAL(t *testing.T) {
	for nom, finir := range map[string]func(t *testing.T, b *banc, c cles){
		"destruction par le créateur": func(t *testing.T, b *banc, c cles) {
			b.entrer(t, c, true)
			if err := b.m.Detruire(c.gestion, nil); err != nil {
				t.Fatal(err)
			}
		},
		"échéance": func(t *testing.T, b *banc, c cles) {
			b.entrer(t, c, true)
			b.h.avancer(25 * time.Hour)
			b.m.Tick()
		},
		"échéance d'un salon où personne n'est entré": func(t *testing.T, b *banc, c cles) {
			b.h.avancer(25 * time.Hour)
			b.m.Tick()
		},
		"10 mots de passe faux": func(t *testing.T, b *banc, c cles) {
			for range 10 {
				b.m.Rejoindre(c.acces, aleatoire(), nil)
			}
			b.m.Tick()
		},
	} {
		t.Run(nom, func(t *testing.T) {
			b := bancVidage(t)
			c, r := b.creerRepere(t)
			if err := store.Checkpoint(b.db); err != nil {
				t.Fatal(err)
			}
			if len(restesBase(b.dir, r)) == 0 {
				t.Fatal("témoin : salon vivant absent de shares.db, le test ne prouve rien")
			}
			finir(t, b, c)
			var n int
			if err := b.db.QueryRow(`SELECT count(*) FROM salons`).Scan(&n); err != nil || n != 0 {
				t.Fatal("salon non effacé :", n, err)
			}
			b.plusRienEnBase(t, nom, r)
		})
	}
}

// Renouvellement : l'ancienne échéance (donc l'heure de création à 15 min près) ne reste ni
// dans le -wal ni dans la base.
func TestRenouvellementVideLeWAL(t *testing.T) {
	b := bancVidage(t)
	c, r := b.creerRepere(t)
	if err := store.Checkpoint(b.db); err != nil {
		t.Fatal(err)
	}
	ancienne := map[string][]byte{"ancienne échéance": r["échéance"]}
	if len(restesBase(b.dir, ancienne)) == 0 {
		t.Fatal("témoin : échéance absente de shares.db")
	}
	b.h.avancer(3 * time.Hour)
	b.regler(t, c, ReglagesReq{Heures: 24})
	b.plusRienEnBase(t, "renouvellement", ancienne)
}
