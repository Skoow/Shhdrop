package share

import (
	"bytes"
	"encoding/hex"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"time"
)

// Destruction par l'administrateur d'un partage déjà détaché (spec §41.8 : un signalement ou
// une destruction par l'administrateur coupe tout, tout de suite). « shhdrop admin destroy »
// tourne dans un autre processus : la ligne du partage n'existe plus en base, seul le serveur
// en marche connaît le descripteur détaché (en mémoire). La commande dépose une demande,
// <dossier des données>/kill/<hex V_accès> ; le serveur, qui lit ce dossier chaque seconde
// (PollRemoved), coupe ses flux, ferme le descripteur et efface
// la demande ; la commande attend cet effacement (KillWait), sinon retire sa demande et
// répond « introuvable ». La demande ne contient que V_accès (déjà en base tant que le
// partage existait) et ne vit que quelques secondes.

func (s *Service) killDir() string { return filepath.Join(filepath.Dir(s.FrozenFile), "kill") }

// cutDetached coupe, dans ce processus, le partage détaché dont V_accès vaut v.
func (s *Service) cutDetached(v []byte) bool {
	s.gone.mu.Lock()
	defer s.gone.mu.Unlock()
	s.gone.init()
	for id, d := range s.gone.dead {
		if bytes.Equal(d.accessV, v) {
			s.killLocked(id, d)
			return true
		}
	}
	return false
}

// killLocked : flux coupés, ouvertures sans droit, descripteur fermé dès la fin des lectures.
func (s *Service) killLocked(id string, d *detached) {
	s.revokeAllLocked(id)
	clear(d.opens)
	d.graceEnd = 0
	s.reapLocked(id, d, s.now())
	s.notifyLocked(id)
}

// killAll : demande de « shhdrop admin wipe » : couper tous les partages détachés (revue B5).
// Ce n'est pas un V_accès en hexadécimal : un serveur plus ancien l'ignore.
const killAll = "all"

// CutAllDetached (« shhdrop admin wipe », après l'effacement des lignes et des fichiers) :
// coupe tous les partages détachés, dans ce processus puis, par une demande, dans le serveur
// en marche, qui l'efface même s'il n'en tient aucun. Rend vrai si le serveur a confirmé ;
// faux après KillWait sans réponse (serveur arrêté, ou qu'il faut redémarrer).
func (s *Service) CutAllDetached() (bool, error) {
	s.gone.mu.Lock()
	s.gone.init()
	for id, d := range s.gone.dead {
		s.killLocked(id, d)
	}
	s.gone.mu.Unlock()
	switch err := s.awaitKill(killAll); {
	case errors.Is(err, ErrNotFound):
		return false, nil
	default:
		return err == nil, err
	}
}

// requestKill dépose la demande et attend que le serveur l'efface (coupure faite).
func (s *Service) requestKill(v []byte) error { return s.awaitKill(hex.EncodeToString(v)) }

// awaitKill dépose la demande name et attend que le serveur l'efface ; sinon la retire et
// rend ErrNotFound.
func (s *Service) awaitKill(name string) error {
	if s.KillWait <= 0 {
		return ErrNotFound
	}
	dir := s.killDir()
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	p := filepath.Join(dir, name)
	f, err := os.OpenFile(p, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil && !errors.Is(err, fs.ErrExist) {
		return err
	}
	if f != nil {
		f.Close()
	}
	for end := time.Now().Add(s.KillWait); time.Now().Before(end); time.Sleep(50 * time.Millisecond) {
		if _, err := os.Stat(p); errors.Is(err, fs.ErrNotExist) {
			return nil
		}
	}
	os.Remove(p)
	return ErrNotFound
}

// pollKillsLocked (serveur, sous gone.mu) : coupe chaque partage détaché demandé et efface la
// demande. Une demande qui ne désigne aucun partage détaché d'ici est laissée : la commande la
// retire à la fin de son attente. La demande killAll (wipe) coupe tous les partages détachés
// et est toujours effacée, même s'il n'y en a aucun : la commande sait ainsi que c'est fait.
func (s *Service) pollKillsLocked() error {
	es, err := os.ReadDir(s.killDir())
	if errors.Is(err, fs.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	for _, e := range es {
		if e.Name() == killAll {
			for id, d := range s.gone.dead {
				s.killLocked(id, d)
			}
			if err := os.Remove(filepath.Join(s.killDir(), killAll)); err != nil && !errors.Is(err, fs.ErrNotExist) {
				return err
			}
			continue
		}
		v, err := hex.DecodeString(e.Name())
		if err != nil || len(v) != 32 {
			continue
		}
		for id, d := range s.gone.dead {
			if bytes.Equal(d.accessV, v) {
				s.killLocked(id, d)
				if err := os.Remove(filepath.Join(s.killDir(), e.Name())); err != nil && !errors.Is(err, fs.ErrNotExist) {
					return err
				}
				break
			}
		}
	}
	return nil
}
