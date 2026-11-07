package share

import (
	"context"
	"errors"
	"sync"
	"testing"
)

// Révocation par clé (lien révoqué, Task F5 ; membre exclu d'un salon, Task C-6 ; ouverture
// d'un partage) : seuls les flux de la clé révoquée sont annulés ; registre vide ensuite.
func TestStreamsRevokeOnlyKey(t *testing.T) {
	var r Streams
	keys := []string{ShareKey("AAAAAAAAAAAAAAAAAAAAAA", 1), ShareKey("AAAAAAAAAAAAAAAAAAAAAA", 2),
		"lien:AAAAAAAAAAAAAAAAAAAAAA:x", "lien:AAAAAAAAAAAAAAAAAAAAAA:y", "membre:m1", "membre:m2"}
	ctxs := map[string][]context.Context{}
	var ends []func()
	for _, k := range keys {
		for i := 0; i < 3; i++ {
			ctx, end := r.Start(context.Background(), k)
			ctxs[k] = append(ctxs[k], ctx)
			ends = append(ends, end)
		}
	}
	if r.Len() != 18 {
		t.Fatal(r.Len())
	}
	for _, revoked := range []string{"lien:AAAAAAAAAAAAAAAAAAAAAA:x", "membre:m2", ShareKey("AAAAAAAAAAAAAAAAAAAAAA", 2)} {
		if n := r.Revoke(revoked); n != 3 {
			t.Fatal(revoked, n)
		}
	}
	for k, cs := range ctxs {
		cut := k == "lien:AAAAAAAAAAAAAAAAAAAAAA:x" || k == "membre:m2" || k == ShareKey("AAAAAAAAAAAAAAAAAAAAAA", 2)
		for _, c := range cs {
			if (c.Err() != nil) != cut {
				t.Fatal(k, c.Err())
			}
			if cut && !errors.Is(context.Cause(c), ErrRevoked) {
				t.Fatal(context.Cause(c))
			}
		}
	}
	if r.Len() != 9 {
		t.Fatal("révoqués toujours inscrits", r.Len())
	}
	for _, end := range ends {
		end()
		end() // idempotent
	}
	if r.Len() != 0 {
		t.Fatal("registre non vide", r.Len())
	}
	// Un flux démarré après une révocation n'est pas annulé par elle (la révocation des
	// requêtes suivantes est l'affaire de l'appelant : ligne effacée, jeton révoqué).
	ctx, end := r.Start(context.Background(), "membre:m2")
	if ctx.Err() != nil {
		t.Fatal(ctx.Err())
	}
	end()
	if r.Len() != 0 {
		t.Fatal(r.Len())
	}
}

func TestStreamsConcurrent(t *testing.T) {
	var r Streams
	var wg sync.WaitGroup
	for i := 0; i < 50; i++ {
		wg.Go(func() {
			_, end := r.Start(context.Background(), "k")
			r.Revoke("autre")
			end()
		})
		wg.Go(func() { r.Revoke("k") })
	}
	wg.Wait()
	if r.Len() != 0 {
		t.Fatal(r.Len())
	}
}

// ctxReader : lecture refusée dès l'annulation, entre deux tranches.
func TestCtxReader(t *testing.T) {
	ctx, cancel := context.WithCancelCause(context.Background())
	r := ctxReader{ctx: ctx, r: zeroReader{}}
	b := make([]byte, 10)
	if n, err := r.Read(b); n != 10 || err != nil {
		t.Fatal(n, err)
	}
	cancel(ErrRevoked)
	if n, err := r.Read(b); n != 0 || !errors.Is(err, ErrRevoked) {
		t.Fatal(n, err)
	}
}

type zeroReader struct{}

func (zeroReader) Read(p []byte) (int, error) { clear(p); return len(p), nil }
