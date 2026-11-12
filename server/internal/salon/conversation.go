package salon

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/binary"
	"errors"
	"math"
	"os"
	"path/filepath"
	"sync"
	"syscall"
	"time"

	"github.com/skoow/shhdrop/server/internal/blob"
)

// Fichier de conversation (v3 §5.1, plan C-2 « Protocole ») : un emplacement de
// TailleEmplacement octets par trame non volatile, dans l'ordre d'arrivée :
// nonce (12, aléatoire) ‖ AES-256-GCM(clé, nonce, trame, adConv ‖ numéro d'emplacement (8)).
// La clé est tirée à l'ouverture et ne vit qu'en mémoire : un disque saisi ou copié, ou un
// redémarrage, ne donne que des emplacements illisibles. Aucun seq, siège, heure ni drapeau
// en clair ; trame effacée = emplacement écrasé de zéros. Aucun fsync : le fichier ne sert
// plus après un redémarrage (clé perdue).

// TailleEmplacement : nonce (12) ‖ trame chiffrée (4 140) ‖ étiquette GCM (16).
const TailleEmplacement = tailleNonce + TailleTrame + 16

const tailleNonce = 12

// adConv : début des données authentifiées ; le numéro d'emplacement qui suit empêche de
// déplacer ou d'échanger des emplacements dans le fichier.
const adConv = "shhdrop/salon/disque/v1"

var (
	// ErrEfface : emplacement écrasé de zéros, ou qui ne s'authentifie pas (autre clé,
	// emplacement déplacé ou modifié).
	ErrEfface = errors.New("salon: trame effacée")
	// ErrEmplacement : emplacement jamais écrit.
	ErrEmplacement = errors.New("salon: emplacement inconnu")
	// ErrDetruite : conversation détruite (clé oubliée, fichier supprimé).
	ErrDetruite = errors.New("salon: conversation détruite")
	// ErrPleine : plus aucun numéro d'emplacement (2^32 − 1 écrits).
	ErrPleine = errors.New("salon: conversation pleine")

	// ErrES : erreur d'entrée-sortie du fichier de conversation. Message fixe, sans chemin ;
	// errors.Is reconnaît aussi le code système d'origine (ENOSPC, os.ErrExist…).
	ErrES = errors.New("salon: erreur d'entrée-sortie de la conversation")
	// ErrInutilisable : une écriture n'a pas pu être annulée (taille du fichier incertaine) ;
	// seule Detruire reste possible.
	ErrInutilisable = errors.New("salon: conversation inutilisable")

	errIDConv = errors.New("salon: identifiant de conversation invalide")
)

// erreurES : ErrES, avec le seul code système d'origine (jamais le chemin d'une PathError).
type erreurES struct{ code error }

func (e erreurES) Error() string       { return ErrES.Error() }
func (e erreurES) Is(cible error) bool { return cible == ErrES }
func (e erreurES) Unwrap() error       { return e.code }

// es encapsule err dans ErrES ; nil reste nil.
func es(err error) error {
	if err == nil {
		return nil
	}
	var code syscall.Errno
	if errors.As(err, &code) {
		return erreurES{code}
	}
	return erreurES{}
}

// fichierEcriture : ce que Conversation utilise du fichier d'écriture (*os.File ; remplacé
// par les tests pour injecter des pannes).
type fichierEcriture interface {
	WriteAt([]byte, int64) (int, error)
	Truncate(int64) error
	Close() error
}

// Conversation : fichier de conversation d'un salon. Sûr pour un usage concurrent.
type Conversation struct {
	mu      sync.RWMutex
	chemin  string
	f       fichierEcriture // écritures
	lecteur *os.File        // lectures, ouvert avec O_NOATIME quand le système le permet
	cle     [32]byte
	aead    cipher.AEAD
	n       uint32 // emplacements écrits
	// inutilisable : Truncate a échoué après une écriture ratée ; tailleMax borne alors le
	// fichier réel (Taille ne le sous-compte jamais).
	inutilisable bool
	tailleMax    int64
	detruite     bool
	supprime     bool // fichier supprimé (Detruire réessaie sinon)
}

// idValide : 22 caractères base64url canoniques (16 octets), anti traversée de chemin.
func idValide(id string) bool {
	if len(id) != 22 {
		return false
	}
	for i := 0; i < len(id); i++ {
		c := id[i]
		if !(c >= 'A' && c <= 'Z' || c >= 'a' && c <= 'z' || c >= '0' && c <= '9' || c == '-' || c == '_') {
			return false
		}
	}
	b, err := b64.DecodeString(id)
	return err == nil && len(b) == 16
}

// sansDate met les dates du fichier à l'epoch (comme blob.wipeTimes).
func sansDate(p string) error { return es(os.Chtimes(p, time.Unix(0, 0), time.Unix(0, 0))) }

// etat : erreur fixe si la conversation ne sert plus (appelant sous c.mu).
func (c *Conversation) etat() error {
	switch {
	case c.detruite:
		return ErrDetruite
	case c.inutilisable:
		return ErrInutilisable
	}
	return nil
}

// ecrire écrit p en off ; les dates sont remises à l'epoch même en cas d'erreur (écriture
// partielle), comme blob.WriteAt.
func (c *Conversation) ecrire(p []byte, off int64) (err error) {
	defer func() {
		if derr := sansDate(c.chemin); err == nil {
			err = derr
		}
	}()
	_, err = c.f.WriteAt(p, off)
	return es(err)
}

