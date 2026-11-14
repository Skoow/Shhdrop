package compte

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"errors"
	"fmt"
	"math/big"
	"time"

	"github.com/skoow/shhdrop/server/internal/courriel"
)

// Étapes en mémoire (conception §8.3) : une inscription, une récupération ou un changement
// d'adresse en attente du code reçu par e-mail ; une connexion en attente du code de
// l'application ; une activation de la double authentification en attente du premier code. Désignées par un jeton de 32 octets rendu au
// client ; la table ne garde que SHA-256 du jeton. Rien sur disque : un redémarrage les perd.
// Aucune adresse en clair : e_canon, e_envoi seulement (le renvoi demande l'adresse au client).
const (
	dureeCode     = 15 * time.Minute // code e-mail (§8.8)
	essaisCode    = 5                // essais par code, puis l'étape meurt
	attenteRenvoi = 60 * time.Second // entre deux envois d'une même étape
	dureeTOTP     = 5 * time.Minute  // étape « double authentification » d'une connexion
	// etapesMax : étapes vivantes au plus (toutes sortes) ; au-delà, busy. Les limites par
	// connexion en bornent déjà le nombre ; ceci borne la mémoire face à beaucoup de /48.
	etapesMax = 20000
)

type sorteEtape uint8

const (
	etapeInscription sorteEtape = iota + 1
	etapeConnexionTOTP
	etapeOubli          // récupération (lot 5)
	etapeEmail          // changement d'adresse : canon, envoi de la nouvelle adresse (lot 5)
	etapeTOTPActivation // secret scellé en attente du premier code (lot 5)
)

type etape struct {
	sorte        sorteEtape
	h            [16]byte
	canon, envoi [32]byte
	langue       string
	code         [32]byte // HMAC(cleCode, h ‖ e_canon ‖ code) ; zéro : pas de code
	essais       int
	expire       time.Time
	envoye       time.Time      // dernier envoi d'un code
	options      OptionsSession // connexion en attente de la double authentification
	essaisTOTP   int            // essais restants pour le code de l'application
	secret       [48]byte       // activation : secret TOTP scellé (jamais en clair)
	// fantome : récupération demandée pour une adresse sans compte (ou une variante de
	// l'adresse exacte) : même étape, mêmes limites, aucun e-mail, aucun code juste.
	fantome bool
	// verifie : récupération dont le code (et le code de l'application, ou l'attente de son
	// retrait, parRetrait) est juste.
	verifie, parRetrait bool
}

// etapes : SHA-256 du jeton → étape (allowedMaps de stats_test.go).
type etapes struct {
	m map[[32]byte]*etape
}

func cleEtape(jeton [32]byte) [32]byte { return sha256.Sum256(jeton[:]) }

// trouver : l'étape vivante de cette sorte, ou nil (une étape échue est retirée).
func (t *etapes) trouver(jeton [32]byte, sorte sorteEtape, now time.Time) *etape {
	k := cleEtape(jeton)
	e := t.m[k]
	if e == nil {
		return nil
	}
	if !now.Before(e.expire) {
		delete(t.m, k)
		return nil
	}
	if e.sorte != sorte {
		return nil
	}
	return e
}

func (t *etapes) retirer(jeton [32]byte) { delete(t.m, cleEtape(jeton)) }

// balayer : retire les étapes échues.
func (t *etapes) balayer(now time.Time) {
	for k, e := range t.m {
		if !now.Before(e.expire) {
			delete(t.m, k)
		}
	}
}

// nouvelleEtapeLocked : jeton tiré, étape gardée (s.mu tenu).
func (s *Service) nouvelleEtapeLocked(e *etape, now time.Time) ([32]byte, error) {
	if len(s.et.m) >= etapesMax {
		s.et.balayer(now)
		if len(s.et.m) >= etapesMax {
			return [32]byte{}, ErrBusy
		}
	}
	var jeton [32]byte
	rand.Read(jeton[:])
	switch e.sorte {
	case etapeConnexionTOTP:
		e.expire = now.Add(dureeTOTP)
	default:
		e.expire = now.Add(dureeCode)
	}
	s.et.m[cleEtape(jeton)] = e
	return jeton, nil
}

// envoyerCodeLocked : nouveau code de 6 chiffres, 15 min, 5 essais, mis en file pour adresse
// (l'adresse exacte de la requête, jamais gardée). File pleine : busy, le code précédent reste.
// Étape fantôme : le même calcul, rien en file, et une empreinte aléatoire qu'aucun code ne
// reproduit.
func (s *Service) envoyerCodeLocked(e *etape, adresse string, now time.Time) error {
	n, err := rand.Int(rand.Reader, big.NewInt(1_000_000))
	if err != nil {
		return err
	}
	code := fmt.Sprintf("%06d", n.Int64())
	c := s.hmacCode(e, code)
	if e.fantome {
		rand.Read(c[:])
	} else if err := s.post.Mettre(courriel.Message{A: adresse, Langue: e.langue, Code: code}); err != nil {
		if errors.Is(err, courriel.ErrPlein) {
			return ErrBusy
		}
		return err
	}
	e.code = c
	e.essais = essaisCode
	e.envoye = now
	e.expire = now.Add(dureeCode)
	return nil
}

// hmacCode : le code n'est gardé qu'en HMAC sous une clé tirée au démarrage, lié à l'étape
// (son h et ses empreintes).
func (s *Service) hmacCode(e *etape, code string) [32]byte {
	m := hmac.New(sha256.New, s.cleCode[:])
	m.Write(e.h[:])
	m.Write(e.canon[:])
	m.Write([]byte(code))
	return [32]byte(m.Sum(nil))
}

func codeForme(c string) bool {
	if len(c) != 6 {
		return false
	}
	for i := 0; i < len(c); i++ {
		if c[i] < '0' || c[i] > '9' {
			return false
		}
	}
	return true
}

// verifierCodeLocked : code mal formé → bad_request (pas un essai) ; faux → un essai de moins,
// l'étape meurt au 5e ; comparaison en temps constant.
func (s *Service) verifierCodeLocked(jeton [32]byte, e *etape, code string) error {
	if !codeForme(code) {
		return ErrRequete
	}
	c := s.hmacCode(e, code)
	if !hmac.Equal(c[:], e.code[:]) {
		e.essais--
		if e.essais <= 0 {
			s.et.retirer(jeton)
			return ErrCodeFaux{0}
		}
		return ErrCodeFaux{e.essais}
	}
	return nil
}
