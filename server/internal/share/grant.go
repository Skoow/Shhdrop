package share

import (
	"crypto/hmac"
	"crypto/sha256"
	"database/sql"
	"encoding/binary"
	"errors"
	"time"
)

// Octroi d'ouverture (spec §41.4, D41-5) : recharger la page ou ouvrir le même partage dans
// un autre onglet ne compte qu'une ouverture tant que l'octroi est valable.
//
// Octroi = b64u(n (4 octets) ‖ exp (4 octets, secondes Unix) ‖ HMAC-SHA-256(clé, étiquette ‖
// id ‖ n ‖ exp)), 40 octets, 54 caractères. L'id interne n'est pas dans l'octroi : le serveur
// le retrouve par K_accès et vérifie le MAC avec lui. La clé est tirée à chaque démarrage
// (NewService) : un redémarrage invalide tous les octrois. L'état (échéance, rechargements)
// vit en mémoire seulement (goneState.grants) ; rien en base, aucune adresse, aucun cookie.

const (
	GrantTTL   = 30 * time.Minute
	MaxReopens = 10
	grantLen   = 40
)

var (
	// ErrGrantInvalid : octroi falsifié, d'un autre partage, expiré, ou ouverture terminée
	// (409 grant_invalid) ; ni ouverture ni essai consommé.
	ErrGrantInvalid = errors.New("octroi d'ouverture invalide")
	// ErrReopenLimit : plus de MaxReopens rechargements pour cette ouverture (429 reopen_limit).
	ErrReopenLimit = errors.New("trop de rechargements")
)

var grantLabel = []byte("shhdrop-open-grant-v1")

// grantEntry : échéance en mémoire de l'octroi d'une ouverture et rechargements acceptés.
type grantEntry struct {
	exp     int64
	reopens int
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
}

// grantLocked pose (ou renouvelle) l'échéance en mémoire de l'ouverture k, plafonnée à cap,
// et signe l'octroi. Sous gone.mu.
func (s *Service) grantLocked(k openKey, cap, now int64) string {
	s.gone.init()
	e := s.gone.grants[k]
	if e == nil {
		e = &grantEntry{}
		s.gone.grants[k] = e
	}
	exp := min(now+int64(GrantTTL/time.Second), cap)
	e.exp = max(e.exp, exp)
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
// ouverture consommée, au plus MaxReopens fois.
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
	var state string
	var issued int
	var doneMask, exp int64
	err := s.DB.QueryRow(`SELECT access_v, proof_v, envelope, state, opens_issued, done_mask, expires_at FROM shares
		WHERE id=? AND state IN ('ready','draining') AND expires_at>? AND failed_attempts<?
		AND proof_v IS NOT NULL AND envelope IS NOT NULL`, id, now, maxAttempts).
		Scan(&accessV, &proofV, &envelope, &state, &issued, &doneMask, &exp)
	if err != nil {
		return Opened{}, notFound(err)
	}
	if !match(kAcces, accessV) {
		return Opened{}, ErrNotFound // ne compte pas comme essai
	}
	k := openKey{id, int(n)}
	s.gone.mu.Lock()
	live := s.liveGrantLocked(k) != nil
	s.gone.mu.Unlock()
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
	defer s.gone.mu.Unlock()
	e := s.liveGrantLocked(k) // revérifié : un done ou un balayage a pu passer
	if e == nil || s.gone.dead[id] != nil {
		return Opened{}, ErrGrantInvalid
	}
	if e.reopens >= MaxReopens {
		return Opened{}, ErrReopenLimit
	}
	e.reopens++
	if state == "draining" {
		// Le nouveau jeton vit 6 h : la purge le suit (comme à la dernière ouverture émise).
		s.mem.mu.Lock()
		p := s.mem.purge[id]
		s.mem.mu.Unlock()
		s.setPurge(id, max(p, min(ceil15(now+purgeWindow), exp)))
	}
	s.budget.extend(k, now+purgeWindow)
	return Opened{N: int(n), Envelope: envelope, Grant: s.grantLocked(k, exp, now)}, nil
}

// Regrant renouvelle l'octroi de l'ouverture openN (jeton de téléchargement valable jusqu'à
// tokenExp) pour GrantTTL, jamais au-delà du jeton ni de l'échéance du partage. Ouverture
// terminée, balayée ou partage disparu : ErrGone.
func (s *Service) Regrant(id string, openN int, tokenExp time.Time) (string, error) {
	if !validID(id) || openN < 1 || openN > maxOpenN {
		return "", ErrNotFound
	}
	now := s.now()
	var exp int64
	err := s.DB.QueryRow(`SELECT expires_at FROM shares WHERE id=? AND state IN ('ready','draining')
		AND expires_at>? AND failed_attempts<?`, id, now, maxAttempts).Scan(&exp)
	if errors.Is(err, sql.ErrNoRows) {
		return "", ErrGone
	}
	if err != nil {
		return "", err
	}
	s.gone.mu.Lock()
	defer s.gone.mu.Unlock()
	k := openKey{id, openN}
	if s.liveGrantLocked(k) == nil || s.gone.dead[id] != nil {
		return "", ErrGone
	}
	cap := min(exp, tokenExp.Unix())
	if cap <= now {
		return "", ErrGone
	}
	return s.grantLocked(k, cap, now), nil
}

// sweepGrants termine les ouvertures dont l'octroi a expiré sans renouvellement et qui ne
// lisent plus rien (aucun segment en cours ni dans les 120 s) : spec §41.4, « fin
// d'ouverture ». Un « draining » dont toutes les ouvertures sont terminées est alors effacé.
func (s *Service) sweepGrants(now int64) error {
	s.gone.mu.Lock()
	s.gone.init()
	var due []openKey
	for k, e := range s.gone.grants {
		if e.exp <= now && !s.gone.active[k].activeAt(now) {
			due = append(due, k)
		}
	}
	s.gone.mu.Unlock()
	var errs []error
	for _, k := range due {
		if err := s.Done(k.id, k.openN); err != nil && !errors.Is(err, ErrGone) && !errors.Is(err, ErrNotFound) {
			errs = append(errs, err)
		}
	}
	return errors.Join(errs...)
}

// GrantCount : octrois en mémoire (tests).
func (s *Service) GrantCount() int {
	s.gone.mu.Lock()
	defer s.gone.mu.Unlock()
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
	s.gone.mu.Unlock()
	if !live {
		return Meta{}, ErrNotFound
	}
	m.ExpiresIn = secs(exp - now)
	m.Segments = SegmentCount(m.Bucket)
	m.OpensLeft = 0
	return m, nil
}
