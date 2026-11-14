package compte

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"testing"
	"time"
)

// Lot 5 du plan du compte : état du compte, mot de passe, adresse, export (conception §8.6,
// §12.4, §21.3, §21.6.2, R21).

// État (GET /api/compte) : dates au jour, palier tiré de compte_des, limites du palier.
func TestEtatCompte(t *testing.T) {
	b := nouveauBanc(t)
	h, j, _ := b.inscrire(t, ipA, "lea@exemple.fr", "lea")
	et, err := b.s.Etat(b.session(t, j))
	if err != nil {
		t.Fatal(err)
	}
	want := Etat{H: h, CreeLe: "2026-11-14", Palier: "neuf", ConfirmeLe: "2026-11-21",
		Limites: Limites{Salons: 1, Places: 4, Heures: 24}}
	if et != want {
		t.Fatalf("%+v", et)
	}
	b.clk.Add(7 * 24 * time.Hour)
	ov, _ := b.s.Connexion(ipA, "lea@exemple.fr", donneesAAuth(b, t), OptionsSession{}, false)
	et, err = b.s.Etat(b.session(t, ov.Jeton))
	want.Palier, want.ConfirmeLe, want.Limites = "confirme", "", Limites{Salons: 3, Places: 10, Heures: 24}
	if err != nil || et != want {
		t.Fatalf("%+v %v", et, err)
	}
	// Banni (actif, non échu) : échéance et motif ; suspendu : rien.
	canon, _ := b.cles.Empreintes(mustAdresse(t, "lea@exemple.fr"))
	if _, err := b.db.Exec(`INSERT INTO bannis VALUES(?,?,?,?,1,6,0)`, alea8(), canon[:], jourDe(b.clk.Now()),
		jourDe(b.clk.Now())+30*jourS); err != nil {
		t.Fatal(err)
	}
	et, _ = b.s.Etat(b.session(t, ov.Jeton))
	if !et.Banni || et.BanniJusqu != "2026-12-21" || et.BanniMotif != 6 {
		t.Fatalf("%+v", et)
	}
	b.db.Exec(`UPDATE bannis SET actif=0`)
	if et, _ = b.s.Etat(b.session(t, ov.Jeton)); et.Banni || et.BanniJusqu != "" || et.BanniMotif != 0 {
		t.Fatalf("suspendu : %+v", et)
	}
}

// donneesAAuth : A_auth n'est pas gardé par le banc ; les tests qui en ont besoin le prennent
// à l'inscription. Ici : remis à une valeur connue (v_mdp recalculé).
func donneesAAuth(b *banc, t *testing.T) [32]byte {
	t.Helper()
	a := alea32()
	var h []byte
	if err := b.db.QueryRow(`SELECT h FROM comptes`).Scan(&h); err != nil {
		t.Fatal(err)
	}
	v := hmacMdp(&b.cles.Poivre, (*[16]byte)(h), &a)
	if _, err := b.db.Exec(`UPDATE comptes SET v_mdp=?`, v[:]); err != nil {
		t.Fatal(err)
	}
	return a
}

func mustAdresse(t *testing.T, e string) Adresse {
	t.Helper()
	a, err := Normaliser(e)
	if err != nil {
		t.Fatal(err)
	}
	return a
}

// Changer de mot de passe : session récente ; toutes les autres sessions fermées.
func TestChangerMdpFermeAutres(t *testing.T) {
	b := nouveauBanc(t)
	_, j1, d := b.inscrire(t, ipA, "lea@exemple.fr", "lea")
	o2, _ := b.s.Connexion(ipA, "lea@exemple.fr", d.AAuth, OptionsSession{Persistante: true}, false)
	nd := donneesOubli(2)
	if err := b.s.ChangerMdp(b.session(t, o2.Jeton), nd.AAuth, nd.EnvMdp); err != nil {
		t.Fatal(err)
	}
	if _, err := b.s.Session(j1); !errors.Is(err, ErrSession) {
		t.Fatal("autre session ouverte :", err)
	}
	b.session(t, o2.Jeton)
	if _, err := b.s.Connexion(ipA, "lea@exemple.fr", d.AAuth, OptionsSession{}, false); !errors.Is(err, ErrIdentifiants) {
		t.Fatal("ancien :", err)
	}
	if o, err := b.s.Connexion(ipA, "lea@exemple.fr", nd.AAuth, OptionsSession{}, false); err != nil || o.EnvMdp != nd.EnvMdp {
		t.Fatal("nouveau :", err)
	}
}

