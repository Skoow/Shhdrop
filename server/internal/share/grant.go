package share

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/binary"
	"errors"
	"time"
)

// Octroi d'ouverture (spec §41.4, D41-5 ; D42-22) : recharger la page, ouvrir le même partage
// dans un autre onglet ou y revenir plus tard depuis le même navigateur ne compte qu'une
// ouverture. L'octroi vaut jusqu'à l'échéance du partage (D42-22, au lieu de 30 min) ; une
// ouverture ne se termine plus quand il expire : seulement par done, destruction ou échéance.
//
// Octroi = b64u(n (4 octets) ‖ exp (4 octets, secondes Unix) ‖ HMAC-SHA-256(clé, étiquette ‖
// id ‖ n ‖ exp)), 40 octets, 54 caractères. L'id interne n'est pas dans l'octroi : le serveur
// le retrouve par K_accès et vérifie le MAC avec lui. La clé est tirée à chaque démarrage
// (NewService) : un redémarrage invalide tous les octrois. L'état (échéance, rechargements)
// vit en mémoire seulement (goneState.grants) ; rien en base, aucune adresse, aucun cookie.

const (
	// MaxReopens : retours (rechargements, autres onglets, retours plus tard) acceptés par
	// ouverture sur toute la vie du lien (D42-22) ; chacun ajoute une lecture complète au
	// budget de l'ouverture (§24, §41.4).
	MaxReopens = 20
	grantLen   = 40
)

var (
	// ErrGrantInvalid : octroi falsifié, d'un autre partage, expiré, ou ouverture terminée
	// (409 grant_invalid) ; ni ouverture ni essai consommé.
	ErrGrantInvalid = errors.New("octroi d'ouverture invalide")
	// ErrReopenLimit : plus de MaxReopens retours pour cette ouverture (429 reopen_limit).
	ErrReopenLimit = errors.New("trop de rechargements")
)

var grantLabel = []byte("shhdrop-open-grant-v1")

// grantEntry : ouverture qui peut revenir (en mémoire jusqu'à sa fin ou celle du partage) et
// retours acceptés.
type grantEntry struct {
	reopens int
	// exp : échéance du partage ; l'entrée est oubliée au plus tard à exp + grâce (sweepGone),
	// même si le partage a été effacé hors de ce processus.
	exp int64
}

func grantMAC(secret [32]byte, id [16]byte, head []byte) []byte {
	h := hmac.New(sha256.New, secret[:])
	h.Write(grantLabel)
	h.Write(id[:])
	h.Write(head)
	return h.Sum(nil)
}

// IssueGrant signe l'octroi de l'ouverture n du partage id, valable jusqu'à exp.
func IssueGrant(secret [32]byte, id [16]byte, n uint32, exp time.Time) string {
	b := make([]byte, 8, grantLen)
	binary.BigEndian.PutUint32(b, n)
	binary.BigEndian.PutUint32(b[4:], uint32(exp.Unix()))
	return b64.EncodeToString(append(b, grantMAC(secret, id, b)...))
}

// VerifyGrant vérifie le MAC (temps constant) et l'échéance ; rend le n° d'ouverture.
func VerifyGrant(secret [32]byte, id [16]byte, g string, now time.Time) (n uint32, ok bool) {
	raw, err := DecodeB64(g, grantLen)
	if err != nil {
		return 0, false
	}
	if !hmac.Equal(raw[8:], grantMAC(secret, id, raw[:8])) {
		return 0, false
	}
	n = binary.BigEndian.Uint32(raw)
	exp := int64(binary.BigEndian.Uint32(raw[4:]))
	if n < 1 || n > maxOpenN || exp <= now.Unix() {
		return 0, false
	}
	return n, true
}

func idBytes(id string) ([16]byte, bool) {
	var a [16]byte
	b, err := DecodeB64(id, 16)
	if err != nil {
		return a, false
	}
	copy(a[:], b)
	return a, true
}

// Opened : résultat d'un déverrouillage (numéro d'ouverture, enveloppe E, octroi).
type Opened struct {
	N        int
	Envelope []byte
	Grant    string
	// OpensLeft : ouvertures encore possibles après celle-ci (0 : c'était la dernière permise,
	// le partage est « draining »).
	OpensLeft int
	// LastOpen : cette ouverture est la dernière permise (n = opens_issued et plus aucune
	// ouverture) ; seul ce lecteur montre « Détruire » (retours UI4, revue D42-22).
	LastOpen bool
}

// grantLocked inscrit l'ouverture k en mémoire et signe son octroi, valable jusqu'à exp
// (échéance du partage, D42-22). Le budget de lecture de k vit aussi jusque-là : un retour
// après plus de 6 h ne le remet pas à zéro. Sous gone.mu.
func (s *Service) grantLocked(k openKey, exp int64) string {
	s.gone.init()
	e := s.gone.grants[k]
	if e == nil {
		e = &grantEntry{}
		s.gone.grants[k] = e
	}
	e.exp = max(e.exp, exp)
	// Le budget vit jusqu'à la fin de grâce de l'échéance : il ne repart pas à zéro pendant
	// qu'une lecture active finit (spec §41.8).
	s.budget.keep(k, max(exp+graceWindow, s.now()+purgeWindow))
	id, _ := idBytes(k.id)
	return IssueGrant(s.grantKey, id, uint32(k.openN), time.Unix(exp, 0))
}

// liveGrantLocked : l'ouverture k a un octroi en mémoire (ni terminée, ni balayée).
func (s *Service) liveGrantLocked(k openKey) *grantEntry {
	s.gone.init()
	return s.gone.grants[k]
}

