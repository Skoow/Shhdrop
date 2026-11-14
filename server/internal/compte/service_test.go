package compte

import (
	"bytes"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/binary"
	"errors"
	"net/netip"
	"os"
	"path/filepath"
	"strconv"
	"sync"
	"testing"
	"time"

	"github.com/skoow/shhdrop/server/internal/courriel"
	"github.com/skoow/shhdrop/server/internal/limits"
)

// Lot 4 du plan du compte : inscription par code e-mail, connexion, sessions, pseudo unique.
// Faux postier (la file d'e-mails), horloge figée, base dans un dossier temporaire (TMPDIR).

type faux struct {
	mu   sync.Mutex
	msgs []courriel.Message
	err  error
}

func (f *faux) Mettre(m courriel.Message) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.err != nil {
		return f.err
	}
	f.msgs = append(f.msgs, m)
	return nil
}

// Plein : la file refuse (err = courriel.ErrPlein).
func (f *faux) Plein() bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	return errors.Is(f.err, courriel.ErrPlein)
}

func (f *faux) n() int { f.mu.Lock(); defer f.mu.Unlock(); return len(f.msgs) }

func (f *faux) dernier(t *testing.T) courriel.Message {
	t.Helper()
	f.mu.Lock()
	defer f.mu.Unlock()
	if len(f.msgs) == 0 {
		t.Fatal("aucun e-mail en file")
	}
	return f.msgs[len(f.msgs)-1]
}

type horloge struct {
	mu sync.Mutex
	t  time.Time
}

func (h *horloge) Now() time.Time      { h.mu.Lock(); defer h.mu.Unlock(); return h.t }
func (h *horloge) Add(d time.Duration) { h.mu.Lock(); h.t = h.t.Add(d); h.mu.Unlock() }

type banc struct {
	s      *Service
	db     *sql.DB
	clk    *horloge
	post   *faux
	lim    *limits.Limiter
	cles   Cles
	chemin string
}

func nouveauBanc(t *testing.T) *banc {
	t.Helper()
	chemin := filepath.Join(t.TempDir(), "comptes.db")
	db, err := OuvrirBase(chemin)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	b := &banc{db: db, clk: &horloge{t: time.Date(2026, 11, 14, 10, 0, 0, 0, time.UTC)}, post: &faux{},
		cles: clesTest(7), chemin: chemin}
	b.lim = limits.New(b.clk.Now)
	b.relancer(t)
	return b
}

// relancer : un nouveau Service sur la même base (redémarrage : la mémoire est perdue).
func (b *banc) relancer(t *testing.T) {
	t.Helper()
	s, err := NewService(Config{DB: b.db, Cles: b.cles, Courriel: b.post, Limites: b.lim, Now: b.clk.Now, Max: 100})
	if err != nil {
		t.Fatal(err)
	}
	b.s = s
}

var ipA = netip.MustParseAddr("2001:db8:a::1")

// ipN : une connexion par /48 distinct (n < 65 536).
func ipN(n int) netip.Addr {
	var a [16]byte
	a[0], a[1], a[2], a[3] = 0x20, 0x01, 0x0d, 0xb8
	binary.BigEndian.PutUint16(a[4:], uint16(n))
	a[15] = 1
	return netip.AddrFrom16(a)
}

// coffreTest : coffre de la forme du serveur (en-tête, gen, nonce, chiffré au palier, étiquette),
// contenu aléatoire (le serveur ne l'ouvre jamais).
func coffreTest(magic string, gen uint64, palier int) []byte {
	b := make([]byte, palier+45)
	rand.Read(b)
	copy(b, magic)
	binary.BigEndian.PutUint64(b[9:], gen)
	return b
}

func alea32() (k [32]byte) { rand.Read(k[:]); return }

func donneesTest(pseudo string) Donnees {
	var d Donnees
	d.AAuth, d.SProfil = alea32(), alea32()
	rand.Read(d.EnvMdp[:])
	d.PCanon = []byte(pseudo)
	d.BlobProfil = coffreTest("SHH-PROF1", 1, 4096)
	d.BlobPrive = coffreTest("SHH-ACCT1", 1, 4096)
	return d
}

// debut : inscription/debut réussie ; rend h, étape et le code reçu.
func (b *banc) debut(t *testing.T, ip netip.Addr, email string) ([16]byte, [32]byte, string) {
	t.Helper()
	h, e, err := b.s.InscriptionDebut(ip, email, "fr")
	if err != nil {
		t.Fatalf("InscriptionDebut(%s) : %v", email, err)
	}
	return h, e, b.post.dernier(t).Code
}

// inscrire : un compte complet, depuis une connexion propre à l'appel.
func (b *banc) inscrire(t *testing.T, ip netip.Addr, email, pseudo string) ([16]byte, [32]byte, Donnees) {
	t.Helper()
	h, e, code := b.debut(t, ip, email)
	d := donneesTest(pseudo)
	j, err := b.s.InscriptionFin(e, code, d, OptionsSession{})
	if err != nil {
		t.Fatalf("InscriptionFin(%s) : %v", email, err)
	}
	return h, j, d
}

