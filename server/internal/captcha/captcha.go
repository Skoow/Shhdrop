// Package captcha fournit l'anti-robot ALTCHA adaptatif (spec §22, D4).
//
// Format compatible avec le widget ALTCHA : défi = hex(SHA-256(sel ‖ nombre)),
// signature = hex(HMAC-SHA-256(clé, défi)). Le sel a un format fixe :
//
//	<24 hex aléatoires>.<16 hex liés à la connexion>.<niveau 0–5>?expires=<10 chiffres>
//
// Le format fixe empêche de déplacer des chiffres entre le nombre et le sel (la chaîne
// hachée étant la même). Le niveau est la difficulté au moment de l'émission : un défi
// dont le niveau est inférieur au niveau actuel de la connexion est refusé, pour que la
// difficulté ne puisse pas être contournée en stockant des défis faciles à l'avance.
// Tout est en mémoire ; rien n'est lié à une adresse IP en clair.
package captcha

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/netip"
	"regexp"
	"strconv"
	"sync"
	"time"

	altcha "github.com/altcha-org/altcha-lib-go"

	"github.com/skoow/shhdrop/server/internal/limits"
)

const (
	baseMax    = 50000
	maxLevel   = 5
	ttl        = 2 * time.Minute
	minFill    = 3 * time.Second
	window     = time.Hour
	maxPayload = 2048
	sweepEvery = time.Minute
)

// ErrInvalid : refus unique, quelle que soit la vérification qui a échoué.
var ErrInvalid = errors.New("anti-robot invalide")

var saltRe = regexp.MustCompile(`^[0-9a-f]{24}\.([0-9a-f]{16})\.([0-5])\?expires=([0-9]{10})$`)

type Captcha struct {
	sigKey, bindKey []byte
	now             func() time.Time

	mu        sync.Mutex
	used      map[string]int64       // sel consommé → expiration (unix)
	creates   map[string][]time.Time // lien de connexion → créations de la dernière heure
	lastSweep time.Time
}

// New prend une clé aléatoire d'au moins 32 octets, générée au démarrage.
func New(hmacKey []byte, now func() time.Time) *Captcha {
	if len(hmacKey) < 32 {
		panic("captcha: clé trop courte")
	}
	return &Captcha{
		sigKey:  derive(hmacKey, "shhdrop altcha signature"),
		bindKey: derive(hmacKey, "shhdrop altcha connexion"),
		now:     now,
		used:    map[string]int64{},
		creates: map[string][]time.Time{},
	}
}

func derive(key []byte, label string) []byte {
	h := hmac.New(sha256.New, key)
	h.Write([]byte(label))
	return h.Sum(nil)
}

// bind rend 16 hex liés à la connexion (/64 ou IPv4), sans révéler l'adresse.
func (c *Captcha) bind(ip netip.Addr) string {
	p64, _ := limits.Prefixes(ip)
	h := hmac.New(sha256.New, c.bindKey)
	h.Write([]byte(p64))
	return hex.EncodeToString(h.Sum(nil)[:8])
}

// sweepLocked oublie les sels expirés et les créations de plus d'une heure (au plus une fois par minute).
func (c *Captcha) sweepLocked(now time.Time) {
	if now.Sub(c.lastSweep) < sweepEvery && !now.Before(c.lastSweep) {
		return
	}
	c.lastSweep = now
	for s, exp := range c.used {
		if now.Unix() >= exp {
			delete(c.used, s)
		}
	}
	for b := range c.creates {
		c.recentLocked(b, now)
	}
}

// recentLocked rend le niveau de difficulté (créations de la dernière heure, plafonné).
func (c *Captcha) recentLocked(b string, now time.Time) int {
	ts := c.creates[b]
	i := 0
	for i < len(ts) && now.Sub(ts[i]) >= window {
		i++
	}
	ts = ts[i:]
	if len(ts) == 0 {
		delete(c.creates, b)
	} else {
		c.creates[b] = ts
	}
	return min(len(ts), maxLevel)
}

// Challenge émet un défi lié à la connexion, valable 2 minutes.
func (c *Captcha) Challenge(ip netip.Addr) (altcha.Challenge, error) {
	now := c.now()
	b := c.bind(ip)
	c.mu.Lock()
	c.sweepLocked(now)
	level := c.recentLocked(b, now)
	c.mu.Unlock()

	rnd := make([]byte, 12)
	if _, err := rand.Read(rnd); err != nil {
		return altcha.Challenge{}, err
	}
	exp := now.Add(ttl)
	return altcha.CreateChallenge(altcha.ChallengeOptions{
		Algorithm: altcha.SHA256,
		MaxNumber: int64(baseMax) << level,
		HMACKey:   string(c.sigKey),
		Salt:      hex.EncodeToString(rnd) + "." + b + "." + strconv.Itoa(level),
		Expires:   &exp,
	})
}

// RecordCreate compte une création réussie : la difficulté double pour l'heure qui suit.
func (c *Captcha) RecordCreate(ip netip.Addr) {
	now := c.now()
	b := c.bind(ip)
	c.mu.Lock()
	defer c.mu.Unlock()
	c.sweepLocked(now)
	c.creates[b] = append(c.creates[b], now)
}

// Verify accepte une solution une seule fois. shownAt est l'heure d'affichage de la page
// (venue d'un jeton signé). Toute erreur est ErrInvalid.
func (c *Captcha) Verify(payload string, ip netip.Addr, honeypot string, shownAt time.Time) error {
	now := c.now()
	if honeypot != "" || now.Sub(shownAt) < minFill || len(payload) > maxPayload {
		return ErrInvalid
	}
	raw, err := base64.StdEncoding.DecodeString(payload)
	if err != nil {
		return ErrInvalid
	}
	var p altcha.Payload
	if json.Unmarshal(raw, &p) != nil || p.Algorithm != string(altcha.SHA256) {
		return ErrInvalid
	}
	m := saltRe.FindStringSubmatch(p.Salt)
	if m == nil {
		return ErrInvalid
	}
	level, _ := strconv.Atoi(m[2])
	exp, _ := strconv.ParseInt(m[3], 10, 64)
	if now.Unix() >= exp || exp > now.Add(ttl).Unix() {
		return ErrInvalid
	}
	b := c.bind(ip)
	if !hmac.Equal([]byte(m[1]), []byte(b)) {
		return ErrInvalid
	}
	want, err := altcha.CreateChallenge(altcha.ChallengeOptions{
		Algorithm: altcha.SHA256,
		HMACKey:   string(c.sigKey),
		Salt:      p.Salt,
		Number:    &p.Number,
	})
	if err != nil || !hmac.Equal([]byte(want.Challenge), []byte(p.Challenge)) ||
		!hmac.Equal([]byte(want.Signature), []byte(p.Signature)) {
		return ErrInvalid
	}

	c.mu.Lock()
	defer c.mu.Unlock()
	c.sweepLocked(now)
	if level < c.recentLocked(b, now) {
		return ErrInvalid
	}
	if _, dup := c.used[p.Salt]; dup {
		return ErrInvalid
	}
	c.used[p.Salt] = exp
	return nil
}
