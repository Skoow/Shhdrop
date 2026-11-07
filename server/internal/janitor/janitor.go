// Package janitor efface les partages échus et réconcilie base et fichiers.
// Il n'écrit jamais d'identifiant ni de donnée : au plus une ligne fixe sur stderr.
package janitor

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"time"

	"github.com/skoow/shhdrop/server/internal/share"
	"github.com/skoow/shhdrop/server/internal/store"
)

// Run appelle Sweep puis Checkpoint à chaque période, jusqu'à l'annulation de ctx.
func Run(ctx context.Context, svc *share.Service, db *sql.DB, every time.Duration) {
	t := time.NewTicker(every)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
		_, err := svc.Sweep()
		if cerr := store.Checkpoint(db); cerr != nil {
			err = errors.Join(err, cerr)
		}
		if err != nil {
			fmt.Fprintln(os.Stderr, "janitor: erreur de nettoyage")
		}
	}
}

// Watch appelle PollRemoved à chaque période (une seconde en production), jusqu'à
// l'annulation de ctx : un partage effacé par « shhdrop admin destroy » (autre processus)
// voit ses flux coupés et ses surveillances prévenues (spec §41.8). Aucune requête quand
// rien n'est surveillé ni en cours de lecture.
func Watch(ctx context.Context, svc *share.Service, every time.Duration) {
	t := time.NewTicker(every)
	defer t.Stop()
	failed := false
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
		// Au plus une ligne fixe par série d'erreurs (jamais d'identifiant).
		if err := svc.PollRemoved(); err != nil && !failed {
			fmt.Fprintln(os.Stderr, "janitor: erreur de surveillance")
			failed = true
		} else if err == nil {
			failed = false
		}
	}
}

// Reconcile, à appeler avant d'écouter : efface les fichiers sans ligne et les
// lignes sans fichier. Les fichiers qui ne sont pas des identifiants valides sont ignorés.
func Reconcile(svc *share.Service) error {
	files, err := svc.Blobs.List()
	if err != nil {
		return err
	}
	onDisk := make(map[string]bool, len(files))
	for _, id := range files {
		onDisk[id] = true
	}
	rs, err := svc.DB.Query(`SELECT id FROM shares`)
	if err != nil {
		return err
	}
	var ids []string
	for rs.Next() {
		var id string
		if err := rs.Scan(&id); err != nil {
			rs.Close()
			return err
		}
		ids = append(ids, id)
	}
	rs.Close()
	if err := rs.Err(); err != nil {
		return err
	}
	inDB := make(map[string]bool, len(ids))
	var errs []error
	for _, id := range ids {
		inDB[id] = true
		if !onDisk[id] {
			if _, err := svc.DB.Exec(`DELETE FROM shares WHERE id=?`, id); err != nil {
				errs = append(errs, err)
			}
		}
	}
	for _, id := range files {
		if !inDB[id] {
			if err := svc.Blobs.Delete(id); err != nil {
				errs = append(errs, err)
			}
		}
	}
	return errors.Join(errs...)
}
