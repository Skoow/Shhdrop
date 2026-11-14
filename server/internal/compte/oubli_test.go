package compte

import (
	"bytes"
	"crypto/rand"
	"crypto/sha256"
	"errors"
	"net/netip"
	"testing"
	"time"
)

// Lot 5 du plan du compte : mot de passe oublié, par e-mail, sans perte du profil (conception
// §21.2.3, §21.2.4, R3, R4).

func sha(b []byte) []byte { s := sha256.Sum256(b); return s[:] }

func donneesOubli(gen uint64) DonneesOubli {
	var d DonneesOubli
	d.AAuth = alea32()
	rand.Read(d.EnvMdp[:])
	d.BlobPrive = coffreTest("SHH-ACCT1", gen, 4096)
	return d
}

// oublier : oubli/debut et oubli/verifier (sans double authentification) ; rend l'étape vérifiée.
func (b *banc) oublier(t *testing.T, ip netip.Addr, email string) [32]byte {
	t.Helper()
	n := b.post.n()
	e, err := b.s.OubliDebut(ip, email, "fr")
	if err != nil || b.post.n() != n+1 {
		t.Fatalf("OubliDebut : %v (%d e-mails)", err, b.post.n()-n)
	}
	if _, _, err := b.s.OubliVerifier(e, b.post.dernier(t).Code, "", false); err != nil {
		t.Fatal("OubliVerifier :", err)
	}
	return e
}

// recuperer : récupération complète ; rend l'ouverture et les nouvelles données.
func (b *banc) recuperer(t *testing.T, ip netip.Addr, email string) (Ouverture, DonneesOubli) {
	t.Helper()
	e := b.oublier(t, ip, email)
	var g uint64
	if err := b.db.QueryRow(`SELECT gen_prive FROM comptes`).Scan(&g); err != nil {
		t.Fatal(err)
	}
	d := donneesOubli(g + 1)
	o, err := b.s.OubliFin(e, d, OptionsSession{})
	if err != nil {
		t.Fatal("OubliFin :", err)
	}
	return o, d
}

// L'e-mail ne part qu'à l'adresse exacte du compte ; une variante, une adresse inconnue : même
// réponse (une étape), aucun e-mail, et un code qui n'est jamais juste.
func TestOubliAdresseExacteSeulement(t *testing.T) {
	b := nouveauBanc(t)
	b.inscrire(t, ipA, "Lea.Dupont@gmail.com", "lea")
	n := b.post.n()
	for _, a := range []string{"leadupont@gmail.com", "inconnue@exemple.fr"} {
		e, err := b.s.OubliDebut(ipN(1), a, "fr")
		if err != nil || e == [32]byte{} || b.post.n() != n {
			t.Fatalf("%s : %v, %d e-mails", a, err, b.post.n()-n)
		}
		for i := 4; i >= 0; i-- {
			var cf ErrCodeFaux
			if _, _, err := b.s.OubliVerifier(e, "123456", "", false); !errors.As(err, &cf) || cf.Restants != i {
				t.Fatalf("%s : %v", a, err)
			}
		}
		if _, _, err := b.s.OubliVerifier(e, "123456", "", false); !errors.Is(err, ErrEtape) {
			t.Fatal(err)
		}
	}
	e, err := b.s.OubliDebut(ipN(2), " LEA.Dupont@gmail.com ", "en")
	if err != nil || b.post.n() != n+1 {
		t.Fatal(err)
	}
	m := b.post.dernier(t)
	if m.A != "lea.dupont@gmail.com" || m.Langue != "en" {
		t.Fatalf("%+v", m)
	}
	if h, att, err := b.s.OubliVerifier(e, m.Code, "", false); err != nil || h == [16]byte{} || att != "" {
		t.Fatal(err)
	}
	// Le lendemain (3 e-mails par jour et par adresse, variantes comprises) : « + » refusé aussi.
	b.clk.Add(24 * time.Hour)
	if _, err := b.s.OubliDebut(ipN(3), "lea.dupont+x@gmail.com", "fr"); err != nil || b.post.n() != n+1 {
		t.Fatal("variante + :", err)
	}
	for _, a := range []string{"pas-une-adresse", "léa@gmail.com"} {
		if _, err := b.s.OubliDebut(ipN(4), a, "fr"); !errors.Is(err, ErrAdresse) {
			t.Fatal(a, err)
		}
	}
	if _, err := b.s.OubliDebut(ipN(4), "lea.dupont@gmail.com", "de"); !errors.Is(err, ErrRequete) {
		t.Fatal("langue", err)
	}
}