// reopen : unlock avec un octroi (UnlockGrant). Octroi invalide ou ouverture terminée :
// ErrGrantInvalid, sans essai ; mot de passe faux : un essai ; juste : même ouverture, aucune
// ouverture consommée, au plus MaxReopens fois sur la vie du lien.
func (s *Service) reopen(id string, kAcces, kPreuve []byte, grant string) (Opened, error) {
	idb, ok := idBytes(id)
	if !ok {
		return Opened{}, ErrNotFound
	}
	now := s.now()
	n, ok := VerifyGrant(s.grantKey, idb, grant, s.Now())
	if !ok {
		return Opened{}, ErrGrantInvalid
	}
	var accessV, proofV, envelope []byte
	var issued, left int
	var doneMask, exp int64
	err := s.DB.QueryRow(`SELECT access_v, proof_v, envelope, opens_issued, opens_left, done_mask, expires_at FROM shares
		WHERE id=? AND state IN ('ready','draining') AND expires_at>? AND failed_attempts<?
		AND proof_v IS NOT NULL AND envelope IS NOT NULL`, id, now, maxAttempts).
		Scan(&accessV, &proofV, &envelope, &issued, &left, &doneMask, &exp)
	if err != nil {
		return Opened{}, notFound(err)
	}
	if !match(kAcces, accessV) {
		return Opened{}, ErrNotFound // ne compte pas comme essai
	}
	k := openKey{id, int(n)}
	s.gone.mu.Lock()
	live := s.liveGrantLocked(k) != nil
	s.gone.unlock()
	if !live || int(n) > issued || doneMask&(int64(1)<<(n-1)) != 0 {
		return Opened{}, ErrGrantInvalid
	}
	if !match(kPreuve, proofV) {
		left, err := s.countFailure(id)
		if err != nil {
			return Opened{}, err
		}
		return Opened{}, &BadPassword{AttemptsLeft: left}
	}
	s.gone.mu.Lock()
	defer s.gone.unlock()
	e := s.liveGrantLocked(k) // revérifié : un done ou un balayage a pu passer
	if e == nil || s.gone.dead[id] != nil || s.gone.retiringLocked(id) {
		return Opened{}, ErrGrantInvalid
	}
	if e.reopens >= MaxReopens {
		return Opened{}, ErrReopenLimit
	}
	e.reopens++
	return Opened{N: int(n), Envelope: envelope, Grant: s.grantLocked(k, exp), OpensLeft: left, LastOpen: left == 0 && int(n) == issued}, nil
}

// BudgetCount : compteurs de budget de lecture en mémoire (tests).
func (s *Service) BudgetCount() int { return s.budget.count() }

// forgetOpensLocked oublie les octrois et les compteurs de budget des ouvertures du partage
// id, sauf celles de keep (ouvertures actives qui gardent le droit de finir). Sous gone.mu.
func (s *Service) forgetOpensLocked(id string, keep map[int]bool) {
	for n := 1; n <= maxOpenN; n++ {
		if keep[n] {
			continue
		}
		delete(s.gone.grants, openKey{id, n})
		s.budget.forget(openKey{id, n})
	}
}

// sweepGrantsLocked oublie les octrois dont le partage a passé son échéance et sa grâce (filet
// pour un partage effacé hors de ce processus). Sous gone.mu.
func (s *Service) sweepGrantsLocked(now int64) {
	for k, e := range s.gone.grants {
		if e.exp+graceWindow <= now && s.gone.dead[k.id] == nil {
			delete(s.gone.grants, k)
		}
	}
}

// GrantCount : octrois en mémoire (tests).
func (s *Service) GrantCount() int {
	s.gone.mu.Lock()
	defer s.gone.unlock()
	return len(s.gone.grants)
}

// grantReopens : rechargements acceptés de l'ouverture k (0 sans octroi). Sous gone.mu.
func (s *Service) grantReopensLocked(k openKey) int64 {
	if e := s.gone.grants[k]; e != nil {
		return int64(e.reopens)
	}
	return 0
}

// MetaGrant : Meta, et pour qui porte un octroi valable de l'ouverture en cours, aussi un
// partage « draining » (plus d'ouverture disponible, mais l'ouverture n rouvre). Sans octroi
// valable, un « draining » reste introuvable, comme pour Meta.
func (s *Service) MetaGrant(kAcces []byte, grant string) (Meta, error) {
	m, err := s.Meta(kAcces)
	if grant == "" || !errors.Is(err, ErrNotFound) {
		return m, err
	}
	v := Verifier(kAcces)
	if v == nil {
		return Meta{}, ErrNotFound
	}
	now := s.now()
	var exp int64
	err = s.DB.QueryRow(`SELECT id, expires_at, salt, kdf_ops, kdf_mem, bucket FROM shares
		WHERE access_v=? AND state='draining' AND expires_at>? AND failed_attempts<?`, v, now, maxAttempts).
		Scan(&m.ID, &exp, &m.Salt, &m.KdfOps, &m.KdfMem, &m.Bucket)
	if err != nil {
		return Meta{}, notFound(err)
	}
	idb, _ := idBytes(m.ID)
	n, ok := VerifyGrant(s.grantKey, idb, grant, s.Now())
	if !ok {
		return Meta{}, ErrNotFound
	}
	s.gone.mu.Lock()
	live := s.liveGrantLocked(openKey{m.ID, int(n)}) != nil
	s.gone.unlock()
	if !live {
		return Meta{}, ErrNotFound
	}
	m.ExpiresIn = secs(exp - now)
	m.Segments = SegmentCount(m.Bucket)
	m.OpensLeft = 0
	return m, nil
}
