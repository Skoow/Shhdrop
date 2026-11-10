// Package limits applique les quotas de création et la limite de débit (spec §4, §9.3).
//
// Tout est en mémoire. Les compteurs sont indexés par HMAC-SHA-256(secret du jour, préfixe IP) :
// données pseudonymisées, jamais écrites sur disque. À minuit UTC, un nouveau secret
// aléatoire est tiré et tous les compteurs sont effacés, sauf ceux des envois encore en
// cours (rotateLocked) : ils restent comptés sous leur clé de la veille, et le secret de la
// veille reste en mémoire tant qu'un de ces envois vit (UploadLife au plus).
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
	BytesPer64     = 6 << 30  // 6 Gio utiles par jour : trois partages pleins (spec §24, §41.2)
	BytesPer48     = 12 << 30 // 12 Gio utiles par jour et par /48 (anti-saturation du disque)
	RequestsPerMin = 60
	SegmentsPerMin = 600 // requêtes de segments à jeton valide, compteur à part
	// SegmentsPer48Min : même compteur par bloc /48 (10 × la connexion), pour qu'un /48
	// découpé en /64 ne multiplie pas le débit par 65 536 (audit M1).
	SegmentsPer48Min = 10 * SegmentsPerMin
	// Envois non finalisés à la fois (spec §29.5).
	PendingPer64 = 2
	PendingPer48 = 6
	// Octets abandonnés (envois effacés sans finalize) par jour (spec §29.5).
	AbandonedPer64 = 12 << 30
	AbandonedPer48 = 24 << 30
	// pendingRetry : Retry-After quand la connexion a déjà ses envois en cours.
	pendingRetry = 60 * time.Second
	day          = 86400
)

// UploadLife : vie maximale d'un envoi non finalisé, 6 h arrondies au quart d'heure supérieur
// (share.uploadWindow et ceil15, spec §24, §41.2). Un envoi en cours à minuit UTC reste
// compté le lendemain au plus ce temps après sa création.
const UploadLife = 6*time.Hour + 15*time.Minute

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
	// Envois de la veille encore en cours (rotateLocked ; upload.old). prev : secret de la
	// veille, nil dès qu'il n'en reste aucun ; prevUntil : heure à laquelle le dernier est
	// oublié d'office.
	prev      []byte
	prevUntil int64
}

type upload struct {
	k64, k48 string
	bytes    int64 // réservés à la création (rendus si l'envoi n'aboutit pas)
	recv     int64 // reçus (Receive) : jamais rendus
	born     int64 // création (secondes Unix), en mémoire seulement : borne le report à minuit
	old      bool  // créé la veille : ses clés sont celles du secret de la veille
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
		// Envois en cours créés depuis moins d'UploadLife : gardés (revue du 10 novembre).
		// Sans cela, un envoi à cheval sur minuit n'était plus compté (4 Gio par connexion
		// et par jour hors quota) et les places d'envoi en cours repartaient de zéro. Un
		// envoi déjà reporté une fois est plus vieux qu'UploadLife : jamais reporté deux fois.
		keep := map[string]upload{}
		for id, u := range l.uploads {
			if !u.old && u.born+int64(UploadLife/time.Second) > t {
				keep[id] = u
			}
		}
		l.dropPrevLocked()
		if len(keep) > 0 {
			l.prev = l.secret
		}
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
		l.uploads = map[string]upload{}
		l.pend64 = map[string]int{}
		l.pend48 = map[string]int{}
		l.aband64 = map[string]int64{}
		l.aband48 = map[string]int64{}
		// Les envois gardés repartent dans les compteurs du jour sous leurs clés de la veille
		// (aucune adresse n'est gardée : BeginUpload recalcule ces clés avec l.prev). Les
		// envois terminés la veille, eux, sont oubliés avec leurs compteurs.
		l.prevUntil = 0
		for id, u := range keep {
			u.old = true
			l.uploads[id] = u
			l.count64[u.k64]++
			l.count48[u.k48]++
			l.bytes64[u.k64] += u.counted()
			l.bytes48[u.k48] += u.counted()
			l.pend64[u.k64]++
			l.pend48[u.k48]++
			l.prevUntil = max(l.prevUntil, u.born+int64(UploadLife/time.Second))
		}
	}
	// Envois de la veille jamais terminés (fin non signalée) : oubliés d'office, et le secret
	// de la veille avec eux.
	if l.prev != nil && t >= l.prevUntil {
		l.dropPrevLocked()
	}
	if m := floorDiv(t, 60); m != l.minute {
		l.minute = m
		l.req = map[string]int{}
		l.seg = map[string]int{}
		l.seg48 = map[string]int{}
	}
}

