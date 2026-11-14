package compte

import (
	"crypto/hmac"
	"crypto/sha256"
	"errors"
	"strings"
)

// Erreurs de Normaliser : mêmes codes que le moteur Rust (engine/core/src/compte.rs).
var (
	ErrAdresseInvalide = errors.New("adresse_invalide")
	ErrAdresseNonASCII = errors.New("adresse_non_ascii")
)

// Adresse normalisée : Canon (unicité, connexion, bannissement) et Exacte (envoi, récupération).
type Adresse struct {
	Canon  string
	Exacte string
}

const (
	adresseMax   = 254
	localMax     = 64
	etiquetteMax = 63
)

// Normaliser : conception §5.1, à l'identique du moteur Rust (normaliser de compte.rs, vecteurs
// normaliser de engine/vectors/compte.json). Blancs ASCII de bord retirés (espace, tabulation,
// retour chariot, saut de ligne) ; un octet non ASCII → ErrAdresseNonASCII ; plus de 254
// caractères, caractère hors de U+0021–U+007E, pas exactement un « @ », partie locale hors du
// « dot-atom » de la RFC 5322 (1 à 64 caractères) ou domaine refusé → ErrAdresseInvalide. Puis
// minuscules (Exacte) ; Canon : partie locale coupée au premier « + » (vide → refus),
// googlemail.com → gmail.com, points retirés pour gmail.com.
func Normaliser(email string) (Adresse, error) {
	t := strings.Trim(email, " \t\r\n")
	for i := 0; i < len(t); i++ {
		if t[i] >= 0x80 {
			return Adresse{}, ErrAdresseNonASCII
		}
	}
	if len(t) > adresseMax {
		return Adresse{}, ErrAdresseInvalide
	}
	b := []byte(t)
	for i, c := range b {
		if c < 0x21 || c > 0x7e {
			return Adresse{}, ErrAdresseInvalide
		}
		if 'A' <= c && c <= 'Z' {
			b[i] = c + ('a' - 'A')
		}
	}
	exacte := string(b)
	local, domaine, ok := strings.Cut(exacte, "@")
	if !ok || strings.Contains(domaine, "@") || !localValide(local) || !domaineValide(domaine) {
		return Adresse{}, ErrAdresseInvalide
	}
	base, _, _ := strings.Cut(local, "+")
	if domaine == "googlemail.com" {
		domaine = "gmail.com"
	}
	if domaine == "gmail.com" {
		base = strings.ReplaceAll(base, ".", "")
	}
	if base == "" {
		return Adresse{}, ErrAdresseInvalide
	}
	return Adresse{Canon: base + "@" + domaine, Exacte: exacte}, nil
}

// localValide : « dot-atom » (lettres, chiffres, !#$%&'*+/=?^_`{|}~-, points ni en bord ni
// doublés), 1 à 64 caractères.
func localValide(l string) bool {
	if len(l) < 1 || len(l) > localMax {
		return false
	}
	for _, a := range strings.Split(l, ".") {
		if a == "" {
			return false
		}
		for i := 0; i < len(a); i++ {
			c := a[i]
			if !isAlnum(c) && !strings.ContainsRune("!#$%&'*+/=?^_`{|}~-", rune(c)) {
				return false
			}
		}
	}
	return true
}

// domaineValide : au moins deux étiquettes de 1 à 63 caractères [a-z0-9-] sans tiret en bord,
// la dernière faite d'au moins deux lettres.
func domaineValide(d string) bool {
	e := strings.Split(d, ".")
	if len(e) < 2 {
		return false
	}
	for _, l := range e {
		if len(l) < 1 || len(l) > etiquetteMax || l[0] == '-' || l[len(l)-1] == '-' {
			return false
		}
		for i := 0; i < len(l); i++ {
			if c := l[i]; !(c >= 'a' && c <= 'z') && !(c >= '0' && c <= '9') && c != '-' {
				return false
			}
		}
	}
	tld := e[len(e)-1]
	if len(tld) < 2 {
		return false
	}
	for i := 0; i < len(tld); i++ {
		if tld[i] < 'a' || tld[i] > 'z' {
			return false
		}
	}
	return true
}

func isAlnum(c byte) bool {
	return c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9'
}

// Empreintes : e_canon = HMAC-SHA-256(K_email, « canon » ‖ 0x00 ‖ canon) ;
// e_envoi = HMAC-SHA-256(K_email, « envoi » ‖ 0x00 ‖ exacte) (conception §5.2). Seules ces
// empreintes sont gardées, jamais l'adresse.
func (c Cles) Empreintes(a Adresse) (canon, envoi [32]byte) {
	return empreinte(c.Email[:], "canon", []byte(a.Canon)), empreinte(c.Email[:], "envoi", []byte(a.Exacte))
}

func empreinte(cle []byte, etiquette string, v []byte) [32]byte {
	m := hmac.New(sha256.New, cle)
	m.Write([]byte(etiquette))
	m.Write([]byte{0})
	m.Write(v)
	return [32]byte(m.Sum(nil))
}