// Adresse existante ou non : mêmes réponses à chaque pas (étape, limites d'e-mails par adresse
// et renvoi après 60 s), le seul écart est l'e-mail lui-même.
func TestOubliReponseIdentique(t *testing.T) {
	b := nouveauBanc(t)
	b.inscrire(t, ipA, "lea@exemple.fr", "lea") // 1 e-mail vers lea@ aujourd'hui
	b.clk.Add(24 * time.Hour)
	for _, a := range []string{"lea@exemple.fr", "inconnue@exemple.fr"} {
		var lim ErrLimit
		e, err := b.s.OubliDebut(ipN(10), a, "fr")
		if err != nil {
			t.Fatal(a, err)
		}
		if err := b.s.RenvoyerOubli(ipN(10), e, a); !errors.As(err, &lim) || lim.Retry != 60*time.Second {
			t.Fatalf("%s : renvoi avant 60 s : %v", a, err)
		}
		if err := b.s.RenvoyerOubli(ipN(10), e, "autre@exemple.fr"); !errors.Is(err, ErrEtape) {
			t.Fatalf("%s : renvoi vers une autre adresse : %v", a, err)
		}
		b.clk.Add(time.Minute)
		if err := b.s.RenvoyerOubli(ipN(10), e, a); err != nil {
			t.Fatalf("%s : renvoi : %v", a, err)
		}
		if _, err := b.s.OubliDebut(ipN(11), a, "fr"); err != nil {
			t.Fatal(a, err)
		}
		// 4e e-mail du jour vers cette adresse : refusé dans les deux cas.
		if _, err := b.s.OubliDebut(ipN(12), a, "fr"); !errors.As(err, &lim) {
			t.Fatalf("%s : 4e e-mail : %v", a, err)
		}
	}
	// Seuls les e-mails réels sont partis : 3 vers lea@, aucun vers l'inconnue.
	b.post.mu.Lock()
	defer b.post.mu.Unlock()
	for _, m := range b.post.msgs[1:] {
		if m.A != "lea@exemple.fr" {
			t.Fatalf("e-mail vers %s", m.A)
		}
	}
	if len(b.post.msgs) != 4 {
		t.Fatalf("%d e-mails", len(b.post.msgs))
	}
}

// Renvoi : le nouveau code remplace l'ancien (adresse existante).
func TestOubliRenvoiRemplaceLeCode(t *testing.T) {
	b := nouveauBanc(t)
	b.inscrire(t, ipA, "lea@exemple.fr", "lea")
	e, _ := b.s.OubliDebut(ipA, "lea@exemple.fr", "fr")
	ancien := b.post.dernier(t).Code
	b.clk.Add(time.Minute)
	if err := b.s.RenvoyerOubli(ipA, e, "lea@exemple.fr"); err != nil {
		t.Fatal(err)
	}
	nouveau := b.post.dernier(t).Code
	if ancien != nouveau {
		if _, _, err := b.s.OubliVerifier(e, ancien, "", false); !errors.As(err, new(ErrCodeFaux)) {
			t.Fatal("ancien code :", err)
		}
	}
	if _, _, err := b.s.OubliVerifier(e, nouveau, "", false); err != nil {
		t.Fatal(err)
	}
}

