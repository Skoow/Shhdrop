//go:build linux

package salon

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"golang.org/x/sys/unix"
)

// dates : mtime et atime du fichier.
func dates(t *testing.T, p string) (mtime, atime time.Time) {
	t.Helper()
	var st unix.Stat_t
	if err := unix.Stat(p, &st); err != nil {
		t.Fatal(err)
	}
	return time.Unix(st.Mtim.Unix()), time.Unix(st.Atim.Unix())
}

// Dates à l'epoch après chaque écriture (création, ajout, effacement).
func TestSansDate(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, idConv)
	c := nouvelleConv(t, dir, idConv)
	epoch := time.Unix(0, 0)
	verifier := func(quand string) {
		t.Helper()
		m, a := dates(t, p)
		if !m.Equal(epoch) || !a.Equal(epoch) {
			t.Fatalf("%s : mtime %v, atime %v", quand, m, a)
		}
	}
	verifier("création")
	ajouter(t, c, 2)
	verifier("ajout")
	if _, err := c.Lire(1); err != nil {
		t.Fatal(err)
	}
	verifier("lecture (O_NOATIME)")
	if err := c.Effacer(0); err != nil {
		t.Fatal(err)
	}
	verifier("effacement")
	if err := c.EffacerPlusieurs([]uint32{0, 1}); err != nil {
		t.Fatal(err)
	}
	verifier("effacement en lot")
	// Témoin : une lecture ordinaire change l'atime sur ce volume, sinon « lecture
	// (O_NOATIME) » ne prouve rien.
	if _, err := os.ReadFile(p); err != nil {
		t.Fatal(err)
	}
	if _, a := dates(t, p); a.Equal(epoch) {
		t.Skip("volume monté sans mise à jour d'atime (noatime) : témoin non concluant")
	}
}

// Dates à l'epoch même après une écriture partielle annulée (defer, comme blob.WriteAt).
func TestSansDateApresEchec(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, idConv)
	c := nouvelleConv(t, dir, idConv)
	ajouter(t, c, 1)
	f := avecPanne(t, c)
	f.ecriturePartielle = true
	if _, err := c.Ajouter(trameTest(1)); err == nil {
		t.Fatal("écriture partielle acceptée")
	}
	if m, a := dates(t, p); !m.Equal(time.Unix(0, 0)) || !a.Equal(time.Unix(0, 0)) {
		t.Fatalf("après échec : mtime %v, atime %v", m, a)
	}
	f.truncateEchoue = true
	if _, err := c.Ajouter(trameTest(1)); err == nil {
		t.Fatal("écriture partielle acceptée")
	}
	if m, _ := dates(t, p); !m.Equal(time.Unix(0, 0)) {
		t.Fatalf("après Truncate en échec : mtime %v", m)
	}
}

// Audit adverse du 13 novembre, stockage, F4 : le ctime du fichier de conversation donnait
// l'heure du dernier message. Après BrouillerDates (une fois par minute, passe disque de
// l'entretien), le ctime des conversations, des pièces et de leurs dossiers est l'heure du
// passage.
func TestBrouillerDatesCtime(t *testing.T) {
	b := nouveauBanc(t, 200)
	c := b.creer(t, 4)
	_, g := b.entrerMembre(t, c, true)
	b.recevoir(t, g, trameD(0, 1))
	fichier := filepath.Join(b.cfg.DossierConversations, g.salon.id)
	ctime := func(p string) time.Time {
		var st unix.Stat_t
		if err := unix.Stat(p, &st); err != nil {
			t.Fatal(err)
		}
		return time.Unix(st.Ctim.Unix())
	}
	dernierMessage := ctime(fichier)
	time.Sleep(50 * time.Millisecond)
	passage := time.Now()
	if err := b.m.BrouillerDates(); err != nil {
		t.Fatal(err)
	}
	for _, p := range []string{fichier, b.cfg.DossierConversations, b.cfg.Pieces.Dir} {
		if got := ctime(p); got.Before(passage.Add(-20 * time.Millisecond)) {
			t.Errorf("%s : ctime %v d'avant le passage %v (dernier message : %v)", filepath.Base(p), got, passage, dernierMessage)
		}
	}
	// La passe disque de l'entretien le fait une fois sur passesParBrouillage.
	time.Sleep(50 * time.Millisecond)
	avant := time.Now()
	for range passesParBrouillage {
		b.m.entretienDisque()
	}
	if got := ctime(fichier); got.Before(avant.Add(-20 * time.Millisecond)) {
		t.Error("entretien : dates jamais brouillées")
	}
}