func TestChangerMdpExigeRecent(t *testing.T) {
	b := nouveauBanc(t)
	_, j, d := b.inscrire(t, ipA, "lea@exemple.fr", "lea")
	b.clk.Add(5 * time.Minute)
	nd := donneesOubli(2)
	if err := b.s.ChangerMdp(b.session(t, j), nd.AAuth, nd.EnvMdp); !errors.Is(err, ErrRecent) {
		t.Fatal(err)
	}
	if err := b.s.Reauth(ipA, b.session(t, j), d.AAuth, ""); err != nil {
		t.Fatal(err)
	}
	if err := b.s.ChangerMdp(b.session(t, j), nd.AAuth, nd.EnvMdp); err != nil {
		t.Fatal(err)
	}
}

// Changement d'adresse : l'adresse actuelle exacte est exigée ; sinon identifiants, sans
// e-mail.
func TestEmailAncienneAdresseExigee(t *testing.T) {
	b := nouveauBanc(t)
	_, j, _ := b.inscrire(t, ipA, "Lea.Dupont@gmail.com", "lea")
	n := b.post.n()
	c := b.session(t, j)
	for _, a := range []string{"leadupont@gmail.com", "lea.dupont+x@gmail.com", "autre@exemple.fr"} {
		if _, err := b.s.EmailDebut(c, ipA, a, "lea@ailleurs.fr", "fr"); !errors.Is(err, ErrIdentifiants) {
			t.Fatal(a, err)
		}
	}
	if _, err := b.s.EmailDebut(c, ipA, "pas-une-adresse", "lea@ailleurs.fr", "fr"); !errors.Is(err, ErrIdentifiants) {
		t.Fatal(err)
	}
	if b.post.n() != n {
		t.Fatal("e-mail envoyé")
	}
	b.clk.Add(5 * time.Minute)
	if _, err := b.s.EmailDebut(b.session(t, j), ipA, "lea.dupont@gmail.com", "lea@ailleurs.fr", "fr"); !errors.Is(err, ErrRecent) {
		t.Fatal("non récente :", err)
	}
}

// Nouvelle adresse jetable (sous-domaines compris) ou invalide : refusée, sans e-mail.
func TestEmailNouvelleJetableRefusee(t *testing.T) {
	b := nouveauBanc(t)
	_, j, _ := b.inscrire(t, ipA, "lea@exemple.fr", "lea")
	n := b.post.n()
	c := b.session(t, j)
	for _, a := range []string{"x@mailinator.com", "x@MAIL.mailinator.com", "x+y@a.b.yopmail.com"} {
		if _, err := b.s.EmailDebut(c, ipA, "lea@exemple.fr", a, "fr"); !errors.Is(err, ErrJetable) {
			t.Fatal(a, err)
		}
	}
	if _, err := b.s.EmailDebut(c, ipA, "lea@exemple.fr", "léa@ailleurs.fr", "fr"); !errors.Is(err, ErrAdresse) {
		t.Fatal(err)
	}
	if _, err := b.s.EmailDebut(c, ipA, "lea@exemple.fr", "lea@ailleurs.fr", "de"); !errors.Is(err, ErrRequete) {
		t.Fatal(err)
	}
	if b.post.n() != n {
		t.Fatal("e-mail envoyé")
	}
}

