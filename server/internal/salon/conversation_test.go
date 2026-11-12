package salon

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

// idConv : identifiant interne valide (22 caractères base64url, 16 octets).
const idConv = "AAAAAAAAAAAAAAAAAAAAAA"

// trameTest : trame reconnaissable de 4 140 octets, différente pour chaque i.
func trameTest(i int) []byte {
	t := make([]byte, TailleTrame)
	copy(t, marque)
	for j := 5; j < len(t); j++ {
		t[j] = byte(j*7 + i*13 + j/251)
	}
	return t
}

func nouvelleConv(t *testing.T, dossier, id string) *Conversation {
	t.Helper()
	c, err := OuvrirConversation(dossier, id)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { c.Detruire() })
	return c
}

func ajouter(t *testing.T, c *Conversation, n int) {
	t.Helper()
	for i := range n {
		e, err := c.Ajouter(trameTest(i))
		if err != nil {
			t.Fatal(err)
		}
		if e != uint32(i) {
			t.Fatalf("emplacement %d, attendu %d", e, i)
		}
	}
}

func TestAllerRetour(t *testing.T) {
	dir := t.TempDir()
	c := nouvelleConv(t, dir, idConv)
	ajouter(t, c, 100)
	if c.Taille() != 100*TailleEmplacement {
		t.Fatalf("Taille = %d", c.Taille())
	}
	fi, err := os.Stat(filepath.Join(dir, idConv))
	if err != nil {
		t.Fatal(err)
	}
	if fi.Size() != 100*TailleEmplacement || fi.Mode().Perm() != 0o600 {
		t.Fatalf("fichier : %d octets, mode %v", fi.Size(), fi.Mode().Perm())
	}
	for i := range 100 {
		b, err := c.Lire(uint32(i))
		if err != nil || !bytes.Equal(b, trameTest(i)) {
			t.Fatalf("emplacement %d : %v", i, err)
		}
	}
	if _, err := c.Lire(100); err == nil {
		t.Fatal("emplacement hors du fichier lu")
	}
	if _, err := c.Ajouter(make([]byte, TailleTrame-1)); err == nil {
		t.Fatal("trame de 4 139 octets acceptée")
	}
	if _, err := OuvrirConversation(dir, idConv); err == nil {
		t.Fatal("fichier existant rouvert (O_EXCL attendu)")
	}
}

// fenetres : toutes les fenêtres de 32 octets de b.
func fenetres(b []byte) map[[32]byte]bool {
	m := make(map[[32]byte]bool, len(b))
	for i := 0; i+32 <= len(b); i++ {
		m[[32]byte(b[i:i+32])] = true
	}
	return m
}

// contientUneFenetre : vrai si une fenêtre de 32 octets de trame figure dans brut.
func contientUneFenetre(brut map[[32]byte]bool, trame []byte) bool {
	for i := 0; i+32 <= len(trame); i++ {
		if brut[[32]byte(trame[i:i+32])] {
			return true
		}
	}
	return false
}

// Le fichier ne contient aucune fenêtre de 32 octets d'aucune trame : sans la clé, il ne
// donne rien des trames (même pas l'en-tête et ce qui le suit).
func TestIllisibleSansCle(t *testing.T) {
	dir := t.TempDir()
	c := nouvelleConv(t, dir, idConv)
	ajouter(t, c, 20)
	brut, err := os.ReadFile(filepath.Join(dir, idConv))
	if err != nil {
		t.Fatal(err)
	}
	// Témoin : la recherche trouve une trame écrite en clair, sinon le test ne prouve rien.
	if !contientUneFenetre(fenetres(append(bytes.Clone(brut), trameTest(7)...)), trameTest(7)) {
		t.Fatal("témoin : trame en clair non trouvée")
	}
	f := fenetres(brut)
	for i := range 20 {
		if contientUneFenetre(f, trameTest(i)) {
			t.Fatalf("octets de la trame %d en clair dans le fichier", i)
		}
	}
}