// annuler ramène le fichier à taille octets après une écriture ratée ; si Truncate échoue,
// la conversation devient inutilisable (sa taille réelle n'est plus connue exactement).
func (c *Conversation) annuler(taille, max int64) {
	defer sansDate(c.chemin)
	if c.f.Truncate(taille) != nil {
		c.inutilisable, c.tailleMax = true, max
	}
}

// OuvrirConversation crée dossier/id (qui ne doit pas exister, mode 0600) et tire sa clé.
func OuvrirConversation(dossier, id string) (*Conversation, error) {
	if !idValide(id) {
		return nil, errIDConv
	}
	if err := os.MkdirAll(dossier, 0o700); err != nil {
		return nil, es(err)
	}
	c := &Conversation{chemin: filepath.Join(dossier, id)}
	f, err := os.OpenFile(c.chemin, os.O_RDWR|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return nil, es(err)
	}
	c.f = f
	ok := false
	defer func() {
		if !ok {
			c.Detruire()
		}
	}()
	if c.lecteur, err = blob.OpenRead(c.chemin); err != nil {
		return nil, es(err)
	}
	rand.Read(c.cle[:]) // ne rend jamais d'erreur (Go ≥ 1.24)
	bloc, err := aes.NewCipher(c.cle[:])
	if err != nil {
		return nil, err
	}
	if c.aead, err = cipher.NewGCM(bloc); err != nil {
		return nil, err
	}
	if err := sansDate(c.chemin); err != nil {
		return nil, err
	}
	ok = true
	return c, nil
}

// ad : données authentifiées de l'emplacement e.
func ad(e uint32) []byte {
	return binary.BigEndian.AppendUint64([]byte(adConv), uint64(e))
}

func decalage(e uint32) int64 { return int64(e) * TailleEmplacement }

// Ajouter écrit la trame (TailleTrame octets) dans un nouvel emplacement et rend son numéro.
// En cas d'échec, le fichier est ramené à sa taille d'avant (aucun emplacement partiel).
func (c *Conversation) Ajouter(trame []byte) (uint32, error) {
	if len(trame) != TailleTrame {
		return 0, ErrEnTete
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if err := c.etat(); err != nil {
		return 0, err
	}
	if c.n == math.MaxUint32 {
		return 0, ErrPleine
	}
	e := c.n
	buf := make([]byte, tailleNonce, TailleEmplacement)
	rand.Read(buf)
	buf = c.aead.Seal(buf, buf, trame, ad(e))
	if err := c.ecrire(buf, decalage(e)); err != nil {
		c.annuler(decalage(e), decalage(e)+TailleEmplacement)
		return 0, err
	}
	c.n++
	return e, nil
}

// Lire rend la trame de l'emplacement e ; ErrEfface s'il est nul ou ne s'authentifie pas.
func (c *Conversation) Lire(e uint32) ([]byte, error) {
	c.mu.RLock()
	defer c.mu.RUnlock()
	if err := c.etat(); err != nil {
		return nil, err
	}
	if e >= c.n {
		return nil, ErrEmplacement
	}
	buf := make([]byte, TailleEmplacement)
	if _, err := c.lecteur.ReadAt(buf, decalage(e)); err != nil {
		return nil, es(err)
	}
	nul := true
	for _, b := range buf {
		if b != 0 {
			nul = false
			break
		}
	}
	if nul {
		return nil, ErrEfface
	}
	trame, err := c.aead.Open(nil, buf[:tailleNonce], buf[tailleNonce:], ad(e))
	if err != nil {
		return nil, ErrEfface
	}
	return trame, nil
}

// Effacer écrase l'emplacement e de zéros.
func (c *Conversation) Effacer(e uint32) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if err := c.etat(); err != nil {
		return err
	}
	if e >= c.n {
		return ErrEmplacement
	}
	// Emplacement déjà écrit : la taille du fichier ne change pas, même en cas d'échec.
	return c.ecrire(make([]byte, TailleEmplacement), decalage(e))
}

// Taille : octets du fichier (emplacements effacés compris) ; 0 après Detruire. Une
// conversation inutilisable compte la borne haute de son fichier.
func (c *Conversation) Taille() int64 {
	c.mu.RLock()
	defer c.mu.RUnlock()
	switch {
	case c.detruite:
		return 0
	case c.inutilisable:
		return c.tailleMax
	}
	return decalage(c.n)
}

// Detruire oublie la clé (mise à zéro), ferme le fichier puis le supprime. Idempotent : un
// nouvel appel ne refait que la suppression si elle avait échoué.
func (c *Conversation) Detruire() error {
	c.mu.Lock()
	defer c.mu.Unlock()
	var errFermeture error
	if !c.detruite {
		c.detruite = true
		clear(c.cle[:])
		c.aead = nil
		if c.lecteur != nil {
			errFermeture = c.lecteur.Close()
		}
		if err := c.f.Close(); errFermeture == nil {
			errFermeture = err
		}
	}
	if c.supprime {
		return nil
	}
	if err := os.Remove(c.chemin); err != nil && !errors.Is(err, os.ErrNotExist) {
		return es(err)
	}
	c.supprime = true
	// Fichier supprimé et clé oubliée : une erreur de fermeture est seulement signalée.
	return es(errFermeture)
}