// Double authentification active : la récupération exige aussi le code de l'application.
func TestOubliExigeTOTP(t *testing.T) {
	b := nouveauBanc(t)
	h, j, _ := b.inscrire(t, ipA, "lea@exemple.fr", "lea")
	sec := b.activerTOTP(t, j)
	b.clk.Add(time.Minute)
	e, _ := b.s.OubliDebut(ipA, "lea@exemple.fr", "fr")
	code := b.post.dernier(t).Code
	if _, _, err := b.s.OubliVerifier(e, code, "", false); !errors.Is(err, ErrTOTPRequis) {
		t.Fatal("sans code d'application :", err)
	}
	if _, err := b.s.OubliFin(e, donneesOubli(2), OptionsSession{}); !errors.Is(err, ErrEtape) {
		t.Fatal("fin avant vérification :", err)
	}
	if _, _, err := b.s.OubliVerifier(e, code, codeA(sec, b.clk.Now(), 3), false); !errors.Is(err, ErrTOTPFaux) {
		t.Fatal("code d'application faux :", err)
	}
	if hh, _, err := b.s.OubliVerifier(e, code, codeA(sec, b.clk.Now(), 0), false); err != nil || hh != h {
		t.Fatal(err)
	}
	if _, err := b.s.OubliFin(e, donneesOubli(2), OptionsSession{}); err != nil {
		t.Fatal(err)
	}
	if len(b.colTOTP(t, h)) != 48 {
		t.Fatal("double authentification retirée par une récupération avec code")
	}
}

type ligneProfil struct {
	h, eCanon, eEnvoi, cle, pe, blobProfil []byte
	genProfil, cree, des, pj               int64
}

func (b *banc) ligneProfil(t *testing.T) ligneProfil {
	t.Helper()
	var l ligneProfil
	if err := b.db.QueryRow(`SELECT h, e_canon, e_envoi, cle_profil, p_empreinte, blob_profil, gen_profil, cree_jour,
		compte_des, pseudo_jour FROM comptes`).Scan(&l.h, &l.eCanon, &l.eEnvoi, &l.cle, &l.pe, &l.blobProfil,
		&l.genProfil, &l.cree, &l.des, &l.pj); err != nil {
		t.Fatal(err)
	}
	return l
}

// Récupération : compte, adresse, ancienneté, pseudo et coffre de profil (et son séquestre)
// gardés ; s_profil rendu.
func TestRecuperationGardeProfil(t *testing.T) {
	b := nouveauBanc(t)
	h, _, d := b.inscrire(t, ipA, "lea@exemple.fr", "lea")
	avant := b.ligneProfil(t)
	b.clk.Add(3 * 24 * time.Hour)
	o, _ := b.recuperer(t, ipA, "lea@exemple.fr")
	apres := b.ligneProfil(t)
	if !bytes.Equal(avant.h, apres.h) || !bytes.Equal(avant.eCanon, apres.eCanon) || !bytes.Equal(avant.eEnvoi, apres.eEnvoi) ||
		!bytes.Equal(avant.cle, apres.cle) || !bytes.Equal(avant.pe, apres.pe) || !bytes.Equal(avant.blobProfil, apres.blobProfil) ||
		avant.genProfil != apres.genProfil || avant.cree != apres.cree || avant.des != apres.des || avant.pj != apres.pj {
		t.Fatal("profil touché par la récupération")
	}
	if o.H != h || o.SProfil != d.SProfil || !bytes.Equal(o.BlobProfil, d.BlobProfil) || o.GenProfil != 1 || o.GenPrive != 2 ||
		o.Jeton == [32]byte{} || o.BlobPrive != nil || o.EnvMdp != [60]byte{} {
		t.Fatalf("ouverture %+v", o.GenPrive)
	}
}