// dropPrevLocked oublie les envois de la veille encore en cours, leurs compteurs et le secret
// de la veille (mis à zéro).
func (l *Limiter) dropPrevLocked() {
	for id, u := range l.uploads {
		if u.old {
			delete(l.uploads, id)
			l.forgetKeyLocked(u.k64)
			l.forgetKeyLocked(u.k48)
		}
	}
	clear(l.prev)
	l.prev, l.prevUntil = nil, 0
}

// forgetKeyLocked efface tous les compteurs du jour de la clé k (clé de la veille sans envoi).
func (l *Limiter) forgetKeyLocked(k string) {
	delete(l.count64, k)
	delete(l.count48, k)
	delete(l.bytes64, k)
	delete(l.bytes48, k)
	delete(l.pend64, k)
	delete(l.pend48, k)
	delete(l.aband64, k)
	delete(l.aband48, k)
}

// releaseCarriedLocked : l'envoi de la veille u (déjà retiré de uploads) finit. Une clé de la
// veille que plus aucun envoi en cours ne porte est effacée avec ses compteurs ; le secret
// de la veille est jeté dès le dernier.
func (l *Limiter) releaseCarriedLocked(u upload) {
	var any, has64, has48 bool
	for _, o := range l.uploads {
		if o.old {
			any = true
			has64 = has64 || o.k64 == u.k64
			has48 = has48 || o.k48 == u.k48
		}
	}
	if !has64 {
		l.forgetKeyLocked(u.k64)
	}
	if !has48 {
		l.forgetKeyLocked(u.k48)
	}
	if !any {
		l.dropPrevLocked()
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
	return keys(l.secret, ip)
}

// keys : clés pseudonymisées de la connexion et du bloc sous secret.
func keys(secret []byte, ip netip.Addr) (k64, k48 string) {
	p64, p48 := Prefixes(ip)
	return mac(secret, "64|"+p64), mac(secret, "48|"+p48)
}

func mac(secret []byte, s string) string {
	h := hmac.New(sha256.New, secret)
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
// jusqu'à minuit UTC (quotas du jour) ou 60 s (envois en cours). Les envois de la veille
// encore en cours de la même adresse comptent aussi (clés de la veille, o64 et o48).
func (l *Limiter) BeginUpload(ip netip.Addr, id string, bytes int64) (retryAfter time.Duration, err error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := l.now()
	l.rotateLocked(now)
	k64, k48 := l.keyLocked(ip)
	// Clés de la veille de cette adresse : absentes des compteurs (zéro) sans envoi reporté.
	var o64, o48 string
	if l.prev != nil {
		o64, o48 = keys(l.prev, ip)
	}
	untilMidnight := time.Unix((l.day+1)*day, 0).Sub(now)
	switch {
	case bytes < 0 || l.count64[k64]+l.count64[o64] >= CreatesPer64 || l.count48[k48]+l.count48[o48] >= CreatesPer48 ||
		bytes > BytesPer64-l.bytes64[k64]-l.bytes64[o64] || bytes > BytesPer48-l.bytes48[k48]-l.bytes48[o48] ||
		l.aband64[k64]+l.aband64[o64] >= AbandonedPer64 || l.aband48[k48]+l.aband48[o48] >= AbandonedPer48:
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
	if l.pend64[k64]+l.pend64[o64] >= PendingPer64 || l.pend48[k48]+l.pend48[o48] >= PendingPer48 {
		return min(pendingRetry, untilMidnight), ErrQuota
	}
	l.count64[k64]++
	l.count48[k48]++
	l.bytes64[k64] += bytes
	l.bytes48[k48] += bytes
	l.pend64[k64]++
	l.pend48[k48]++
	l.uploads[id] = upload{k64: k64, k48: k48, bytes: bytes, born: now.Unix()}
	return 0, nil
}

// endLocked retire l'envoi id des envois en cours ; refund rend sa réservation ; abandoned
// compte ses octets comme abandonnés.
func (l *Limiter) endLocked(id string, refund, abandoned bool) {
	l.rotateLocked(l.now())
	u, ok := l.uploads[id]
	if !ok {
		return
	}
	delete(l.uploads, id)
	decr(l.pend64, u.k64)
	decr(l.pend48, u.k48)
	if refund {
		// La création et la réservation non remplie sont rendues ; les octets reçus, jamais.
		decr(l.count64, u.k64)
		decr(l.count48, u.k48)
		l.bytes64[u.k64] -= u.counted() - u.recv
		l.bytes48[u.k48] -= u.counted() - u.recv
	}
	if abandoned {
		l.aband64[u.k64] += u.counted()
		l.aband48[u.k48] += u.counted()
	}
	if u.old {
		l.releaseCarriedLocked(u)
	}
}

// counted : octets comptés au quota pour un envoi : sa réservation (création, grow), ou
// ses octets reçus s'ils la dépassent (segments effacés et renvoyés compris).
func (u upload) counted() int64 { return max(u.bytes, u.recv) }

// debitLocked ajoute d au compte de u (d ≤ 0 : rend) ; refuse un débit au-delà du jour.
func (l *Limiter) debitLocked(id string, u upload, next upload, now time.Time) (time.Duration, error) {
	d := next.counted() - u.counted()
	if d > 0 && (d > BytesPer64-l.bytes64[u.k64] || d > BytesPer48-l.bytes48[u.k48]) {
		return time.Unix((l.day+1)*day, 0).Sub(now), ErrQuota
	}
	l.bytes64[u.k64] += d
	l.bytes48[u.k48] += d
	l.uploads[id] = next
	return 0, nil
}

// Receive compte n octets reçus pour l'envoi id (spec §41.14) : au-delà de sa réservation,
// débités au quota du jour (refus ErrQuota, délai jusqu'à minuit UTC). Un segment effacé
// reste compté. Un envoi de la veille reste compté sous sa clé de la veille. Un id inconnu
// (redémarrage, envoi plus vieux qu'UploadLife) est ignoré.
func (l *Limiter) Receive(id string, n int64) (time.Duration, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := l.now()
	l.rotateLocked(now)
	u, ok := l.uploads[id]
	if !ok {
		return 0, nil
	}
	if n < 0 {
		return 0, ErrQuota
	}
	next := u
	next.recv += n
	return l.debitLocked(id, u, next, now)
}

// Reserve porte la réservation de l'envoi id à bytes (grow d'un brouillon, spec §41.14) :
// le supplément est débité d'avance (refus ErrQuota) ; plus bas, la différence est rendue
// (annulation d'un grow échoué). Un id inconnu (redémarrage) est ignoré, comme
// pour Receive : la place reste bornée par les segments reçus (share.Grow).
func (l *Limiter) Reserve(id string, bytes int64) (time.Duration, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := l.now()
	l.rotateLocked(now)
	u, ok := l.uploads[id]
	if !ok {
		return 0, nil
	}
	if bytes < 0 {
		return 0, ErrQuota
	}
	next := u
	next.bytes = bytes
	return l.debitLocked(id, u, next, now)
}

// FinishUpload : l'envoi id est finalisé ; sa création et ses octets restent comptés.
func (l *Limiter) FinishUpload(id string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.endLocked(id, false, false)
}

// CancelUpload : la création a échoué (place pleine, conflit…) ; rien n'est compté.
func (l *Limiter) CancelUpload(id string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.endLocked(id, true, false)
}

// AbandonUpload : l'envoi id a été effacé sans finalize (abandon, échéance) ; sa création et
// sa réservation sont rendues, ses octets reçus restent comptés (spec §41.14), et tous
// comptent comme abandonnés. Un id inconnu (serveur redémarré) est ignoré.
func (l *Limiter) AbandonUpload(id string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.endLocked(id, true, true)
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

func decr(m map[string]int, k string) {
	if m[k]--; m[k] <= 0 {
		delete(m, k)
	}
}