func (b *banc) nComptes(t *testing.T) int {
	t.Helper()
	var n int
	if err := b.db.QueryRow(`SELECT count(*) FROM comptes`).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func (b *banc) nSessions(t *testing.T) int {
	t.Helper()
	var n int
	if err := b.db.QueryRow(`SELECT count(*) FROM sessions`).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

// fichiers : base et WAL lus en entier (après un point de reprise passif : rien n'est retenu).
func (b *banc) fichiers(t *testing.T) []byte {
	t.Helper()
	var out []byte
	for _, f := range []string{b.chemin, b.chemin + "-wal"} {
		c, err := os.ReadFile(f)
		if err != nil && !errors.Is(err, os.ErrNotExist) {
			t.Fatal(err)
		}
		out = append(out, c...)
	}
	return out
}

func codeFaux(code string) string {
	n, _ := strconv.Atoi(code)
	return strconv.Itoa(100000 + (n+1)%900000)
}

// Conception §10.1, §21.3 : un code part toujours ; le compte n'existe sur disque qu'après
// le code juste ; une session est ouverte.
func TestInscriptionComplete(t *testing.T) {
	b := nouveauBanc(t)
	h, e, code := b.debut(t, ipA, "  Lea.Dupont@Exemple.FR ")
	m := b.post.dernier(t)
	if m.A != "lea.dupont@exemple.fr" || m.Langue != "fr" || len(code) != 6 {
		t.Fatalf("message %+v", m)
	}
	if h == [16]byte{} || e == [32]byte{} || b.nComptes(t) != 0 {
		t.Fatal("compte créé avant le code")
	}
	d := donneesTest("lea")
	j, err := b.s.InscriptionFin(e, code, d, OptionsSession{})
	if err != nil {
		t.Fatal(err)
	}
	if b.nComptes(t) != 1 || b.nSessions(t) != 1 {
		t.Fatal("compte ou session absents")
	}
	c, err := b.s.Session(j)
	if err != nil || c.H != h || !c.Recente {
		t.Fatalf("session %+v %v", c, err)
	}
	// L'étape a servi : plus rien.
	if _, err := b.s.InscriptionFin(e, code, d, OptionsSession{}); !errors.Is(err, ErrEtape) {
		t.Fatal("étape réutilisée :", err)
	}
	var cree, des, vu, pj int64
	if err := b.db.QueryRow(`SELECT cree_jour, compte_des, vu_mois, pseudo_jour FROM comptes`).Scan(&cree, &des, &vu, &pj); err != nil {
		t.Fatal(err)
	}
	jour := time.Date(2026, 11, 14, 0, 0, 0, 0, time.UTC).Unix()
	if cree != jour || des != jour || pj != jour || vu != time.Date(2026, 11, 1, 0, 0, 0, 0, time.UTC).Unix() {
		t.Fatal("dates", cree, des, vu, pj)
	}
}

// §8.8 : 5 essais par code, puis l'étape meurt (même le bon code ne passe plus).
func TestCodeCinqEssais(t *testing.T) {
	b := nouveauBanc(t)
	_, e, code := b.debut(t, ipA, "lea@exemple.fr")
	for i := 4; i >= 0; i-- {
		_, err := b.s.InscriptionFin(e, codeFaux(code), donneesTest("lea"), OptionsSession{})
		var cf ErrCodeFaux
		if !errors.As(err, &cf) || cf.Restants != i {
			t.Fatalf("essai %d : %v", 5-i, err)
		}
	}
	if _, err := b.s.InscriptionFin(e, code, donneesTest("lea"), OptionsSession{}); !errors.Is(err, ErrEtape) {
		t.Fatal("6e essai :", err)
	}
	// Un code mal formé n'est pas un essai.
	_, e, code = b.debut(t, ipA, "leo@exemple.fr")
	for _, c := range []string{"", "12345", "1234567", "12345a", "١٢٣٤٥٦"} {
		if _, err := b.s.InscriptionFin(e, c, donneesTest("leo"), OptionsSession{}); !errors.Is(err, ErrRequete) {
			t.Fatalf("%q : %v", c, err)
		}
	}
	if _, err := b.s.InscriptionFin(e, code, donneesTest("leo"), OptionsSession{}); err != nil {
		t.Fatal(err)
	}
}

func TestCodeExpire15Min(t *testing.T) {
	b := nouveauBanc(t)
	_, e, code := b.debut(t, ipA, "lea@exemple.fr")
	b.clk.Add(15*time.Minute + time.Second)
	if _, err := b.s.InscriptionFin(e, code, donneesTest("lea"), OptionsSession{}); !errors.Is(err, ErrEtape) {
		t.Fatal(err)
	}
	_, e, code = b.debut(t, ipA, "leo@exemple.fr")
	b.clk.Add(15*time.Minute - time.Second)
	if _, err := b.s.InscriptionFin(e, code, donneesTest("leo"), OptionsSession{}); err != nil {
		t.Fatal(err)
	}
}

// §8.3 : les étapes sont en mémoire seulement.
func TestInscriptionPerdueAuRedemarrage(t *testing.T) {
	b := nouveauBanc(t)
	_, e, code := b.debut(t, ipA, "lea@exemple.fr")
	b.relancer(t)
	if _, err := b.s.InscriptionFin(e, code, donneesTest("lea"), OptionsSession{}); !errors.Is(err, ErrEtape) {
		t.Fatal(err)
	}
	if b.nComptes(t) != 0 {
		t.Fatal("ligne créée")
	}
}

// §5.3 : domaine de la liste et ses sous-domaines refusés, avant tout envoi.
func TestJetableRefuse(t *testing.T) {
	b := nouveauBanc(t)
	for _, a := range []string{"x@0-mail.com", "x@MAIL.0-mail.com", "x+y@a.b.0-mail.com"} {
		if _, _, err := b.s.InscriptionDebut(ipA, a, "fr"); !errors.Is(err, ErrJetable) {
			t.Fatalf("%s : %v", a, err)
		}
	}
	if b.post.n() != 0 {
		t.Fatal("e-mail envoyé")
	}
	for _, a := range []string{"x@0-mail.co", "x@exemple.fr", "x@mail-0-mail.com"} {
		if _, _, err := b.s.InscriptionDebut(ipN(len(a)), a, "fr"); err != nil {
			t.Fatalf("%s : %v", a, err)
		}
	}
	for _, a := range []string{"", "pas-une-adresse", "léa@exemple.fr", "a@b"} {
		if _, _, err := b.s.InscriptionDebut(ipA, a, "fr"); !errors.Is(err, ErrAdresse) {
			t.Fatalf("%q : %v", a, err)
		}
	}
	if _, _, err := b.s.InscriptionDebut(ipA, "x@exemple.fr", "de"); !errors.Is(err, ErrRequete) {
		t.Fatal("langue", err)
	}
}

// Deux inscriptions de la même adresse (variantes) confirmées : une seule ligne ; l'autre
// apprend, après son code juste, que l'adresse a déjà un compte.
func TestCourseDeuxInscriptionsMemeAdresse(t *testing.T) {
	b := nouveauBanc(t)
	_, e1, c1 := b.debut(t, ipN(1), "lea.dupont@gmail.com")
	_, e2, c2 := b.debut(t, ipN(2), "Lea.Dupont+x@GMAIL.com")
	var wg sync.WaitGroup
	errs := make([]error, 2)
	for i, x := range []struct {
		e [32]byte
		c string
	}{{e1, c1}, {e2, c2}} {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, errs[i] = b.s.InscriptionFin(x.e, x.c, donneesTest("p"+strconv.Itoa(i)), OptionsSession{})
		}()
	}
	wg.Wait()
	ok, deja := 0, 0
	for _, err := range errs {
		switch {
		case err == nil:
			ok++
		case errors.Is(err, ErrDejaInscrit):
			deja++
		default:
			t.Fatal(err)
		}
	}
	if ok != 1 || deja != 1 || b.nComptes(t) != 1 {
		t.Fatal(ok, deja, b.nComptes(t))
	}
}

// §21.3 (décision 2) : pour une adresse libre, prise ou bannie, inscription/debut répond et
// écrit de la même façon (un vrai code, le même modèle) ; l'état n'est dit qu'après le code
// juste ; aucune ligne créée ; un code faux répond code_faux dans les trois cas.
func TestInscriptionEtatSeulementApresCode(t *testing.T) {
	b := nouveauBanc(t)
	b.inscrire(t, ipN(1), "prise@exemple.fr", "prise")
	canon, _ := b.cles.Empreintes(Adresse{Canon: "bannie@exemple.fr", Exacte: "bannie@exemple.fr"})
	jusqu := time.Date(2029, 11, 14, 0, 0, 0, 0, time.UTC).Unix()
	if _, err := b.db.Exec(`INSERT INTO bannis VALUES(?,?,?,?,1,6,0)`, []byte("B1234567"), canon[:],
		time.Date(2026, 11, 14, 0, 0, 0, 0, time.UTC).Unix(), jusqu); err != nil {
		t.Fatal(err)
	}
	n0 := b.nComptes(t)
	type cas struct {
		email string
		e     [32]byte
		code  string
		msg   courriel.Message
	}
	var tous []cas
	for i, a := range []string{"libre@exemple.fr", "prise@exemple.fr", "bannie@exemple.fr"} {
		_, e, code := b.debut(t, ipN(10+i), a)
		tous = append(tous, cas{a, e, code, b.post.dernier(t)})
	}
	for _, c := range tous {
		if c.msg.A != c.email || c.msg.Langue != "fr" || len(c.msg.Code) != 6 {
			t.Fatalf("%s : %+v", c.email, c.msg)
		}
		_, err := b.s.InscriptionFin(c.e, codeFaux(c.code), donneesTest("x"+c.email[:4]), OptionsSession{})
		var cf ErrCodeFaux
		if !errors.As(err, &cf) || cf.Restants != 4 {
			t.Fatalf("%s : code faux → %v", c.email, err)
		}
	}
	if _, err := b.s.InscriptionFin(tous[1].e, tous[1].code, donneesTest("autre"), OptionsSession{}); !errors.Is(err, ErrDejaInscrit) {
		t.Fatal("prise :", err)
	}
	_, err := b.s.InscriptionFin(tous[2].e, tous[2].code, donneesTest("autre2"), OptionsSession{})
	var bn ErrBanni
	if !errors.As(err, &bn) || bn.Jusqu != "2029-11-14" {
		t.Fatal("bannie :", err)
	}
	if b.nComptes(t) != n0 {
		t.Fatal("ligne créée")
	}
	// Bannissement suspendu ou échu : l'adresse peut recréer un compte.
	if _, err := b.db.Exec(`UPDATE bannis SET actif=0`); err != nil {
		t.Fatal(err)
	}
	b.inscrire(t, ipN(20), "bannie@exemple.fr", "revenue")
	if _, err := b.s.InscriptionFin(tous[0].e, tous[0].code, donneesTest("libre"), OptionsSession{}); err != nil {
		t.Fatal("libre :", err)
	}
}

// Renvoi : 60 s après le précédent envoi, à la même adresse exacte, nouveau code ; l'ancien
// ne vaut plus. Adresse différente : étape inconnue. 3 e-mails par jour et par adresse.
func TestRenvoyer60s(t *testing.T) {
	b := nouveauBanc(t)
	_, e, ancien := b.debut(t, ipA, "lea@exemple.fr")
	var lim ErrLimit
	if err := b.s.Renvoyer(ipA, e, "lea@exemple.fr"); !errors.As(err, &lim) || lim.Retry != 60*time.Second {
		t.Fatal("renvoi immédiat :", err)
	}
	b.clk.Add(30 * time.Second)
	if err := b.s.Renvoyer(ipA, e, "lea@exemple.fr"); !errors.As(err, &lim) || lim.Retry != 30*time.Second {
		t.Fatal("renvoi à 30 s :", err)
	}
	b.clk.Add(30 * time.Second)
	if err := b.s.Renvoyer(ipA, e, "lea+x@exemple.fr"); !errors.Is(err, ErrEtape) {
		t.Fatal("autre adresse :", err)
	}
	if err := b.s.Renvoyer(ipA, e, "LEA@exemple.fr"); err != nil {
		t.Fatal(err)
	}
	nouveau := b.post.dernier(t).Code
	if b.post.n() != 2 {
		t.Fatal("e-mails", b.post.n())
	}
	b.clk.Add(time.Minute)
	if err := b.s.Renvoyer(ipA, e, "lea@exemple.fr"); err != nil {
		t.Fatal(err)
	}
	b.clk.Add(time.Minute)
	if err := b.s.Renvoyer(ipA, e, "lea@exemple.fr"); !errors.As(err, &lim) {
		t.Fatal("4e e-mail du jour :", err)
	}
	dernier := b.post.dernier(t).Code
	_ = nouveau
	var cf ErrCodeFaux
	if ancien != dernier { // tirages indépendants : égaux une fois sur un million
		if _, err := b.s.InscriptionFin(e, ancien, donneesTest("lea"), OptionsSession{}); !errors.As(err, &cf) {
			t.Fatal("ancien code :", err)
		}
	}
	if _, err := b.s.InscriptionFin(e, dernier, donneesTest("lea"), OptionsSession{}); err != nil {
		t.Fatal(err)
	}
}

// File d'e-mails pleine : busy, aucune étape gardée.
func TestFilePleineBusy(t *testing.T) {
	b := nouveauBanc(t)
	b.post.err = courriel.ErrPlein
	if _, _, err := b.s.InscriptionDebut(ipA, "lea@exemple.fr", "fr"); !errors.Is(err, ErrBusy) {
		t.Fatal(err)
	}
}

// SHH_COMPTES_MAX atteint : busy, à debut comme à fin.
func TestComptesMax(t *testing.T) {
	b := nouveauBanc(t)
	s, err := NewService(Config{DB: b.db, Cles: b.cles, Courriel: b.post, Limites: b.lim, Now: b.clk.Now, Max: 1})
	if err != nil {
		t.Fatal(err)
	}
	b.s = s
	_, e2, c2 := b.debut(t, ipN(2), "b@exemple.fr")
	b.inscrire(t, ipN(1), "a@exemple.fr", "a")
	if _, _, err := b.s.InscriptionDebut(ipN(3), "c@exemple.fr", "fr"); !errors.Is(err, ErrBusy) {
		t.Fatal(err)
	}
	if _, err := b.s.InscriptionFin(e2, c2, donneesTest("b"), OptionsSession{}); !errors.Is(err, ErrBusy) {
		t.Fatal(err)
	}
}

// Données d'inscription vérifiées : coffres au palier exact, en-tête et gen 1 ; étiquette de 64
// octets ou rien.
func TestDonneesVerifiees(t *testing.T) {
	b := nouveauBanc(t)
	_, e, code := b.debut(t, ipA, "lea@exemple.fr")
	mauvais := []func(*Donnees, *OptionsSession){
		func(d *Donnees, _ *OptionsSession) { d.BlobProfil = d.BlobProfil[:len(d.BlobProfil)-1] },
		func(d *Donnees, _ *OptionsSession) { d.BlobPrive = coffreTest("SHH-PROF1", 1, 4096) },
		func(d *Donnees, _ *OptionsSession) { d.BlobProfil = coffreTest("SHH-PROF1", 2, 4096) },
		func(d *Donnees, _ *OptionsSession) { d.BlobPrive = coffreTest("SHH-ACCT1", 0, 4096) },
		func(d *Donnees, _ *OptionsSession) { d.BlobPrive = coffreTest("SHH-ACCT1", 1, 8192) },
		func(d *Donnees, _ *OptionsSession) { d.PCanon = nil },
		func(_ *Donnees, s *OptionsSession) { s.Etiquette = make([]byte, 63) },
	}
	for i, f := range mauvais {
		d, s := donneesTest("lea"), OptionsSession{}
		f(&d, &s)
		if _, err := b.s.InscriptionFin(e, code, d, s); !errors.Is(err, ErrRequete) {
			t.Fatalf("cas %d : %v", i, err)
		}
	}
	d := donneesTest("lea")
	d.BlobProfil = coffreTest("SHH-PROF1", 1, 262144)
	if _, err := b.s.InscriptionFin(e, code, d, OptionsSession{Etiquette: make([]byte, 64), Persistante: true}); err != nil {
		t.Fatal(err)
	}
}

// Conception §5.1, revue point 6 : une variante de l'adresse (casse, points, « + ») ouvre le
// même compte.
func TestConnexionVarianteCanonique(t *testing.T) {
	b := nouveauBanc(t)
	h, _, d := b.inscrire(t, ipA, "lea.dupont@gmail.com", "lea")
	o, err := b.s.Connexion(ipA, "Lea.Dupont+x@GMAIL.com", d.AAuth, OptionsSession{}, false)
	if err != nil || o.H != h || o.Etape != nil || o.EnvMdp != d.EnvMdp || o.SProfil != d.SProfil ||
		!bytes.Equal(o.BlobProfil, d.BlobProfil) || !bytes.Equal(o.BlobPrive, d.BlobPrive) || o.GenProfil != 1 || o.GenPrive != 1 {
		t.Fatalf("%+v %v", o.H, err)
	}
	if _, err := b.s.Session(o.Jeton); err != nil {
		t.Fatal(err)
	}
	if _, err := b.s.Connexion(ipA, "leadupont@googlemail.com", d.AAuth, OptionsSession{}, false); err != nil {
		t.Fatal(err)
	}
}

// §8.7 : adresse inconnue, mot de passe faux et compte banni avec un mauvais mot de passe :
// même erreur, après le même calcul (un HMAC de v_mdp, sur une valeur factice si l'adresse est
// inconnue). Un compte banni se connecte encore avec le bon mot de passe (§13 : export,
// suppression).
func TestConnexionInconnueEtFausseIdentiques(t *testing.T) {
	b := nouveauBanc(t)
	_, _, d := b.inscrire(t, ipN(1), "lea@exemple.fr", "lea")
	_, _, db := b.inscrire(t, ipN(2), "banni@exemple.fr", "banni")
	if _, err := b.db.Exec(`UPDATE comptes SET banni=1 WHERE p_empreinte=?`, mustPseudo(t, b.cles, "banni")); err != nil {
		t.Fatal(err)
	}
	n := 0
	orig := hmacMdp
	hmacMdp = func(cle *[32]byte, h *[16]byte, a *[32]byte) [32]byte { n++; return orig(cle, h, a) }
	t.Cleanup(func() { hmacMdp = orig })
	var msgs []string
	for i, x := range []struct {
		email string
		a     [32]byte
	}{{"inconnue@exemple.fr", d.AAuth}, {"lea@exemple.fr", alea32()}, {"banni@exemple.fr", alea32()}} {
		n = 0
		o, err := b.s.Connexion(ipN(10+i), x.email, x.a, OptionsSession{}, false)
		if !errors.Is(err, ErrIdentifiants) || o.Jeton != [32]byte{} {
			t.Fatalf("%s : %v", x.email, err)
		}
		if n != 1 {
			t.Fatalf("%s : %d calculs de v_mdp", x.email, n)
		}
		msgs = append(msgs, err.Error())
	}
	if msgs[0] != msgs[1] || msgs[1] != msgs[2] {
		t.Fatal(msgs)
	}
	if _, err := b.s.Connexion(ipN(20), "banni@exemple.fr", db.AAuth, OptionsSession{}, false); err != nil {
		t.Fatal("banni, bon mot de passe :", err)
	}
}

func mustPseudo(t *testing.T, c Cles, p string) []byte {
	t.Helper()
	e, err := c.EmpreintePseudo([]byte(p))
	if err != nil {
		t.Fatal(err)
	}
	return e[:]
}

// §8.8 : au-delà de 5 échecs dans l'heure sur un compte (existant ou non), la connexion exige
// une preuve ALTCHA, même avec le bon mot de passe ; jamais de verrouillage.
func TestPreuveApresCinqEchecs(t *testing.T) {
	b := nouveauBanc(t)
	_, _, d := b.inscrire(t, ipN(1), "lea@exemple.fr", "lea")
	for i := 0; i < 5; i++ {
		if _, err := b.s.Connexion(ipN(100+i), "lea@exemple.fr", alea32(), OptionsSession{}, false); !errors.Is(err, ErrIdentifiants) {
			t.Fatal(i, err)
		}
		if _, err := b.s.Connexion(ipN(200+i), "personne@exemple.fr", alea32(), OptionsSession{}, false); !errors.Is(err, ErrIdentifiants) {
			t.Fatal(i, err)
		}
	}
	for _, a := range []string{"lea@exemple.fr", "LEA+z@exemple.fr", "personne@exemple.fr"} {
		if _, err := b.s.Connexion(ipN(300), a, d.AAuth, OptionsSession{}, false); !errors.Is(err, ErrPreuveRequise) {
			t.Fatal(a, err)
		}
	}
	if _, err := b.s.Connexion(ipN(300), "lea@exemple.fr", d.AAuth, OptionsSession{}, true); err != nil {
		t.Fatal("avec preuve :", err)
	}
	b.clk.Add(time.Hour)
	if _, err := b.s.Connexion(ipN(301), "lea@exemple.fr", d.AAuth, OptionsSession{}, false); err != nil {
		t.Fatal("heure suivante :", err)
	}
}

// Cent échecs venus d'ailleurs n'empêchent pas le titulaire d'entrer (avec preuve).
func TestPasDeVerrouillage(t *testing.T) {
	b := nouveauBanc(t)
	_, _, d := b.inscrire(t, ipN(1), "lea@exemple.fr", "lea")
	for i := 0; i < 100; i++ {
		b.s.Connexion(ipN(1000+i), "lea@exemple.fr", alea32(), OptionsSession{}, true)
	}
	if _, err := b.s.Connexion(ipN(1), "lea@exemple.fr", d.AAuth, OptionsSession{}, true); err != nil {
		t.Fatal(err)
	}
}

// §8.8 : 20 échecs par heure par connexion, 60 par /48 (adresses quelconques), puis limit.
func TestLimiteEchecsParConnexion(t *testing.T) {
	b := nouveauBanc(t)
	_, _, d := b.inscrire(t, ipN(1), "lea@exemple.fr", "lea")
	ip := netip.MustParseAddr("2001:db8:5:1::1")
	for i := 0; i < 20; i++ {
		if _, err := b.s.Connexion(ip, "x"+strconv.Itoa(i)+"@exemple.fr", alea32(), OptionsSession{}, true); !errors.Is(err, ErrIdentifiants) {
			t.Fatal(i, err)
		}
	}
	var lim ErrLimit
	if _, err := b.s.Connexion(ip, "lea@exemple.fr", d.AAuth, OptionsSession{}, true); !errors.As(err, &lim) || lim.Retry <= 0 {
		t.Fatal(err)
	}
	for i := 2; i <= 3; i++ { // le même /48, d'autres /64 : 60 au total
		ip := netip.MustParseAddr("2001:db8:5:" + strconv.Itoa(i) + "::1")
		for j := 0; j < 20; j++ {
			b.s.Connexion(ip, "y"+strconv.Itoa(j)+"@exemple.fr", alea32(), OptionsSession{}, true)
		}
	}
	if _, err := b.s.Connexion(netip.MustParseAddr("2001:db8:5:9::1"), "lea@exemple.fr", d.AAuth, OptionsSession{}, true); !errors.As(err, &lim) {
		t.Fatal("/48 :", err)
	}
	if _, err := b.s.Connexion(ipN(9), "lea@exemple.fr", d.AAuth, OptionsSession{}, true); err != nil {
		t.Fatal("autre /48 :", err)
	}
}

// Double authentification active : la connexion rend une étape, aucune session n'est créée
// avant le code de l'application (lot 5).
func TestSessionApresTOTPSeulement(t *testing.T) {
	b := nouveauBanc(t)
	_, _, d := b.inscrire(t, ipA, "lea@exemple.fr", "lea")
	if _, err := b.db.Exec(`UPDATE comptes SET totp=?`, make([]byte, 48)); err != nil {
		t.Fatal(err)
	}
	n := b.nSessions(t)
	o, err := b.s.Connexion(ipA, "lea@exemple.fr", d.AAuth, OptionsSession{}, false)
	if err != nil || o.Etape == nil || *o.Etape == [32]byte{} || o.Jeton != [32]byte{} || o.SProfil != [32]byte{} ||
		o.BlobPrive != nil || o.BlobProfil != nil || o.EnvMdp != [60]byte{} {
		t.Fatalf("%+v %v", o.Etape, err)
	}
	if b.nSessions(t) != n {
		t.Fatal("session créée avant la double authentification")
	}
	if _, err := b.s.Connexion(ipA, "lea@exemple.fr", alea32(), OptionsSession{}, false); !errors.Is(err, ErrIdentifiants) {
		t.Fatal(err)
	}
}

// §8.5 : session simple : 2 h sans usage, et au plus jusqu'à la fin du jour UTC suivant.
func TestSessionSimpleExpire(t *testing.T) {
	b := nouveauBanc(t)
	_, j, _ := b.inscrire(t, ipA, "lea@exemple.fr", "lea")
	b.clk.Add(2*time.Hour - time.Second)
	if _, err := b.s.Session(j); err != nil {
		t.Fatal(err)
	}
	b.clk.Add(2*time.Hour + time.Second)
	if _, err := b.s.Session(j); !errors.Is(err, ErrSession) {
		t.Fatal("2 h sans usage :", err)
	}
	if b.nSessions(t) != 0 {
		t.Fatal("session échue gardée")
	}
	// Utilisée chaque heure : valable jusqu'au 16 novembre à 0 h (fin du 15), pas au-delà.
	_, j, _ = b.inscrire(t, ipN(2), "leo@exemple.fr", "leo")
	fin := time.Date(2026, 11, 16, 0, 0, 0, 0, time.UTC)
	for b.clk.Now().Add(time.Hour).Before(fin) {
		b.clk.Add(time.Hour)
		if _, err := b.s.Session(j); err != nil {
			t.Fatal(b.clk.Now(), err)
		}
	}
	b.clk.Add(fin.Sub(b.clk.Now()))
	if _, err := b.s.Session(j); !errors.Is(err, ErrSession) {
		t.Fatal("fin du jour suivant :", err)
	}
	// Un redémarrage remet l'inactivité à zéro sans prolonger le plafond.
	_, j, _ = b.inscrire(t, ipN(3), "lia@exemple.fr", "lia")
	b.clk.Add(time.Hour + 50*time.Minute)
	b.relancer(t)
	b.clk.Add(time.Hour + 50*time.Minute)
	if _, err := b.s.Session(j); err != nil {
		t.Fatal("après redémarrage :", err)
	}
}

// « Rester connecté » : 30 jours sans usage, 90 jours au plus (depuis le mois d'ajout, seule
// date gardée : plafond entre 59 et 90 jours selon le jour du mois).
func TestSessionPersistante30Et90Jours(t *testing.T) {
	b := nouveauBanc(t)
	_, _, d := b.inscrire(t, ipA, "lea@exemple.fr", "lea")
	ouvrir := func() [32]byte {
		o, err := b.s.Connexion(ipA, "lea@exemple.fr", d.AAuth, OptionsSession{Persistante: true}, false)
		if err != nil {
			t.Fatal(err)
		}
		return o.Jeton
	}
	j := ouvrir()
	b.clk.Add(29 * 24 * time.Hour)
	b.relancer(t)
	if _, err := b.s.Session(j); err != nil {
		t.Fatal("29 jours :", err)
	}
	b.clk.Add(30*24*time.Hour + time.Second)
	if _, err := b.s.Session(j); !errors.Is(err, ErrSession) {
		t.Fatal("30 jours sans usage :", err)
	}
	// Utilisée chaque semaine : valable jusqu'au 1er novembre + 90 jours (30 janvier).
	b.clk = &horloge{t: time.Date(2026, 11, 14, 10, 0, 0, 0, time.UTC)}
	b.lim = limits.New(b.clk.Now)
	b.relancer(t)
	j = ouvrir()
	plafond := time.Date(2026, 11, 1, 0, 0, 0, 0, time.UTC).Add(90 * 24 * time.Hour)
	for b.clk.Now().Add(7 * 24 * time.Hour).Before(plafond) {
		b.clk.Add(7 * 24 * time.Hour)
		if _, err := b.s.Session(j); err != nil {
			t.Fatal(b.clk.Now(), err)
		}
	}
	b.clk.Add(plafond.Sub(b.clk.Now()))
	if _, err := b.s.Session(j); !errors.Is(err, ErrSession) {
		t.Fatal("plafond :", err)
	}
}

// §8.5 : session récente pendant 5 min après la connexion ou un reauth juste.
func TestSessionRecente5Min(t *testing.T) {
	b := nouveauBanc(t)
	_, j, d := b.inscrire(t, ipA, "lea@exemple.fr", "lea")
	b.clk.Add(5*time.Minute - time.Second)
	c, err := b.s.Session(j)
	if err != nil || !c.Recente {
		t.Fatal(c, err)
	}
	b.clk.Add(2 * time.Second)
	if c, err = b.s.Session(j); err != nil || c.Recente {
		t.Fatal(c, err)
	}
	if err := b.s.Reauth(ipA, c, alea32(), ""); !errors.Is(err, ErrIdentifiants) {
		t.Fatal(err)
	}
	if c, _ = b.s.Session(j); c.Recente {
		t.Fatal("reauth faux : session récente")
	}
	if err := b.s.Reauth(ipA, c, d.AAuth, ""); err != nil {
		t.Fatal(err)
	}
	if c, _ = b.s.Session(j); !c.Recente {
		t.Fatal("reauth juste : pas récente")
	}
}

// §8.2 : la base ne garde que SHA-256 du jeton ; jamais le jeton, ni A_auth, ni s_profil.
func TestJetonJamaisEnClair(t *testing.T) {
	b := nouveauBanc(t)
	_, j, d := b.inscrire(t, ipA, "lea@exemple.fr", "lea")
	var tv []byte
	if err := b.db.QueryRow(`SELECT t_v FROM sessions`).Scan(&tv); err != nil {
		t.Fatal(err)
	}
	if want := sha256.Sum256(j[:]); !bytes.Equal(tv, want[:]) {
		t.Fatal("t_v ≠ SHA-256(jeton)")
	}
	f := b.fichiers(t)
	for nom, v := range map[string][]byte{"jeton": j[:], "a_auth": d.AAuth[:], "s_profil": d.SProfil[:],
		"adresse": []byte("lea@exemple.fr"), "pseudo": []byte("lea\x00")} {
		if bytes.Contains(f, v) {
			t.Errorf("%s en clair dans comptes.db", nom)
		}
	}
	if _, err := b.s.Session([32]byte{}); !errors.Is(err, ErrSession) {
		t.Fatal(err)
	}
}

// §8.8 : 20 sessions par compte au plus : la plus ancienne est fermée.
func TestVingtSessionsAuPlus(t *testing.T) {
	b := nouveauBanc(t)
	_, premier, d := b.inscrire(t, ipA, "lea@exemple.fr", "lea")
	var dernier [32]byte
	for i := 0; i < 20; i++ {
		b.clk.Add(time.Second)
		o, err := b.s.Connexion(ipA, "lea@exemple.fr", d.AAuth, OptionsSession{}, false)
		if err != nil {
			t.Fatal(err)
		}
		dernier = o.Jeton
	}
	if b.nSessions(t) != 20 {
		t.Fatal(b.nSessions(t))
	}
	if _, err := b.s.Session(dernier); err != nil {
		t.Fatal(err)
	}
	if _, err := b.s.Session(premier); !errors.Is(err, ErrSession) {
		t.Fatal("la plus ancienne reste :", err)
	}
}

// Liste des appareils, fermeture d'une session, de toutes les autres, déconnexion.
func TestFermerAutres(t *testing.T) {
	b := nouveauBanc(t)
	_, j1, d := b.inscrire(t, ipA, "lea@exemple.fr", "lea")
	etiq := bytes.Repeat([]byte{7}, 64)
	o2, _ := b.s.Connexion(ipA, "lea@exemple.fr", d.AAuth, OptionsSession{Persistante: true, Etiquette: etiq}, false)
	o3, _ := b.s.Connexion(ipA, "lea@exemple.fr", d.AAuth, OptionsSession{}, false)
	_, autre, _ := b.inscrire(t, ipN(5), "leo@exemple.fr", "leo")
	c2, err := b.s.Session(o2.Jeton)
	if err != nil {
		t.Fatal(err)
	}
	vs, err := b.s.Sessions(c2)
	if err != nil || len(vs) != 3 {
		t.Fatal(vs, err)
	}
	courantes := 0
	for _, v := range vs {
		if v.Ajoutee != "2026-11" {
			t.Fatal(v.Ajoutee)
		}
		if v.Courante {
			courantes++
			if v.Sid != c2.Sid || !v.Persistante || !bytes.Equal(v.Etiquette, etiq) {
				t.Fatalf("%+v", v)
			}
		}
	}
	if courantes != 1 {
		t.Fatal(courantes)
	}
	c3, _ := b.s.Session(o3.Jeton)
	if err := b.s.FermerSession(c2, c3.Sid); err != nil {
		t.Fatal(err)
	}
	if _, err := b.s.Session(o3.Jeton); !errors.Is(err, ErrSession) {
		t.Fatal(err)
	}
	// Le sid d'une session d'un autre compte : rien n'est fermé.
	ca, _ := b.s.Session(autre)
	if err := b.s.FermerSession(c2, ca.Sid); !errors.Is(err, ErrEtape) {
		t.Fatal(err)
	}
	if err := b.s.FermerAutres(c2); err != nil {
		t.Fatal(err)
	}
	if _, err := b.s.Session(j1); !errors.Is(err, ErrSession) {
		t.Fatal(err)
	}
	if _, err := b.s.Session(o2.Jeton); err != nil {
		t.Fatal(err)
	}
	if _, err := b.s.Session(autre); err != nil {
		t.Fatal("autre compte touché :", err)
	}
	if err := b.s.Deconnexion(c2); err != nil {
		t.Fatal(err)
	}
	if _, err := b.s.Session(o2.Jeton); !errors.Is(err, ErrSession) {
		t.Fatal(err)
	}
}

// §8.2 : toutes les dates de comptes.db au jour ou au premier du mois, jamais d'heure.
func TestDatesDeLaBase(t *testing.T) {
	b := nouveauBanc(t)
	b.clk.Add(13*time.Hour + 17*time.Minute + 3*time.Second)
	_, _, d := b.inscrire(t, ipA, "lea@exemple.fr", "lea")
	b.clk.Add(40 * 24 * time.Hour)
	b.s.Connexion(ipA, "lea@exemple.fr", d.AAuth, OptionsSession{Persistante: true}, false)
	jours := map[string]string{"comptes": "cree_jour, compte_des, pseudo_jour", "sessions": "expire_jour"}
	for table, cols := range jours {
		rows, err := b.db.Query(`SELECT ` + cols + ` FROM ` + table)
		if err != nil {
			t.Fatal(err)
		}
		for rows.Next() {
			v := make([]int64, 3)
			ptr := []any{&v[0], &v[1], &v[2]}
			if table == "sessions" {
				ptr = ptr[:1]
			}
			rows.Scan(ptr...)
			for _, x := range v {
				if x%86400 != 0 {
					t.Fatal(table, x)
				}
			}
		}
		rows.Close()
	}
	var vu, cree []int64
	rows, _ := b.db.Query(`SELECT vu_mois FROM comptes`)
	for rows.Next() {
		var x int64
		rows.Scan(&x)
		vu = append(vu, x)
	}
	rows.Close()
	rows, _ = b.db.Query(`SELECT cree_mois FROM sessions`)
	for rows.Next() {
		var x int64
		rows.Scan(&x)
		cree = append(cree, x)
	}
	rows.Close()
	dec := time.Date(2026, 12, 1, 0, 0, 0, 0, time.UTC).Unix()
	if len(vu) != 1 || vu[0] != dec {
		t.Fatal("vu_mois", vu)
	}
	for _, x := range append(cree, vu...) {
		if tm := time.Unix(x, 0).UTC(); tm.Day() != 1 || tm.Hour() != 0 || tm.Minute() != 0 || tm.Second() != 0 {
			t.Fatal(tm)
		}
	}
}

// §21.5 : pseudo unique parmi les comptes ; refus à inscription/fin, l'étape reste valable.
func TestPseudoUnique(t *testing.T) {
	b := nouveauBanc(t)
	b.inscrire(t, ipN(1), "lea@exemple.fr", "lea")
	_, e, code := b.debut(t, ipN(2), "leo@exemple.fr")
	if _, err := b.s.InscriptionFin(e, code, donneesTest("lea"), OptionsSession{}); !errors.Is(err, ErrPseudoPris) {
		t.Fatal(err)
	}
	if b.nComptes(t) != 1 {
		t.Fatal("ligne créée")
	}
	if _, err := b.s.InscriptionFin(e, code, donneesTest("leo"), OptionsSession{}); err != nil {
		t.Fatal("même étape, autre pseudo :", err)
	}
}

// §21.5 et demande du propriétaire (14 novembre) : réservés et interdits refusés partout,
// avec la réponse d'un pseudo pris (rien ne dit qu'un mot est interdit plutôt que pris).
func TestPseudoReserveRefuse(t *testing.T) {
	b := nouveauBanc(t)
	b.inscrire(t, ipN(1), "lea@exemple.fr", "lea")
	_, e, code := b.debut(t, ipN(2), "leo@exemple.fr")
	for _, p := range []string{"adrnin", "shhgone", "leshhgoneofficiel", "police", "connard", "xxconnardxx", "fuck"} {
		if _, err := b.s.InscriptionFin(e, code, donneesTest(p), OptionsSession{}); !errors.Is(err, ErrPseudoPris) {
			t.Fatalf("%s : %v", p, err)
		}
		libre, err := b.s.PseudoVerifierEtape(e, []byte(p))
		if err != nil || libre {
			t.Fatalf("%s : verifier %v %v", p, libre, err)
		}
	}
	if _, err := b.s.InscriptionFin(e, code, donneesTest("leo"), OptionsSession{}); err != nil {
		t.Fatal(err)
	}
}

// §21.5 : changement une fois par jour UTC (le jour de l'inscription compte) ; l'ancien
// pseudo est libéré aussitôt.
func TestPseudoUneFoisPar24h(t *testing.T) {
	b := nouveauBanc(t)
	_, j, d := b.inscrire(t, ipN(1), "lea@exemple.fr", "lea")
	c, _ := b.s.Session(j)
	var lim ErrLimit
	if err := b.s.ChangerPseudo(c, []byte("lea2")); !errors.As(err, &lim) {
		t.Fatal("le jour de l'inscription :", err)
	}
	b.clk.Add(14 * time.Hour) // le 15 à 0 h
	o, err := b.s.Connexion(ipN(1), "lea@exemple.fr", d.AAuth, OptionsSession{}, false)
	if err != nil {
		t.Fatal(err)
	}
	c, _ = b.s.Session(o.Jeton)
	if err := b.s.ChangerPseudo(c, []byte("connard")); !errors.Is(err, ErrPseudoPris) {
		t.Fatal(err)
	}
	if err := b.s.ChangerPseudo(c, []byte("lea2")); err != nil {
		t.Fatal(err)
	}
	if err := b.s.ChangerPseudo(c, []byte("lea3")); !errors.As(err, &lim) {
		t.Fatal("deux fois le même jour :", err)
	}
	b.inscrire(t, ipN(2), "leo@exemple.fr", "lea") // l'ancien est libre
	if libre, err := b.s.PseudoVerifier(c, []byte("lea2")); err != nil || libre {
		t.Fatal("le sien n'est pas libre", libre, err)
	}
}

// La base ne contient que p_empreinte, jamais p_canon.
func TestPseudoJamaisEnClair(t *testing.T) {
	b := nouveauBanc(t)
	b.inscrire(t, ipN(1), "lea@exemple.fr", "ReperePseudoLea")
	if bytes.Contains(b.fichiers(t), []byte("ReperePseudoLea")) {
		t.Fatal("pseudo en clair")
	}
	var pe []byte
	if err := b.db.QueryRow(`SELECT p_empreinte FROM comptes`).Scan(&pe); err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(pe, mustPseudo(t, b.cles, "ReperePseudoLea")) {
		t.Fatal("p_empreinte")
	}
}

// §21.5 : pseudo/verifier, 30 par heure (par étape ou par compte).
func TestPseudoVerifier30ParHeure(t *testing.T) {
	b := nouveauBanc(t)
	_, j, _ := b.inscrire(t, ipN(1), "lea@exemple.fr", "lea")
	c, _ := b.s.Session(j)
	for i := 0; i < 30; i++ {
		if libre, err := b.s.PseudoVerifier(c, []byte("leo")); err != nil || !libre {
			t.Fatal(i, libre, err)
		}
	}
	var lim0 ErrLimit
	if _, err := b.s.PseudoVerifier(c, []byte("leo")); !errors.As(err, &lim0) {
		t.Fatal(err)
	}
	b.clk.Add(time.Hour)
	if libre, err := b.s.PseudoVerifier(c, []byte("leo")); err != nil || !libre {
		t.Fatal("heure suivante :", libre, err)
	}
	_, e, _ := b.debut(t, ipN(2), "leo@exemple.fr")
	for i := 0; i < 30; i++ {
		libre, err := b.s.PseudoVerifierEtape(e, []byte("lea"))
		if err != nil || libre {
			t.Fatal(i, libre, err)
		}
	}
	var lim ErrLimit
	if _, err := b.s.PseudoVerifierEtape(e, []byte("leo")); !errors.As(err, &lim) {
		t.Fatal(err)
	}
	if _, err := b.s.PseudoVerifierEtape(alea32(), []byte("leo")); !errors.Is(err, ErrEtape) {
		t.Fatal(err)
	}
	if _, err := b.s.PseudoVerifierEtape(e, nil); !errors.Is(err, ErrRequete) {
		t.Fatal(err)
	}
}
