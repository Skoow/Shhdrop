package share

import (
	"bytes"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// Destruction par l'administrateur d'un partage déjà détaché (spec §41.8 : un signalement ou
// une destruction par l'administrateur coupe tout, tout de suite). « shhdrop admin destroy »
// tourne dans un autre processus : la ligne du partage n'existe plus en base, seul le serveur
// en marche connaît le descripteur détaché (en mémoire). La commande dépose une demande,
// <dossier des données>/kill/<hex HMAC-SHA-256(clé du serveur, V_accès)> ; le serveur, qui lit
// ce dossier chaque seconde (PollRemoved), coupe ses flux, ferme le descripteur et efface
// la demande ; la commande attend cet effacement (KillWait), sinon retire sa demande et
// répond « introuvable ». La demande est vide et ne vit que quelques secondes.
//
// Nom à clé (audit du 13 novembre, D8) : un nom peut rester dans les blocs du dossier après
// sa suppression ; hex(V_accès) y aurait confirmé, à qui détient le lien, qu'un partage a été
// détruit par l'administrateur. La clé est tirée par le serveur à son premier passage
// (PollRemoved) et réécrite en place dans <dossier des données>/kill.key à chaque démarrage :
// un nom resté sur le disque ne se relie plus à un lien dès que la clé a changé. Dates du
// dossier, des demandes et de la clé remises à l'epoch.

func (s *Service) killDir() string { return filepath.Join(filepath.Dir(s.FrozenFile), "kill") }

func (s *Service) killKeyFile() string { return filepath.Join(filepath.Dir(s.FrozenFile), "kill.key") }

// killKey : clé des noms de demandes, côté serveur (ensureKillKey).
type killKey struct {
	mu  sync.Mutex
	key []byte // nil tant qu'elle n'est pas écrite
}

// killName : nom de la demande pour V_accès v sous la clé key.
func killName(key, v []byte) string {
	h := hmac.New(sha256.New, key)
	h.Write([]byte("shhdrop kill|"))
	h.Write(v)
	return hex.EncodeToString(h.Sum(nil))
}

// epoch0 : remet les dates de p à l'epoch (aucune heure de destruction sur le disque).
func epoch0(p string) error { return os.Chtimes(p, time.Unix(0, 0), time.Unix(0, 0)) }

// ensureKillKey (serveur) : tire la clé et l'écrit, en place, dans kill.key (même fichier,
// mêmes blocs : l'ancienne clé est écrasée), une fois par processus.
func (s *Service) ensureKillKey() ([]byte, error) {
	s.kill.mu.Lock()
	defer s.kill.mu.Unlock()
	if s.kill.key != nil {
		return s.kill.key, nil
	}
	key := make([]byte, 32)
	if _, err := rand.Read(key); err != nil {
		return nil, err
	}
	// Dossier des demandes créé ici, au premier passage du serveur, et non à la première
	// destruction par l'administrateur : sa date de création (btime, que rien ne remet) ne dit
	// plus l'heure de la première destruction (audit adverse du 13 novembre, 3e campagne,
	// stockage, F5).
	if err := os.MkdirAll(s.killDir(), 0o700); err != nil {
		return nil, err
	}
	_ = epoch0(s.killDir())
	p := s.killKeyFile()
	f, err := os.OpenFile(p, os.O_RDWR|os.O_CREATE, 0o600)
	if err != nil {
		return nil, err
	}
	_, err = f.WriteAt(key, 0)
	err = errors.Join(err, f.Truncate(int64(len(key))), f.Sync(), f.Close(), epoch0(p))
	if err != nil {
		return nil, err
	}
	s.kill.key = key
	return key, nil
}

// readKillKey (commande) : clé écrite par le serveur ; absente ou mal formée : nil.
func (s *Service) readKillKey() []byte {
	f, err := os.Open(s.killKeyFile())
	if err != nil {
		return nil
	}
	defer f.Close()
	key := make([]byte, 33)
	if n, err := io.ReadFull(f, key); n != 32 || !errors.Is(err, io.ErrUnexpectedEOF) {
		return nil
	}
	return key[:32]
}

// cutDetached coupe, dans ce processus, le partage détaché dont V_accès vaut v.
func (s *Service) cutDetached(v []byte) bool {
	s.gone.mu.Lock()
	defer s.gone.unlock()
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
	s.gone.unlock()
	switch err := s.awaitKill(killAll); {
	case errors.Is(err, ErrNotFound):
		return false, nil
	default:
		return err == nil, err
	}
}

// requestKill dépose la demande et attend que le serveur l'efface (coupure faite). Clé du
// serveur attendue au plus KillWait (serveur qui vient de démarrer) ; sans elle : ErrNotFound.
func (s *Service) requestKill(v []byte) error {
	key := s.readKillKey()
	for end := time.Now().Add(s.KillWait); key == nil && time.Now().Before(end); key = s.readKillKey() {
		time.Sleep(50 * time.Millisecond)
	}
	if key == nil {
		return ErrNotFound
	}
	return s.awaitKill(killName(key, v))
}

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
		epoch0(p)
	}
	epoch0(dir)
	defer epoch0(dir) // la suppression (par le serveur ou ici) change aussi la date du dossier
	for end := time.Now().Add(s.KillWait); time.Now().Before(end); time.Sleep(50 * time.Millisecond) {
		if _, err := os.Stat(p); errors.Is(err, fs.ErrNotExist) {
			return nil
		}
	}
	os.Remove(p)
	return ErrNotFound
}

