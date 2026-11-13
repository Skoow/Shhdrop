// Package blob stocke un fichier de chiffré par partage, de taille réservée à l'avance.
package blob

import (
	"errors"
	"fmt"
	"hash/fnv"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"sync"
	"time"
)

// Store range les fichiers dans Dir, un par identifiant. NoSparse (production) : la place
// doit être réellement allouée sur le disque ; pas de repli « fichier creux » (audit F6).
type Store struct {
	Dir      string
	NoSparse bool
	// Gate (facultatif) : borne des appels système de fichiers simultanés (gate.go), partagée
	// par tous les Store du processus.
	Gate *Gate

	// idMu : Reserve, Resize et Delete d'un même fichier ne se croisent pas (verrous rayés
	// par identifiant) : chacun connaît la taille avant et après, le compteur reste exact.
	idMu [64]sync.Mutex
	// usage : octets réservés, comptés en mémoire (UsedBytes) plutôt que relus sur le disque
	// à chaque création. Jamais sous la somme réelle des fichiers de ce processus :
	//   - une place créée ou agrandie est comptée avant l'appel au système (inflight), et
	//     corrigée ensuite si l'appel a échoué ;
	//   - une place rendue (Delete, Resize réduit, correction) n'est décomptée qu'après coup,
	//     et jamais si une relecture du dossier (Resync) a croisé l'opération ;
	//   - une relecture ajoute à la somme lue la croissance des opérations qui l'ont croisée
	//     (grown), au risque de la compter deux fois jusqu'à la relecture suivante.
	// Un fichier supprimé par un autre processus (commande d'administration) reste compté
	// jusqu'à la relecture suivante.
	usage struct {
		mu       sync.Mutex
		synced   bool   // used vient d'une relecture du dossier
		scanning bool   // relecture en cours
		scans    uint64 // relectures commencées
		used     int64
		inflight int64 // croissance des opérations en cours
		grown    int64 // croissance des opérations qui ont croisé la relecture en cours
	}
	scanMu    sync.Mutex // une relecture à la fois
	afterScan func()     // tests : appelé entre la lecture du dossier et le recalage
}

// lock : verrou du fichier id.
func (s *Store) lock(id string) *sync.Mutex {
	h := fnv.New32a()
	h.Write([]byte(id))
	return &s.idMu[h.Sum32()%uint32(len(s.idMu))]
}

// begin annonce une opération qui peut créer grow octets (≥ 0), comptés d'avance ; rend le
// repère à passer à end.
func (s *Store) begin(grow int64) (scans uint64) {
	u := &s.usage
	u.mu.Lock()
	defer u.mu.Unlock()
	u.inflight += grow
	if u.scanning {
		u.grown += grow
	}
	if u.synced {
		u.used += grow
	}
	return u.scans
}

// end clôt l'opération annoncée par begin(grow) : la taille a changé de actual (≤ grow).
// La différence est rendue au compteur, sauf si une relecture a croisé l'opération (la somme
// relue en tient peut-être déjà compte : on garde le compte le plus haut).
func (s *Store) end(scans uint64, grow, actual int64) {
	u := &s.usage
	u.mu.Lock()
	defer u.mu.Unlock()
	u.inflight -= grow
	if u.synced && !u.scanning && u.scans == scans {
		u.used += actual - grow
	}
}

// Resync relit le dossier et recale le compteur d'UsedBytes sur le disque (balayage du
// janitor) : la commande d'administration supprime des fichiers depuis un autre processus.
func (s *Store) Resync() error {
	s.scanMu.Lock()
	defer s.scanMu.Unlock()
	u := &s.usage
	u.mu.Lock()
	u.scanning = true
	u.scans++
	u.grown = u.inflight
	u.mu.Unlock()
	var total int64
	err := s.Gate.do(func() (err error) { total, err = s.scan(); return err })
	if s.afterScan != nil {
		s.afterScan()
	}
	u.mu.Lock()
	defer u.mu.Unlock()
	u.scanning = false
	if err != nil {
		return err // compteur gardé tel quel
	}
	u.used = total + u.grown
	u.synced = true
	return nil
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

// wipeDirTimes remet les dates du dossier à l'epoch après une création ou une suppression de
// fichier, qui les met à l'heure (audit du 12 novembre, D7). Au mieux : un échec n'annule pas
// l'opération faite (un fichier créé mais signalé en échec resterait orphelin) ; la date de
// changement d'inode (ctime) ne peut pas être remise, aucun appel système ne le permet.
func (s *Store) wipeDirTimes() { _ = wipeTimes(s.Dir) }

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
	mu := s.lock(id)
	mu.Lock()
	defer mu.Unlock()
	scans := s.begin(size)
	return s.Gate.do(func() error {
		defer s.wipeDirTimes() // fichier créé, ou créé puis retiré
		if err := s.reserve(p, size); err != nil {
			s.end(scans, size, 0) // rien de créé, ou fichier retiré
			return err
		}
		s.end(scans, size, size)
		return wipeTimes(p)
	})
}

