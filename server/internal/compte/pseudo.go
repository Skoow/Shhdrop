package compte

import (
	_ "embed"
	"errors"
	"strings"
	"unicode/utf8"
)

// PseudoCanonMax : longueur au plus de p_canon, en octets. Le lot 1 a mesuré 336 octets pour un
// p_canon valide (24 graphèmes de plusieurs points de code) ; 96, prévu par le plan, aurait
// refusé des pseudos valides. 512 laisse de la marge et borne le calcul.
const PseudoCanonMax = 512

var (
	// ErrPseudoCanon : p_canon vide, trop long ou en UTF-8 invalide (400 bad_request).
	ErrPseudoCanon = errors.New("p_canon invalide")
	// ErrPseudoReserve : p_canon d'un pseudo réservé (conception §21.5).
	ErrPseudoReserve = errors.New("pseudo_reserve")
)

// reserves.txt : formes canoniques (pseudo_canon du moteur Rust, squelette UTS #39 compris)
// des pseudos réservés, exactement constants.reserves de engine/vectors/compte.json. Le
// serveur ne calcule jamais le canon : il reçoit p_canon du client et compare des octets ;
// aucune bibliothèque Unicode côté Go (versions Unicode : celles du moteur, notées dans
// constants.unicode).
//
//go:embed reserves.txt
var reservesTxt string

var reserves = lireReserves(reservesTxt)

func lireReserves(s string) []string {
	var out []string
	for _, l := range strings.Split(s, "\n") {
		if l != "" && !strings.HasPrefix(l, "#") {
			out = append(out, l)
		}
	}
	return out
}

// EmpreintePseudo : p_empreinte = HMAC-SHA-256(K_pseudo, « pseudo » ‖ 0x00 ‖ p_canon)
// (conception §21.2.2). Refus : p_canon vide, de plus de PseudoCanonMax octets ou en UTF-8
// invalide (ErrPseudoCanon) ; pseudo réservé (ErrPseudoReserve). Limite assumée (§21.5) : un
// client modifié peut envoyer autre chose que le vrai canon ; l'unicité ne vaut que pour les
// clients honnêtes.
func (c Cles) EmpreintePseudo(pCanon []byte) ([32]byte, error) {
	if len(pCanon) == 0 || len(pCanon) > PseudoCanonMax || !utf8.Valid(pCanon) {
		return [32]byte{}, ErrPseudoCanon
	}
	for _, r := range reserves {
		if string(pCanon) == r {
			return [32]byte{}, ErrPseudoReserve
		}
	}
	return empreinte(c.Pseudo[:], "pseudo", pCanon), nil
}
