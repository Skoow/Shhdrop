// Package compte : compte par e-mail pour créer un salon (conception
// docs/superpowers/specs/2026-11-14-compte-email-design.md, plan du compte). Le serveur ne
// reçoit jamais le mot de passe et ne garde aucune adresse en clair : seulement des empreintes
// à clé, calculées avec les sous-clés de K_serveur.
package compte

import (
	"crypto/hkdf"
	"crypto/sha256"
	"errors"
	"fmt"
	"io"
	"os"
)

// Cles : sous-clés de K_serveur, HKDF-SHA-256 à sel vide (conception §5.2, §21.2.2).
type Cles struct {
	Email     [32]byte // « shhdrop/v2/serveur/compte/email » : e_canon, e_envoi
	Poivre    [32]byte // « shhdrop/v2/serveur/compte/mdp » : v_mdp
	TOTP      [32]byte // « shhdrop/v2/serveur/compte/totp » : secret TOTP chiffré
	Sequestre [32]byte // « shhdrop/v2/serveur/compte/sequestre » : cle_profil (séquestre de s_profil)
	Pseudo    [32]byte // « shhdrop/v2/serveur/compte/pseudo » : p_empreinte
}

// LireCles lit K_serveur (exactement 32 octets, fichier ordinaire, droits 0400 ou 0600) et en
// tire les sous-clés ; le tampon de K_serveur est effacé. Messages pour l'exploitant : le
// chemin seulement, jamais le contenu. Perdre ce fichier perd tous les comptes (§5.2 a) : copie
// hors ligne obligatoire.
func LireCles(chemin string) (Cles, error) {
	f, err := os.Open(chemin)
	if err != nil {
		return Cles{}, fmt.Errorf("SHH_COMPTES_CLE_FILE %s illisible", chemin)
	}
	defer f.Close()
	st, err := f.Stat()
	if err != nil || !st.Mode().IsRegular() {
		return Cles{}, fmt.Errorf("SHH_COMPTES_CLE_FILE %s : fichier ordinaire attendu", chemin)
	}
	if st.Mode().Perm()&^0o600 != 0 {
		return Cles{}, fmt.Errorf("SHH_COMPTES_CLE_FILE %s : droits %o, attendu 0400 ou 0600 (chmod 0400)", chemin, st.Mode().Perm())
	}
	k := make([]byte, 33)
	defer clear(k)
	n, err := io.ReadFull(f, k)
	if n != 32 || !errors.Is(err, io.ErrUnexpectedEOF) {
		return Cles{}, fmt.Errorf("SHH_COMPTES_CLE_FILE %s : exactement 32 octets attendus "+
			"(head -c 32 /dev/urandom > fichier)", chemin)
	}
	k = k[:32]
	if [32]byte(k) == [32]byte{} {
		return Cles{}, fmt.Errorf("SHH_COMPTES_CLE_FILE %s : clé nulle (32 zéros), à tirer au hasard", chemin)
	}
	var c Cles
	for _, s := range []struct {
		dst   *[32]byte
		label string
	}{{&c.Email, "email"}, {&c.Poivre, "mdp"}, {&c.TOTP, "totp"}, {&c.Sequestre, "sequestre"}, {&c.Pseudo, "pseudo"}} {
		d, err := hkdf.Key(sha256.New, k, nil, "shhdrop/v2/serveur/compte/"+s.label, 32)
		if err != nil {
			return Cles{}, err
		}
		copy(s.dst[:], d)
		clear(d)
	}
	return c, nil
}