// Une autre Conversation (autre clé) ne lit rien d'une copie du fichier.
func TestAutreCleEchoue(t *testing.T) {
	dir := t.TempDir()
	c := nouvelleConv(t, dir, idConv)
	ajouter(t, c, 5)
	const id2 = "BBBBBBBBBBBBBBBBBBBBBA"
	c2 := nouvelleConv(t, dir, id2)
	ajouter(t, c2, 5)
	brut, err := os.ReadFile(filepath.Join(dir, idConv))
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, id2), brut, 0o600); err != nil {
		t.Fatal(err)
	}
	for i := range 5 {
		if _, err := c2.Lire(uint32(i)); !errors.Is(err, ErrEfface) {
			t.Fatalf("emplacement %d lu avec une autre clé : %v", i, err)
		}
	}
}

// Deux emplacements échangés dans le fichier : le numéro d'emplacement est authentifié.
func TestEmplacementsEchanges(t *testing.T) {
	dir := t.TempDir()
	c := nouvelleConv(t, dir, idConv)
	ajouter(t, c, 3)
	p := filepath.Join(dir, idConv)
	brut, err := os.ReadFile(p)
	if err != nil {
		t.Fatal(err)
	}
	e0 := bytes.Clone(brut[:TailleEmplacement])
	copy(brut[:TailleEmplacement], brut[TailleEmplacement:2*TailleEmplacement])
	copy(brut[TailleEmplacement:2*TailleEmplacement], e0)
	if err := os.WriteFile(p, brut, 0o600); err != nil {
		t.Fatal(err)
	}
	for _, e := range []uint32{0, 1} {
		if _, err := c.Lire(e); !errors.Is(err, ErrEfface) {
			t.Fatalf("emplacement %d échangé accepté : %v", e, err)
		}
	}
	if b, err := c.Lire(2); err != nil || !bytes.Equal(b, trameTest(2)) {
		t.Fatal("emplacement 2 :", err)
	}
}

func TestEffacerZeros(t *testing.T) {
	dir := t.TempDir()
	c := nouvelleConv(t, dir, idConv)
	ajouter(t, c, 6)
	if err := c.Effacer(3); err != nil {
		t.Fatal(err)
	}
	brut, err := os.ReadFile(filepath.Join(dir, idConv))
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(brut[3*TailleEmplacement:4*TailleEmplacement], make([]byte, TailleEmplacement)) {
		t.Fatal("emplacement 3 non nul")
	}
	if len(brut) != 6*TailleEmplacement || c.Taille() != 6*TailleEmplacement {
		t.Fatal("taille changée par Effacer", len(brut), c.Taille())
	}
	if _, err := c.Lire(3); !errors.Is(err, ErrEfface) {
		t.Fatal("emplacement effacé lu :", err)
	}
	for _, i := range []int{0, 1, 2, 4, 5} {
		if b, err := c.Lire(uint32(i)); err != nil || !bytes.Equal(b, trameTest(i)) {
			t.Fatalf("emplacement %d : %v", i, err)
		}
	}
	if err := c.Effacer(3); err != nil {
		t.Fatal("second effacement :", err)
	}
	if err := c.Effacer(6); err == nil {
		t.Fatal("effacement hors du fichier accepté")
	}
	if e, err := c.Ajouter(trameTest(6)); err != nil || e != 6 {
		t.Fatal("ajout après effacement :", e, err)
	}
}

func TestDetruire(t *testing.T) {
	dir := t.TempDir()
	c := nouvelleConv(t, dir, idConv)
	ajouter(t, c, 3)
	if err := c.Detruire(); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(dir, idConv)); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("fichier encore présent :", err)
	}
	if _, err := c.Lire(0); err == nil {
		t.Fatal("lecture après destruction")
	}
	if _, err := c.Ajouter(trameTest(0)); err == nil {
		t.Fatal("ajout après destruction")
	}
	if err := c.Effacer(0); err == nil {
		t.Fatal("effacement après destruction")
	}
	if c.cle != [32]byte{} || c.aead != nil {
		t.Fatal("clé encore en mémoire")
	}
	if c.Taille() != 0 {
		t.Fatal("taille après destruction", c.Taille())
	}
	if err := c.Detruire(); err != nil {
		t.Fatal("seconde destruction :", err)
	}
	if _, err := os.Stat(filepath.Join(dir, idConv)); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("fichier recréé :", err)
	}
}