// readKills lit le dossier des demandes (hors de gone.mu : lecture de disque) ; nil s'il
// n'existe pas.
func (s *Service) readKills() ([]os.DirEntry, error) {
	es, err := os.ReadDir(s.killDir())
	if errors.Is(err, fs.ErrNotExist) {
		return nil, nil
	}
	return es, err
}

// pollKillsLocked (serveur, sous gone.mu, avec les demandes lues par readKills) : coupe chaque
// partage détaché demandé et efface la demande. Une demande qui ne désigne aucun partage
// détaché d'ici est laissée : la commande la retire à la fin de son attente. La demande
// killAll (wipe) coupe tous les partages détachés et est toujours effacée, même s'il n'y en a
// aucun : la commande sait ainsi que c'est fait.
func (s *Service) pollKillsLocked(es []os.DirEntry, key []byte) error {
	removed := false
	defer func() {
		if removed {
			epoch0(s.killDir())
		}
	}()
	for _, e := range es {
		if e.Name() == killAll {
			for id, d := range s.gone.dead {
				s.killLocked(id, d)
			}
			removed = true
			if err := os.Remove(filepath.Join(s.killDir(), killAll)); err != nil && !errors.Is(err, fs.ErrNotExist) {
				return err
			}
			continue
		}
		if v, err := hex.DecodeString(e.Name()); err != nil || len(v) != 32 {
			continue
		}
		for id, d := range s.gone.dead {
			if hmac.Equal([]byte(killName(key, d.accessV)), []byte(e.Name())) {
				s.killLocked(id, d)
				removed = true
				if err := os.Remove(filepath.Join(s.killDir(), e.Name())); err != nil && !errors.Is(err, fs.ErrNotExist) {
					return err
				}
				break
			}
		}
	}
	return nil
}

// fichiersDeDonnees : fichiers du dossier de données hors des dossiers de fichiers chiffrés
// (blobs/, salons/, salon-pieces/, brouillés par leurs propres passes), relatifs au dossier de
// données : gel, demandes de destruction, clé de leurs noms, base SQLite (nom ouvert par
// cmd/shhdrop, avec ses deux fichiers du mode WAL).
var fichiersDeDonnees = []string{"frozen", "kill", "kill.key", "shares.db", "shares.db-wal", "shares.db-shm"}

// ScrubDataTimes (janitor, à chaque passage) : dates de contenu et d'accès de fichiersDeDonnees
// et du dossier de données remises à l'epoch ; leur date de changement d'inode (ctime) prend
// l'heure de ce passage, comme pour les autres fichiers (blob.Store.ScrubTimes). Sans cela,
// ils donnaient à qui lit le disque l'heure du dernier gel ou dégel (frozen, dossier), de la
// dernière destruction par l'administrateur (kill/) et de la dernière écriture en base
// (shares.db, shares.db-wal), à la milliseconde (audit adverse du 13 novembre, 3e campagne,
// stockage, F5). Après un passage, ces heures ne sont plus lisibles qu'à la période du janitor
// près. Sans effet sur SQLite, qui ne lit jamais les dates de ses fichiers (son compteur de
// changements est dans l'en-tête). La date de création (btime) reste : celle de frozen dit
// l'heure du gel en cours (README §9). Fichier absent : ignoré ; la première autre erreur est
// rendue, sans arrêter le passage. Sous la borne des appels disque des partages.
func (s *Service) ScrubDataTimes() error {
	dir := filepath.Dir(s.FrozenFile)
	var first error
	for _, n := range append(fichiersDeDonnees, "") {
		p := filepath.Join(dir, n)
		err := s.Blobs.Gate.Do(func() error { return epoch0(p) })
		if err != nil && !errors.Is(err, fs.ErrNotExist) && first == nil {
			first = err
		}
	}
	return first
}
