package main

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"slices"
	"syscall"
	"time"

	"github.com/skoow/shhdrop/server/internal/api"
	"github.com/skoow/shhdrop/server/internal/blob"
	"github.com/skoow/shhdrop/server/internal/captcha"
	"github.com/skoow/shhdrop/server/internal/config"
	"github.com/skoow/shhdrop/server/internal/janitor"
	"github.com/skoow/shhdrop/server/internal/limits"
	"github.com/skoow/shhdrop/server/internal/share"
	"github.com/skoow/shhdrop/server/internal/store"
	"github.com/skoow/shhdrop/server/internal/token"
)

func main() {
	if len(os.Args) < 2 {
		fmt.Fprintln(os.Stderr, "usage: shhdrop serve|admin")
		os.Exit(2)
	}
	switch os.Args[1] {
	case "serve":
		cfg, err := config.FromEnv()
		if err == nil {
			ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGTERM, os.Interrupt)
			err = serve(ctx, cfg, os.Stdout)
			stop()
		}
		if err != nil {
			fmt.Fprintln(os.Stderr, "erreur:", err)
			os.Exit(1)
		}
	case "admin":
		cfg, err := config.FromEnv()
		if err != nil {
			fmt.Fprintln(os.Stderr, "erreur:", err)
			os.Exit(1)
		}
		os.Exit(runAdmin(os.Args[2:], cfg, os.Stdin, os.Stdout, os.Stderr))
	default:
		fmt.Fprintf(os.Stderr, "commande inconnue: %s\n", os.Args[1])
		os.Exit(2)
	}
}

func randomKey() ([]byte, error) {
	k := make([]byte, 32)
	_, err := rand.Read(k)
	return k, err
}

// placeholder : page d'attente tant que le site (web/dist) n'est pas fourni.
func placeholder() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		io.WriteString(w, "<!doctype html><html lang=\"fr\"><meta charset=\"utf-8\"><title>Shhdrop</title><p>Shhdrop</p></html>\n")
	})
}

// prepareDataDir : SHH_DATA_DIR (absolu, vérifié par config) est créé s'il n'existe pas.
// Un dossier existant doit être vide (premier démarrage) ou contenir shares.db et blobs/ :
// sinon c'est sans doute le dossier d'un autre programme (/var, $HOME…), dont tightenPerms
// forcerait les droits et dont Reconcile effacerait des fichiers (audit F5).
func prepareDataDir(dir string) error {
	es, err := os.ReadDir(dir)
	if errors.Is(err, fs.ErrNotExist) {
		return os.MkdirAll(dir, 0o700)
	}
	if err != nil {
		return fmt.Errorf("SHH_DATA_DIR %s : %w", dir, err)
	}
	// lost+found : dossier créé par mkfs à la racine d'un volume ext4 dédié ; ignoré ici.
	// Un simple fichier de ce nom, lui, n'est pas celui de mkfs.
	es = slices.DeleteFunc(es, func(e fs.DirEntry) bool { return e.Name() == "lost+found" && e.Type().IsDir() })
	if len(es) == 0 {
		return nil
	}
	db, err1 := os.Stat(filepath.Join(dir, "shares.db"))
	blobs, err2 := os.Stat(filepath.Join(dir, "blobs"))
	if err1 != nil || err2 != nil || !db.Mode().IsRegular() || !blobs.IsDir() {
		return fmt.Errorf("SHH_DATA_DIR %s n'est pas vide et ne contient pas shares.db et blobs/ : refus "+
			"(dossier d'un autre programme ?) ; indiquer un dossier vide ou celui de Shhdrop", dir)
	}
	return nil
}

// diskFree : espace libre du système de fichiers (variable pour les tests).
var diskFree = statfsFree

// storageMargin : place laissée libre au-delà de SHH_STORAGE_MAX (base, WAL, système).
const storageMargin = 1 << 30

// checkStorage : SHH_STORAGE_MAX doit tenir dans l'espace libre plus la place déjà
// réservée par les fichiers, moins 1 Gio de marge (audit F6).
func checkStorage(dataDir string, max int64, used int64) error {
	free, err := diskFree(dataDir)
	if err != nil {
		return fmt.Errorf("espace disque de %s : %w", dataDir, err)
	}
	avail := free + uint64(used)
	if avail < storageMargin || uint64(max) > avail-storageMargin {
		return fmt.Errorf("SHH_STORAGE_MAX (%d octets) dépasse l'espace utilisable de %s "+
			"(%d libres + %d déjà réservés − 1 Gio de marge) : réduire SHH_STORAGE_MAX ou agrandir le disque",
			max, dataDir, free, used)
	}
	return nil
}

