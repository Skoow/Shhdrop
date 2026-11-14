package main

import (
	"bytes"
	"crypto/hkdf"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"time"

	"github.com/skoow/shhdrop/server/internal/blob"
	"github.com/skoow/shhdrop/server/internal/config"
	"github.com/skoow/shhdrop/server/internal/salon"
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
			return usage("wipe efface tous les partages et tous les salons : relancer avec --yes pour confirmer")
		}
	default:
		return usage("commande admin inconnue")
	}

	// destroy : le lien est lu avant d'ouvrir quoi que ce soit ; seule K_accès en est gardée
	// (K_accès_s pour un lien de salon #c<43>), effacée à la fin.
	var kAcces []byte
	var estSalon bool
	if args[0] == "destroy" {
		lien, err := lireLien(stdin)
		if err != nil {
			return usage(err.Error())
		}
		kAcces, estSalon, err = cleAccesDuLien(lien)
		clear(lien)
		if err != nil {
			return usage(err.Error())
		}
		defer clear(kAcces)
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
		if err := unfreeze(frozen); err != nil {
			return fail(err)
		}
		fmt.Fprintf(stdout, "créations rétablies (%s)\n", dir)
	case "destroy":
		if estSalon {
			return destroySalon(svc, dir, kAcces, stdout, stderr, fail)
		}
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
		// Salons : pièces, conversations et lignes ; le serveur en marche ferme leurs
		// connexions au tick suivant (lignes disparues). Base d'une version antérieure : pas
		// de table du salon, aucun salon à effacer.
		switch err := store.RequireCurrent(svc.DB); {
		case err == nil:
			ns, err := salon.EffacerTout(svc.DB, filepath.Join(dir, dirSalonPieces), filepath.Join(dir, dirSalons))
			if err != nil {
				return fail(err)
			}
			fmt.Fprintf(stdout, "%d salons effacés, pièces et conversations comprises (%s)\n", ns, dir)
		case errors.Is(err, store.ErrOldSchema):
			fmt.Fprintf(stdout, "aucun salon (base d'une version antérieure) (%s)\n", dir)
		default:
			return fail(err)
		}
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

// lireLien lit l'entrée standard, bornée, dans un seul tampon (à effacer par l'appelant).
func lireLien(r io.Reader) ([]byte, error) {
	buf := make([]byte, maxStdinLink+1)
	n, err := io.ReadFull(r, buf)
	if err != nil && !errors.Is(err, io.EOF) && !errors.Is(err, io.ErrUnexpectedEOF) {
		clear(buf)
		return nil, errors.New("entrée standard illisible")
	}
	if n > maxStdinLink {
		clear(buf)
		return nil, errors.New("entrée standard trop longue")
	}
	return buf[:n], nil
}

var (
	errUneLigne    = errors.New("entrée standard : une seule ligne attendue (le lien)")
	errLienAttendu = errors.New("lien invalide (attendu : https://…/#<clé de 43 caractères>, ou #c<clé> pour un salon)")
)

// cleAccesDuLien tire K_accès du lien signalé, traité en OCTETS de bout en bout (jamais de
// chaîne, qu'on ne peut pas effacer : audit adverse du 13 novembre, 3e campagne, stockage, F4 :
// le lien, donc K_lien, restait en plusieurs exemplaires dans le tas). lien : une seule ligne
// non vide (espaces et lignes vides autour ignorés). Partage : les 43 caractères base64url
// après le dernier « # » (spec §32), ou la clé seule ; K_accès = HKDF-SHA-256(K_lien, sel
// vide, « shhdrop/v2/acces », 32) (spec §29.2). Salon : « c » puis 43 caractères (spec
// §39.3) ; K_accès_s = HKDF-SHA-256(K_lien, sel vide, « shhdrop/v2/salon/acces », 32)
// (vecteurs « cles » de engine/vectors/salon-v3.json). Tout autre lien (gestion #m<43>…) :
// erreur. K_lien décodée est effacée ici ; lien n'est pas modifié (à effacer par l'appelant, de
// même que la clé rendue). Ce qui ne peut pas être effacé : l'état interne de HMAC pendant le
// calcul, et les tampons de lecture du système ou de net/http.
func cleAccesDuLien(lien []byte) (k []byte, estSalon bool, err error) {
	ligne, ok := seuleLigne(lien)
	if !ok {
		return nil, false, errUneLigne
	}
	cle := ligne
	if i := bytes.LastIndexByte(ligne, '#'); i >= 0 {
		cle = ligne[i+1:]
	}
	info := "shhdrop/v2/acces"
	if len(cle) == 44 && cle[0] == 'c' {
		cle, estSalon, info = cle[1:], true, "shhdrop/v2/salon/acces"
	}
	var kLien [32]byte
	defer clear(kLien[:])
	if !decoderCle(&kLien, cle) {
		return nil, false, errLienAttendu
	}
	if k, err = hkdf.Key(sha256.New, kLien[:], nil, info, 32); err != nil {
		return nil, false, errLienAttendu
	}
	return k, estSalon, nil
}

// seuleLigne : la seule ligne non vide de b (sous-tranche de b, sans copie), espaces retirés.
func seuleLigne(b []byte) ([]byte, bool) {
	var ligne []byte
	for len(b) > 0 {
		l := b
		if i := bytes.IndexByte(b, '\n'); i >= 0 {
			l, b = b[:i], b[i+1:]
		} else {
			b = nil
		}
		if l = bytes.TrimSpace(l); len(l) == 0 {
			continue
		}
		if ligne != nil {
			return nil, false
		}
		ligne = l
	}
	return ligne, ligne != nil
}

// decoderCle décode 43 caractères base64url sans bourrage, canoniques, vers 32 octets (comme
// share.DecodeB64, sans passer par une chaîne). En cas d'échec, dst est effacé.
func decoderCle(dst *[32]byte, src []byte) bool {
	if len(src) != 43 {
		return false
	}
	var tmp [33]byte // Decode peut écrire au-delà de 32 octets avant de refuser
	defer clear(tmp[:])
	n, err := base64.RawURLEncoding.Strict().Decode(tmp[:], src)
	if err != nil || n != 32 {
		return false
	}
	copy(dst[:], tmp[:32])
	return true
}

// freeze crée le fichier de gel (0600) dans un dossier existant ; idempotent.
// Dates de frozen et du dossier de données remises à l'epoch tout de suite (audit adverse du
// 13 novembre, 3e campagne, stockage, F5 : elles donnaient l'heure du gel à la milliseconde) ;
// leur ctime est ramené par le janitor (share.Service.ScrubDataTimes), à la minute près. Au
// mieux : un échec de Chtimes ne change pas le gel.
func freeze(frozen string) error {
	f, err := os.OpenFile(frozen, os.O_CREATE|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	if err := f.Close(); err != nil {
		return err
	}
	sansDate(frozen)
	sansDate(filepath.Dir(frozen))
	return nil
}

// sansDate : dates de contenu et d'accès de p à l'epoch, au mieux.
func sansDate(p string) { _ = os.Chtimes(p, time.Unix(0, 0), time.Unix(0, 0)) }

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

// destroySalon : destroy - d'un lien de salon : ligne rendue morte, puis pièces, conversation
// et ligne supprimées (salon.DetruireHorsLigne), puis vidage du WAL ; le serveur en marche
// ferme les connexions en raison 2 à sa passe suivante. Exige le schéma courant (tables du salon). Ni le lien ni l'identifiant ne sont
// affichés.
func destroySalon(svc *share.Service, dir string, kAcces []byte, stdout, stderr io.Writer, fail func(error) int) int {
	if err := store.RequireCurrent(svc.DB); err != nil {
		return fail(err)
	}
	complet, err := salon.DetruireHorsLigne(svc.DB, &blob.Store{Dir: filepath.Join(dir, dirSalonPieces)},
		filepath.Join(dir, dirSalons), kAcces)
	if errors.Is(err, salon.ErrNotFound) {
		fmt.Fprintf(stderr, "introuvable (%s ; 0 salon détruit)\n", dir)
		return 1
	}
	if err != nil {
		return fail(err)
	}
	if !complet {
		// Jamais « détruit » pour une ligne encore en base (audit adverse 3, F2).
		fmt.Fprintf(stderr, "salon rendu inaccessible (plus aucune requête ne le voit), mais des pièces déposées pendant la "+
			"commande restent à effacer (%s) : le serveur en marche le fait dans la seconde ; relancer la commande pour "+
			"vérifier (réponse attendue : introuvable)\n", dir)
		return 1
	}
	if err := store.Checkpoint(svc.DB); err != nil {
		return fail(err)
	}
	fmt.Fprintf(stdout, "1 salon détruit (%s)\n", dir)
	return 0
}
