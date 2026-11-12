package salon

import (
	"crypto/rand"
	"crypto/sha256"
	"sync"
	"time"
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
// tant qu'un WebSocket du siège est ouvert (Task 9) ; posé à l'entrée.
type siege struct {
	nonce           [16]byte
	jetonV          [32]byte
	emis, plancher  uint64
	horsLigneDepuis time.Time
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
	conv  *Conversation // nil pour la tombe d'un salon détruit sans état
	// fini : salon détruit ; plus rien n'y entre ni n'y est recréé (tombe gardée dans
	// Manager.salons jusqu'à l'échéance).
	fini bool
}

func nouveauSalon(id string, expires time.Time, maxMembers int, conv *Conversation) *salon {
	return &salon{
		id: id, expires: expires, maxMembers: maxMembers, conv: conv,
		jetons: map[[32]byte]uint8{}, revoques: map[[32]byte]struct{}{},
	}
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

// annoncerLocked range une annonce au rang suivant. Invariant : len(journal) + sièges
// occupés ≤ journalMax, si bien qu'un siège occupé peut toujours être annoncé parti (0x03).
// Toute annonce autre qu'un départ garde donc nbSieges places libres (sinon ErrLimit, rien
// n'est changé) ; un départ ne peut pas échouer (il libère un siège et prend une place).
func (s *salon) annoncerLocked(enr func(seq uint64) []byte, depart bool) (uint64, error) {
	if !depart && len(s.journal) >= journalMax-nbSieges {
		return 0, ErrLimit
	}
	s.seq++
	s.journal = append(s.journal, evenement{seq: s.seq, enr: enr(s.seq)})
	return s.seq, nil
}

// installerLocked tire jeton et nonce, annonce le siège (0x02 arrivée, ou 0x0A reprise si
// reprise) et l'installe. Le jeton n'est rendu qu'à l'appelant ; seul son SHA-256 reste.
func (s *salon) installerLocked(n uint8, reprise bool, now time.Time) (jeton [32]byte, x *siege, err error) {
	x = &siege{horsLigneDepuis: now}
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
	x.emis, x.plancher = seq, seq
	s.sieges[n] = x
	s.jetons[x.jetonV] = n
	return jeton, x, nil
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
