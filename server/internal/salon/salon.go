package salon

import (
	"crypto/rand"
	"crypto/sha256"
	"slices"
	"sync"
	"time"

	"github.com/skoow/shhdrop/server/internal/share"
)

// État en mémoire d'un salon (plan C-2 Tasks 6 et 8) : sièges, jetons, rangs, journal des
// annonces et index des trames. Rien de tout cela n'est écrit sur disque (spec §39.3.5, v3
// §5.1) : seules les trames non volatiles le sont, chiffrées (Conversation), sans rang,
// siège, heure ni drapeau. Un redémarrage l'oublie (plan, point 11).

const (
	// nbSieges : sièges 0 à 9 ; le 0 est réservé au créateur (plan, point 1).
	nbSieges = 10
	// journalMax : annonces (0x02, 0x03, 0x09, 0x0A) gardées au plus par salon.
	journalMax = 4096
	// horsLigneMax : un siège hors ligne depuis ce délai est libéré (plan, point 4 ; D41-26).
	horsLigneMax = 10 * time.Minute
	// arriveesParMembre : arrivées totales < arriveesParMembre × max_members (§39.3.3).
	arriveesParMembre = 5
)

// evenement : annonce du journal, avec son rang et son enregistrement serveur → client.
type evenement struct {
	seq uint64
	enr []byte
}

// siege : place occupée. jetonV : SHA-256 du jeton de membre (le jeton lui-même n'est
// jamais gardé). emis : rang de l'annonce qui a donné le jeton (0x02 ou 0x0A) ; plancher :
// rang à partir duquel le membre peut lire les pièces (Task 13). horsLigneDepuis : zéro
// tant qu'un WebSocket du siège est ouvert (Task 9) ; posé à l'entrée et à la déconnexion.
// arrivee : rang de l'arrivée (0x02) de l'occupant, gardé par une reprise (0x0A) : borne de
// Retirer. repris : rang du dernier 0x0A d'une reprise par WebSocket du titulaire (0 : aucune),
// borne des 0x0E renvoyés à l'accueil (borneEffaces). reprises : heures (Config.Now) des
// reprises par WebSocket de la dernière heure, repriseMax au plus (connexion.go). derniere :
// minute Unix (arrondie à la minute inférieure) de la dernière déconnexion d'un WebSocket du
// siège, 0 si inconnue (Task 9b, spec v3 §14.1) : en mémoire seulement, gardée par une
// reprise (0x0A), oubliée avec le siège (départ, libération, fin du salon).
type siege struct {
	nonce           [16]byte
	jetonV          [32]byte
	emis, plancher  uint64
	arrivee         uint64
	repris          uint64
	horsLigneDepuis time.Time
	derniere        uint64
	reprises        []time.Time
}

// salon : état d'un salon vivant. Tous les champs sont protégés par mu.
type salon struct {
	mu         sync.Mutex
	id         string
	expires    time.Time
	maxMembers int
	sieges     [nbSieges]*siege
	seq        uint64 // dernier rang attribué (le premier est 1)
	arrivees   int    // arrivées d'invités depuis la création de l'état
	jetons     map[[32]byte]uint8
	revoques   map[[32]byte]struct{}
	journal    []evenement
	// index : trames non volatiles rangées, triées par seq (relais.go).
	index []entree
	// Pièces (pieces.go) : lesPieces, toutes les pièces vivantes par identifiant ; libres,
	// celles qui ne sont pas encore liées (échéances de Tick) ; pieces, pièce liée par rang de
	// trame ; aPurger, pièces marquées effacées dont fichier et ligne restent à effacer hors du
	// verrou ; flux : lectures en cours (Manager.flux), nil pour une tombe. Maps nil tant
	// qu'aucune pièce.
	lesPieces, libres map[string]*piece
	pieces            map[uint64]*piece
	aPurger           []purge
	flux              *share.Streams
	// echeances : effacements « 10 min » et « 1 h » à venir (effacement.go), vidés par Tick.
	echeances echeances
	conv      *Conversation // nil pour la tombe d'un salon détruit sans état
	// conns : connexion WebSocket de chaque siège (une au plus, connexion.go).
	conns [nbSieges]*connexion
	// limites : seaux des trames montantes de chaque siège, remis à neuf à chaque nouvel
	// occupant, gardés par une reprise (limites.go).
	limites [nbSieges]limiteSiege
	// now : horloge du gestionnaire (Config.Now), pour les échéances lues hors de Tick.
	now func() time.Time
	// fini : salon détruit ; plus rien n'y entre ni n'y est recréé (tombe gardée dans
	// Manager.salons jusqu'à l'échéance).
	fini bool
	// dernierR : numéro de la dernière rotation de l'invitation (exclusion.go) ; 0 : aucune.
	// En mémoire seulement, comme le reste de l'état.
	dernierR uint32
}

