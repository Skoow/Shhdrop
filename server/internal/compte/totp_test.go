package compte

import (
	"bytes"
	"crypto/aes"
	"crypto/cipher"
	"encoding/base32"
	"errors"
	"testing"
	"time"
)

// Lot 5 du plan du compte : double authentification TOTP (conception §8.4, §21.2.4). RFC 6238
// (SHA-1, 6 chiffres, 30 s, ±1 pas) codée avec crypto/hmac et crypto/sha1 de la bibliothèque
// standard (décision du propriétaire du 14 novembre : aucune dépendance de plus) ; les
// vecteurs de la RFC le prouvent.

// session : la session du jeton (échoue sinon).
func (b *banc) session(t *testing.T, j [32]byte) Courante {
	t.Helper()
	c, err := b.s.Session(j)
	if err != nil {
		t.Fatal("session :", err)
	}
	return c
}

// codeA : le code de l'application pour le pas de l'instant t décalé de d pas.
func codeA(secret []byte, t time.Time, d int) string {
	return hotp(secret, uint64(int64(pasDe(t))+int64(d)), 6)
}

// activerTOTP : double authentification activée depuis la session j (récente) ; rend le
// secret. Le pas de l'activation est consommé : le code suivant doit attendre 30 s.
func (b *banc) activerTOTP(t *testing.T, j [32]byte) []byte {
	t.Helper()
	c := b.session(t, j)
	e, sec, err := b.s.TOTPDebut(c)
	if err != nil {
		t.Fatal("TOTPDebut :", err)
	}
	raw, err := base32.StdEncoding.DecodeString(sec)
	if err != nil || len(raw) != 20 || len(sec) != 32 {
		t.Fatalf("secret %q : %v", sec, err)
	}
	if err := b.s.TOTPFin(c, e, codeA(raw, b.clk.Now(), 0)); err != nil {
		t.Fatal("TOTPFin :", err)
	}
	return raw
}

func (b *banc) colTOTP(t *testing.T, h [16]byte) []byte {
	t.Helper()
	var v []byte
	if err := b.db.QueryRow(`SELECT totp FROM comptes WHERE h=?`, h[:]).Scan(&v); err != nil {
		t.Fatal(err)
	}
	return v
}

// RFC 6238, annexe B (SHA-1, graine « 12345678901234567890 », 8 chiffres) ; 6 chiffres : les
// 6 derniers (même troncature, modulo 10^6).
func TestTOTPVecteursRFC6238(t *testing.T) {
	graine := []byte("12345678901234567890")
	for _, v := range []struct {
		t    int64
		code string
	}{{59, "94287082"}, {1111111109, "07081804"}, {1111111111, "14050471"}, {1234567890, "89005924"},
		{2000000000, "69279037"}, {20000000000, "65353130"}} {
		p := pasDe(time.Unix(v.t, 0))
		if got := hotp(graine, p, 8); got != v.code {
			t.Errorf("T=%d : %s, attendu %s", v.t, got, v.code)
		}
		if got := hotp(graine, p, 6); got != v.code[2:] {
			t.Errorf("T=%d (6 chiffres) : %s, attendu %s", v.t, got, v.code[2:])
		}
	}
}

// Tolérance d'un pas de chaque côté, pas plus ; un pas déjà accepté (ou plus ancien) est refusé.
func TestTOTPTolerance(t *testing.T) {
	b := nouveauBanc(t)
	_, j, d := b.inscrire(t, ipA, "lea@exemple.fr", "lea")
	sec := b.activerTOTP(t, j)
	b.clk.Add(10 * 30 * time.Second)
	c := b.session(t, j)
	now := b.clk.Now()
	for _, dp := range []int{-2, 2, 3} {
		if err := b.s.Reauth(ipA, c, d.AAuth, codeA(sec, now, dp)); !errors.Is(err, ErrTOTPFaux) {
			t.Fatalf("pas %+d : %v", dp, err)
		}
	}
	for _, dp := range []int{-1, 0, 1} {
		if err := b.s.Reauth(ipA, c, d.AAuth, codeA(sec, now, dp)); err != nil {
			t.Fatalf("pas %+d : %v", dp, err)
		}
	}
	if err := b.s.Reauth(ipA, c, d.AAuth, ""); !errors.Is(err, ErrTOTPRequis) {
		t.Fatal("sans code :", err)
	}
	for _, c2 := range []string{"12345", "1234567", "12a456"} {
		if err := b.s.Reauth(ipA, c, d.AAuth, c2); !errors.Is(err, ErrTOTPFaux) {
			t.Fatalf("%q : %v", c2, err)
		}
	}
}

