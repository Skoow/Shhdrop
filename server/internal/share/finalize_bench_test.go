package share

// Rapport de performance du 13 novembre, A12 : temps de Finalize d'un partage de 200 Mo
// (palier 4000, 256 Mio : 49 segments de 4 Mio envoyés, ≈ 205 Mo, puis le dernier ; bourrage
// des segments 49 à 61, ≈ 54 Mo d'aléa). Sur le disque du dossier temporaire.
//
//	go test -run '^$' -bench Finalize200Mo -benchtime 5x ./internal/share/

import (
	"testing"
	"time"
)

func BenchmarkFinalize200Mo(b *testing.B) {
	const bucket, sent = 4000, 49
	for range b.N {
		b.StopTimer()
		s, _ := newSvc(b)
		k := newKeys()
		id, segs, err := s.createAny(k.req(bucket, 24, 1))
		if err != nil {
			b.Fatal(err)
		}
		for n := range segs {
			if n >= sent && n < segs-1 {
				continue
			}
			if err := s.PutSegment(id, n, segBody(bucket, n, byte(n+1))); err != nil {
				b.Fatal(n, err)
			}
		}
		// Un envoi réel dure des dizaines de secondes : laisser finir l'écriture de fond.
		s.waitBackgroundSync()
		time.Sleep(10 * time.Millisecond)
		r := fin(id)
		r.FillFrom, r.FillTo = sent, segs-1
		b.StartTimer()
		if _, err := s.Finalize(id, r); err != nil {
			b.Fatal(err)
		}
	}
}
