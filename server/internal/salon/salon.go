package salon

import (
	"crypto/rand"
	"crypto/sha256"
	"slices"
	"sync"
	"sync/atomic"
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
	// MemoireJournalMax : mémoire budgétée pour le journal plein d'un salon, à 64 o l'annonce
	// (evenement de 32 o, enregistrement de 26 o au plus). Hors du plafond global des trames :
	// config.checkSalons en tient compte au démarrage (SHH_SALONS_MAX contre GOMEMLIMIT).
	MemoireJournalMax = journalMax * 64
	// jamaisConnecteMax : un siège invité qui n'a jamais ouvert de WebSocket dans ce délai après
	// son entrée est libéré (relecture C-2, N1 : réponse de rejoindre perdue, remplissage).
	jamaisConnecteMax = 10 * time.Minute
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
// rang à partir duquel le membre peut lire les pièces (Task 13). Un siège reste réservé
// pendant toute la vie du salon, en ligne ou non (revue finale C-2, I3, 12 novembre : règle
// « instantané » du propriétaire) ; seuls un départ (0x03) ou une exclusion le libèrent.
// arrivee : rang de l'arrivée (0x02) de l'occupant, gardé par une reprise (0x0A) : borne de
// Retirer. repris : rang du dernier 0x0A d'une reprise par WebSocket du titulaire (0 : aucune),
// borne des 0x0E renvoyés à l'accueil (borneEffaces). reprises : heures (Config.Now) des
// reprises par WebSocket de la dernière heure, repriseMax au plus (connexion.go). derniere :
// minute Unix (arrondie à la minute inférieure) de la dernière déconnexion d'un WebSocket du
// siège, 0 si inconnue (Task 9b, spec v3 §14.1) : en mémoire seulement, gardée par une
// reprise (0x0A), oubliée avec le siège (départ, exclusion, fin du salon).
type siege struct {
	nonce          [16]byte
	jetonV         [32]byte
	emis, plancher uint64
	arrivee        uint64
	repris         uint64
	derniere       uint64
	reprises       []time.Time
	// jamaisConnecte : siège invité entré (0x02) qui n'a encore ouvert aucun WebSocket ; entre :
	// heure (Config.Now) de cette entrée. Mis à faux à la première connexion (inscrire), gardé
	// par une reprise. Encore vrai jamaisConnecteMax après l'entrée : départ 0x03 (Tick ;
	// relecture C-2, N1). Aucun KeyPackage n'a pu être publié sans WebSocket : sans effet MLS.
	jamaisConnecte bool
	entre          time.Time
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
	// signale : un membre a déjà fait « Quitter et signaler » (QuitterSignaler) : seul le
	// premier signalement du salon compte. Un booléen, sans identifiant ni adresse ; oublié
	// avec l'état du salon (fin, redémarrage).
	signale bool
	// signalements : « Quitter et signaler » réussis par catégorie (indice = code − 1), en
	// mémoire seulement (conception du compte §21.10.3, R14 : pour que le fondateur agisse sans
	// lien d'invitation) ; aucun identifiant de membre ; remis à zéro à la fin du salon.
	signalements [NbCategories]int
	journal      []evenement
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
	// glob : compteur global des trames en mémoire (Manager.tramesGlob, tableau de bord) ; nil
	// pour un salon bâti hors de Manager.etat (tombe, tests).
	glob *atomic.Int64
	// part, pot, potMax : part de trames réservée à ce salon et pot commun de tout ce qui est
	// rangé au-delà des parts (Manager.partTrames, tramesPot, potTramesMax ; F3). pot nil :
	// sans plafond global.
	part   int
	pot    *atomic.Int64
	potMax int
	// echeances : effacements à venir des règles 1 à 3, une fois lues par tous (effacement.go),
	// une au plus par entrée de l'index ; vidées par Tick, la fin et le renouvellement.
	echeances echeances
	conv      *Conversation // nil pour la tombe d'un salon détruit sans état
	// ancienne : conversation remplacée par un renouvellement et pas encore détruite (reglages.go,
	// remplacer : détruite hors du verrou du salon) ; nil sinon. La fin du salon la détruit aussi
	// (achever), si sa destruction avait échoué ou n'était pas finie.
	ancienne *Conversation
	// aEcraser : emplacements de conv marqués effacés (retrait, échéance, trame écrite pour
	// un membre parti entre-temps), à écraser sur le disque HORS du verrou (Manager.ecraser :
	// aucun appel disque ni attente de la borne sous s.mu, audit adverse du 13 novembre, F1).
	// Toujours des emplacements de la conversation courante : vidé quand elle est remplacée
	// (renouvellement) ou détruite (fin).
	aEcraser []uint32
	// occ : sièges occupés, tenu à jour sous mu (installerLocked, oublierLocked, oublier) et lu
	// sans verrou par Manager.Stats ; finiA : copie de fini lue sans verrou (estFini). Le
	// tableau de bord et les parcours sous Manager.mu n'attendent ainsi jamais le verrou d'un
	// salon (F1).
	occ   atomic.Int32
	finiA atomic.Bool
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
	// etatFin : partie disque de la fin (fin.go : finRien, finAFaire, finEnCours).
	etatFin uint8
	// Réglages (reglages.go) : depart, rang de départ du dernier renouvellement (0 : aucun ;
	// rien de rang ≤ depart n'est plus servi) ; gen, nombre de renouvellements, écrit sous mu et
	// lu aussi sans verrou par l'écrivain d'une connexion (trame d'un lot préparé avant un
	// renouvellement jamais écrite après lui) ; regle : places ou durée changées au moins une
	// fois (l'accueil porte alors un 0x10).
	depart uint64
	gen    atomic.Uint64
	regle  bool
}

// globAtteint : ce salon ne peut plus ranger de trame en mémoire (pot nil : sans plafond
// global). Part équitable (audit adverse du 13 novembre, F3) : tant que le salon a moins de
// trames rangées que sa part réservée, il n'est jamais refusé, quoi que fassent les autres ;
// au-delà, il puise dans le pot commun, et n'est refusé que quand ce pot est vide. Les parts
// de tous les salons plus le pot ne dépassent jamais le plafond global (Manager.partTrames) :
// le garde-fou de la mémoire reste entier. Appelé sous s.mu.
func (s *salon) globAtteint() bool {
	return s.pot != nil && len(s.index) >= s.part && int(s.pot.Load()) >= s.potMax
}

// globInc : une trame de plus vient d'être rangée dans l'index (sous s.mu) ; comptée dans le
// pot commun si elle dépasse la part du salon. globDec : les n trames de l'index sont retirées
// (index vidé par une fin ou un renouvellement, sous s.mu).
func (s *salon) globInc() {
	if s.glob != nil {
		s.glob.Add(1)
	}
	if s.pot != nil && len(s.index) > s.part {
		s.pot.Add(1)
	}
}

func (s *salon) globDec(n int) {
	if s.glob != nil && n > 0 {
		s.glob.Add(-int64(n))
	}
	if s.pot != nil && n > s.part {
		s.pot.Add(-int64(n - s.part))
	}
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
	x = &siege{}
	if ancien := s.sieges[n]; reprise && ancien != nil {
		if d := ancien.attenteReprise(now); d > 0 {
			return [32]byte{}, nil, &Attente{Retry: d}
		}
		x.reprises = append(slices.Clone(ancien.reprises), now)
		x.derniere = ancien.derniere // une reprise n'est pas une déconnexion
		x.jamaisConnecte, x.entre = ancien.jamaisConnecte, ancien.entre
	} else if n != 0 {
		// Nouvel occupant d'un siège invité. Le siège 0 n'est jamais libéré ainsi : il reste au
		// créateur et ne compte pas dans le plafond des invités.
		x.jamaisConnecte, x.entre = true, now
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
	if !reprise && n != 0 {
		// Nouvel occupant (0x02) d'un siège invité : seaux neufs (limites.go). Le siège 0 est
		// toujours le créateur : son retour après « Quitter » n'est qu'une reprise, il garde ses
		// seaux (revue finale C-2, mineur c).
		s.limites[n] = nouvelleLimite()
	}
	x.emis, x.plancher, x.arrivee = seq, seq, seq
	if reprise && s.sieges[n] != nil {
		x.arrivee = s.sieges[n].arrivee
		s.plusAttenduLocked(n) // nouvelle identité : trames d'avant le 0x0A illisibles pour elle
	}
	if s.sieges[n] == nil {
		s.occ.Add(1)
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
	s.occ.Add(-1)
	delete(s.jetons, x.jetonV)
	return x.jetonV, true
}