func TestIDInvalide(t *testing.T) {
	dir := t.TempDir()
	for _, id := range []string{"../x", "AAAAAAAAAAAAAAAAAAAAA", "AAAAAAAAAAAAAAAAAAAAAAA", "AAAAAAAAAAAAAAAAAAAA/A",
		"AAAAAAAAAAAAAAAAAAAA\nA", "AAAAAAAAAAAAAAAAAAAAA=", "AAAAAAAAAAAAAAAAAAAAAB", ""} {
		if c, err := OuvrirConversation(dir, id); err == nil {
			c.Detruire()
			t.Errorf("identifiant %q accepté", id)
		}
	}
	if es, err := os.ReadDir(dir); err != nil || len(es) != 0 {
		t.Fatal("fichier créé :", es, err)
	}
	if _, err := os.Stat(filepath.Join(filepath.Dir(dir), "x")); err == nil {
		t.Fatal("fichier créé hors du dossier")
	}
}

// fichierPanne : fichier d'écriture qui échoue sur demande (écriture partielle, Truncate).
type fichierPanne struct {
	*os.File
	ecriturePartielle bool // WriteAt écrit la moitié puis échoue
	truncateEchoue    bool
}

var errPanneTest = errors.New("/chemin/secret/panne injectée")

func (f *fichierPanne) WriteAt(p []byte, off int64) (int, error) {
	if f.ecriturePartielle {
		n, _ := f.File.WriteAt(p[:len(p)/2], off)
		return n, &os.PathError{Op: "write", Path: "/chemin/secret", Err: errPanneTest}
	}
	return f.File.WriteAt(p, off)
}

func (f *fichierPanne) Truncate(n int64) error {
	if f.truncateEchoue {
		return &os.PathError{Op: "truncate", Path: "/chemin/secret", Err: errPanneTest}
	}
	return f.File.Truncate(n)
}

func avecPanne(t *testing.T, c *Conversation) *fichierPanne {
	t.Helper()
	f := &fichierPanne{File: c.f.(*os.File)}
	c.f = f
	return f
}

// Une écriture partielle est annulée : fichier ramené à sa taille d'avant, numéro rendu à
// l'ajout suivant, erreur sans chemin.
func TestAjouterRetourArriere(t *testing.T) {
	dir := t.TempDir()
	c := nouvelleConv(t, dir, idConv)
	ajouter(t, c, 2)
	f := avecPanne(t, c)
	f.ecriturePartielle = true
	_, err := c.Ajouter(trameTest(2))
	if !errors.Is(err, ErrES) || strings.Contains(err.Error(), "/") {
		t.Fatalf("erreur %v", err)
	}
	fi, err := os.Stat(filepath.Join(dir, idConv))
	if err != nil || fi.Size() != 2*TailleEmplacement || c.Taille() != 2*TailleEmplacement {
		t.Fatal("taille après échec :", fi.Size(), c.Taille(), err)
	}
	f.ecriturePartielle = false
	if e, err := c.Ajouter(trameTest(2)); err != nil || e != 2 {
		t.Fatal("ajout après échec :", e, err)
	}
	for i := range 3 {
		if b, err := c.Lire(uint32(i)); err != nil || !bytes.Equal(b, trameTest(i)) {
			t.Fatalf("emplacement %d : %v", i, err)
		}
	}
}

