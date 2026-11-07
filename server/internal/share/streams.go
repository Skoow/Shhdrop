package share

import (
	"context"
	"errors"
	"io"
	"strconv"
	"sync"
)

// ErrRevoked : cause de l'annulation d'un flux révoqué (signalement, administrateur,
// exclusion d'un salon, lien révoqué ; spec §41.8).
var ErrRevoked = errors.New("flux révoqué")

// Streams : flux de segments en cours, par clé de révocation (spec §41.8, §9.5) : (id
// interne, n° d'ouverture) pour un partage (ShareKey) ; empreinte du jeton de membre pour un
// salon (Task C-6) ; (id, étiquette du lien) pour un lien révoqué (Task F5). Mémoire
// seulement ; une entrée vit le temps du flux. Valeur zéro prête à l'emploi.
type Streams struct {
	mu   sync.Mutex
	seq  uint64
	live map[string]map[uint64]context.CancelCauseFunc
}

// ShareKey : clé de révocation d'une ouverture de partage.
func ShareKey(id string, openN int) string { return "s:" + id + ":" + strconv.Itoa(openN) }

// Start inscrit un flux sous key : le contexte rendu est annulé par Revoke(key) ou par
// l'annulation de parent ; end (idempotent) le désinscrit et libère le contexte.
func (r *Streams) Start(parent context.Context, key string) (ctx context.Context, end func()) {
	ctx, cancel := context.WithCancelCause(parent)
	r.mu.Lock()
	if r.live == nil {
		r.live = map[string]map[uint64]context.CancelCauseFunc{}
	}
	r.seq++
	n := r.seq
	if r.live[key] == nil {
		r.live[key] = map[uint64]context.CancelCauseFunc{}
	}
	r.live[key][n] = cancel
	r.mu.Unlock()
	var once sync.Once
	return ctx, func() {
		once.Do(func() {
			r.mu.Lock()
			if m := r.live[key]; m != nil {
				delete(m, n)
				if len(m) == 0 {
					delete(r.live, key)
				}
			}
			r.mu.Unlock()
			cancel(context.Canceled)
		})
	}
}

// Revoke annule tout de suite tous les flux en cours de key (coupure en cours de segment)
// et rend leur nombre. Les flux suivants ne sont pas concernés : l'appelant refuse lui-même
// les requêtes suivantes (ligne effacée, jeton révoqué).
func (r *Streams) Revoke(key string) int {
	r.mu.Lock()
	m := r.live[key]
	delete(r.live, key)
	r.mu.Unlock()
	for _, cancel := range m {
		cancel(ErrRevoked)
	}
	return len(m)
}

// Len : nombre de flux inscrits (tests).
func (r *Streams) Len() int {
	r.mu.Lock()
	defer r.mu.Unlock()
	n := 0
	for _, m := range r.live {
		n += len(m)
	}
	return n
}

// ctxReader refuse toute lecture dès que ctx est annulé : la copie d'un segment vers la
// réponse s'arrête à la tranche suivante (io.Copy lit par 32 Kio).
type ctxReader struct {
	ctx context.Context
	r   io.Reader
}

func (c ctxReader) Read(p []byte) (int, error) {
	if c.ctx.Err() != nil {
		return 0, context.Cause(c.ctx)
	}
	return c.r.Read(p)
}
