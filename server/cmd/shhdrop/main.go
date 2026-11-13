package main

import (
	"context"
	"crypto/rand"
	"database/sql"
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
	"github.com/skoow/shhdrop/server/internal/salon"
	"github.com/skoow/shhdrop/server/internal/share"
	"github.com/skoow/shhdrop/server/internal/store"
	"github.com/skoow/shhdrop/server/internal/token"
)

func main() { os.Exit(runCmd(os.Args, os.Stdout, os.Stderr)) }

// serveFn : serve (variable pour les tests).
var serveFn = serve

// runCmd : commande args[1]. Rien de ce que le programme ne maîtrise pas n'est recopié sur
// stderr (audit F3, F4) : ni l'argument reçu (il peut contenir un lien collé par erreur), ni
// une erreur système (son chemin peut contenir l'identifiant interne d'un partage), voir
// publicMessage. Les erreurs de configuration (config.FromEnv) ne reprennent que les valeurs
// données par l'exploitant.
func runCmd(args []string, stdout, stderr io.Writer) int {
	if len(args) < 2 {
		fmt.Fprintln(stderr, "usage: shhdrop serve|admin")
		return 2
	}
	switch args[1] {
	case "serve":
		cfg, err := config.FromEnv()
		if err != nil {
			fmt.Fprintln(stderr, "erreur:", err)
			return 1
		}
		ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGTERM, os.Interrupt)
		err = serveFn(ctx, cfg, stdout)
		stop()
		if err != nil {
			fmt.Fprintln(stderr, "erreur:", publicMessage(err))
			return 1
		}
		return 0
	case "admin":
		cfg, err := config.FromEnv()
		if err != nil {
			fmt.Fprintln(stderr, "erreur:", err)
			return 1
		}
		return runAdmin(args[2:], cfg, os.Stdin, stdout, stderr)
	default:
		fmt.Fprintln(stderr, "commande inconnue ; usage: shhdrop serve|admin")
		return 2
	}
}

// shownError : message écrit pour l'exploitant (règle de configuration, consigne), sûr à
// afficher : il ne reprend que des valeurs de la configuration, jamais une erreur système.
type shownError struct{ msg string }

func (e shownError) Error() string { return e.msg }

func shown(msg string) error { return shownError{msg} }

func shownf(format string, a ...any) error { return shownError{fmt.Sprintf(format, a...)} }

// publicMessage : texte d'une erreur pour stderr. Un message écrit pour l'exploitant
// (shownError, store.ErrNewerSchema, blob.ErrNoAllocate) est rendu tel quel ; toute autre
// erreur (système, base) est remplacée par un message fixe : son texte peut contenir un
// chemin de fichier de partage, donc un identifiant interne (spec §9.4, §36).
func publicMessage(err error) string {
	var s shownError
	switch {
	case errors.As(err, &s):
		return s.msg
	case errors.Is(err, store.ErrNewerSchema), errors.Is(err, store.ErrOldSchema), errors.Is(err, store.ErrSalonsPerimes),
		errors.Is(err, store.ErrCheckpointBusy),
		errors.Is(err, blob.ErrNoAllocate):
		return firstKnown(err).Error()
	}
	return "échec (erreur système, détail non affiché : il peut contenir un identifiant de partage)"
}