// Truncate impossible après un échec : conversation inutilisable (erreur fixe), Taille ne
// sous-compte jamais le fichier réel, Detruire marche encore.
func TestTruncateEchoue(t *testing.T) {
	dir := t.TempDir()
	c := nouvelleConv(t, dir, idConv)
	ajouter(t, c, 2)
	f := avecPanne(t, c)
	f.ecriturePartielle, f.truncateEchoue = true, true
	if _, err := c.Ajouter(trameTest(2)); !errors.Is(err, ErrES) {
		t.Fatal(err)
	}
	fi, err := os.Stat(filepath.Join(dir, idConv))
	if err != nil {
		t.Fatal(err)
	}
	if fi.Size() <= 2*TailleEmplacement {
		t.Fatal("témoin : écriture partielle absente", fi.Size())
	}
	if c.Taille() < fi.Size() {
		t.Fatalf("Taille %d < fichier %d", c.Taille(), fi.Size())
	}
	f.ecriturePartielle, f.truncateEchoue = false, false
	if _, err := c.Ajouter(trameTest(2)); !errors.Is(err, ErrInutilisable) {
		t.Fatal("ajout :", err)
	}
	if _, err := c.Lire(0); !errors.Is(err, ErrInutilisable) {
		t.Fatal("lecture :", err)
	}
	if err := c.Effacer(0); !errors.Is(err, ErrInutilisable) {
		t.Fatal("effacement :", err)
	}
	if err := c.Detruire(); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(dir, idConv)); !errors.Is(err, os.ErrNotExist) || c.Taille() != 0 {
		t.Fatal("fichier après destruction :", err, c.Taille())
	}
}

// Erreurs d'E/S sans chemin : lecture d'un fichier tronqué de l'extérieur, suppression
// impossible, ouverture d'un fichier existant.
func TestErreursSansChemin(t *testing.T) {
	dir := t.TempDir()
	c := nouvelleConv(t, dir, idConv)
	ajouter(t, c, 2)
	if err := os.Truncate(filepath.Join(dir, idConv), TailleEmplacement); err != nil {
		t.Fatal(err)
	}
	_, err := c.Lire(1)
	if !errors.Is(err, ErrES) || strings.Contains(err.Error(), dir) {
		t.Fatal("lecture :", err)
	}
	_, err = OuvrirConversation(dir, idConv)
	if !errors.Is(err, ErrES) || !errors.Is(err, os.ErrExist) || strings.Contains(err.Error(), dir) {
		t.Fatal("ouverture :", err)
	}
	_, err = OuvrirConversation(filepath.Join(dir, idConv, "sous"), "BBBBBBBBBBBBBBBBBBBBBA")
	if !errors.Is(err, ErrES) || strings.Contains(err.Error(), dir) {
		t.Fatal("dossier :", err)
	}
}

// Lire en parallèle d'Ajouter, Effacer et Detruire (sous -race) : aucune course, aucune
// trame fausse ; chaque lecture rend la trame, ErrEfface, ErrEmplacement ou ErrDetruite.
func TestLireConcurrent(t *testing.T) {
	dir := t.TempDir()
	c := nouvelleConv(t, dir, idConv)
	ajouter(t, c, 10)
	var wg sync.WaitGroup
	stop := make(chan struct{})
	for g := range 4 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for i := 0; ; i++ {
				select {
				case <-stop:
					return
				default:
				}
				e := uint32((i + g) % 40)
				b, err := c.Lire(e)
				switch {
				case err == nil:
					if !bytes.Equal(b, trameTest(int(e))) {
						t.Errorf("emplacement %d : trame fausse", e)
						return
					}
				case errors.Is(err, ErrEfface), errors.Is(err, ErrEmplacement), errors.Is(err, ErrDetruite):
				default:
					t.Errorf("emplacement %d : %v", e, err)
					return
				}
				_ = c.Taille()
			}
		}()
	}
	wg.Add(2)
	go func() {
		defer wg.Done()
		for i := 10; i < 40; i++ {
			if _, err := c.Ajouter(trameTest(i)); err != nil && !errors.Is(err, ErrDetruite) {
				t.Error(err)
			}
		}
	}()
	go func() {
		defer wg.Done()
		for i := 0; i < 40; i += 3 {
			if err := c.Effacer(uint32(i)); err != nil && !errors.Is(err, ErrEmplacement) && !errors.Is(err, ErrDetruite) {
				t.Error(err)
			}
		}
	}()
	time.Sleep(20 * time.Millisecond)
	if err := c.Detruire(); err != nil {
		t.Fatal(err)
	}
	close(stop)
	wg.Wait()
}