// reserve crée et alloue le fichier ; en cas d'échec, il ne reste rien.
func (s *Store) reserve(p string, size int64) error {
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
	return nil
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
	defer s.wipeDirTimes() // après la suppression de la sonde (LIFO)
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
			} else {
				s.wipeDirTimes()
			}
		}
	}
	return errors.Join(errs...)
}

// WriteAt écrit dans la zone réservée ; refuse tout dépassement.
func (s *Store) WriteAt(id string, off int64, p []byte) error {
	path, err := s.path(id)
	if err != nil {
		return err
	}
	return s.Gate.do(func() error { return writeAt(path, off, p) })
}

func writeAt(path string, off int64, p []byte) (err error) {
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

// Section : n octets d'un fichier, lus en flux (sans tampon de la taille du segment).
// À fermer par l'appelant.
type Section struct {
	*io.SectionReader
	f *os.File
}

// Close ferme le fichier sous-jacent.
func (s *Section) Close() error { return s.f.Close() }

// Open ouvre exactement n octets à partir de off, pour une lecture en flux. Le fichier est
// ouvert sans mise à jour de la date d'accès quand le système le permet (OpenRead) :
// l'atime trahirait l'heure de la première lecture (audit de confidentialité P5).
// La taille est vérifiée sur le fichier ouvert : un fichier plus court que la zone
// demandée est refusé avant d'envoyer quoi que ce soit.
func (s *Store) Open(id string, off int64, n int64) (*Section, error) {
	path, err := s.path(id)
	if err != nil {
		return nil, err
	}
	var f *os.File
	var fi os.FileInfo
	err = s.Gate.do(func() error {
		if f, err = OpenRead(path); err != nil {
			return err
		}
		if fi, err = f.Stat(); err != nil {
			f.Close()
		}
		return err
	})
	if err != nil {
		return nil, err
	}
	if off < 0 || n < 0 || off > fi.Size() || n > fi.Size()-off {
		f.Close()
		return nil, errors.New("blob : lecture hors du fichier")
	}
	// Chaque lecture de la section passe sous la borne (Gate).
	return &Section{SectionReader: io.NewSectionReader(s.ReaderAt(f), off, n), f: f}, nil
}

// OpenFile ouvre le fichier entier en lecture (sans mise à jour de la date d'accès), pour
// le garder ouvert après sa suppression (spec §41.8 : descripteur détaché). À fermer.
func (s *Store) OpenFile(id string) (*os.File, error) {
	path, err := s.path(id)
	if err != nil {
		return nil, err
	}
	var f *os.File
	err = s.Gate.do(func() (err error) { f, err = OpenRead(path); return err })
	return f, err
}

// Delete supprime le fichier ; sans erreur s'il est déjà absent.
func (s *Store) Delete(id string) error {
	p, err := s.path(id)
	if err != nil {
		return err
	}
	mu := s.lock(id)
	mu.Lock()
	defer mu.Unlock()
	scans := s.begin(0)
	var freed int64
	defer func() { s.end(scans, 0, -freed) }()
	return s.Gate.do(func() error {
		fi, serr := os.Stat(p)
		if err := os.Remove(p); err != nil && !errors.Is(err, os.ErrNotExist) {
			return err
		} else if err == nil {
			s.wipeDirTimes()
			if serr == nil && !fi.IsDir() {
				freed = fi.Size()
			}
		}
		return nil
	})
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

// ScrubTimes remet à l'epoch les dates de chaque fichier du dossier, puis du dossier. Les dates
// de contenu et d'accès y sont déjà (wipeTimes à chaque écriture) ; l'effet voulu est sur la
// date de changement d'inode (ctime), qu'aucun appel ne permet de choisir mais que tout Chtimes
// met à l'heure : après un passage, le ctime de tous les fichiers est l'heure de ce passage,
// et non plus celle de la fin de l'envoi, du dernier message ou de la dernière suppression
// (audit adverse du 13 novembre, stockage, F4). Appelée à chaque passage du janitor. La date
// de création (btime) ne peut pas être changée : limite écrite dans deploy/README.md. Un
// fichier supprimé entre-temps est ignoré ; la première autre erreur est rendue, sans arrêter
// le passage.
func (s *Store) ScrubTimes() error {
	ids, err := s.List()
	if err != nil {
		return err
	}
	var first error
	for _, id := range ids {
		p := filepath.Join(s.Dir, id)
		err := s.Gate.do(func() error { return wipeTimes(p) })
		if err != nil && !errors.Is(err, os.ErrNotExist) && first == nil {
			first = err
		}
	}
	if err := s.Gate.do(func() error { return wipeTimes(s.Dir) }); err != nil && !errors.Is(err, os.ErrNotExist) && first == nil {
		first = err
	}
	return first
}

// UsedBytes : somme des tailles logiques des fichiers, tenue en mémoire (usage) ; le dossier
// n'est lu qu'au premier appel (démarrage) et par Resync.
func (s *Store) UsedBytes() (int64, error) {
	u := &s.usage
	u.mu.Lock()
	if u.synced {
		defer u.mu.Unlock()
		return u.used, nil
	}
	u.mu.Unlock()
	if err := s.Resync(); err != nil {
		return 0, err
	}
	u.mu.Lock()
	defer u.mu.Unlock()
	return u.used, nil
}

// scan additionne les tailles logiques des fichiers du dossier.
func (s *Store) scan() (int64, error) {
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

// withFile ouvre le fichier id en écriture ; les dates sont remises à l'epoch à la fermeture.
func (s *Store) withFile(id string, f func(*os.File) error) error {
	path, err := s.path(id)
	if err != nil {
		return err
	}
	return s.Gate.do(func() error { return openWith(path, f) })
}

func openWith(path string, f func(*os.File) error) (err error) {
	fh, err := os.OpenFile(path, os.O_WRONLY, 0)
	if err != nil {
		return err
	}
	defer func() {
		if werr := wipeTimes(path); err == nil {
			err = werr
		}
	}()
	defer func() {
		if cerr := fh.Close(); err == nil {
			err = cerr
		}
	}()
	return f(fh)
}

// Resize porte le fichier à size octets : agrandi, la nouvelle place est allouée comme par
// Reserve ; réduit, la fin est rendue au système de fichiers (spec §41.14).
func (s *Store) Resize(id string, size int64) error {
	if size < 0 {
		return errors.New("blob : taille négative")
	}
	mu := s.lock(id)
	mu.Lock()
	defer mu.Unlock()
	return s.withFile(id, func(f *os.File) error {
		fi, err := f.Stat()
		if err != nil {
			return err
		}
		old := fi.Size()
		grow := max(size-old, 0)
		scans := s.begin(grow)
		// La taille réelle après l'appel (réussi ou non) fait foi ; illisible : on garde
		// le compte le plus haut.
		defer func() {
			now := max(old, size)
			if fi, err := f.Stat(); err == nil {
				now = fi.Size()
			}
			s.end(scans, grow, now-old)
		}()
		if size <= old {
			return f.Truncate(size)
		}
		return allocate(f, size, s.NoSparse)
	})
}

// Erase efface la plage [off, off+n) : trou rendu au système de fichiers quand il le permet
// (relu comme des zéros), sinon écriture de zéros ; puis fsync. Refuse tout dépassement.
func (s *Store) Erase(id string, off, n int64) error {
	return s.withFile(id, func(f *os.File) error {
		fi, err := f.Stat()
		if err != nil {
			return err
		}
		if off < 0 || n < 0 || off > fi.Size() || n > fi.Size()-off {
			return errors.New("blob : effacement hors du fichier")
		}
		if !punchHole(f, off, n) {
			zero := make([]byte, min(n, 4<<20))
			for done := int64(0); done < n; {
				k := min(int64(len(zero)), n-done)
				if _, err := f.WriteAt(zero[:k], off+done); err != nil {
					return err
				}
				done += k
			}
		}
		return f.Sync()
	})
}

// Sync force le contenu du fichier sur le disque (fdatasync sous Linux : données et taille,
// sans les dates), avant que le partage soit annoncé prêt (revue B4).
func (s *Store) Sync(id string) error {
	return s.withFile(id, datasync)
}