// Après le code juste : empreintes, v_mdp et Env_mdp remplacés ; l'ancienne adresse ne
// connecte plus et redevient libre ; les autres sessions sont fermées.
func TestEmailChangeEmpreintes(t *testing.T) {
	b := nouveauBanc(t)
	_, j, d := b.inscrire(t, ipA, "lea@exemple.fr", "lea")
	o2, _ := b.s.Connexion(ipA, "lea@exemple.fr", d.AAuth, OptionsSession{}, false)
	c := b.session(t, j)
	e, err := b.s.EmailDebut(c, ipA, "lea@exemple.fr", "Lea.Martin+shh@Ailleurs.fr", "en")
	if err != nil {
		t.Fatal(err)
	}
	code := b.post.dernier(t).Code
	if err := b.s.EmailFin(c, e, codeFaux(code), alea32(), [60]byte{}, ""); !errors.As(err, new(ErrCodeFaux)) {
		t.Fatal("code faux :", err)
	}
	nd := donneesOubli(2)
	if err := b.s.EmailFin(c, e, code, nd.AAuth, nd.EnvMdp, ""); err != nil {
		t.Fatal(err)
	}
	canon, envoi := b.cles.Empreintes(mustAdresse(t, "lea.martin+shh@ailleurs.fr"))
	var ec, ee []byte
	if err := b.db.QueryRow(`SELECT e_canon, e_envoi FROM comptes`).Scan(&ec, &ee); err != nil ||
		!bytes.Equal(ec, canon[:]) || !bytes.Equal(ee, envoi[:]) {
		t.Fatal("empreintes :", err)
	}
	if _, err := b.s.Session(o2.Jeton); !errors.Is(err, ErrSession) {
		t.Fatal("autre session ouverte :", err)
	}
	if _, err := b.s.Connexion(ipA, "lea@exemple.fr", d.AAuth, OptionsSession{}, false); !errors.Is(err, ErrIdentifiants) {
		t.Fatal("ancienne adresse :", err)
	}
	if o, err := b.s.Connexion(ipA, "lea.martin@ailleurs.fr", nd.AAuth, OptionsSession{}, false); err != nil || o.EnvMdp != nd.EnvMdp {
		t.Fatal("nouvelle adresse :", err)
	}
	if err := b.s.EmailFin(c, e, code, nd.AAuth, nd.EnvMdp, ""); !errors.Is(err, ErrEtape) {
		t.Fatal("étape resservie :", err)
	}
	b.inscrire(t, ipN(5), "lea@exemple.fr", "leo")
}

// R21 : double authentification active : code de l'application exigé à email/fin.
func TestEmailExigeTOTP(t *testing.T) {
	b := nouveauBanc(t)
	_, j, _ := b.inscrire(t, ipA, "lea@exemple.fr", "lea")
	sec := b.activerTOTP(t, j)
	b.clk.Add(time.Minute)
	c := b.session(t, j)
	e, err := b.s.EmailDebut(c, ipA, "lea@exemple.fr", "lea@ailleurs.fr", "fr")
	if err != nil {
		t.Fatal(err)
	}
	code := b.post.dernier(t).Code
	if err := b.s.EmailFin(c, e, code, alea32(), [60]byte{}, ""); !errors.Is(err, ErrTOTPRequis) {
		t.Fatal(err)
	}
	if err := b.s.EmailFin(c, e, code, alea32(), [60]byte{}, codeA(sec, b.clk.Now(), 2)); !errors.Is(err, ErrTOTPFaux) {
		t.Fatal(err)
	}
	if err := b.s.EmailFin(c, e, code, alea32(), [60]byte{}, codeA(sec, b.clk.Now(), 0)); err != nil {
		t.Fatal(err)
	}
}

// §21.3 : aucun avis à l'ancienne adresse ; un seul e-mail, vers la nouvelle (exacte).
func TestEmailAucunAvisAncienne(t *testing.T) {
	b := nouveauBanc(t)
	_, j, _ := b.inscrire(t, ipA, "lea@exemple.fr", "lea")
	n := b.post.n()
	c := b.session(t, j)
	e, err := b.s.EmailDebut(c, ipA, "lea@exemple.fr", "Lea@Ailleurs.fr", "fr")
	if err != nil {
		t.Fatal(err)
	}
	if b.post.n() != n+1 || b.post.dernier(t).A != "lea@ailleurs.fr" {
		t.Fatal("e-mail :", b.post.dernier(t).A)
	}
	b.clk.Add(time.Minute)
	if err := b.s.RenvoyerEmail(c, ipA, e, "lea@ailleurs.fr"); err != nil {
		t.Fatal("renvoi :", err)
	}
	if err := b.s.EmailFin(c, e, b.post.dernier(t).Code, alea32(), [60]byte{}, ""); err != nil {
		t.Fatal(err)
	}
	b.post.mu.Lock()
	defer b.post.mu.Unlock()
	for _, m := range b.post.msgs[n:] {
		if m.A != "lea@ailleurs.fr" {
			t.Fatal("e-mail vers", m.A)
		}
	}
	if len(b.post.msgs) != n+2 {
		t.Fatal(len(b.post.msgs)-n, "e-mails")
	}
}