// Récupération : coffre privé remplacé (gen qui continue), l'ancien effacé des fichiers ;
// ancien mot de passe refusé, le nouveau accepté.
func TestRecuperationVideCoffrePrive(t *testing.T) {
	b := nouveauBanc(t)
	_, _, d := b.inscrire(t, ipA, "lea@exemple.fr", "lea")
	e := b.oublier(t, ipA, "lea@exemple.fr")
	for _, g := range []uint64{1, 3} {
		if _, err := b.s.OubliFin(e, donneesOubli(g), OptionsSession{}); !errors.Is(err, ErrRequete) {
			t.Fatalf("gen %d : %v", g, err)
		}
	}
	nd := donneesOubli(2)
	o, err := b.s.OubliFin(e, nd, OptionsSession{})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := b.s.OubliFin(e, donneesOubli(3), OptionsSession{}); !errors.Is(err, ErrEtape) {
		t.Fatal("étape resservie :", err)
	}
	blob, gen, err := b.s.LireCoffre(b.session(t, o.Jeton), Prive)
	if err != nil || gen != 2 || !bytes.Equal(blob, nd.BlobPrive) {
		t.Fatal("nouveau coffre :", gen, err)
	}
	if f := b.fichiers(t); bytes.Contains(f, d.BlobPrive[45:1045]) || bytes.Contains(f, d.EnvMdp[:]) {
		t.Fatal("ancien coffre privé ou ancienne enveloppe encore dans les fichiers")
	}
	if _, err := b.s.Connexion(ipA, "lea@exemple.fr", d.AAuth, OptionsSession{}, false); !errors.Is(err, ErrIdentifiants) {
		t.Fatal("ancien mot de passe :", err)
	}
	ov, err := b.s.Connexion(ipA, "lea@exemple.fr", nd.AAuth, OptionsSession{}, false)
	if err != nil || ov.EnvMdp != nd.EnvMdp {
		t.Fatal("nouveau mot de passe :", err)
	}
}

// Récupération : toutes les sessions fermées ; seule celle de la récupération reste.
func TestRecuperationFermeLesSessions(t *testing.T) {
	b := nouveauBanc(t)
	_, j1, d := b.inscrire(t, ipA, "lea@exemple.fr", "lea")
	o2, err := b.s.Connexion(ipA, "lea@exemple.fr", d.AAuth, OptionsSession{Persistante: true}, false)
	if err != nil {
		t.Fatal(err)
	}
	o, _ := b.recuperer(t, ipA, "lea@exemple.fr")
	for _, j := range [][32]byte{j1, o2.Jeton} {
		if _, err := b.s.Session(j); !errors.Is(err, ErrSession) {
			t.Fatal("ancienne session ouverte :", err)
		}
	}
	if b.nSessions(t) != 1 {
		t.Fatal(b.nSessions(t), "sessions")
	}
	if c := b.session(t, o.Jeton); !c.Recente {
		t.Fatal("session de la récupération non récente")
	}
}

