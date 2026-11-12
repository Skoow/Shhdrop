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

	errIDConv = errors.New("salon: identifiant de conversation invalide")
)

// Conversation : fichier de conversation d'un salon. Sûr pour un usage concurrent.
type Conversation struct {
	mu       sync.RWMutex
	chemin   string
	f        *os.File // écritures
	lecteur  *os.File // lectures, ouvert avec O_NOATIME quand le système le permet
	cle      [32]byte
	aead     cipher.AEAD
	n        uint32 // emplacements écrits
	detruite bool
	supprime bool // fichier supprimé (Detruire réessaie sinon)
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
func sansDate(p string) error { return os.Chtimes(p, time.Unix(0, 0), time.Unix(0, 0)) }

// OuvrirConversation crée dossier/id (qui ne doit pas exister, mode 0600) et tire sa clé.
func OuvrirConversation(dossier, id string) (*Conversation, error) {
	if !idValide(id) {
		return nil, errIDConv
	}
	if err := os.MkdirAll(dossier, 0o700); err != nil {
		return nil, err
	}
	c := &Conversation{chemin: filepath.Join(dossier, id)}
	f, err := os.OpenFile(c.chemin, os.O_RDWR|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return nil, err
	}
	c.f = f
	ok := false
	defer func() {
		if !ok {
			c.Detruire()
		}
	}()
	if c.lecteur, err = blob.OpenRead(c.chemin); err != nil {
		return nil, err
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
	if c.detruite {
		return 0, ErrDetruite
	}
	if c.n == math.MaxUint32 {
		return 0, ErrPleine
	}
	e := c.n
	buf := make([]byte, tailleNonce, TailleEmplacement)
	rand.Read(buf)
	buf = c.aead.Seal(buf, buf, trame, ad(e))
	if _, err := c.f.WriteAt(buf, decalage(e)); err != nil {
		c.f.Truncate(decalage(e))
		return 0, err
	}
	if err := sansDate(c.chemin); err != nil {
		c.f.Truncate(decalage(e))
		return 0, err
	}
	c.n++
	return e, nil
}

// Lire rend la trame de l'emplacement e ; ErrEfface s'il est nul ou ne s'authentifie pas.
func (c *Conversation) Lire(e uint32) ([]byte, error) {
	c.mu.RLock()
	defer c.mu.RUnlock()
	if c.detruite {
		return nil, ErrDetruite
	}
	if e >= c.n {
		return nil, ErrEmplacement
	}
	buf := make([]byte, TailleEmplacement)
	if _, err := c.lecteur.ReadAt(buf, decalage(e)); err != nil {
		return nil, err
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
	if c.detruite {
		return ErrDetruite
	}
	if e >= c.n {
		return ErrEmplacement
	}
	if _, err := c.f.WriteAt(make([]byte, TailleEmplacement), decalage(e)); err != nil {
		return err
	}
	return sansDate(c.chemin)
}

// Taille : octets du fichier (emplacements effacés compris) ; 0 après Detruire.
func (c *Conversation) Taille() int64 {
	c.mu.RLock()
	defer c.mu.RUnlock()
	if c.detruite {
		return 0
	}
	return decalage(c.n)
}

// Detruire oublie la clé (mise à zéro), ferme le fichier puis le supprime. Idempotent : un
// nouvel appel ne refait que la suppression si elle avait échoué.
func (c *Conversation) Detruire() error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if !c.detruite {
		c.detruite = true
		clear(c.cle[:])
		c.aead = nil
		if c.lecteur != nil {
			c.lecteur.Close()
		}
		c.f.Close()
	}
	if c.supprime {
		return nil
	}
	if err := os.Remove(c.chemin); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	c.supprime = true
	return nil
}
