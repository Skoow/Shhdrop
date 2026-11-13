package salon

import (
	"encoding/binary"
	"errors"
	"math"
	"time"

	"github.com/skoow/shhdrop/server/internal/share"
)

// Réglages d'un salon ouvert (spec 2026-11-13-salon-places-duree-design.md, révision du
// 13 novembre, qui fait foi) : nombre de places et renouvellement, par le créateur
// (S_gestion), sans recréer de lien.
//
//   - Places : N entre le besoin minimal (sièges occupés, plus le siège 0 du créateur s'il
//     est vide, puisqu'il lui est toujours rendu) et SalonPlacesMax (et au moins 2, comme à
//     la création) ; le plafond des arrivées suit (arriveesParMembre × N), les arrivées déjà
//     comptées restent.
//   - Renouvellement (« prolonger = renouveler ») : nouvelle durée de 1, 6, 12 ou 24 h comptée
//     depuis maintenant (au quart d'heure supérieur), et toute la conversation effacée :
//     trames, pièces, échéances, lectures attendues, 0x0E en attente. Restent le lien, le mot
//     de passe, les membres à leur place (jetons, sièges, journal des annonces, seaux) et le
//     compteur seq, qui continue de croître (aucun rang réutilisé). Anti-abus : compté comme
//     une création de salon (quota et preuve anti-robot, couche HTTP, fonction avant) ; aucun
//     plafond de durée gardé en mémoire.
//
// Prévenir les membres : enregistrement serveur sans rang 0x10 « réglages » (EnrReglages :
// départ ‖ secondes restantes ‖ places), diffusé à chaque changement, en direct et en
// rattrapage (au retour au direct), et mis dans l'accueil de toute connexion d'un salon dont
// les réglages ont changé au moins une fois. Jamais une cause de fermeture. Règle du client :
// à chaque 0x10, effacer tout ce qu'il garde de rang ≤ départ (idempotent : un 0x10 de places
// seules porte le même départ que le précédent, 0 sans renouvellement), afficher l'échéance et
// les places, et reprendre avec depuis ≥ départ.

// SalonPlacesMax : places au plus d'un salon sans compte (sièges 0 à 9) ; plus tard, par offre.
const SalonPlacesMax = nbSieges

// ErrOccupied : places demandées sous le nombre de sièges occupés (409 occupied).
var ErrOccupied = errors.New("salon: places occupées")

// errRenouvellement : la conversation n'a pas pu être recréée ; le salon est fini.
var errRenouvellement = errors.New("salon: renouvellement impossible")

// rouvrirConversation : recréation de la conversation (variable pour les tests : panne).
var rouvrirConversation = OuvrirConversation

// ReglagesReq : POST /api/salons/reglages. Places : 0 = inchangé ; Heures : 0 = pas de
// renouvellement.
type ReglagesReq struct{ Places, Heures int }

// Valide : au moins un réglage, chacun dans ses bornes.
func (r ReglagesReq) Valide() bool {
	if r.Places == 0 && r.Heures == 0 {
		return false
	}
	if r.Places != 0 && (r.Places < 2 || r.Places > SalonPlacesMax) {
		return false
	}
	switch r.Heures {
	case 0, 1, 6, 12, 24:
		return true
	}
	return false
}

// Reglages : réponse (max_members, expires_in_s, depuis = rang de départ du dernier
// renouvellement, 0 s'il n'y en a jamais eu).
type Reglages struct {
	MaxMembers int
	ExpiresIn  time.Duration
	Depuis     uint64
}

