package salon

import (
	"bytes"
	"errors"
	"testing"
	"testing/synctest"
	"time"
)

// Relecture des corrections C-2, N1 (décision du contrôleur, dans l'esprit d'I3) : un siège
// invité qui n'a jamais ouvert de WebSocket dans les 10 min qui suivent son entrée (réponse de
// rejoindre perdue, remplissage volontaire) est libéré par un départ 0x03 ; sa place est
// rendue au plafond max_members, son arrivée reste comptée. Un siège connecté au moins une
// fois reste réservé à vie (I3).

// Réponse de rejoindre perdue : le salon (max_members = 2) est plein ; à 10 min, le siège
// fantôme part (0x03) et l'invité peut entrer.
func TestReponsePerdueSiegeLibere(t *testing.T) {
	b := nouveauBanc(t, 200)
	c := b.creer(t, 2)
	b.entrer(t, c, true)
	perdu := b.entrer(t, c, false) // réponse jamais reçue : aucun WebSocket
	s := b.etat(t, c)
	if _, err := b.m.Rejoindre(c.acces, c.preuve, nil); !errors.Is(err, ErrFull) {
		t.Fatal("salon plein attendu :", err)
	}
	b.h.avancer(jamaisConnecteMax - time.Second)
	b.m.Tick()
	if _, err := b.m.Membre(perdu.Jeton[:]); err != nil {
		t.Fatal("libéré avant 10 min :", err)
	}
	b.h.avancer(time.Second)
	b.m.Tick()
	if _, err := b.m.Membre(perdu.Jeton[:]); !errors.Is(err, ErrNotFound) {
		t.Fatal("siège fantôme gardé :", err)
	}
	var dernier evenement
	sous(s, func() { dernier = s.journal[len(s.journal)-1] })
	if !bytes.Equal(dernier.enr, EnrDepart(dernier.seq, perdu.Siege)) {
		t.Fatalf("0x03 attendu : %x", dernier.enr)
	}
	if e := b.entrer(t, c, false); e.Siege != perdu.Siege {
		t.Fatal("place non rendue :", e.Siege)
	}
}

// Siège connecté une fois, puis absent 2 h : toujours réservé (I3).
func TestSiegeConnecteUneFoisReserve(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		b := nouveauBanc(t, 200)
		c := b.creer(t, 2)
		ea := b.entrer(t, c, false)
		la := b.connecter(ea.Jeton, ea.Seq)
		synctest.Wait()
		finir(t, la)
		for range 120 {
			b.h.avancer(time.Minute)
			b.m.Tick()
		}
		if _, err := b.m.Membre(ea.Jeton[:]); err != nil {
			t.Fatal("siège connecté une fois libéré :", err)
		}
	})
}

// Remplissage volontaire par des rejoindre sans WebSocket : places rendues à 10 min, arrivées
// toujours comptées (5 × max_members : aucune boucle sans fin).
func TestRemplissageSansWSRendu(t *testing.T) {
	b := nouveauBanc(t, 200)
	c := b.creer(t, 4)
	for range 3 {
		b.entrer(t, c, false)
	}
	s := b.etat(t, c)
	if _, err := b.m.Rejoindre(c.acces, c.preuve, nil); !errors.Is(err, ErrFull) {
		t.Fatal("salon plein attendu :", err)
	}
	b.h.avancer(jamaisConnecteMax)
	b.m.Tick()
	if n := occupes(s); n != 0 {
		t.Fatal("sièges fantômes gardés :", n)
	}
	var arrivees int
	sous(s, func() { arrivees = s.arrivees })
	if arrivees != 3 {
		t.Fatal("arrivées décomptées :", arrivees)
	}
	b.entrer(t, c, false)
	sous(s, func() { arrivees = s.arrivees })
	if arrivees != 4 {
		t.Fatal("arrivées :", arrivees)
	}
}
