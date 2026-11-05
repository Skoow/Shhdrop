// Package blob stocke un fichier de chiffré par partage, de taille réservée à l'avance.
package blob

import (
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"time"
)

// Store range les fichiers dans Dir, un par identifiant. NoSparse (production) : la place
// doit être réellement allouée sur le disque ; pas de repli « fichier creux » (audit F6).
type Store struct {
	Dir      string
	NoSparse bool
}

var errID = errors.New("blob : identifiant invalide")

// ErrNoAllocate : NoSparse, et le système de fichiers ne sait pas allouer à l'avance.
var ErrNoAllocate = errors.New("blob : allocation réelle impossible sur ce système de fichiers (fichier creux refusé)")

// validID n'accepte que 22 caractères base64url (anti traversée de chemin).
func validID(id string) bool {
	if len(id) != 22 {
		return false
	}
	for i := 0; i < len(id); i++ {
		c := id[i]
		if !(c >= 'A' && c <= 'Z' || c >= 'a' && c <= 'z' || c >= '0' && c <= '9' || c == '-' || c == '_') {
			return false
		}
	}
	return true
}

func (s *Store) path(id string) (string, error) {
	if !validID(id) {
		return "", errID
	}
	return filepath.Join(s.Dir, id), nil
}

// wipeTimes met les dates du fichier à l'epoch pour ne rien révéler.
func wipeTimes(p string) error {
	return os.Chtimes(p, time.Unix(0, 0), time.Unix(0, 0))
}

// Reserve crée le fichier de size octets, alloués sur le disque quand le système de
// fichiers le permet (sinon fichier creux, ou ErrNoAllocate si NoSparse) ; erreur s'il existe déjà.
func (s *Store) Reserve(id string, size int64) error {
	p, err := s.path(id)
	if err != nil {
		return err
	}
	if size < 0 {
		return errors.New("blob : taille négative")
	}
	if err := os.MkdirAll(s.Dir, 0o700); err != nil {
		return err
	}
	f, err := os.OpenFile(p, os.O_RDWR|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return err
	}
	if err := allocate(f, size, s.NoSparse); err != nil {
		f.Close()
		os.Remove(p)
		return err
	}
	if err := f.Close(); err != nil {
		os.Remove(p)
		return err
	}
	return wipeTimes(p)
}

// CheckAllocate vérifie au démarrage que le dossier permet l'allocation réelle (avec
// NoSparse) : un fichier de sonde caché (ignoré par List) est réservé puis supprimé.
func (s *Store) CheckAllocate() error {
	if err := os.MkdirAll(s.Dir, 0o700); err != nil {
		return err
	}
	f, err := os.CreateTemp(s.Dir, ".sonde-")
	if err != nil {
		return err
	}
	defer os.Remove(f.Name())
	err = allocate(f, 4096, s.NoSparse)
	return errors.Join(err, f.Close())
}

// probeName : nom des fichiers que CheckAllocate crée (os.CreateTemp : préfixe + chiffres).
var probeName = regexp.MustCompile(`^\.sonde-[0-9]+$`)

// RemoveProbes supprime les fichiers de sonde laissés par un arrêt brutal pendant
// CheckAllocate. Seuls les fichiers ordinaires au nom exact de la sonde sont touchés
// (jamais un blob, un dossier ou un lien symbolique).
func (s *Store) RemoveProbes() error {
	es, err := os.ReadDir(s.Dir)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	var errs []error
	for _, e := range es {
		if probeName.MatchString(e.Name()) && e.Type().IsRegular() {
			if err := os.Remove(filepath.Join(s.Dir, e.Name())); err != nil && !errors.Is(err, os.ErrNotExist) {
				errs = append(errs, err)
			}
		}
	}
	return errors.Join(errs...)
}

// WriteAt écrit dans la zone réservée ; refuse tout dépassement.
func (s *Store) WriteAt(id string, off int64, p []byte) (err error) {
	path, err := s.path(id)
	if err != nil {
		return err
	}
	f, err := os.OpenFile(path, os.O_WRONLY, 0)
	if err != nil {
		return err
	}
	// Les dates sont remises à zéro même en cas d'erreur (écriture partielle).
	// Ordre LIFO : fermeture d'abord, puis Chtimes.
	defer func() {
		if werr := wipeTimes(path); err == nil {
			err = werr
		}
	}()
	defer func() {
		if cerr := f.Close(); err == nil {
			err = cerr
		}
	}()
	fi, err := f.Stat()
	if err != nil {
		return err
	}
	if off < 0 || off > fi.Size() || int64(len(p)) > fi.Size()-off {
		return errors.New("blob : écriture hors de la réservation")
	}
	_, err = f.WriteAt(p, off)
	return err
}

// ReadAt lit exactement n octets à partir de off.
func (s *Store) ReadAt(id string, off int64, n int) ([]byte, error) {
	path, err := s.path(id)
	if err != nil {
		return nil, err
	}
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	fi, err := f.Stat()
	if err != nil {
		return nil, err
	}
	if off < 0 || n < 0 || off > fi.Size() || int64(n) > fi.Size()-off {
		return nil, errors.New("blob : lecture hors du fichier")
	}
	buf := make([]byte, n)
	if _, err := io.ReadFull(io.NewSectionReader(f, off, int64(n)), buf); err != nil {
		return nil, err
	}
	return buf, nil
}

// Delete supprime le fichier ; sans erreur s'il est déjà absent.
func (s *Store) Delete(id string) error {
	p, err := s.path(id)
	if err != nil {
		return err
	}
	if err := os.Remove(p); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	return nil
}

// List renvoie les identifiants présents sur disque.
func (s *Store) List() ([]string, error) {
	es, err := os.ReadDir(s.Dir)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var ids []string
	for _, e := range es {
		if !e.IsDir() && validID(e.Name()) {
			ids = append(ids, e.Name())
		}
	}
	return ids, nil
}

// UsedBytes additionne les tailles logiques des fichiers.
func (s *Store) UsedBytes() (int64, error) {
	ids, err := s.List()
	if err != nil {
		return 0, err
	}
	var total int64
	for _, id := range ids {
		fi, err := os.Stat(filepath.Join(s.Dir, id))
		if errors.Is(err, os.ErrNotExist) {
			continue
		}
		if err != nil {
			return 0, fmt.Errorf("blob : %w", err)
		}
		total += fi.Size()
	}
	return total, nil
}
