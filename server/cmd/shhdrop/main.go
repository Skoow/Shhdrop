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
	srv := &http.Server{
		Handler: api.New(svc, token.New(tokKey, cfg.Now), limits.New(cfg.Now), captcha.New(capKey, cfg.Now),
			static, cfg.BehindProxy),
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       120 * time.Second,
		WriteTimeout:      120 * time.Second,
		IdleTimeout:       60 * time.Second,
		// Les messages internes de net/http peuvent contenir l'adresse du client : jetés.
		ErrorLog: log.New(io.Discard, "", 0),
	}
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
	sctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := srv.Shutdown(sctx); err != nil {
		return err
	}
	if err := <-errc; !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}
