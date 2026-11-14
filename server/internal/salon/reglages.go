package salon

import (
	"encoding/binary"
	"errors"
	"math"
	"os"
	"path/filepath"
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

// rouvrirConversation : conversation neuve d'un renouvellement, ouverte sous le nom provisoire
// du salon (variable pour les tests : panne).
var rouvrirConversation = func(dossier, id string) (*Conversation, error) {
	return ouvrirConversation(dossier, id, cheminProvisoire(dossier, id))
}

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
// minimal (besoinPlaces) : ErrOccupied ; au-delà du palier du compte créateur :
// *PalierDepasse (palierReglages). avant (facultatif) est appelée sous essaiLock une fois S_gestion et
// les places vérifiés, juste avant d'appliquer (couche HTTP : preuve anti-robot et quota d'un
// renouvellement, qui ne sont donc jamais consommés pour une demande refusée ici) ; son erreur
// est rendue telle quelle, rien n'est changé.
//
// Ordre (sous essaiLock : aucune entrée ni exclusion en même temps ; les sièges occupés ne
// peuvent que diminuer) : ligne relue ; état mémoire (créé s'il manque, comme Exclure) ;
// vérifications ; avant ; une requête SQL atomique hors du verrou du salon (expires_at,
// max_members, ligne vivante seulement) ; échéance du bloc (Manager.vivants) ; nouvelle
// conversation ouverte hors de tout verrou de salon ; puis, sous le verrou du salon, l'état
// mémoire seul (renouvelerLocked) et le 0x10 ; ancienne conversation détruite hors du verrou
// (remplacer) ; enfin les pièces effacées
// hors du verrou (fichier, puis ligne et budget : pieces_bytes revient à 0 pièce par pièce,
// jamais par une remise à 0 forcée qui retirerait le budget d'une pièce créée juste après).
// Si la conversation ne peut pas être recréée (ou l'ancienne détruite), le salon
// est fini (raison 7, « interrompu par le serveur ») : Tick reprend sa partie disque comme
// pour toute fin de vie.
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
	var compte []byte
	if err := m.cfg.DB.QueryRow(`SELECT expires_at, max_members, compte FROM salons WHERE id=? AND manage_v=? AND expires_at>?
		AND failed_attempts<?`, id, v, now.Unix(), maxEssais).Scan(&exp, &places, &compte); err != nil {
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
	if err := m.palierReglages(compteDe(compte), places, r.Heures); err != nil {
		return Reglages{}, err
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
	// Ancienne échéance (l'heure de création à 15 min près) et anciennes places récrites :
	// vidage du WAL demandé (regroupé, hors de cette requête ; stockage, F1).
	m.vidage.Demander()
	if r.Heures != 0 {
		m.mu.Lock()
		if x, ok := m.vivants[id]; ok {
			x.exp = exp // place du bloc rendue à la nouvelle échéance, pas à l'ancienne
			m.vivants[id] = x
		}
		m.mu.Unlock()
	}
	defer m.purger(s) // pièces d'avant : fichier, puis ligne et budget, hors du verrou du salon
	// Renouvellement : la nouvelle conversation est ouverte AVANT de prendre le verrou du salon
	// (appel disque, sous un nom provisoire : l'ancienne tient encore le nom du salon), et
	// l'ancienne est détruite APRÈS l'avoir rendu (audit adverse du 13 novembre, 3e campagne,
	// front serveur, A : la destruction attendait le verrou de la conversation, donc le disque,
	// sous le verrou du salon, et figeait l'entretien en mémoire de tous les salons).
	var neuve *Conversation
	if r.Heures != 0 {
		_ = os.Remove(cheminProvisoire(m.cfg.DossierConversations, id)) // reste d'un essai raté ; sous essaiLock
		if neuve, err = rouvrirConversation(m.cfg.DossierConversations, id); err != nil {
			_ = m.finir(s, RaisonInterrompu) // partie disque ratée : reprise par l'entretien
			return Reglages{}, ErrES
		}
		neuve.lec = m.lec // lectures bornées comme à l'ouverture
		neuve.compterDans(&m.octetsConv)
	}
	depart, ancienne, err := m.appliquerReglages(s, places, exp, neuve)
	if err != nil {
		if neuve != nil {
			_ = neuve.Detruire() // jamais installée ; un reste est retiré au prochain renouvellement
		}
		return Reglages{}, err
	}
	if neuve != nil && m.remplacer(s, ancienne, neuve) != nil {
		_ = m.finir(s, RaisonInterrompu) // partie disque ratée : reprise par l'entretien
		return Reglages{}, ErrES
	}
	return Reglages{MaxMembers: places, ExpiresIn: secs(exp - now.Unix()), Depuis: depart}, nil
}

// palierReglages : un salon créé par un compte garde les limites de son palier (conception du
// compte §8.6, §11 ; lu par la ligne, sans session) : places après le réglage (demandées, ou
// celles du salon pour un renouvellement seul : un compte revenu au palier neuf ne renouvelle
// pas un salon de 10 places) et durée d'un renouvellement. Salon sans compte, ou sans crochet
// (SHH_COMPTES=0) : rien.
func (m *Manager) palierReglages(compte *[16]byte, places, heures int) error {
	if compte == nil || m.cfg.Palier == nil {
		return nil
	}
	p, err := m.cfg.Palier(*compte)
	if err != nil {
		return err
	}
	if places > p.Places || heures > p.Heures {
		return &PalierDepasse{p}
	}
	return nil
}

// remplacer : partie disque d'un renouvellement, hors de tout verrou de salon (sous essaiLock) :
// l'ancienne conversation est détruite (clé oubliée, fichier supprimé ; attend la fin d'une
// écriture en cours dans ce fichier), puis la nouvelle prend le nom du salon. Un échec laisse
// l'ancienne dans salon.ancienne : la fin du salon, décidée par l'appelant, la reprend
// (achever).
func (m *Manager) remplacer(s *salon, ancienne, neuve *Conversation) error {
	if ancienne != nil {
		if err := ancienne.Detruire(); err != nil {
			return err
		}
		s.mu.Lock()
		if s.ancienne == ancienne {
			s.ancienne = nil
		}
		s.mu.Unlock()
	}
	return neuve.renommer(filepath.Join(m.cfg.DossierConversations, s.id))
}

// appliquerReglages : état mémoire sous le verrou du salon, puis 0x10 à tous ; aucun appel
// disque. neuve (non nil : renouvellement) devient la conversation du salon ; l'ancienne est
// rendue, à détruire hors du verrou (remplacer). Salon fini ou échu en mémoire entre-temps :
// ErrNotFound (sa ligne est effacée par sa fin), rien n'est changé.
func (m *Manager) appliquerReglages(s *salon, places int, exp int64, neuve *Conversation) (uint64, *Conversation, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := m.cfg.Now()
	if s.fini || !now.Before(s.expires) {
		return 0, nil, ErrNotFound
	}
	s.maxMembers = places
	var ancienne *Conversation
	if neuve != nil {
		ancienne = m.renouvelerLocked(s, neuve)
		s.expires = time.Unix(exp, 0)
	}
	s.regle = true
	s.diffuserLocked(s.enrReglagesLocked(now), genreReglages, nil)
	return s.depart, ancienne, nil
}

// renouvelerLocked : partie mémoire d'un renouvellement, sans aucun appel disque ni attente
// d'un autre verrou que ceux des connexions : tout ce qui est d'avant cesse d'être servi
// (pièces marquées effacées et leurs flux coupés, index, échéances, lectures attendues, 0x0E en
// attente, trames en file des connexions ; rang de départ posé, gen incrémenté), et neuve
// (vide, sous une clé neuve, déjà ouverte) remplace la conversation. Rend l'ancienne, gardée
// aussi dans salon.ancienne tant qu'elle n'est pas détruite : une écriture en cours dans
// l'ancienne voit salon.conv changée et récrit sa trame dans la nouvelle (ranger). Appelé sous
// s.mu.
func (m *Manager) renouvelerLocked(s *salon, neuve *Conversation) *Conversation {
	for _, p := range s.lesPieces {
		s.supprimerPieceLocked(p)
	}
	s.globDec(len(s.index)) // trames en mémoire rendues au compte global avant de vider l'index
	s.index, s.echeances, s.pieces = nil, nil, nil
	s.aEcraser = nil // emplacements de l'ancienne conversation, détruite par remplacer
	s.depart = s.seq
	s.gen.Add(1)
	for _, c := range s.conns {
		if c != nil {
			c.oublierAvantLocked()
		}
	}
	ancienne := s.conv
	s.conv, s.ancienne = neuve, ancienne
	return ancienne
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