// R4 : 7 jours sans changement d'adresse ni suppression après une récupération par e-mail.
func TestAttente7Jours(t *testing.T) {
	b := nouveauBanc(t)
	b.inscrire(t, ipA, "lea@exemple.fr", "lea")
	b.clk.Add(2 * time.Hour) // 12:00 UTC, le 14 novembre
	o, nd := b.recuperer(t, ipA, "lea@exemple.fr")
	c := b.session(t, o.Jeton)
	var at ErrAttente
	if _, err := b.s.EmailDebut(c, ipA, "lea@exemple.fr", "lea@ailleurs.fr", "fr"); !errors.As(err, &at) || at.Jusqu != "2026-11-21" {
		t.Fatal("email/debut :", err)
	}
	if _, err := b.s.Supprimer(c); !errors.As(err, &at) || at.Jusqu != "2026-11-21" {
		t.Fatal("supprimer :", err)
	}
	if et, err := b.s.Etat(c); err != nil || et.RecupJusqu != "2026-11-21" {
		t.Fatal("état :", et.RecupJusqu, err)
	}
	// Le 20 novembre à 23:59 : encore refusé.
	b.clk.Add(6*24*time.Hour + 11*time.Hour + 59*time.Minute)
	ov, err := b.s.Connexion(ipA, "lea@exemple.fr", nd.AAuth, OptionsSession{}, false)
	if err != nil {
		t.Fatal(err)
	}
	c = b.session(t, ov.Jeton)
	if _, err := b.s.Supprimer(c); !errors.As(err, &at) {
		t.Fatal("le 20 :", err)
	}
	// email/fin : refusé aussi pendant l'attente (étape ouverte juste avant l'attente).
	if _, err := b.db.Exec(`UPDATE comptes SET recup_jour=NULL`); err != nil {
		t.Fatal(err)
	}
	e, err := b.s.EmailDebut(c, ipA, "lea@exemple.fr", "lea@ailleurs.fr", "fr")
	if err != nil {
		t.Fatal(err)
	}
	code := b.post.dernier(t).Code
	if _, err := b.db.Exec(`UPDATE comptes SET recup_jour=?`, jourDe(b.clk.Now())-6*jourS); err != nil {
		t.Fatal(err)
	}
	if err := b.s.EmailFin(c, e, code, alea32(), [60]byte{}, ""); !errors.As(err, &at) {
		t.Fatal("email/fin :", err)
	}
	// Le 21 novembre : permis.
	b.clk.Add(time.Minute)
	c = b.session(t, ov.Jeton)
	if err := b.s.EmailFin(c, e, code, alea32(), [60]byte{}, ""); err != nil {
		t.Fatal("email/fin le 21 :", err)
	}
	if et, err := b.s.Etat(c); err != nil || et.RecupJusqu != "" {
		t.Fatal("état le 21 :", et.RecupJusqu, err)
	}
	if _, err := b.s.Supprimer(c); err != nil {
		t.Fatal("supprimer le 21 :", err)
	}
}

// R3 : « Je n'ai plus mon application » : retrait dans 7 jours ; avant, le code de
// l'application reste exigé ; à la date, la récupération passe sans lui et la retire.
func TestRetraitTOTPApres7Jours(t *testing.T) {
	b := nouveauBanc(t)
	h, j, _ := b.inscrire(t, ipA, "lea@exemple.fr", "lea")
	b.activerTOTP(t, j)
	e, _ := b.s.OubliDebut(ipA, "lea@exemple.fr", "fr")
	code := b.post.dernier(t).Code
	if _, att, err := b.s.OubliVerifier(e, code, "", true); err != nil || att != "2026-11-21" {
		t.Fatal(att, err)
	}
	if _, _, err := b.s.OubliVerifier(e, code, "", false); !errors.Is(err, ErrEtape) {
		t.Fatal("étape après la demande :", err)
	}
	var rj int64
	if err := b.db.QueryRow(`SELECT totp_retrait_jour FROM comptes`).Scan(&rj); err != nil || dateJour(rj) != "2026-11-21" {
		t.Fatal(rj, err)
	}
	// Une seconde demande ne recule pas la date.
	b.clk.Add(24 * time.Hour)
	e, _ = b.s.OubliDebut(ipA, "lea@exemple.fr", "fr")
	if _, att, err := b.s.OubliVerifier(e, b.post.dernier(t).Code, "", true); err != nil || att != "2026-11-21" {
		t.Fatal("seconde demande :", att, err)
	}
	// Le 20 : code d'application encore exigé.
	b.clk.Add(5*24*time.Hour + 13*time.Hour)
	e, _ = b.s.OubliDebut(ipA, "lea@exemple.fr", "fr")
	code = b.post.dernier(t).Code
	if _, _, err := b.s.OubliVerifier(e, code, "", false); !errors.Is(err, ErrTOTPRequis) {
		t.Fatal("le 20 :", err)
	}
	// Le 21 : passe ; oubli/fin retire la double authentification.
	b.clk.Add(11 * time.Hour)
	e, _ = b.s.OubliDebut(ipA, "lea@exemple.fr", "fr")
	if _, _, err := b.s.OubliVerifier(e, b.post.dernier(t).Code, "", false); err != nil {
		t.Fatal("le 21 :", err)
	}
	nd := donneesOubli(2)
	if _, err := b.s.OubliFin(e, nd, OptionsSession{}); err != nil {
		t.Fatal(err)
	}
	if b.colTOTP(t, h) != nil {
		t.Fatal("double authentification gardée")
	}
	if err := b.db.QueryRow(`SELECT totp_retrait_jour FROM comptes WHERE totp_retrait_jour IS NOT NULL`).Scan(&rj); err == nil {
		t.Fatal("totp_retrait_jour gardé")
	}
	if o, err := b.s.Connexion(ipA, "lea@exemple.fr", nd.AAuth, OptionsSession{}, false); err != nil || o.Etape != nil {
		t.Fatal("connexion sans code :", err)
	}
}

