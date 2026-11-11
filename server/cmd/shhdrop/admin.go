package main

import (
	"bufio"
	"crypto/hkdf"
	"crypto/sha256"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"time"

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
		fmt.Fprintln(stderr, "usage: shhdrop admin freeze|unfreeze|destroy - (lien lu sur l'entrée standard)|wipe --yes")
		return 2
	}
	fail := func(err error) int {
		fmt.Fprintln(stderr, "erreur:", publicMessage(err)) // jamais une erreur système (audit F3)
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
		if len(args) != 2 || args[1] != "-" {
			// Spec §32 : le lien ne contient plus que la clé (après #) ; en argument, elle irait
			// dans l'historique du shell et dans /proc/<pid>/cmdline (audit F11).
			return usage("destroy lit le lien signalé sur l'entrée standard : shhdrop admin destroy -")
		}
	case "wipe":
		if len(args) != 2 || args[1] != "--yes" {
			return usage("wipe efface tous les partages : relancer avec --yes pour confirmer")
		}
	default:
		return usage("commande admin inconnue")
	}

	// destroy : le lien est lu avant d'ouvrir quoi que ce soit ; seule K_accès en est gardée.
	var kAcces []byte
	if args[0] == "destroy" {
		link, err := readLink(stdin)
		if err != nil {
			return usage(err.Error())
		}
		var ok bool
		if kAcces, ok = accessKeyOf(link); !ok {
			return usage("lien invalide (attendu : https://…/#<clé de 43 caractères>)")
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
		if err := svc.DestroyAdmin(kAcces); err != nil {
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
		// Un téléchargement commencé sur un partage déjà retiré finit sur un descripteur que
		// seul le serveur en marche tient (grâce de 2 h, spec §41.8) : il doit le couper (revue B5).
		cut, err := svc.CutAllDetached()
		if err != nil {
			return fail(err)
		}
		if cut {
			fmt.Fprintln(stdout, "lectures en cours coupées par le serveur en marche")
		} else {
			fmt.Fprintln(stdout, "ATTENTION : le serveur n'a pas confirmé la coupure des lectures en cours. "+
				"S'il tourne, le redémarrer maintenant : sinon, un téléchargement déjà commencé peut encore finir (jusqu'à 2 h). "+
				"S'il est arrêté, il n'y a rien à couper.")
		}
	}
	return 0
}

// adminKillWait : attente de la réponse du serveur en marche (kill.go).
var adminKillWait = 3 * time.Second

// adminDataDir : chemin absolu d'un dossier existant qui contient shares.db.
func adminDataDir(dir string) (string, error) {
	if !filepath.IsAbs(dir) {
		return "", shownf("SHH_DATA_DIR doit être un chemin absolu (dossier contenant shares.db) : %q", dir)
	}
	fi, err := os.Stat(filepath.Join(dir, "shares.db"))
	if err != nil || !fi.Mode().IsRegular() {
		return "", shownf("SHH_DATA_DIR %s ne contient pas shares.db : mauvais dossier ? (rien n'a été fait)", dir)
	}
	return dir, nil
}

// readLink lit une seule ligne non vide (le lien) sur l'entrée standard.
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
		return "", errors.New("entrée standard : une seule ligne attendue (le lien)")
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
		Now: cfg.Now, StorageMax: cfg.StorageMaxBytes, FrozenFile: filepath.Join(dir, "frozen"),
		// Partage déjà retiré mais encore lu (grâce) : le serveur en marche le coupe (kill.go).
		KillWait: adminKillWait})
	if err != nil {
		db.Close()
		return nil, nil, err
	}
	return svc, func() { db.Close() }, nil
}

// accessKeyOf : K_accès = HKDF-SHA-256(K_lien, « shhdrop/v2/acces ») (spec §29.2), K_lien
// étant les 43 caractères base64url après le « # » d'un lien de partage (spec §32), ou la
// clé seule. Seule K_accès sert ensuite (DestroyAdmin cherche par V_accès) ; rien n'est écrit.
func accessKeyOf(link string) ([]byte, bool) {
	key := link
	if i := strings.LastIndexByte(link, '#'); i >= 0 {
		key = link[i+1:]
	}
	kLien, err := share.DecodeB64(key, 32)
	if err != nil {
		return nil, false
	}
	k, err := hkdf.Key(sha256.New, kLien, nil, "shhdrop/v2/acces", 32)
	clear(kLien)
	return k, err == nil
}
