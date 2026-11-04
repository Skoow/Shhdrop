package main

import (
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net/url"
	"os"
	"path/filepath"
	"strings"

	"github.com/skoow/shhdrop/server/internal/blob"
	"github.com/skoow/shhdrop/server/internal/config"
	"github.com/skoow/shhdrop/server/internal/share"
	"github.com/skoow/shhdrop/server/internal/store"
)

// Codes de sortie : 0 ok, 1 opération échouée, 2 erreur d'usage.
// La sortie ne reprend jamais l'argument reçu (il peut contenir un secret).
func runAdmin(args []string, cfg config.Config, stdout, stderr io.Writer) int {
	usage := func(msg string) int {
		fmt.Fprintln(stderr, msg)
		fmt.Fprintln(stderr, "usage: shhdrop admin freeze|unfreeze|destroy <id ou lien>|wipe --yes")
		return 2
	}
	if len(args) == 0 {
		return usage("commande admin manquante")
	}
	frozen := filepath.Join(cfg.DataDir, "frozen")
	fail := func(err error) int {
		fmt.Fprintln(stderr, "erreur:", err)
		return 1
	}
	switch args[0] {
	case "freeze":
		if len(args) != 1 {
			return usage("freeze n'a pas d'argument")
		}
		if err := os.MkdirAll(cfg.DataDir, 0o700); err != nil {
			return fail(err)
		}
		f, err := os.OpenFile(frozen, os.O_CREATE|os.O_WRONLY, 0o600)
		if err != nil {
			return fail(err)
		}
		if err := f.Close(); err != nil {
			return fail(err)
		}
		fmt.Fprintln(stdout, "créations suspendues")
	case "unfreeze":
		if len(args) != 1 {
			return usage("unfreeze n'a pas d'argument")
		}
		if err := os.Remove(frozen); err != nil && !errors.Is(err, fs.ErrNotExist) {
			return fail(err)
		}
		fmt.Fprintln(stdout, "créations rétablies")
	case "destroy":
		if len(args) != 2 {
			return usage("destroy attend un identifiant ou un lien")
		}
		id, ok := extractID(args[1])
		if !ok {
			return usage("identifiant invalide")
		}
		svc, closeFn, err := openService(cfg)
		if err != nil {
			return fail(err)
		}
		defer closeFn()
		if err := svc.DestroyAdmin(id); err != nil {
			if errors.Is(err, share.ErrNotFound) {
				fmt.Fprintln(stderr, "introuvable")
				return 1
			}
			return fail(err)
		}
		fmt.Fprintln(stdout, "détruit")
	case "wipe":
		if len(args) != 2 || args[1] != "--yes" {
			return usage("wipe efface tous les partages : relancer avec --yes pour confirmer")
		}
		svc, closeFn, err := openService(cfg)
		if err != nil {
			return fail(err)
		}
		defer closeFn()
		ids, err := svc.Blobs.List()
		if err != nil {
			return fail(err)
		}
		var errs []error
		for _, id := range ids {
			errs = append(errs, svc.Blobs.Delete(id))
		}
		_, err = svc.DB.Exec(`DELETE FROM shares`)
		errs = append(errs, err)
		if err == nil {
			errs = append(errs, store.Checkpoint(svc.DB))
		}
		if err := errors.Join(errs...); err != nil {
			return fail(err)
		}
		fmt.Fprintln(stdout, "tout est effacé")
	default:
		return usage("commande admin inconnue")
	}
	return 0
}

func openService(cfg config.Config) (*share.Service, func(), error) {
	db, err := store.Open(filepath.Join(cfg.DataDir, "shares.db"))
	if err != nil {
		return nil, nil, err
	}
	return &share.Service{DB: db, Blobs: &blob.Store{Dir: filepath.Join(cfg.DataDir, "blobs")},
			Now: cfg.Now, StorageMax: cfg.StorageMaxBytes, FrozenFile: filepath.Join(cfg.DataDir, "frozen")},
		func() { db.Close() }, nil
}

// extractID accepte un identifiant brut ou un lien …/s/<id>#… ou …/m/<id>#… ;
// le fragment (secret) est ignoré. Rend l'identifiant s'il a 22 caractères base64url.
func extractID(arg string) (string, bool) {
	id := arg
	if strings.Contains(arg, "/") {
		u, err := url.Parse(arg)
		if err != nil {
			return "", false
		}
		rest, ok := strings.CutPrefix(u.Path, "/s/")
		if !ok {
			rest, ok = strings.CutPrefix(u.Path, "/m/")
		}
		if !ok {
			return "", false
		}
		id = rest
	} else {
		id, _, _ = strings.Cut(arg, "#")
	}
	if len(id) != 22 {
		return "", false
	}
	for i := 0; i < len(id); i++ {
		c := id[i]
		if !(c >= 'A' && c <= 'Z' || c >= 'a' && c <= 'z' || c >= '0' && c <= '9' || c == '-' || c == '_') {
			return "", false
		}
	}
	return id, true
}
