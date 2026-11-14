package compte

import (
	_ "embed"
	"errors"
	"fmt"
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

// interdits.txt : pseudos interdits côté serveur seulement (demande du propriétaire du
// 14 novembre : rôles, autorités, marques, insultes), lus une fois au démarrage.
//
//go:embed interdits.txt
var interditsTxt string

var interditsExacts, interditsContient = doitInterdits(interditsTxt)

func doitInterdits(s string) ([]string, []string) {
	l, err := lireInterdits(s)
	if err != nil {
		panic(err)
	}
	return l[0], l[1]
}

// lireInterdits : lignes « exact <forme> » et « contient <forme> » (la suite de la ligne,
// après la forme, est un commentaire) ; vides et « # » ignorées ; toute autre ligne refusée.
func lireInterdits(s string) ([2][]string, error) {
	var out [2][]string
	for i, l := range strings.Split(s, "\n") {
		if l == "" || strings.HasPrefix(l, "#") {
			continue
		}
		f := strings.Fields(l)
		k := map[string]int{"exact": 0, "contient": 1}
		n, ok := k[f[0]]
		if !ok || len(f) < 2 {
			return out, fmt.Errorf("interdits.txt, ligne %d : %q", i+1, l)
		}
		out[n] = append(out[n], f[1])
	}
	return out, nil
}

// interdit : p_canon réservé (reserves.txt, commun au moteur) ou interdit (interdits.txt).
func interdit(p string) bool {
	for _, l := range [2][]string{reserves, interditsExacts} {
		for _, r := range l {
			if p == r {
				return true
			}
		}
	}
	for _, r := range interditsContient {
		if strings.Contains(p, r) {
			return true
		}
	}
	return false
}

// EmpreintePseudo : p_empreinte = HMAC-SHA-256(K_pseudo, « pseudo » ‖ 0x00 ‖ p_canon)
// (conception §21.2.2). Refus : p_canon vide, de plus de PseudoCanonMax octets ou en UTF-8
// invalide (ErrPseudoCanon) ; pseudo réservé ou interdit (ErrPseudoReserve). Limite assumée (§21.5) : un
// client modifié peut envoyer autre chose que le vrai canon ; l'unicité ne vaut que pour les
// clients honnêtes.
func (c Cles) EmpreintePseudo(pCanon []byte) ([32]byte, error) {
	if len(pCanon) == 0 || len(pCanon) > PseudoCanonMax || !utf8.Valid(pCanon) {
		return [32]byte{}, ErrPseudoCanon
	}
	if interdit(string(pCanon)) {
		return [32]byte{}, ErrPseudoReserve
	}
	return empreinte(c.Pseudo[:], "pseudo", pCanon), nil
}
