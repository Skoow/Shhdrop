package main

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"github.com/skoow/shhdrop/server/internal/api"
	"github.com/skoow/shhdrop/server/internal/blob"
	"github.com/skoow/shhdrop/server/internal/captcha"
	"github.com/skoow/shhdrop/server/internal/config"
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
		fmt.Fprintln(os.Stderr, "admin: pas encore implémenté")
		os.Exit(1)
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
	if err := os.MkdirAll(cfg.DataDir, 0o700); err != nil {
		return err
	}
	db, err := store.Open(filepath.Join(cfg.DataDir, "shares.db"))
	if err != nil {
		return err
	}
	defer db.Close()
	svc := &share.Service{DB: db, Blobs: &blob.Store{Dir: filepath.Join(cfg.DataDir, "blobs")}, Now: cfg.Now,
		StorageMax: cfg.StorageMaxBytes, FrozenFile: filepath.Join(cfg.DataDir, "frozen")}

	// Clés tirées à chaque démarrage, gardées en mémoire seulement (spec §7.7).
	tokKey, err := randomKey()
	if err != nil {
		return err
	}
	capKey, err := randomKey()
	if err != nil {
		return err
	}
	static := placeholder()
	if cfg.StaticDir != "" {
		static = http.FileServerFS(os.DirFS(cfg.StaticDir))
	}
	srv := newHTTPServer(api.New(svc, token.New(tokKey, cfg.Now), limits.New(cfg.Now),
		captcha.New(capKey, cfg.Now), static, cfg.BehindProxy))
	ln, err := net.Listen("tcp", cfg.Listen)
	if err != nil {
		return err
	}
	if _, err := fmt.Fprintf(out, "SHH_LISTENING %s\n", ln.Addr()); err != nil {
		ln.Close()
		return err
	}
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
