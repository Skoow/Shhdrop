// Package janitor efface les partages échus et réconcilie base et fichiers.
// Il n'écrit jamais d'identifiant ni de donnée : au plus une ligne fixe sur stderr.
package janitor

import (
	"context"
	"errors"
	"fmt"
	"os"
	"time"

	"github.com/skoow/shhdrop/server/internal/share"
)

// Run appelle Sweep, recale la place utilisée sur le disque (blob.Store.Resync : la commande
// d'administration supprime des fichiers depuis un autre processus), brouille les dates
// d'inode des fichiers (blob.Store.ScrubTimes), puis vide le WAL
// (svc.Vidage.Maintenant : attente courte d'une base occupée par un autre processus, échec
// compté pour le tableau de bord ; audit adverse du 13 novembre, stockage, F3), et enfin
// brouille les dates du dossier de données (svc.ScrubDataTimes), à chaque période, jusqu'à
// l'annulation de ctx.
func Run(ctx context.Context, svc *share.Service, every time.Duration) {
	t := time.NewTicker(every)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
		err := protect(func() error {
			_, err := svc.Sweep()
			if rerr := svc.Blobs.Resync(); rerr != nil {
				err = errors.Join(err, rerr)
			}
			// Dates d'inode des fichiers de partages ramenées à l'heure de ce passage, la même
			// pour tous (stockage, F4).
			if serr := svc.Blobs.ScrubTimes(); serr != nil {
				err = errors.Join(err, serr)
			}
			if cerr := svc.Vidage.Maintenant(); cerr != nil {
				err = errors.Join(err, cerr)
			}
			// Puis celles du dossier de données (gel, demandes de destruction, base), après le
			// vidage qui vient d'écrire dans la base (stockage, 3e campagne, F5).
			if derr := svc.ScrubDataTimes(); derr != nil {
				err = errors.Join(err, derr)
			}
			return err
		})
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
		err := protect(svc.PollRemoved)
		if err != nil && !failed {
			fmt.Fprintln(os.Stderr, "janitor: erreur de surveillance")
			failed = true
		} else if err == nil {
			failed = false
		}
	}
}

// errPanic : panique récupérée dans un tour de Run ou de Watch.
var errPanic = errors.New("janitor : panique récupérée")

// protect exécute un tour de boucle et récupère une panique (audit du 13 novembre, D6 : une
// donnée inattendue en base arrêtait tout le processus) : elle devient errPanic, donc la
// ligne fixe habituelle sur stderr, sans la valeur ni la pile (elles pourraient contenir un
// identifiant). Le tour suivant a lieu normalement.
func protect(f func() error) (err error) {
	defer func() {
		if recover() != nil {
			err = errPanic
		}
	}()
	return f()
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
