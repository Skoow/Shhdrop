package salon

import (
	"bytes"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/skoow/shhdrop/server/internal/blob"
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

// Audit adverse du 13 novembre, front serveur, F1 et F2 : une conversation ne prend jamais de
// borne des appels disque pour ses ÉCRITURES (l'appelant, Manager, en tient une place, prise
// hors de tout verrou : redteam_dos_test.go) ; ses LECTURES passent par la borne des lectures
// (lec), sans jamais la dépasser, même lancées par centaines (le rattrapage en lançait une par
// connexion, jusqu'à SHH_WS_MAX fils du système au-dessus de pids_limit).
func TestConversationBorneLesLectures(t *testing.T) {
	dir := t.TempDir()
	c := nouvelleConv(t, dir, idConv)
	c.lec = blob.NewGate(3)
	ajouter(t, c, 50)
	if err := c.EffacerPlusieurs([]uint32{1}); err != nil {
		t.Fatal("EffacerPlusieurs :", err)
	}
	if p := c.lec.Peak(); p != 0 {
		t.Fatalf("écritures passées par la borne des lectures (Peak=%d)", p)
	}
	var wg sync.WaitGroup
	for r := 0; r < 200; r++ {
		wg.Go(func() {
			for k := 0; k < 50; k++ {
				if _, err := c.Lire(uint32(k)); err != nil && !(k == 1 && errors.Is(err, ErrEfface)) {
					t.Error(k, err)
					return
				}
			}
		})
	}
	wg.Wait()
	if p := c.lec.Peak(); p < 1 || p > 3 {
		t.Fatalf("lectures simultanées : plus haut %d, attendu de 1 à 3", p)
	}
	if u := c.lec.InUse(); u != 0 {
		t.Fatalf("places de lecture non rendues : %d", u)
	}
}

// paliers : taille du fichier d'une conversation de n emplacements écrits (croissance par
// paliers de emplacementsParPalier, audit adverse du 13 novembre, stockage F4).
func paliers(n int) int64 {
	return int64((n+emplacementsParPalier-1)/emplacementsParPalier) * TaillePalier
}

// Audit adverse du 13 novembre, stockage F4 : la taille du fichier ne donne plus le nombre de
// trames (paliers remplis d'aléa), et un emplacement effacé ne se reconnaît plus à ses zéros :
// 7 trames et un retrait donnent un fichier d'un palier, sans aucun emplacement nul, ni dans
// les emplacements écrits, ni dans le reste du palier.
func TestFichierSansNombreNiZeros(t *testing.T) {
	dir := t.TempDir()
	c := nouvelleConv(t, dir, idConv)
	ajouter(t, c, 7)
	if err := c.Effacer(1); err != nil {
		t.Fatal(err)
	}
	if err := c.EffacerPlusieurs([]uint32{4}); err != nil {
		t.Fatal(err)
	}
	brut, err := os.ReadFile(filepath.Join(dir, idConv))
	if err != nil {
		t.Fatal(err)
	}
	if len(brut) != TaillePalier || c.Taille() != TaillePalier {
		t.Fatalf("taille %d (Taille %d), attendu un palier de %d", len(brut), c.Taille(), TaillePalier)
	}
	nul := make([]byte, TailleEmplacement)
	for e := 0; e < emplacementsParPalier; e++ {
		if bytes.Equal(brut[e*TailleEmplacement:(e+1)*TailleEmplacement], nul) {
			t.Fatalf("emplacement %d entièrement nul", e)
		}
	}
	for _, e := range []uint32{1, 4} {
		if _, err := c.Lire(e); !errors.Is(err, ErrEfface) {
			t.Fatalf("emplacement %d effacé lu : %v", e, err)
		}
	}
	// Le palier suivant ne commence qu'au 65e emplacement.
	for i := 7; i < emplacementsParPalier; i++ {
		if _, err := c.Ajouter(trameTest(i)); err != nil {
			t.Fatal(err)
		}
	}
	if c.Taille() != TaillePalier {
		t.Fatal("palier dépassé trop tôt :", c.Taille())
	}
	if _, err := c.Ajouter(trameTest(64)); err != nil {
		t.Fatal(err)
	}
	fi, err := os.Stat(filepath.Join(dir, idConv))
	if err != nil || fi.Size() != 2*TaillePalier || c.Taille() != 2*TaillePalier {
		t.Fatal("deuxième palier :", fi, c.Taille(), err)
	}
	if b, err := c.Lire(64); err != nil || !bytes.Equal(b, trameTest(64)) {
		t.Fatal("emplacement 64 :", err)
	}
	if _, err := c.Lire(65); !errors.Is(err, ErrEmplacement) {
		t.Fatal("emplacement jamais écrit lu :", err)
	}
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
	if c.Taille() != paliers(100) {
		t.Fatalf("Taille = %d", c.Taille())
	}
	fi, err := os.Stat(filepath.Join(dir, idConv))
	if err != nil {
		t.Fatal(err)
	}
	if fi.Size() != paliers(100) || fi.Mode().Perm() != 0o600 {
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

func TestEffacerAlea(t *testing.T) {
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
	if bytes.Equal(brut[3*TailleEmplacement:4*TailleEmplacement], make([]byte, TailleEmplacement)) {
		t.Fatal("emplacement 3 nul : un effacement se reconnaîtrait sur le disque")
	}
	if len(brut) != TaillePalier || c.Taille() != TaillePalier {
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

// EffacerPlusieurs : tous les emplacements donnés écrasés (aléa), les autres intacts,
// taille inchangée ; un numéro hors du fichier refuse tout (rien n'est écrit) ; liste vide :
// rien ; conversation détruite : ErrDetruite ; écriture en échec : ErrES.
func TestEffacerPlusieurs(t *testing.T) {
	dir := t.TempDir()
	c := nouvelleConv(t, dir, idConv)
	ajouter(t, c, 6)
	if err := c.EffacerPlusieurs(nil); err != nil {
		t.Fatal("liste vide :", err)
	}
	if err := c.EffacerPlusieurs([]uint32{1, 3, 4, 3}); err != nil {
		t.Fatal(err)
	}
	for i := range 6 {
		b, err := c.Lire(uint32(i))
		if i == 1 || i == 3 || i == 4 {
			if !errors.Is(err, ErrEfface) {
				t.Fatalf("emplacement %d non effacé : %v", i, err)
			}
		} else if err != nil || !bytes.Equal(b, trameTest(i)) {
			t.Fatalf("emplacement %d : %v", i, err)
		}
	}
	if c.Taille() != TaillePalier {
		t.Fatal("taille changée", c.Taille())
	}
	if err := c.EffacerPlusieurs([]uint32{2, 6}); !errors.Is(err, ErrEmplacement) {
		t.Fatal("hors du fichier :", err)
	}
	if b, err := c.Lire(2); err != nil || !bytes.Equal(b, trameTest(2)) {
		t.Fatal("emplacement 2 écrit malgré le refus :", err)
	}
	f := avecPanne(t, c)
	f.ecriturePartielle = true
	if err := c.EffacerPlusieurs([]uint32{0, 2}); !errors.Is(err, ErrES) || strings.Contains(err.Error(), "/") {
		t.Fatal("écriture en échec :", err)
	}
	f.ecriturePartielle = false
	// Relecture Task 11 : une écriture ratée (emplacement 5 seul) n'empêche pas les suivantes,
	// et les dates sont remises à l'epoch malgré l'échec.
	for i := range 3 { // emplacements 6 à 8
		if _, err := c.Ajouter(trameTest(10 + i)); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.Chtimes(c.chemin, time.Now(), time.Now()); err != nil {
		t.Fatal(err)
	}
	f.panneSeule, f.panneDecalage = true, decalage(5)
	if err := c.EffacerPlusieurs([]uint32{2, 5, 7, 8}); !errors.Is(err, ErrES) || strings.Contains(err.Error(), "/") {
		t.Fatal("écriture en échec :", err)
	}
	f.panneSeule = false
	for _, e := range []uint32{2, 7, 8} {
		if _, err := c.Lire(e); !errors.Is(err, ErrEfface) {
			t.Fatalf("emplacement %d non effacé après l'échec d'un autre : %v", e, err)
		}
	}
	if b, err := c.Lire(5); err != nil || !bytes.Equal(b, trameTest(5)) {
		t.Fatal("emplacement 5 :", err)
	}
	if b, err := c.Lire(6); err != nil || !bytes.Equal(b, trameTest(10)) {
		t.Fatal("emplacement 6 :", err)
	}
	if fi, err := os.Stat(c.chemin); err != nil || !fi.ModTime().Equal(time.Unix(0, 0)) {
		t.Fatal("dates après un échec :", fi.ModTime(), err)
	}
	c.Detruire()
	if err := c.EffacerPlusieurs([]uint32{0}); !errors.Is(err, ErrDetruite) {
		t.Fatal("après Detruire :", err)
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
	if c.aead != nil {
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
	ecriturePartielle bool  // WriteAt écrit la moitié puis échoue
	errEcriture       error // code de l'échec (errPanneTest si nil), ex. syscall.ENOSPC
	truncateEchoue    bool
	// panneSeule : seule l'écriture au décalage panneDecalage échoue (sans rien écrire).
	panneSeule    bool
	panneDecalage int64
}

var errPanneTest = errors.New("/chemin/secret/panne injectée")

func (f *fichierPanne) WriteAt(p []byte, off int64) (int, error) {
	if f.ecriturePartielle {
		n, _ := f.File.WriteAt(p[:len(p)/2], off)
		code := f.errEcriture
		if code == nil {
			code = errPanneTest
		}
		return n, &os.PathError{Op: "write", Path: "/chemin/secret", Err: code}
	}
	if f.panneSeule && off == f.panneDecalage {
		return 0, &os.PathError{Op: "write", Path: "/chemin/secret", Err: errPanneTest}
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

// Une écriture partielle est annulée, dans un palier déjà écrit (n = 2 : taille inchangée) comme
// au premier emplacement d'un palier (n = 64 : fichier ramené à sa taille d'avant) : numéro
// rendu à l'ajout suivant, erreur sans chemin.
func TestAjouterRetourArriere(t *testing.T) {
	for _, n := range []int{2, emplacementsParPalier} {
		dir := t.TempDir()
		c := nouvelleConv(t, dir, idConv)
		ajouter(t, c, n)
		f := avecPanne(t, c)
		f.ecriturePartielle = true
		_, err := c.Ajouter(trameTest(n))
		if !errors.Is(err, ErrES) || strings.Contains(err.Error(), "/") {
			t.Fatalf("erreur %v", err)
		}
		fi, err := os.Stat(filepath.Join(dir, idConv))
		if err != nil || fi.Size() != paliers(n) || c.Taille() != paliers(n) {
			t.Fatal("taille après échec :", n, fi.Size(), c.Taille(), err)
		}
		f.ecriturePartielle = false
		if e, err := c.Ajouter(trameTest(n)); err != nil || e != uint32(n) {
			t.Fatal("ajout après échec :", e, err)
		}
		for i := range n + 1 {
			if b, err := c.Lire(uint32(i)); err != nil || !bytes.Equal(b, trameTest(i)) {
				t.Fatalf("emplacement %d : %v", i, err)
			}
		}
	}
}

// Truncate impossible après l'échec de l'écriture d'un nouveau palier : conversation
// inutilisable (erreur fixe), Taille ne sous-compte jamais le fichier réel, Detruire marche
// encore.
func TestTruncateEchoue(t *testing.T) {
	dir := t.TempDir()
	c := nouvelleConv(t, dir, idConv)
	ajouter(t, c, emplacementsParPalier)
	f := avecPanne(t, c)
	f.ecriturePartielle, f.truncateEchoue = true, true
	if _, err := c.Ajouter(trameTest(2)); !errors.Is(err, ErrES) {
		t.Fatal(err)
	}
	fi, err := os.Stat(filepath.Join(dir, idConv))
	if err != nil {
		t.Fatal(err)
	}
	if fi.Size() <= TaillePalier {
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

// Suppression du fichier en échec (relecture Task 12) : la taille n'est pas remise à zéro tant
// que le fichier existe (l'usage n'est jamais sous-compté), ni dans le total du gestionnaire ;
// elle l'est quand une nouvelle destruction réussit.
func TestDetruireEchecGardeTaille(t *testing.T) {
	dir := t.TempDir()
	var total atomic.Int64
	c := nouvelleConv(t, dir, idConv)
	c.compterDans(&total)
	ajouter(t, c, 2)
	p := filepath.Join(dir, idConv)
	// Simulé : à la place du fichier, un dossier non vide que os.Remove ne peut pas supprimer
	// (même en root).
	if err := os.Remove(p); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(p, "x"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := c.Detruire(); !errors.Is(err, ErrES) {
		t.Fatal("suppression impossible :", err)
	}
	if c.Taille() != TaillePalier || total.Load() != TaillePalier {
		t.Fatal("taille remise à zéro avant la suppression :", c.Taille(), total.Load())
	}
	if err := os.RemoveAll(p); err != nil {
		t.Fatal(err)
	}
	if err := c.Detruire(); err != nil {
		t.Fatal(err)
	}
	if c.Taille() != 0 || total.Load() != 0 {
		t.Fatal("taille après suppression :", c.Taille(), total.Load())
	}
}