// tightenPerms resserre les droits au démarrage, même sur un dossier ou une base
// créés auparavant avec des droits plus larges : dossiers 0700, base et annexes 0600.
// SQLite crée les fichiers -wal et -shm avec les droits de la base.
func tightenPerms(dataDir string) error {
	blobs := filepath.Join(dataDir, "blobs")
	if err := os.MkdirAll(blobs, 0o700); err != nil {
		return err
	}
	for _, d := range []string{dataDir, blobs} {
		if err := os.Chmod(d, 0o700); err != nil {
			return err
		}
	}
	db := filepath.Join(dataDir, "shares.db")
	for _, f := range []string{db, db + "-wal", db + "-shm"} {
		if err := os.Chmod(f, 0o600); err != nil && !errors.Is(err, os.ErrNotExist) {
			return err
		}
	}
	return nil
}

// shutdownTimeout : délai laissé aux requêtes en cours à l'arrêt (variable pour les tests).
var shutdownTimeout = 30 * time.Second

// newHTTPServer : délais contre les connexions lentes (un segment de 4 Mio en 300 s
// demande environ 14 Ko/s) et en-têtes plafonnés à 16 Kio.
func newHTTPServer(h http.Handler) *http.Server {
	return &http.Server{
		Handler:           h,
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       300 * time.Second,
		WriteTimeout:      300 * time.Second,
		IdleTimeout:       60 * time.Second,
		MaxHeaderBytes:    16 << 10,
		// Les messages internes de net/http peuvent contenir l'adresse du client : jetés.
		ErrorLog: log.New(io.Discard, "", 0),
	}
}

// serve démarre le serveur et s'arrête proprement quand ctx est annulé.
// Seule sortie sur out : « SHH_LISTENING <hôte:port> » une fois l'écoute ouverte.
func serve(ctx context.Context, cfg config.Config, out io.Writer) error {
	if !filepath.IsAbs(cfg.DataDir) {
		return errors.New("SHH_DATA_DIR doit être un chemin absolu")
	}
	// Site vérifié avant de toucher au dossier de données.
	static := placeholder()
	if cfg.StaticDir != "" {
		var err error
		if static, err = staticHandler(cfg.StaticDir); err != nil {
			return err
		}
	}
	if err := prepareDataDir(cfg.DataDir); err != nil {
		return err
	}
	// Avant l'ouverture (fichiers existants) et après (fichiers que SQLite vient de créer).
	if err := tightenPerms(cfg.DataDir); err != nil {
		return err
	}
	db, err := store.Open(filepath.Join(cfg.DataDir, "shares.db"))
	if err != nil {
		return err
	}
	defer db.Close()
	if err := tightenPerms(cfg.DataDir); err != nil {
		return err
	}
	// En production (derrière le proxy), pas de fichier creux : la place doit être allouée.
	svc, err := share.NewService(share.Config{DB: db,
		Blobs: &blob.Store{Dir: filepath.Join(cfg.DataDir, "blobs"), NoSparse: cfg.BehindProxy},
		Now:   cfg.Now, StorageMax: cfg.StorageMaxBytes, FrozenFile: filepath.Join(cfg.DataDir, "frozen")})
	if err != nil {
		return err
	}
	if err := janitor.Reconcile(svc); err != nil {
		return err
	}
	used, err := svc.Blobs.UsedBytes()
	if err != nil {
		return err
	}
	if err := checkStorage(cfg.DataDir, cfg.StorageMaxBytes, used); err != nil {
		return err
	}
	// Sondes laissées par un arrêt brutal pendant CheckAllocate.
	if err := svc.Blobs.RemoveProbes(); err != nil {
		return err
	}
	if svc.Blobs.NoSparse {
		if err := svc.Blobs.CheckAllocate(); err != nil {
			return fmt.Errorf("SHH_BEHIND_PROXY=1 : %w", err)
		}
	}

	// Clés tirées à chaque démarrage, gardées en mémoire seulement (spec §7.7).
	tokKey, err := randomKey()
	if err != nil {
		return err
	}
	capKey, err := randomKey()
	if err != nil {
		return err
	}
	srv := newHTTPServer(api.New(svc, token.New(tokKey, cfg.Now), limits.New(cfg.Now),
		captcha.New(capKey, cfg.Now), static, cfg.BehindProxy, cfg.TrustedProxies))
	ln, err := net.Listen("tcp", cfg.Listen)
	if err != nil {
		return err
	}
	if _, err := fmt.Fprintf(out, "SHH_LISTENING %s\n", ln.Addr()); err != nil {
		ln.Close()
		return err
	}
	jctx, jcancel := context.WithCancel(ctx)
	jdone := make(chan struct{})
	go func() { janitor.Run(jctx, svc, db, 60*time.Second); close(jdone) }()
	defer func() { jcancel(); <-jdone }()
	errc := make(chan error, 1)
	go func() { errc <- srv.Serve(ln) }()
	select {
	case err := <-errc:
		return err
	case <-ctx.Done():
	}
	sctx, cancel := context.WithTimeout(context.Background(), shutdownTimeout)
	defer cancel()
	serr := srv.Shutdown(sctx)
	if serr != nil {
		// Délai dépassé : connexions fermées de force.
		srv.Close()
	}
	// Attendre la fin de Serve avant que defer ne ferme la base.
	if err := <-errc; !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	if serr != nil {
		return fmt.Errorf("arrêt forcé : %w", serr)
	}
	return nil
}