// Nouvelle adresse déjà prise (ou bannie) : même réponse et même e-mail au début ; l'état
// n'est dit qu'après le code juste ; rien ne change.
func TestEmailNouvelleDejaPrise(t *testing.T) {
	b := nouveauBanc(t)
	b.inscrire(t, ipA, "leo@exemple.fr", "leo")
	h, j, _ := b.inscrire(t, ipN(1), "lea@exemple.fr", "lea")
	var avant []byte
	b.db.QueryRow(`SELECT e_canon FROM comptes WHERE h=?`, h[:]).Scan(&avant)
	c := b.session(t, j)
	n := b.post.n()
	e, err := b.s.EmailDebut(c, ipN(1), "lea@exemple.fr", "LEO+x@exemple.fr", "fr")
	if err != nil || b.post.n() != n+1 || b.post.dernier(t).A != "leo+x@exemple.fr" {
		t.Fatal(err)
	}
	if err := b.s.EmailFin(c, e, b.post.dernier(t).Code, alea32(), [60]byte{}, ""); !errors.Is(err, ErrDejaInscrit) {
		t.Fatal(err)
	}
	// Adresse bannie.
	canon, _ := b.cles.Empreintes(mustAdresse(t, "banni@exemple.fr"))
	if _, err := b.db.Exec(`INSERT INTO bannis VALUES(?,?,?,?,1,10,0)`, alea8(), canon[:], jourDe(b.clk.Now()),
		jourDe(b.clk.Now())+365*jourS); err != nil {
		t.Fatal(err)
	}
	e, err = b.s.EmailDebut(c, ipN(1), "lea@exemple.fr", "banni@exemple.fr", "fr")
	if err != nil {
		t.Fatal(err)
	}
	var bn ErrBanni
	if err := b.s.EmailFin(c, e, b.post.dernier(t).Code, alea32(), [60]byte{}, ""); !errors.As(err, &bn) || bn.Jusqu != "2027-11-14" {
		t.Fatal(err)
	}
	var apres []byte
	b.db.QueryRow(`SELECT e_canon FROM comptes WHERE h=?`, h[:]).Scan(&apres)
	if !bytes.Equal(avant, apres) {
		t.Fatal("adresse changée")
	}
}

// Export : données du serveur seulement (jours, mois, double authentification, appareils),
// sans adresse, empreinte, h, coffre, enveloppe ni séquestre.
func TestExportSansAdresse(t *testing.T) {
	b := nouveauBanc(t)
	h, j, d := b.inscrire(t, ipA, "lea@exemple.fr", "lea")
	b.s.Connexion(ipA, "lea@exemple.fr", d.AAuth, OptionsSession{Persistante: true, Etiquette: bytes.Repeat([]byte{7}, 64)}, false)
	x, err := b.s.Export(b.session(t, j))
	if err != nil {
		t.Fatal(err)
	}
	if x.CreeLe != "2026-11-14" || x.AncienneteDepuis != "2026-11-14" || x.VuMois != "2026-11" || x.TOTP ||
		len(x.Sessions) != 2 || x.Sessions[0].Ajoutee != "2026-11" {
		t.Fatalf("%+v", x)
	}
	js, _ := json.Marshal(x)
	var ec, ee, cp []byte
	b.db.QueryRow(`SELECT e_canon, e_envoi, cle_profil FROM comptes`).Scan(&ec, &ee, &cp)
	for _, s := range [][]byte{[]byte("lea"), ec, ee, cp, h[:], d.EnvMdp[:], d.SProfil[:], d.BlobPrive[:64], d.BlobProfil[:64]} {
		for _, f := range [][]byte{s, []byte(base64.StdEncoding.EncodeToString(s)), []byte(base64.RawURLEncoding.EncodeToString(s))} {
			if len(f) > 0 && bytes.Contains(js, f) {
				t.Fatalf("export : %q contient une valeur du compte", js)
			}
		}
	}
}
