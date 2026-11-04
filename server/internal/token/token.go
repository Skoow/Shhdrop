// Package token émet et vérifie les jetons signés (spec §7.7).
//
// Jeton = b64u(type ‖ len(id) ‖ id ‖ n° d'ouverture ‖ expiration) "." b64u(HMAC-SHA-256).
// Les jetons ne sont jamais stockés ; la clé vit en mémoire et change à chaque démarrage.
package token

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"errors"
	"math"
	"strings"
	"time"
)

// Types de jetons.
const (
	Upload       byte = 'u'
	Download     byte = 'd'
	CaptchaShown byte = 'c'
)

// ErrInvalid : jeton malformé, falsifié, expiré ou destiné à autre chose.
var ErrInvalid = errors.New("jeton invalide")

const maxTokenLen = 1024

var b64 = base64.RawURLEncoding.Strict()

type Signer struct {
	key []byte
	now func() time.Time
}

// New prend une clé aléatoire d'au moins 32 octets.
func New(key []byte, now func() time.Time) *Signer {
	if len(key) < 32 {
		panic("token: clé trop courte")
	}
	return &Signer{key: append([]byte(nil), key...), now: now}
}

func (s *Signer) mac(b []byte) []byte {
	h := hmac.New(sha256.New, s.key)
	h.Write(b)
	return h.Sum(nil)
}

func (s *Signer) encode(raw []byte) string {
	return b64.EncodeToString(raw) + "." + b64.EncodeToString(s.mac(raw))
}

// Issue signe un jeton. len(id) ≤ 255 et 0 ≤ openN ≤ 2³²−1 (sinon erreur de programmation : panique).
func (s *Signer) Issue(kind byte, id string, openN int, exp time.Time) string {
	if len(id) > 255 || openN < 0 || openN > math.MaxUint32 {
		panic("token: id ou n° d'ouverture hors limites")
	}
	b := make([]byte, 0, 2+len(id)+12)
	b = append(b, kind, byte(len(id)))
	b = append(b, id...)
	b = binary.BigEndian.AppendUint32(b, uint32(openN))
	b = binary.BigEndian.AppendUint64(b, uint64(exp.Unix()))
	return s.encode(b)
}

// Check vérifie la signature, le type, l'id et l'expiration, et rend le n° d'ouverture.
func (s *Signer) Check(tok string, kind byte, id string) (int, error) {
	n, _, err := s.CheckExp(tok, kind, id)
	return n, err
}

// CheckExp est Check, et rend aussi l'expiration signée (zéro en cas d'erreur).
func (s *Signer) CheckExp(tok string, kind byte, id string) (int, time.Time, error) {
	n, exp, err := s.check(tok, kind, id)
	if err != nil {
		return 0, time.Time{}, err
	}
	return n, time.Unix(exp, 0), nil
}

func (s *Signer) check(tok string, kind byte, id string) (int, int64, error) {
	if len(tok) > maxTokenLen {
		return 0, 0, ErrInvalid
	}
	p, m, ok := strings.Cut(tok, ".")
	if !ok {
		return 0, 0, ErrInvalid
	}
	raw, err := b64.DecodeString(p)
	if err != nil {
		return 0, 0, ErrInvalid
	}
	sig, err := b64.DecodeString(m)
	if err != nil || !hmac.Equal(sig, s.mac(raw)) {
		return 0, 0, ErrInvalid
	}
	if len(raw) < 2 || raw[0] != kind {
		return 0, 0, ErrInvalid
	}
	l := int(raw[1])
	if len(raw) != 2+l+12 || string(raw[2:2+l]) != id {
		return 0, 0, ErrInvalid
	}
	openN := binary.BigEndian.Uint32(raw[2+l:])
	exp := int64(binary.BigEndian.Uint64(raw[2+l+4:]))
	if exp <= s.now().Unix() {
		return 0, 0, ErrInvalid
	}
	return int(openN), exp, nil
}
