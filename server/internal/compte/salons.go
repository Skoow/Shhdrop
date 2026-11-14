package compte

import (
	"crypto/rand"
	"crypto/subtle"
	"time"
)

// Salons du compte (conception §11, §21.6.2 « GET salons », « salons/detruire », §21.10 ; plan
// lot 6) : palier et bannissement lus à la création d'un salon, ancienneté remise à zéro par
// un signalement, et salons vivants créés par le compte, désignés par une ref aléatoire
// éphémère : aucun identifiant de salon ne sort du serveur.

// dureeRef : une ref de salon vaut 10 min après sa création (§21.6.2).
const dureeRef = 10 * time.Minute

// SalonVivant : un salon vivant du compte, tel que le crochet du salon le rend. ID :
// identifiant interne (jamais rendu) ; ExpireVers : échéance (secondes Unix, au quart d'heure).
type SalonVivant struct {
	ID             string
	ExpireVers     int64
	Places, Sieges int
}

// SalonRef : une ligne de GET /api/compte/salons.
type SalonRef struct {
	Ref            [16]byte
	ExpireVers     int64
	Places, Sieges int
}

// refSalon : ce qu'une ref désigne, en mémoire seulement (sous refsMu).
type refSalon struct {
	h      [16]byte
	id     string
	expire time.Time
}

// Palier : limites du compte h pour créer ou régler un salon (§11). Adresse bannie
// (bannissement actif, non échu, lu dans bannis comme Etat) : ErrBanni ; compte inconnu
// (supprimé entre-temps) : ErrSession.
func (s *Service) Palier(h [16]byte) (Limites, error) {
	now := s.now()
	l, err := s.lireEtat(h, now)
	if err != nil {
		return Limites{}, err
	}
	if l.banni {
		return Limites{}, ErrBanni{dateJour(l.banniJusqu)}
	}
	_, lim, _ := palier(l.des, now)
	return lim, nil
}

// Signale : premier signalement d'un salon du compte h : compte_des = aujourd'hui (§11 ;
// décision D4). Compte inconnu (supprimé) : rien.
func (s *Service) Signale(h [16]byte) error {
	_, err := s.db.Exec(`UPDATE comptes SET compte_des=? WHERE h=?`, jourDe(s.now()), h[:])
	return err
}

// SalonsListe : salons vivants créés par le compte de la session, chacun désigné par une ref de
// 16 octets aléatoires, la même pendant ses 10 min (plusieurs appareils du compte s'accordent),
// puis une nouvelle. Les refs échues sont oubliées ici.
func (s *Service) SalonsListe(c Courante) ([]SalonRef, error) {
	out := []SalonRef{}
	if s.salonsVivants == nil {
		return out, nil
	}
	vs, err := s.salonsVivants(c.H)
	if err != nil {
		return nil, err
	}
	now := s.now()
	s.refsMu.Lock()
	defer s.refsMu.Unlock()
	existantes := map[string][16]byte{}
	for r, x := range s.refs {
		switch {
		case !now.Before(x.expire):
			delete(s.refs, r)
		case x.h == c.H:
			existantes[x.id] = r
		}
	}
	for _, v := range vs {
		r, ok := existantes[v.ID]
		if !ok {
			rand.Read(r[:])
			s.refs[r] = refSalon{h: c.H, id: v.ID, expire: now.Add(dureeRef)}
		}
		out = append(out, SalonRef{Ref: r, ExpireVers: v.ExpireVers, Places: v.Places, Sieges: v.Sieges})
	}
	return out, nil
}

// DetruireParRef : le salon de la ref est détruit (même effet que « Détruire » du créateur).
// Ref inconnue, échue, d'un autre compte, ou salon déjà fini : ErrEtape (404), la même réponse.
func (s *Service) DetruireParRef(c Courante, ref [16]byte) error {
	now := s.now()
	s.refsMu.Lock()
	x, ok := s.refs[ref]
	valide := ok && now.Before(x.expire) && subtle.ConstantTimeCompare(x.h[:], c.H[:]) == 1
	if valide {
		delete(s.refs, ref) // une ref ne sert qu'une fois
	}
	s.refsMu.Unlock()
	if !valide || s.detruireSalon == nil {
		return ErrEtape
	}
	return s.detruireSalon(c.H, x.id) // salon fini entre-temps : ErrEtape (contrat du crochet)
}