// Regler applique r au salon de S_gestion. S_gestion absent, faux ou d'un salon qui n'est plus
// vivant : ErrNotFound (comme Gestion) ; r invalide : ErrBadRequest ; places sous le besoin
// minimal (besoinPlaces) : ErrOccupied. avant (facultatif) est appelée sous essaiLock une fois S_gestion et
// les places vérifiés, juste avant d'appliquer (couche HTTP : preuve anti-robot et quota d'un
// renouvellement, qui ne sont donc jamais consommés pour une demande refusée ici) ; son erreur
// est rendue telle quelle, rien n'est changé.
//
// Ordre (sous essaiLock : aucune entrée ni exclusion en même temps ; les sièges occupés ne
// peuvent que diminuer) : ligne relue ; état mémoire (créé s'il manque, comme Exclure) ;
// vérifications ; avant ; une requête SQL atomique hors du verrou du salon (expires_at,
// max_members, ligne vivante seulement) ; échéance du bloc (Manager.vivants) ; puis, sous le
// verrou du salon, l'état mémoire (renouvelerLocked) et le 0x10 ; enfin les pièces effacées
// hors du verrou (fichier, puis ligne et budget : pieces_bytes revient à 0 pièce par pièce,
// jamais par une remise à 0 forcée qui retirerait le budget d'une pièce créée juste après).
// Si la conversation ne peut pas être recréée, rien d'avant n'est déjà plus servi et le salon
// est fini (raison 2) : Tick reprend sa partie disque comme pour toute fin de vie.
func (m *Manager) Regler(sGestion []byte, r ReglagesReq, avant func() error) (Reglages, error) {
	v := share.Verifier(sGestion)
	if v == nil {
		return Reglages{}, ErrNotFound
	}
	if !r.Valide() {
		return Reglages{}, ErrBadRequest
	}
	now := m.cfg.Now()
	var id string
	if err := m.cfg.DB.QueryRow(`SELECT id FROM salons WHERE manage_v=? AND expires_at>? AND failed_attempts<?`,
		v, now.Unix(), maxEssais).Scan(&id); err != nil {
		return Reglages{}, notFound(err)
	}
	mu := m.essaiLock(id)
	mu.Lock()
	defer mu.Unlock()
	var exp int64
	var places int
	if err := m.cfg.DB.QueryRow(`SELECT expires_at, max_members FROM salons WHERE id=? AND manage_v=? AND expires_at>?
		AND failed_attempts<?`, id, v, now.Unix(), maxEssais).Scan(&exp, &places); err != nil {
		return Reglages{}, notFound(err)
	}
	s, err := m.etat(id, exp, places)
	if err != nil {
		return Reglages{}, err
	}
	if r.Places != 0 {
		if r.Places < s.besoinPlaces() {
			return Reglages{}, ErrOccupied
		}
		places = r.Places
	}
	if avant != nil {
		if err := avant(); err != nil {
			return Reglages{}, err
		}
	}
	if r.Heures != 0 {
		exp = share.Ceil15(now.Unix() + int64(r.Heures)*3600)
	}
	res, err := m.cfg.DB.Exec(`UPDATE salons SET expires_at=?, max_members=? WHERE id=? AND expires_at>? AND failed_attempts<?`,
		exp, places, id, now.Unix(), maxEssais)
	if err != nil {
		return Reglages{}, base(err)
	}
	if k, _ := res.RowsAffected(); k != 1 {
		return Reglages{}, ErrNotFound
	}
	if r.Heures != 0 {
		m.mu.Lock()
		if x, ok := m.vivants[id]; ok {
			x.exp = exp // place du bloc rendue à la nouvelle échéance, pas à l'ancienne
			m.vivants[id] = x
		}
		m.mu.Unlock()
	}
	defer m.purger(s) // pièces d'avant : fichier, puis ligne et budget, hors du verrou du salon
	depart, err := m.appliquerReglages(s, places, exp, r.Heures != 0)
	if errors.Is(err, errRenouvellement) {
		_ = m.finir(s, RaisonDetruit) // partie disque ratée : reprise par Tick
		return Reglages{}, ErrES
	}
	if err != nil {
		return Reglages{}, err
	}
	return Reglages{MaxMembers: places, ExpiresIn: secs(exp - now.Unix()), Depuis: depart}, nil
}

// appliquerReglages : état mémoire sous le verrou du salon, puis 0x10 à tous. Salon fini ou
// échu en mémoire entre-temps : ErrNotFound (sa ligne est effacée par sa fin).
func (m *Manager) appliquerReglages(s *salon, places int, exp int64, renouveler bool) (uint64, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := m.cfg.Now()
	if s.fini || !now.Before(s.expires) {
		return 0, ErrNotFound
	}
	s.maxMembers = places
	if renouveler {
		if err := m.renouvelerLocked(s); err != nil {
			return 0, err
		}
		s.expires = time.Unix(exp, 0)
	}
	s.regle = true
	s.diffuserLocked(s.enrReglagesLocked(now), genreReglages, nil)
	return s.depart, nil
}

// renouvelerLocked : tout ce qui est d'avant cesse d'être servi d'abord (pièces marquées
// effacées et leurs flux coupés, index, échéances, lectures attendues, 0x0E en attente,
// trames en file des connexions ; rang de départ posé, gen incrémenté), puis la conversation
// est détruite (clé mise à zéro, fichier supprimé) et recréée vide sous une clé neuve. Échec
// de la destruction ou de la recréation : errRenouvellement (l'appelant finit le salon ; la
// conversation détruite rend ErrDetruite à toute écriture d'ici là). Appelé sous s.mu.
func (m *Manager) renouvelerLocked(s *salon) error {
	for _, p := range s.lesPieces {
		s.supprimerPieceLocked(p)
	}
	s.index, s.echeances, s.pieces = nil, nil, nil
	s.depart = s.seq
	s.gen.Add(1)
	for _, c := range s.conns {
		if c != nil {
			c.oublierAvantLocked()
		}
	}
	if err := s.conv.Detruire(); err != nil {
		return errRenouvellement
	}
	conv, err := rouvrirConversation(m.cfg.DossierConversations, s.id)
	if err != nil {
		return errRenouvellement
	}
	conv.compterDans(&m.octetsConv)
	s.conv = conv
	return nil
}

// besoinPlaces : places au moins nécessaires, sièges occupés plus le siège 0 s'il est libre
// (choisirLocked le rend toujours au créateur, qui doit pouvoir revenir).
func (s *salon) besoinPlaces() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	n := s.occupesLocked()
	if s.sieges[0] == nil {
		n++
	}
	return n
}

// enrReglagesLocked : 0x10 des réglages courants, au dernier rang attribué. Appelé sous s.mu.
func (s *salon) enrReglagesLocked(now time.Time) []byte {
	reste := min(max(s.expires.Unix()-now.Unix(), 0), math.MaxUint32)
	return EnrReglages(s.seq, s.depart, uint32(reste), uint8(s.maxMembers))
}

// EnrReglages : 0x10 « réglages », sans rang : départ (8, rang de départ du dernier
// renouvellement, 0 sans renouvellement) ‖ secondes restantes (4) ‖ places (1) ; 22 octets.
func EnrReglages(seq, depart uint64, secondes uint32, places uint8) []byte {
	b := binary.BigEndian.AppendUint64(enr(0x10, seq, 8+4+1), depart)
	return append(binary.BigEndian.AppendUint32(b, secondes), places)
}