// R3 : une connexion avec le code de l'application annule la demande de retrait.
func TestRetraitTOTPAnnuleParConnexion(t *testing.T) {
	b := nouveauBanc(t)
	_, j, d := b.inscrire(t, ipA, "lea@exemple.fr", "lea")
	sec := b.activerTOTP(t, j)
	e, _ := b.s.OubliDebut(ipA, "lea@exemple.fr", "fr")
	if _, _, err := b.s.OubliVerifier(e, b.post.dernier(t).Code, "", true); err != nil {
		t.Fatal(err)
	}
	b.clk.Add(time.Minute)
	o, _ := b.s.Connexion(ipA, "lea@exemple.fr", d.AAuth, OptionsSession{}, false)
	if _, err := b.s.ConnexionTOTP(*o.Etape, codeA(sec, b.clk.Now(), 0)); err != nil {
		t.Fatal(err)
	}
	var n int
	if err := b.db.QueryRow(`SELECT count(*) FROM comptes WHERE totp_retrait_jour IS NOT NULL`).Scan(&n); err != nil || n != 0 {
		t.Fatal("demande gardée", n, err)
	}
	b.clk.Add(7 * 24 * time.Hour)
	e, _ = b.s.OubliDebut(ipA, "lea@exemple.fr", "fr")
	if _, _, err := b.s.OubliVerifier(e, b.post.dernier(t).Code, "", false); !errors.Is(err, ErrTOTPRequis) {
		t.Fatal("après annulation :", err)
	}
}

// R3 : « Annuler la demande » depuis une session (même non récente) annule le retrait.
func TestRetraitTOTPAnnuleParSession(t *testing.T) {
	b := nouveauBanc(t)
	_, j, _ := b.inscrire(t, ipA, "lea@exemple.fr", "lea")
	b.activerTOTP(t, j)
	e, _ := b.s.OubliDebut(ipA, "lea@exemple.fr", "fr")
	if _, _, err := b.s.OubliVerifier(e, b.post.dernier(t).Code, "", true); err != nil {
		t.Fatal(err)
	}
	b.clk.Add(10 * time.Minute)
	c := b.session(t, j)
	if et, err := b.s.Etat(c); err != nil || et.RetraitTOTPLe != "2026-11-21" || !et.TOTP {
		t.Fatal(et.RetraitTOTPLe, err)
	}
	if err := b.s.TOTPAnnulerRetrait(c); err != nil {
		t.Fatal(err)
	}
	if et, err := b.s.Etat(c); err != nil || et.RetraitTOTPLe != "" {
		t.Fatal(et.RetraitTOTPLe, err)
	}
	b.clk.Add(7 * 24 * time.Hour)
	e, _ = b.s.OubliDebut(ipA, "lea@exemple.fr", "fr")
	if _, _, err := b.s.OubliVerifier(e, b.post.dernier(t).Code, "", false); !errors.Is(err, ErrTOTPRequis) {
		t.Fatal("après annulation :", err)
	}
}
