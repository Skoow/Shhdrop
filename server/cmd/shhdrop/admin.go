package main

import (
	"bufio"
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

// maxStdinLink : longueur maximale d'un lien lu sur l'entrée standard (destroy -).
const maxStdinLink = 4096

// Codes de sortie : 0 ok, 1 opération échouée, 2 erreur d'usage.
// La sortie ne reprend jamais l'argument reçu (il peut contenir un secret).
// Les commandes ne créent jamais rien d'autre que le fichier de gel : le dossier de
// données doit exister et contenir shares.db (audit M2). Chaque réussite affiche le
// chemin absolu du dossier et le nombre de partages touchés.
func runAdmin(args []string, cfg config.Config, stdin io.Reader, stdout, stderr io.Writer) int {
	usage := func(msg string) int {
		fmt.Fprintln(stderr, msg)
		fmt.Fprintln(stderr, "usage: shhdrop admin freeze|unfreeze|destroy <id ou lien sans #…>|destroy -|wipe --yes")
		return 2
	}
	fail := func(err error) int {
		fmt.Fprintln(stderr, "erreur:", err)
		return 1
	}
	if len(args) == 0 {
		return usage("commande admin manquante")
	}
	switch args[0] {
	case "freeze", "unfreeze":
		if len(args) != 1 {
			return usage(args[0] + " n'a pas d'argument")
		}
	case "destroy":
		if len(args) != 2 {
			return usage("destroy attend un identifiant, un lien, ou « - » (lien lu sur l'entrée standard)")
		}
	case "wipe":
		if len(args) != 2 || args[1] != "--yes" {
			return usage("wipe efface tous les partages : relancer avec --yes pour confirmer")
		}
	default:
		return usage("commande admin inconnue")
	}

	// destroy : l'identifiant est lu avant d'ouvrir quoi que ce soit.
	var id string
	if args[0] == "destroy" {
		arg := args[1]
		if arg == "-" {
			var err error
			if arg, err = readLink(stdin); err != nil {
				return usage(err.Error())
			}
		} else if strings.Contains(arg, "#") {
			// Audit F11 : la clé (après #) est dans argv, donc dans l'historique du shell.
			fmt.Fprintln(stderr, "attention : l'argument contient la clé du lien (partie après #) ; elle est "+
				"maintenant dans l'historique du shell et visible des autres processus. "+
				"Retirer la partie après #, ou passer le lien sur l'entrée standard : shhdrop admin destroy -")
		}
		var ok bool
		if id, ok = extractID(arg); !ok {
			return usage("identifiant invalide")
		}
	}

	dir, err := adminDataDir(cfg.DataDir)
	if err != nil {
		return fail(err)
	}
	frozen := filepath.Join(dir, "frozen")
	svc, closeFn, err := openService(cfg, dir)
	if err != nil {
		return fail(err)
	}
	defer closeFn()

	switch args[0] {
	case "freeze":
		if err := freeze(frozen); err != nil {
			return fail(err)
		}
		n, err := countShares(svc)
		if err != nil {
			return fail(err)
		}
		fmt.Fprintf(stdout, "créations suspendues (%s ; %d partages en place)\n", dir, n)
	case "unfreeze":
		if err := os.Remove(frozen); err != nil && !errors.Is(err, fs.ErrNotExist) {
			return fail(err)
		}
		fmt.Fprintf(stdout, "créations rétablies (%s)\n", dir)
	case "destroy":
		if err := svc.DestroyAdmin(id); err != nil {
			if errors.Is(err, share.ErrNotFound) {
				fmt.Fprintf(stderr, "introuvable (%s ; 0 partage détruit)\n", dir)
				return 1
			}
			return fail(err)
		}
		fmt.Fprintf(stdout, "1 partage détruit (%s)\n", dir)
	case "wipe":
		// Gel d'abord, laissé en place : aucune création ne s'intercale pendant l'effacement.
		if err := freeze(frozen); err != nil {
			return fail(err)
		}
		fmt.Fprintf(stdout, "créations suspendues (relancer « shhdrop admin unfreeze » pour les rétablir)\n")
		ids, err := svc.Blobs.List()
		if err != nil {
			return fail(err)
		}
		var errs []error
		for _, id := range ids {
			errs = append(errs, svc.Blobs.Delete(id))
		}
		res, err := svc.DB.Exec(`DELETE FROM shares`)
		errs = append(errs, err)
		var n int64
		if err == nil {
			n, err = res.RowsAffected()
			errs = append(errs, err, store.Checkpoint(svc.DB))
		}
		if err := errors.Join(errs...); err != nil {
			return fail(err)
		}
		fmt.Fprintf(stdout, "%d partages effacés, fichiers compris (%s)\n", n, dir)
	}
	return 0
}

// adminDataDir : chemin absolu d'un dossier existant qui contient shares.db.
func adminDataDir(dir string) (string, error) {
	if !filepath.IsAbs(dir) {
		return "", fmt.Errorf("SHH_DATA_DIR doit être un chemin absolu (dossier contenant shares.db) : %q", dir)
	}
	fi, err := os.Stat(filepath.Join(dir, "shares.db"))
	if err != nil || !fi.Mode().IsRegular() {
		return "", fmt.Errorf("SHH_DATA_DIR %s ne contient pas shares.db : mauvais dossier ? (rien n'a été fait)", dir)
	}
	return dir, nil
}

// readLink lit une seule ligne non vide (le lien ou l'identifiant) sur l'entrée standard.
func readLink(r io.Reader) (string, error) {
	b, err := io.ReadAll(io.LimitReader(r, maxStdinLink+1))
	if err != nil {
		return "", errors.New("entrée standard illisible")
	}
	if len(b) > maxStdinLink {
		return "", errors.New("entrée standard trop longue")
	}
	sc := bufio.NewScanner(strings.NewReader(string(b)))
	var lines []string
	for sc.Scan() {
		if l := strings.TrimSpace(sc.Text()); l != "" {
			lines = append(lines, l)
		}
	}
	if len(lines) != 1 {
		return "", errors.New("entrée standard : une seule ligne attendue (le lien ou l'identifiant)")
	}
	return lines[0], nil
}

// freeze crée le fichier de gel (0600) dans un dossier existant ; idempotent.
func freeze(frozen string) error {
	f, err := os.OpenFile(frozen, os.O_CREATE|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	return f.Close()
}

func countShares(svc *share.Service) (int, error) {
	var n int
	err := svc.DB.QueryRow(`SELECT count(*) FROM shares`).Scan(&n)
	return n, err
}

func openService(cfg config.Config, dir string) (*share.Service, func(), error) {
	db, err := store.OpenExisting(filepath.Join(dir, "shares.db"))
	if err != nil {
		return nil, nil, err
	}
	svc, err := share.NewService(share.Config{DB: db, Blobs: &blob.Store{Dir: filepath.Join(dir, "blobs")},
		Now: cfg.Now, StorageMax: cfg.StorageMaxBytes, FrozenFile: filepath.Join(dir, "frozen")})
	if err != nil {
		db.Close()
		return nil, nil, err
	}
	return svc, func() { db.Close() }, nil
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
