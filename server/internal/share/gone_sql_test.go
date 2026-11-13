package share

// Audit de sécurité du 13 novembre, D7 : retire, Watch et grantIfLive lisaient la base en
// tenant gone.mu, que prend chaque lecture de segment ; une base lente (verrouillée par
// « shhdrop admin », busy_timeout de 5 s, vidage du WAL) suspendait alors tous les
// téléchargements. La base n'a qu'une connexion (store.Open) : une transaction ouverte ici la
// retient, et chaque appel attend sa requête SQL. gone.mu doit rester libre pendant ce temps.

import (
	"context"
	"testing"
	"time"
)

func TestAucunSQLSousGoneMu(t *testing.T) {
	cas := map[string]func(s *Service, id string){
		"retire":      func(s *Service, id string) { s.retire(id, true, s.now()) },
		"Watch":       func(s *Service, id string) { s.Watch(id, 1) },
		"grantIfLive": func(s *Service, id string) { s.grantIfLive(id, 1, s.now()+3600) },
		"OpenSegment": func(s *Service, id string) {
			if g, err := s.OpenSegmentCtx(context.Background(), id, 0, 1); err == nil {
				g.Close()
			}
		},
	}
	for nom, f := range cas {
		t.Run(nom, func(t *testing.T) {
			s, _ := newSvc(t)
			k := newKeys()
			id := ready(t, s, k, 1, 24, 10)
			if _, err := s.UnlockGrant(id, k.acces, k.preuve, ""); err != nil {
				t.Fatal(err)
			}
			tx, err := s.DB.Begin() // la seule connexion : toute requête attend
			if err != nil {
				t.Fatal(err)
			}
			done := make(chan struct{})
			go func() { f(s, id); close(done) }()
			time.Sleep(100 * time.Millisecond)
			libre := s.gone.mu.TryLock()
			if libre {
				s.gone.mu.Unlock()
			}
			tx.Rollback()
			select {
			case <-done:
			case <-time.After(5 * time.Second):
				t.Fatal("appel non terminé")
			}
			if !libre {
				t.Fatalf("%s : gone.mu tenu pendant une requête SQL", nom)
			}
		})
	}
}