func nouveauSalon(id string, expires time.Time, maxMembers int, conv *Conversation, now func() time.Time) *salon {
	s := &salon{
		id: id, expires: expires, maxMembers: maxMembers, conv: conv, now: now,
		jetons: map[[32]byte]uint8{}, revoques: map[[32]byte]struct{}{},
	}
	for n := range s.limites {
		s.limites[n] = nouvelleLimite()
	}
	return s
}

// occupesLocked : sièges occupés.
func (s *salon) occupesLocked() int {
	n := 0
	for _, x := range s.sieges {
		if x != nil {
			n++
		}
	}
	return n
}

// annoncerLocked range une annonce au rang suivant et la diffuse aux connexions en direct.
// Invariant : len(journal) + sièges
// occupés ≤ journalMax, si bien qu'un siège occupé peut toujours être annoncé parti (0x03).
// Toute annonce autre qu'un départ garde donc nbSieges places libres (sinon ErrLimit, rien
// n'est changé) ; un départ ne peut pas échouer (il libère un siège et prend une place).
func (s *salon) annoncerLocked(enr func(seq uint64) []byte, depart bool) (uint64, error) {
	if !depart && len(s.journal) >= journalMax-nbSieges {
		return 0, ErrLimit
	}
	s.seq++
	ev := evenement{seq: s.seq, enr: enr(s.seq)}
	s.journal = append(s.journal, ev)
	s.diffuserLocked(ev.enr, genreRang, nil)
	return s.seq, nil
}

// installerLocked tire jeton et nonce, annonce le siège (0x02 arrivée, ou 0x0A reprise si
// reprise) et l'installe. Le jeton n'est rendu qu'à l'appelant ; seul son SHA-256 reste.
// Une reprise retire le siège des lecteurs attendus des trames déjà rangées (plan, point 8).
// Une reprise d'un siège occupé compte dans le plafond des reprises du siège (repriseMax par
// heure, partagé avec les reprises par WebSocket) : au-delà, *Attente, rien n'est changé.
func (s *salon) installerLocked(n uint8, reprise bool, now time.Time) (jeton [32]byte, x *siege, err error) {
	x = &siege{horsLigneDepuis: now}
	if ancien := s.sieges[n]; reprise && ancien != nil {
		if d := ancien.attenteReprise(now); d > 0 {
			return [32]byte{}, nil, &Attente{Retry: d}
		}
		x.reprises = append(slices.Clone(ancien.reprises), now)
		x.derniere = ancien.derniere // une reprise n'est pas une déconnexion
	}
	rand.Read(jeton[:]) // ne rend jamais d'erreur (Go ≥ 1.24)
	rand.Read(x.nonce[:])
	x.jetonV = sha256.Sum256(jeton[:])
	enr := func(seq uint64) []byte { return EnrArrivee(seq, n, x.nonce) }
	if reprise {
		enr = func(seq uint64) []byte { return EnrReprise(seq, n, x.nonce) }
	}
	seq, err := s.annoncerLocked(enr, false)
	if err != nil {
		return [32]byte{}, nil, err
	}
	if !reprise {
		s.limites[n] = nouvelleLimite() // nouvel occupant (0x02) : seaux neufs (limites.go)
	}
	x.emis, x.plancher, x.arrivee = seq, seq, seq
	if reprise && s.sieges[n] != nil {
		x.arrivee = s.sieges[n].arrivee
		s.plusAttenduLocked(n) // nouvelle identité : trames d'avant le 0x0A illisibles pour elle
	}
	s.sieges[n] = x
	s.jetons[x.jetonV] = n
	return jeton, x, nil
}

// attenteReprise oublie les reprises de plus d'une heure et rend le délai avant la prochaine
// reprise permise (0 : permise tout de suite).
func (x *siege) attenteReprise(now time.Time) time.Duration {
	k := 0
	for _, t := range x.reprises {
		if now.Sub(t) < time.Hour {
			x.reprises[k] = t
			k++
		}
	}
	x.reprises = x.reprises[:k]
	if len(x.reprises) < repriseMax {
		return 0
	}
	return x.reprises[0].Add(time.Hour).Sub(now)
}

// borneEffaces : rang au-delà duquel le titulaire, sous son identité actuelle, a pu recevoir
// une trame : dernier 0x0A (reprise par WebSocket), sinon rang d'émission du jeton (0x02, ou
// 0x0A d'une reprise par rejoindre).
func (x *siege) borneEffaces() uint64 {
	if x.repris != 0 {
		return x.repris
	}
	return x.emis
}

// oublierLocked retire le siège n et son jeton (sans annonce) ; rend l'empreinte oubliée.
func (s *salon) oublierLocked(n uint8) (jetonV [32]byte, ok bool) {
	x := s.sieges[n]
	if x == nil {
		return jetonV, false
	}
	s.sieges[n] = nil
	delete(s.jetons, x.jetonV)
	return x.jetonV, true
}