// Un code accepté ne resert pas (même pas, ou pas plus ancien, dans la fenêtre).
func TestTOTPRejeu(t *testing.T) {
	b := nouveauBanc(t)
	_, j, d := b.inscrire(t, ipA, "lea@exemple.fr", "lea")
	sec := b.activerTOTP(t, j)
	// Le code de l'activation lui-même ne resert pas.
	if err := b.s.Reauth(ipA, b.session(t, j), d.AAuth, codeA(sec, b.clk.Now(), 0)); !errors.Is(err, ErrTOTPRejoue) {
		t.Fatal("code de l'activation :", err)
	}
	b.clk.Add(30 * time.Second)
	code := codeA(sec, b.clk.Now(), 0)
	o, err := b.s.Connexion(ipA, "lea@exemple.fr", d.AAuth, OptionsSession{}, false)
	if err != nil || o.Etape == nil {
		t.Fatal(err)
	}
	if _, err := b.s.ConnexionTOTP(*o.Etape, code); err != nil {
		t.Fatal(err)
	}
	o, _ = b.s.Connexion(ipA, "lea@exemple.fr", d.AAuth, OptionsSession{}, false)
	if _, err := b.s.ConnexionTOTP(*o.Etape, code); !errors.Is(err, ErrTOTPRejoue) {
		t.Fatal("rejeu :", err)
	}
	if _, err := b.s.ConnexionTOTP(*o.Etape, codeA(sec, b.clk.Now(), -1)); !errors.Is(err, ErrTOTPRejoue) {
		t.Fatal("pas plus ancien :", err)
	}
	if _, err := b.s.ConnexionTOTP(*o.Etape, codeA(sec, b.clk.Now(), 1)); err != nil {
		t.Fatal("pas suivant :", err)
	}
}

// Secret : 20 octets, gardé en nonce ‖ AES-256-GCM(K_totp, secret, AD = « SHH-TOTP1 » ‖ h)
// = 48 octets ; jamais en clair (ni brut, ni en base32) dans la base ni son WAL.
func TestTOTPSecretChiffre(t *testing.T) {
	b := nouveauBanc(t)
	h, j, _ := b.inscrire(t, ipA, "lea@exemple.fr", "lea")
	sec := b.activerTOTP(t, j)
	col := b.colTOTP(t, h)
	if len(col) != 48 || bytes.Contains(col, sec) {
		t.Fatalf("colonne totp : %d octets", len(col))
	}
	blk, _ := aes.NewCipher(b.cles.TOTP[:])
	g, _ := cipher.NewGCM(blk)
	clair, err := g.Open(nil, col[:12], col[12:], append([]byte("SHH-TOTP1"), h[:]...))
	if err != nil || !bytes.Equal(clair, sec) {
		t.Fatal("ouverture avec K_totp et l'AD :", err)
	}
	if _, err := g.Open(nil, col[:12], col[12:], []byte("SHH-TOTP1")); err == nil {
		t.Fatal("AD sans h acceptée")
	}
	f := b.fichiers(t)
	if bytes.Contains(f, sec) || bytes.Contains(f, []byte(base32.StdEncoding.EncodeToString(sec))) {
		t.Fatal("secret en clair sur disque")
	}
}

// Activation : session récente, puis un premier code juste ; sans lui, rien n'est écrit. 5
// essais par étape. Retrait : session récente (donc code de l'application).
func TestTOTPActivationExigeCode(t *testing.T) {
	b := nouveauBanc(t)
	h, j, d := b.inscrire(t, ipA, "lea@exemple.fr", "lea")
	c := b.session(t, j)
	e, sec, err := b.s.TOTPDebut(c)
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := base32.StdEncoding.DecodeString(sec)
	if b.colTOTP(t, h) != nil {
		t.Fatal("secret écrit avant le premier code")
	}
	faux := codeA(raw, b.clk.Now(), 5)
	for i := 0; i < 4; i++ {
		if err := b.s.TOTPFin(c, e, faux); !errors.Is(err, ErrTOTPFaux) {
			t.Fatal(i, err)
		}
	}
	if err := b.s.TOTPFin(c, e, faux); !errors.Is(err, ErrTOTPFaux) {
		t.Fatal("5e :", err)
	}
	if err := b.s.TOTPFin(c, e, codeA(raw, b.clk.Now(), 0)); !errors.Is(err, ErrEtape) {
		t.Fatal("après 5 essais :", err)
	}
	if b.colTOTP(t, h) != nil {
		t.Fatal("secret écrit")
	}
	// Session plus récente : refus.
	b.clk.Add(6 * time.Minute)
	c = b.session(t, j)
	if _, _, err := b.s.TOTPDebut(c); !errors.Is(err, ErrRecent) {
		t.Fatal("TOTPDebut non récente :", err)
	}
	if err := b.s.Reauth(ipA, c, d.AAuth, ""); err != nil {
		t.Fatal(err)
	}
	sec2 := b.activerTOTP(t, j)
	if len(b.colTOTP(t, h)) != 48 {
		t.Fatal("non activée")
	}
	// Déjà active : une seconde activation est refusée.
	if _, _, err := b.s.TOTPDebut(b.session(t, j)); !errors.Is(err, ErrRequete) {
		t.Fatal("seconde activation :", err)
	}
	b.clk.Add(6 * time.Minute)
	if err := b.s.TOTPRetirer(b.session(t, j)); !errors.Is(err, ErrRecent) {
		t.Fatal("retrait non récent :", err)
	}
	if err := b.s.Reauth(ipA, b.session(t, j), d.AAuth, codeA(sec2, b.clk.Now(), 0)); err != nil {
		t.Fatal(err)
	}
	if err := b.s.TOTPRetirer(b.session(t, j)); err != nil || b.colTOTP(t, h) != nil {
		t.Fatal("retrait :", err)
	}
}