// firstKnown : l'erreur connue de publicMessage contenue dans err.
func firstKnown(err error) error {
	for _, k := range []error{store.ErrNewerSchema, store.ErrOldSchema, store.ErrSalonsPerimes, store.ErrCheckpointBusy,
		blob.ErrNoAllocate} {
		if errors.Is(err, k) {
			return k
		}
	}
	return err
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
		io.WriteString(w, "<!doctype html><html lang=\"fr\"><meta charset=\"utf-8\"><title>Shhgone</title><p>Shhgone</p></html>\n")
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
		return shownf("SHH_DATA_DIR %s n'est pas vide et ne contient pas shares.db et blobs/ : refus "+
			"(dossier d'un autre programme ?) ; indiquer un dossier vide ou celui de Shhgone", dir)
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
		return shownf("SHH_STORAGE_MAX (%d octets) dépasse l'espace utilisable de %s "+
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

// salonsOf : réglages du salon donnés à l'API, valeur zéro (désactivé) sans SHH_SALONS=1,
// même si SHH_ORIGIN est posée (la CSP reste alors celle d'avant le salon).
func salonsOf(cfg config.Config, m *salon.Manager) api.Salons {
	if !cfg.Salons {
		return api.Salons{}
	}
	return api.Salons{Origin: cfg.Origin, M: m}
}

// capacityOf : places du serveur (config.Capacity) données à l'API.
func capacityOf(cfg config.Config) api.Capacity {
	c := cfg.Capacity
	return api.Capacity{Uploads: c.Uploads, Downloads: c.Downloads, Watches: c.Watches, WebSockets: c.WebSockets}
}

// Dossiers du salon sous SHH_DATA_DIR : conversations et pièces (jamais blobs/, que
// janitor.Reconcile vide de ce qu'il n'y connaît pas).
const dirSalons, dirSalonPieces = "salons", "salon-pieces"

// salonWait : attente, à l'arrêt, de la fin des WebSocket du salon avant la fermeture de la
// base (FermerTout ne les attend pas ; l'écrivain d'un client qui ne lit plus rend au plus
// après 1 s).
const salonWait = 5 * time.Second

// setupSalons : sans SHH_SALONS=1, rien (nil : aucune route, ExtraUsed des partages non câblé,
// aucun dossier créé). Sinon le gestionnaire du salon, dossiers en 0700, purge au démarrage
// faite (plan C-2, point 11 : avant l'écoute), et l'usage du salon ajouté à celui des
// partages (ExtraUsed). Le gestionnaire voit les partages par UsedShares, qui n'inclut
// jamais ExtraUsed : aucun double compte.
func setupSalons(cfg config.Config, db *sql.DB, svc *share.Service, lim *limits.Limiter, gate *blob.Gate) (*salon.Manager, error) {
	if !cfg.Salons {
		return nil, nil
	}
	m, err := salon.NewManager(salon.Config{DB: db,
		Pieces:               &blob.Store{Dir: filepath.Join(cfg.DataDir, dirSalonPieces), NoSparse: cfg.BehindProxy, Gate: gate},
		DossierConversations: filepath.Join(cfg.DataDir, dirSalons), Now: cfg.Now, Max: cfg.SalonsMax,
		StorageMax: cfg.StorageMaxBytes, UsedPartages: svc.UsedShares, OnAbandon: lim.AbandonUpload,
		TramesMax: cfg.Capacity.SalonFrames, SalonFramesTotal: cfg.Capacity.SalonFramesTotal})
	if err != nil {
		return nil, err
	}
	if err := m.PurgerAuDemarrage(); err != nil {
		return nil, err
	}
	svc.ExtraUsed = m.UsedBytes
	return m, nil
}

// usedAtStart : place déjà prise sous SHH_STORAGE_MAX au démarrage (checkStorage) : partages
// et, salon actif, pièces et conversations (rien après la purge, compté quand même).
func usedAtStart(svc *share.Service, m *salon.Manager) (int64, error) {
	used, err := svc.UsedShares()
	if err != nil || m == nil {
		return used, err
	}
	u, err := m.Usage()
	return used + u, err
}

// shutdownTimeout : délai laissé aux requêtes en cours à l'arrêt (variable pour les tests).
var shutdownTimeout = 30 * time.Second

// newHTTPServer : délais contre les connexions lentes et en-têtes plafonnés à 16 Kio.
// Les 300 s ne sont qu'un filet : chaque transfert de segment pose sa propre échéance,
// plus courte (api, xferMinRate).
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
		return shown("SHH_DATA_DIR doit être un chemin absolu")
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
	// Limites en mémoire ; un envoi effacé sans finalize compte en octets abandonnés (§29.5).
	// Une seule borne des appels de fichiers pour les partages et les pièces (audit D4).
	gate := blob.NewGate(max(1, cfg.Capacity.DiskOps))
	lim := limits.New(cfg.Now)
	lim.SetStorage(cfg.StorageMaxBytes) // part équitable du stockage (audit D2)
	lim.SetSegmentsPerMin(cfg.Capacity.SegmentsPerMin)
	svc, err := share.NewService(share.Config{DB: db, OnAbandon: func(id string, _ int) { lim.AbandonUpload(id) },
		Blobs: &blob.Store{Dir: filepath.Join(cfg.DataDir, "blobs"), NoSparse: cfg.BehindProxy, Gate: gate},
		Now:   cfg.Now, StorageMax: cfg.StorageMaxBytes, FrozenFile: filepath.Join(cfg.DataDir, "frozen")})
	if err != nil {
		return err
	}
	// Envois, « draining » et partages échus effacés (leurs échéances étaient en mémoire, aucun
	// jeton ne survit : spec §36 S12, §41.8), puis fichiers sans ligne et lignes sans fichier.
	if _, err := svc.PurgeAtStart(); err != nil {
		return err
	}
	if err := janitor.Reconcile(svc); err != nil {
		return err
	}
	sm, err := setupSalons(cfg, db, svc, lim, gate)
	if err != nil {
		return err
	}
	used, err := usedAtStart(svc, sm)
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
	srv := newHTTPServer(api.New(svc, token.New(tokKey, cfg.Now), lim,
		captcha.New(capKey, cfg.Now), static, cfg.BehindProxy, cfg.TrustedProxies, salonsOf(cfg, sm), capacityOf(cfg)))
	if sm != nil {
		// net/http ne suit plus une connexion mise à niveau : Shutdown ne l'attend pas.
		srv.RegisterOnShutdown(sm.FermerTout)
		// Exécuté avant db.Close (defer) : WebSocket fermés et attendus (au plus salonWait).
		defer func() {
			sm.FermerTout()
			sm.AttendreConnexions(salonWait)
		}()
	}
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
	wdone := make(chan struct{})
	go func() { janitor.Run(jctx, svc, db, 60*time.Second); close(jdone) }()
	// Chaque seconde : partages effacés hors du serveur (shhdrop admin destroy) → flux
	// coupés et surveillances prévenues (spec §41.8).
	go func() { janitor.Watch(jctx, svc, time.Second); close(wdone) }()
	// Salon : Tick chaque seconde (échéances, sièges hors ligne, pièces, salons échus, lignes
	// supprimées par l'administrateur), arrêté avant la fermeture de la base.
	rdone := make(chan struct{})
	if sm != nil {
		go func() { sm.Run(jctx); close(rdone) }()
	} else {
		close(rdone)
	}
	defer func() { jcancel(); <-jdone; <-wdone; <-rdone }()
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
