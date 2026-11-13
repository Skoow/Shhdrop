package main

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"

	"github.com/skoow/shhdrop/server/internal/store"
)

// Audit adverse du 13 novembre, 2e passage, stockage, F2 : le vidage du WAL au démarrage
// passait AVANT la purge de démarrage ; avec SHH_SALONS=0 (configuration livrée), les partages
// purgés (envois en cours, « draining ») restaient lisibles dans shares.db jusqu'au premier
// passage du janitor (≈ 55 s mesurées). Le vidage se fait maintenant après la purge des
// partages, la réconciliation et la purge des salons, avant l'écoute : dès que le serveur
// écoute, ni shares.db ni shares.db-wal ne gardent l'identifiant ou les vérificateurs d'un
// partage purgé.
func TestVidageApresLaPurgeDeDemarrage(t *testing.T) {
	cfg, svc := adminSetup(t)
	id := mk(t, svc) // envoi en cours : effacé au démarrage (PurgeAtStart)
	var acc, man []byte
	if err := svc.DB.QueryRow(`SELECT access_v, manage_v FROM shares WHERE id=?`, id).Scan(&acc, &man); err != nil {
		t.Fatal(err)
	}
	// Replié dans shares.db, comme tout partage plus vieux qu'un passage du janitor, puis
	// arrêt (la base reste telle quelle sur le disque).
	if err := store.Checkpoint(svc.DB); err != nil {
		t.Fatal(err)
	}
	if err := svc.DB.Close(); err != nil {
		t.Fatal(err)
	}
	base := filepath.Join(cfg.DataDir, "shares.db")
	if data, _ := os.ReadFile(base); !bytes.Contains(data, acc) || !bytes.Contains(data, []byte(id)) {
		t.Fatal("témoin : partage absent de shares.db avant le démarrage")
	}
	cfg.Listen, cfg.StorageMaxBytes = "127.0.0.1:0", 1<<30
	startServe(t, cfg) // rend la main à « SHH_LISTENING » : purge et vidage sont faits
	for _, f := range []string{base, base + "-wal"} {
		data, _ := os.ReadFile(f)
		for nom, v := range map[string][]byte{"id": []byte(id), "V_accès": acc, "V_gestion": man} {
			if bytes.Contains(data, v) {
				t.Errorf("%s contient encore %s du partage purgé au démarrage", filepath.Base(f), nom)
			}
		}
	}
}