// Connexion : étape, puis code de l'application ; la session n'existe qu'après. 5 essais par
// étape ; 10 échecs par heure par compte, puis 429 pour ce compte.
func TestConnexionAvecTOTP(t *testing.T) {
	b := nouveauBanc(t)
	_, j, d := b.inscrire(t, ipA, "lea@exemple.fr", "lea")
	sec := b.activerTOTP(t, j)
	b.clk.Add(30 * time.Second)
	n := b.nSessions(t)
	o, err := b.s.Connexion(ipA, "lea@exemple.fr", d.AAuth, OptionsSession{Persistante: true}, false)
	if err != nil || o.Etape == nil {
		t.Fatal(err)
	}
	if _, err := b.s.ConnexionTOTP(*o.Etape, codeA(sec, b.clk.Now(), 4)); !errors.Is(err, ErrTOTPFaux) || b.nSessions(t) != n {
		t.Fatal("code faux :", err)
	}
	if _, err := b.s.ConnexionTOTP(alea32(), codeA(sec, b.clk.Now(), 0)); !errors.Is(err, ErrEtape) {
		t.Fatal("étape inconnue :", err)
	}
	ov, err := b.s.ConnexionTOTP(*o.Etape, codeA(sec, b.clk.Now(), 0))
	if err != nil || ov.Jeton == [32]byte{} || ov.SProfil != d.SProfil || !bytes.Equal(ov.BlobPrive, d.BlobPrive) ||
		ov.EnvMdp != d.EnvMdp || ov.Etape != nil {
		t.Fatal("ouverture :", err)
	}
	var pers int
	if err := b.db.QueryRow(`SELECT persistante FROM sessions WHERE t_v=?`, sha(ov.Jeton[:])).Scan(&pers); err != nil || pers != 1 {
		t.Fatal("options de la connexion perdues :", pers, err)
	}
	if _, err := b.s.ConnexionTOTP(*o.Etape, codeA(sec, b.clk.Now(), 1)); !errors.Is(err, ErrEtape) {
		t.Fatal("étape resservie :", err)
	}
	// 5 essais par étape.
	o, _ = b.s.Connexion(ipA, "lea@exemple.fr", d.AAuth, OptionsSession{}, false)
	for i := 0; i < 5; i++ {
		if _, err := b.s.ConnexionTOTP(*o.Etape, "000000"); !errors.Is(err, ErrTOTPFaux) && !errors.Is(err, ErrTOTPRejoue) {
			t.Fatal(i, err)
		}
	}
	if _, err := b.s.ConnexionTOTP(*o.Etape, codeA(sec, b.clk.Now(), 1)); !errors.Is(err, ErrEtape) {
		t.Fatal("6e essai :", err)
	}
	// 10 échecs dans l'heure (5 déjà comptés, plus celui du début) : 429.
	o, _ = b.s.Connexion(ipA, "lea@exemple.fr", d.AAuth, OptionsSession{}, false)
	for i := 0; i < 4; i++ {
		if _, err := b.s.ConnexionTOTP(*o.Etape, "000000"); !errors.Is(err, ErrTOTPFaux) && !errors.Is(err, ErrTOTPRejoue) {
			t.Fatal(i, err)
		}
	}
	var lim ErrLimit
	if _, err := b.s.ConnexionTOTP(*o.Etape, codeA(sec, b.clk.Now(), 1)); !errors.As(err, &lim) {
		t.Fatal("11e échec dans l'heure :", err)
	}
	b.clk.Add(time.Hour)
	o, _ = b.s.Connexion(ipA, "lea@exemple.fr", d.AAuth, OptionsSession{}, false)
	if _, err := b.s.ConnexionTOTP(*o.Etape, codeA(sec, b.clk.Now(), 0)); err != nil {
		t.Fatal("heure suivante :", err)
	}
}
