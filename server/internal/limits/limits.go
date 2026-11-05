// Package limits applique les quotas de création et la limite de débit (spec §4, §9.3).
//
// Tout est en mémoire. Les compteurs sont indexés par HMAC-SHA-256(secret du jour, préfixe IP) :
// données pseudonymisées, jamais écrites sur disque. À minuit UTC, un nouveau secret
// aléatoire est tiré et tous les compteurs sont effacés.
package limits

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"net/netip"
	"sync"
	"time"
)

const (
	CreatesPer64   = 10
	CreatesPer48   = 30
	BytesPer64     = 3 << 30 // 3 Gio utiles par jour (spec §24)
	BytesPer48     = 6 << 30 // 6 Gio utiles par jour et par /48 (anti-saturation du disque)
	RequestsPerMin = 60
	SegmentsPerMin = 600 // requêtes de segments à jeton valide, compteur à part
	// SegmentsPer48Min : même compteur par bloc /48 (10 × la connexion), pour qu'un /48
	// découpé en /64 ne multiplie pas le débit par 65 536 (audit M1).
	SegmentsPer48Min = 10 * SegmentsPerMin
	day              = 86400
)

// Prefixes rend la connexion et le bloc d'une adresse : IPv4 (y compris ::ffff:a.b.c.d)
// → l'adresse elle-même pour les deux ; IPv6 → préfixes /64 et /48. Une adresse invalide
// tombe dans un seau commun.
func Prefixes(ip netip.Addr) (p64, p48 string) {
	ip = ip.Unmap().WithZone("")
	switch {
	case ip.Is4():
		return ip.String(), ip.String()
	case ip.Is6():
		a, _ := ip.Prefix(64)
		b, _ := ip.Prefix(48)
		return a.String(), b.String()
	}
	return "invalid", "invalid"
}

type Limiter struct {
	now func() time.Time

	mu      sync.Mutex
	day     int64 // jour UTC courant (jours depuis 1970)
	secret  []byte
	count64 map[string]int
	count48 map[string]int
	bytes64 map[string]int64
	bytes48 map[string]int64
	minute  int64 // minute courante (minutes depuis 1970)
	req     map[string]int
	seg     map[string]int
	seg48   map[string]int
}

func New(now func() time.Time) *Limiter {
	l := &Limiter{now: now, day: -1, minute: -1}
	l.mu.Lock()
	l.rotateLocked(now())
	l.mu.Unlock()
	return l
}

func (l *Limiter) rotateLocked(now time.Time) {
	t := now.Unix()
	if d := floorDiv(t, day); d != l.day {
		l.day = d
		l.secret = make([]byte, 32)
		if _, err := rand.Read(l.secret); err != nil {
			panic(err) // crypto/rand ne renvoie pas d'erreur sous Linux
		}
		l.count64 = map[string]int{}
		l.count48 = map[string]int{}
		l.bytes64 = map[string]int64{}
		l.bytes48 = map[string]int64{}
		l.req = map[string]int{}
		l.seg = map[string]int{}
		l.seg48 = map[string]int{}
	}
	if m := floorDiv(t, 60); m != l.minute {
		l.minute = m
		l.req = map[string]int{}
		l.seg = map[string]int{}
		l.seg48 = map[string]int{}
	}
}

func floorDiv(a, b int64) int64 {
	q := a / b
	if a%b != 0 && a < 0 {
		q--
	}
	return q
}

func (l *Limiter) keyLocked(ip netip.Addr) (k64, k48 string) {
	p64, p48 := Prefixes(ip)
	return l.hmac("64|" + p64), l.hmac("48|" + p48)
}

func (l *Limiter) hmac(s string) string {
	h := hmac.New(sha256.New, l.secret)
	h.Write([]byte(s))
	return hex.EncodeToString(h.Sum(nil))
}

// Key rend les clés pseudonymisées de la connexion (/64) et du bloc (/48) pour le jour courant.
func (l *Limiter) Key(ip netip.Addr) (k64, k48 string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.rotateLocked(l.now())
	return l.keyLocked(ip)
}

// AllowCreate vérifie les quatre quotas journaliers d'un coup et ne compte la création que si
// elle est acceptée. En cas de refus, retryAfter est le temps jusqu'à minuit UTC.
func (l *Limiter) AllowCreate(ip netip.Addr, bytes int64) (ok bool, retryAfter time.Duration) {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := l.now()
	l.rotateLocked(now)
	k64, k48 := l.keyLocked(ip)
	if bytes < 0 || l.count64[k64] >= CreatesPer64 || l.count48[k48] >= CreatesPer48 ||
		bytes > BytesPer64-l.bytes64[k64] || bytes > BytesPer48-l.bytes48[k48] {
		return false, time.Unix((l.day+1)*day, 0).Sub(now)
	}
	l.count64[k64]++
	l.count48[k48]++
	l.bytes64[k64] += bytes
	l.bytes48[k48] += bytes
	return true, 0
}

// AllowRequest : 60 requêtes par minute (fenêtre fixe) et par connexion.
func (l *Limiter) AllowRequest(ip netip.Addr) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.rotateLocked(l.now())
	k64, _ := l.keyLocked(ip)
	if l.req[k64] >= RequestsPerMin {
		return false
	}
	l.req[k64]++
	return true
}

// AllowSegment : 600 requêtes de segments par minute (fenêtre fixe) et par connexion, et
// 6 000 par bloc /48, pour les seules requêtes de segments dont le jeton est valide
// (vérifié avant l'appel). Une requête refusée n'est comptée nulle part.
func (l *Limiter) AllowSegment(ip netip.Addr) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.rotateLocked(l.now())
	k64, k48 := l.keyLocked(ip)
	if l.seg[k64] >= SegmentsPerMin || l.seg48[k48] >= SegmentsPer48Min {
		return false
	}
	l.seg[k64]++
	l.seg48[k48]++
	return true
}
