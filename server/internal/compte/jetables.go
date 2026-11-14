package compte

import (
	_ "embed"
	"fmt"
	"strings"
)

// Listes embarquées dans le binaire (conception §5.3) : jamais téléchargées par le serveur.
//
//go:embed jetables.txt
var jetablesTxt string

//go:embed jetables-ajouts.txt
var jetablesAjoutsTxt string

// jetables : ensemble constant des domaines jetables, lu une fois au démarrage (une liste
// illisible arrête le programme : erreur de construction, attrapée par les tests).
var jetables map[string]struct{} = doitDomaines(jetablesTxt, jetablesAjoutsTxt)

func doitDomaines(textes ...string) map[string]struct{} {
	e, err := lireDomaines(textes...)
	if err != nil {
		panic(err)
	}
	return e
}

// lireDomaines : un domaine par ligne ([a-z0-9.-]), lignes vides et commentaires (#) ignorés.
func lireDomaines(textes ...string) (map[string]struct{}, error) {
	e := map[string]struct{}{}
	for _, t := range textes {
		for i, l := range strings.Split(t, "\n") {
			if l == "" || strings.HasPrefix(l, "#") {
				continue
			}
			for j := 0; j < len(l); j++ {
				if c := l[j]; !(c >= 'a' && c <= 'z') && !(c >= '0' && c <= '9') && c != '.' && c != '-' {
					return nil, fmt.Errorf("liste de domaines jetables, ligne %d : %q", i+1, l)
				}
			}
			e[l] = struct{}{}
		}
	}
	return e, nil
}

// Jetable : vrai si le domaine (canonique, en minuscules) ou l'un de ses domaines parents est
// dans la liste (x.mailinator.com comme mailinator.com).
func Jetable(domaine string) bool {
	for d := domaine; d != ""; {
		if _, ok := jetables[d]; ok {
			return true
		}
		_, reste, ok := strings.Cut(d, ".")
		if !ok {
			return false
		}
		d = reste
	}
	return false
}
