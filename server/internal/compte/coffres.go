package compte

import (
	"database/sql"
	"encoding/binary"
	"errors"
)

// Coffres (conception §21.2.2, §21.6.2) : « SHH-PROF1 » (profil, séquestré) et « SHH-ACCT1 »
// (privé, chiffré par K_compte seulement) ; chacun = en-tête (9) ‖ gen (8, gros-boutiste) ‖
// nonce (12) ‖ chiffré du clair bourré au palier (4, 16, 64 ou 256 Kio) ‖ étiquette (16). Le
// serveur n'ouvre jamais un coffre : il vérifie la forme, le palier et que gen vaut if_gen + 1
// (le gen est dans l'AD : le client le refuse s'il ne correspond pas), et garde le plus grand.

// Coffre : sorte de coffre.
type Coffre uint8

const (
	Profil Coffre = iota + 1
	Prive
)

func (c Coffre) colonnes() (blob, gen, magic string) {
	if c == Profil {
		return "blob_profil", "gen_profil", "SHH-PROF1"
	}
	return "blob_prive", "gen_prive", "SHH-ACCT1"
}

// coffreValide : forme exacte et gen attendu.
func coffreValide(c Coffre, b []byte, gen uint64) bool {
	if c != Profil && c != Prive {
		return false
	}
	_, _, magic := c.colonnes()
	switch len(b) {
	case 4096 + 45, 16384 + 45, 65536 + 45, 262144 + 45:
	default:
		return false
	}
	return string(b[:9]) == magic && binary.BigEndian.Uint64(b[9:17]) == gen
}

// LireCoffre : le coffre et son gen.
func (s *Service) LireCoffre(c Courante, sorte Coffre) ([]byte, uint64, error) {
	if sorte != Profil && sorte != Prive {
		return nil, 0, ErrRequete
	}
	col, gcol, _ := sorte.colonnes()
	var b []byte
	var g uint64
	err := s.db.QueryRow(`SELECT `+col+`, `+gcol+` FROM comptes WHERE h=?`, c.H[:]).Scan(&b, &g)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, 0, ErrSession
	}
	return b, g, err
}

// EcrireCoffre : écrit blob si le gen du serveur est ifGen (sinon ErrConflit, avec le gen du
// serveur) ; blob doit porter gen = ifGen + 1. 60 écritures par heure pour les deux coffres
// ensemble (une écriture refusée pour conflit compte : elle a été tentée).
func (s *Service) EcrireCoffre(c Courante, sorte Coffre, ifGen uint64, blob []byte) (uint64, error) {
	if ifGen >= 1<<62 || !coffreValide(sorte, blob, ifGen+1) {
		return 0, ErrRequete
	}
	now := s.now()
	if !s.lim.AllowEcritureCoffre(c.H) {
		return 0, ErrLimit{heureSuivante(now)}
	}
	col, gcol, _ := sorte.colonnes()
	var gen uint64
	err := s.tx(func(tx *sql.Tx) error {
		if err := tx.QueryRow(`SELECT `+gcol+` FROM comptes WHERE h=?`, c.H[:]).Scan(&gen); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return ErrSession
			}
			return err
		}
		if gen != ifGen {
			return ErrConflit{gen}
		}
		gen = ifGen + 1
		_, err := tx.Exec(`UPDATE comptes SET `+col+`=?, `+gcol+`=? WHERE h=?`, blob, gen, c.H[:])
		return err
	})
	if err != nil {
		return 0, err
	}
	return gen, nil
}
