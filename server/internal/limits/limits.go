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
	"errors"
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
	// Envois non finalisés à la fois (spec §29.5).
	PendingPer64 = 2
	PendingPer48 = 6
	// Octets abandonnés (envois effacés sans finalize) par jour (spec §29.5).
	AbandonedPer64 = 6 << 30
	AbandonedPer48 = 12 << 30
	// pendingRetry : Retry-After quand la connexion a déjà ses envois en cours.
	pendingRetry = 60 * time.Second
	day          = 86400
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
	// Envois en cours (BeginUpload → FinishUpload / CancelUpload / AbandonUpload) : id →
	// clés pseudonymisées du jour de la création, en mémoire seulement (spec §29.5).
	uploads map[string]upload
	pend64  map[string]int
	pend48  map[string]int
	aband64 map[string]int64
	aband48 map[string]int64
}

type upload struct {
	k64, k48 string
	bytes    int64
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
		// Les envois en cours sont oubliés avec le secret du jour (leurs clés ne
		// correspondent plus à rien) : un envoi finalisé après minuit n'est pas compté.
		l.uploads = map[string]upload{}
		l.pend64 = map[string]int{}
		l.pend48 = map[string]int{}
		l.aband64 = map[string]int64{}
		l.aband48 = map[string]int64{}
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

// Erreurs de BeginUpload.
var (
	// ErrQuota : quota journalier (créations, octets, octets abandonnés) atteint, ou trop
	// d'envois en cours ; réponse 429 avec le délai rendu.
	ErrQuota = errors.New("limits : quota atteint")
	// ErrDuplicate : un envoi en cours porte déjà cet id (sonde) : compté comme une
	// création, réponse identique à une création invalide (400).
	ErrDuplicate = errors.New("limits : envoi déjà en cours sous cet id")
)

// BeginUpload réserve un envoi (spec §29.5) : refusé si la connexion ou son /48 a déjà
// atteint ses créations ou ses octets du jour (partages finalisés et envois en cours
// confondus), ses envois en cours (2 par connexion, 6 par /48) ou ses octets abandonnés
// du jour. Accepté : la création et ses octets sont réservés ; FinishUpload les garde
// (débit à la finalisation), CancelUpload et AbandonUpload les rendent. retryAfter : délai
// jusqu'à minuit UTC (quotas du jour) ou 60 s (envois en cours).
func (l *Limiter) BeginUpload(ip netip.Addr, id string, bytes int64) (retryAfter time.Duration, err error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := l.now()
	l.rotateLocked(now)
	k64, k48 := l.keyLocked(ip)
	untilMidnight := time.Unix((l.day+1)*day, 0).Sub(now)
	switch {
	case bytes < 0 || l.count64[k64] >= CreatesPer64 || l.count48[k48] >= CreatesPer48 ||
		bytes > BytesPer64-l.bytes64[k64] || bytes > BytesPer48-l.bytes48[k48] ||
		l.aband64[k64] >= AbandonedPer64 || l.aband48[k48] >= AbandonedPer48:
		return untilMidnight, ErrQuota
	}
	// Id d'un envoi déjà en cours : une sonde (les id dérivent d'une K_lien aléatoire de
	// 256 bits, une vraie collision est impossible). Elle coûte une création du quota,
	// comme une création réussie (revue K1, I2), et ne touche pas l'envoi existant.
	if _, dup := l.uploads[id]; dup {
		l.count64[k64]++
		l.count48[k48]++
		l.bytes64[k64] += bytes
		l.bytes48[k48] += bytes
		return 0, ErrDuplicate
	}
	if l.pend64[k64] >= PendingPer64 || l.pend48[k48] >= PendingPer48 {
		return min(pendingRetry, untilMidnight), ErrQuota
	}
	l.count64[k64]++
	l.count48[k48]++
	l.bytes64[k64] += bytes
	l.bytes48[k48] += bytes
	l.pend64[k64]++
	l.pend48[k48]++
	l.uploads[id] = upload{k64: k64, k48: k48, bytes: bytes}
	return 0, nil
}

// endLocked retire l'envoi id des envois en cours ; refund rend sa réservation.
func (l *Limiter) endLocked(id string, refund bool) (upload, bool) {
	l.rotateLocked(l.now())
	u, ok := l.uploads[id]
	if !ok {
		return u, false
	}
	delete(l.uploads, id)
	decr(l.pend64, u.k64)
	decr(l.pend48, u.k48)
	if refund {
		decr(l.count64, u.k64)
		decr(l.count48, u.k48)
		l.bytes64[u.k64] -= u.bytes
		l.bytes48[u.k48] -= u.bytes
	}
	return u, true
}

func decr(m map[string]int, k string) {
	if m[k]--; m[k] <= 0 {
		delete(m, k)
	}
}

// FinishUpload : l'envoi id est finalisé ; sa création et ses octets restent comptés.
func (l *Limiter) FinishUpload(id string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.endLocked(id, false)
}

// CancelUpload : la création a échoué (place pleine, conflit…) ; rien n'est compté.
func (l *Limiter) CancelUpload(id string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.endLocked(id, true)
}

// AbandonUpload : l'envoi id a été effacé sans finalize (abandon, échéance) ; sa
// réservation est rendue et ses octets comptent comme abandonnés. Un id inconnu (serveur
// redémarré, jour changé) est ignoré.
func (l *Limiter) AbandonUpload(id string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if u, ok := l.endLocked(id, true); ok {
		l.aband64[u.k64] += u.bytes
		l.aband48[u.k48] += u.bytes
	}
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
