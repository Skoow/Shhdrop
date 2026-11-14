package courriel

import (
	"bytes"
	"context"
	"crypto/tls"
	"errors"
	"go/ast"
	"go/parser"
	"go/token"
	"io"
	"io/fs"
	"mime/quotedprintable"
	"net/mail"
	"path/filepath"
	"reflect"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/skoow/shhdrop/server/internal/config"
)

const from = "Shhgone <ne-pas-repondre@shhgone.com>"

// Textes exacts de la conception §21.3 (FR) ; EN : objet de §21.3, corps traduit au lot 3.
const (
	corpsFR = "Votre code : 123 456\r\nIl expire dans 15 minutes.\r\nSi vous n'avez rien demandé, ignorez ce message.\r\n"
	corpsEN = "Your code: 123 456\r\nIt expires in 15 minutes.\r\nIf you did not ask for anything, ignore this message.\r\n"
)

func smtpConf(port int) config.SMTP {
	return config.SMTP{Host: "127.0.0.1", Port: port, User: "utilisateur", PasswordFile: "/run/secrets/smtp", From: from}
}

// envoyeur : vers le faux serveur f, en TLS implicite (port 465), STARTTLS (587) ou texte
// clair (port réel du faux serveur, boucle locale).
func envoyeur(t *testing.T, f *fauxSMTP, mode int) *Envoyeur {
	t.Helper()
	port := f.port
	if mode == 465 || mode == 587 {
		port = mode
	}
	e, err := Nouveau(smtpConf(port), []byte("mot-de-passe-smtp"))
	if err != nil {
		t.Fatal(err)
	}
	e.portDial, e.racines, e.pause = f.port, f.pool, 0
	return e
}

func lancer(t *testing.T, e *Envoyeur) {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	fini := make(chan struct{})
	go func() { e.Run(ctx); close(fini) }()
	t.Cleanup(func() {
		cancel()
		select {
		case <-fini:
		case <-time.After(5 * time.Second):
			t.Error("Run ne s'arrête pas à l'annulation du contexte")
		}
	})
}

func corpsDecode(t *testing.T, m *mail.Message) string {
	t.Helper()
	b, err := io.ReadAll(quotedprintable.NewReader(m.Body))
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

var reMessageID = regexp.MustCompile(`^<[0-9a-f]{32}@shhgone\.com>$`)

func TestEnvoiCode(t *testing.T) {
	for _, c := range []struct{ langue, objet, corps string }{
		{"fr", "Votre code Shhgone", corpsFR},
		{"en", "Your Shhgone code", corpsEN},
	} {
		t.Run(c.langue, func(t *testing.T) {
			f := nouveauFaux(t, func(f *fauxSMTP) { f.implicite = true })
			e := envoyeur(t, f, 465)
			lancer(t, e)
			if err := e.Mettre(Message{A: "lea.dupont+x@exemple.fr", Langue: c.langue, Code: "123456"}); err != nil {
				t.Fatal(err)
			}
			r := f.attendre(t, 1)[0]
			if !r.tls || r.from != "<ne-pas-repondre@shhgone.com>" || r.to != "<lea.dupont+x@exemple.fr>" {
				t.Fatalf("enveloppe : tls=%v from=%q to=%q", r.tls, r.from, r.to)
			}
			m, err := mail.ReadMessage(bytes.NewReader(r.data))
			if err != nil {
				t.Fatal(err)
			}
			if got := m.Header.Get("Subject"); got != c.objet {
				t.Fatalf("objet %q", got)
			}
			if got := corpsDecode(t, m); got != strings.ReplaceAll(c.corps, "\r\n", "\n") { // ReadDotBytes rend des \n
				t.Fatalf("corps %q", got)
			}
			// Octet pour octet, à la date et au Message-ID près.
			d, id := m.Header.Get("Date"), m.Header.Get("Message-ID")
			if _, err := time.Parse(time.RFC1123Z, d); err != nil || !strings.HasSuffix(d, " +0000") {
				t.Fatalf("Date %q (RFC 5322, UTC)", d)
			}
			if !reMessageID.MatchString(id) {
				t.Fatalf("Message-ID %q", id)
			}
			want := "From: " + from + "\r\nTo: lea.dupont+x@exemple.fr\r\nSubject: " + c.objet + "\r\nDate: " + d +
				"\r\nMessage-ID: " + id + "\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=utf-8\r\n" +
				"Content-Transfer-Encoding: quoted-printable\r\n\r\n" + qp(t, c.corps)
			if string(r.data) != strings.ReplaceAll(want, "\r\n", "\n") { // ReadDotBytes rend des \n
				t.Fatalf("message brut :\n%s\nattendu :\n%s", r.data, want)
			}
		})
	}
}

func qp(t *testing.T, s string) string {
	var b bytes.Buffer
	w := quotedprintable.NewWriter(&b)
	if _, err := w.Write([]byte(s)); err != nil {
		t.Fatal(err)
	}
	w.Close()
	return b.String()
}

func TestAucunEnTeteDeTrop(t *testing.T) {
	f := nouveauFaux(t, func(f *fauxSMTP) { f.implicite = true })
	e := envoyeur(t, f, 465)
	lancer(t, e)
	e.Mettre(Message{A: "lea@exemple.fr", Langue: "fr", Code: "000001"})
	e.Mettre(Message{A: "lea@exemple.fr", Langue: "fr", Code: "000002"})
	rs := f.attendre(t, 2)
	var ids []string
	for _, r := range rs {
		m, err := mail.ReadMessage(bytes.NewReader(r.data))
		if err != nil {
			t.Fatal(err)
		}
		var cles []string
		for k := range m.Header {
			cles = append(cles, k)
		}
		slices.Sort(cles)
		want := []string{"Content-Transfer-Encoding", "Content-Type", "Date", "From", "Message-Id", "Mime-Version", "Subject", "To"}
		if !slices.Equal(cles, want) {
			t.Fatalf("en-têtes %v, attendu exactement %v (conception §21.3)", cles, want)
		}
		for k, v := range m.Header {
			if len(v) != 1 {
				t.Fatalf("en-tête %s répété", k)
			}
		}
		if m.Header.Get("Content-Type") != "text/plain; charset=utf-8" {
			t.Fatal(m.Header.Get("Content-Type"))
		}
		ids = append(ids, m.Header.Get("Message-Id"))
	}
	if ids[0] == ids[1] {
		t.Fatal("Message-ID identique pour deux messages : il doit être aléatoire")
	}
}

// TestEmailModeleUnique : un seul modèle ; le message ne dépend que de l'adresse (en-tête To),
// de la langue et du code ; aucun autre texte d'e-mail dans les sources du serveur.
func TestEmailModeleUnique(t *testing.T) {
	// Message : exactement A, Langue, Code (aucun champ de modèle, de pseudo, de lien).
	var noms []string
	ty := reflect.TypeFor[Message]()
	for i := range ty.NumField() {
		noms = append(noms, ty.Field(i).Name)
	}
	if !slices.Equal(noms, []string{"A", "Langue", "Code"}) {
		t.Fatalf("Message : champs %v, attendu A, Langue, Code", noms)
	}
	date := time.Date(2026, 11, 14, 10, 0, 0, 0, time.UTC)
	corpsDe := func(a, l, c string) string {
		b := composer(from, Message{A: a, Langue: l, Code: c}, date, "<x@shhgone.com>")
		if bytes.Count(b, []byte("\n")) != bytes.Count(b, []byte("\r\n")) {
			t.Fatal("fin de ligne autre que CRLF")
		}
		_, corps, ok := strings.Cut(string(b), "\r\n\r\n")
		if !ok {
			t.Fatal("pas de séparation en-têtes / corps")
		}
		return corps
	}
	for _, l := range []string{"fr", "en"} {
		// Adresse libre, prise, bannie, récupération, nouvelle adresse : rien ne change que le code.
		ref := corpsDe("libre@exemple.fr", l, "123456")
		for _, a := range []string{"prise@exemple.fr", "bannie@exemple.fr", "x+recup@gmail.com"} {
			if corpsDe(a, l, "123456") != ref {
				t.Fatalf("%s : le corps dépend de l'adresse", l)
			}
		}
		if corpsDe("libre@exemple.fr", l, "654321") == ref {
			t.Fatal("le code ne change pas le corps")
		}
		if strings.Contains(ref, "exemple") || strings.Contains(ref, "http") || strings.Contains(ref, "@") {
			t.Fatalf("%s : le corps contient autre chose que le code : %q", l, ref)
		}
	}
	// Sources du serveur : les textes d'e-mail n'existent que dans modele.go, et le paquet ne
	// déclare aucun autre modèle (ModeleDejaInscrit, ModeleBanni… : conception §21.17).
	textes := []string{"Votre code", "Your Shhgone code", "Shhgone code", "Subject:", "Il expire", "It expires",
		"ignorez ce message", "ignore this message", "déjà un compte", "already", "banni", "Content-Type: text/plain"}
	err := filepath.WalkDir("../..", func(p string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() || !strings.HasSuffix(p, ".go") || strings.HasSuffix(p, "_test.go") {
			return err
		}
		f, err := parser.ParseFile(token.NewFileSet(), p, nil, 0)
		if err != nil {
			return err
		}
		modele := filepath.ToSlash(p) == "../../internal/courriel/modele.go"
		ast.Inspect(f, func(n ast.Node) bool {
			switch x := n.(type) {
			case *ast.BasicLit:
				if x.Kind != token.STRING {
					return true
				}
				s, _ := strconv.Unquote(x.Value)
				for _, m := range textes[:10] {
					if strings.Contains(s, m) && !modele && !strings.Contains(p, "courriel") {
						t.Errorf("%s : texte d'e-mail %q hors de internal/courriel/modele.go", p, m)
					}
				}
				if strings.Contains(p, "internal/courriel/") && !modele {
					for _, m := range textes {
						if strings.Contains(s, m) {
							t.Errorf("%s : texte d'e-mail %q hors de modele.go", p, m)
						}
					}
				}
			case *ast.Ident:
				if strings.Contains(p, "internal/courriel/") && strings.HasPrefix(x.Name, "Modele") {
					t.Errorf("%s : identifiant %s : un seul modèle, aucun type de modèle", p, x.Name)
				}
			}
			return true
		})
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
}

func TestEnvoiSTARTTLS(t *testing.T) {
	f := nouveauFaux(t, func(f *fauxSMTP) { f.offrirStartTLS = true })
	e := envoyeur(t, f, 587)
	lancer(t, e)
	e.Mettre(Message{A: "lea@exemple.fr", Langue: "fr", Code: "123456"})
	if r := f.attendre(t, 1)[0]; !r.tls {
		t.Fatal("DATA hors TLS en mode STARTTLS")
	}
	if _, _, auths, _, _ := f.etat(); !slices.Equal(auths, []bool{true}) {
		t.Fatalf("AUTH : %v, attendu une seule, sous TLS", auths)
	}
}

// sansEnvoi : un message mis en file pour e ; le faux serveur ne doit recevoir ni
// authentification, ni MAIL FROM, ni message.
func sansEnvoi(t *testing.T, f *fauxSMTP, e *Envoyeur) {
	t.Helper()
	lancer(t, e)
	if err := e.Mettre(Message{A: "lea@exemple.fr", Langue: "fr", Code: "123456"}); err != nil {
		t.Fatal(err)
	}
	time.Sleep(300 * time.Millisecond)
	_, mails, auths, _, recus := f.etat()
	if mails != 0 || len(auths) != 0 || recus != 0 {
		t.Fatalf("envoi ou authentification sans TLS vérifié : mails=%d auths=%v recus=%d", mails, auths, recus)
	}
}

func TestSTARTTLSAbsentRefuse(t *testing.T) {
	f := nouveauFaux(t, nil) // n'annonce pas STARTTLS : jamais de repli en clair
	sansEnvoi(t, f, envoyeur(t, f, 587))
}

func TestCertificatNonVerifieRefuse(t *testing.T) {
	for _, mode := range []int{465, 587} {
		f := nouveauFaux(t, func(f *fauxSMTP) { f.implicite = mode == 465; f.offrirStartTLS = mode == 587 })
		e := envoyeur(t, f, mode)
		e.racines = nil // magasin du système : le certificat de test n'y est pas
		sansEnvoi(t, f, e)
	}
}

func TestMauvaisNomRefuse(t *testing.T) {
	f := nouveauFaux(t, func(f *fauxSMTP) {
		f.implicite = true
		cert, pool := certificat(t, false) // localhost seulement, pas 127.0.0.1 (SHH_SMTP_HOST)
		f.tlsConf.Certificates, f.pool = []tls.Certificate{cert}, pool
	})
	sansEnvoi(t, f, envoyeur(t, f, 465))
}

func TestTLSAncienRefuse(t *testing.T) {
	f := nouveauFaux(t, func(f *fauxSMTP) {
		f.implicite = true
		f.tlsConf.MinVersion, f.tlsConf.MaxVersion = tls.VersionTLS10, tls.VersionTLS11
	})
	sansEnvoi(t, f, envoyeur(t, f, 465))
}

func TestTexteClairRefuseHorsBoucle(t *testing.T) {
	for _, c := range []struct {
		host string
		port int
		ok   bool
	}{
		{"smtp.exemple.fr", 465, true}, {"smtp.exemple.fr", 587, true},
		{"smtp.exemple.fr", 25, false}, {"smtp.exemple.fr", 2525, false}, {"192.0.2.1", 2525, false},
		{"127.0.0.1", 2525, true}, {"localhost", 2525, true}, {"::1", 2525, true},
	} {
		conf := smtpConf(c.port)
		conf.Host = c.host
		_, err := Nouveau(conf, []byte("x"))
		if (err == nil) != c.ok {
			t.Errorf("%s:%d : err=%v", c.host, c.port, err)
		}
	}
	// Configuration incomplète : refus (aucun envoyeur sans hôte, sans compte ni expéditeur).
	for _, mut := range []func(*config.SMTP){
		func(c *config.SMTP) { c.Host = "" }, func(c *config.SMTP) { c.User = "" },
		func(c *config.SMTP) { c.From = "" }, func(c *config.SMTP) { c.From = "pas une adresse" },
		func(c *config.SMTP) { c.Port = 0 },
	} {
		conf := smtpConf(465)
		mut(&conf)
		if _, err := Nouveau(conf, []byte("x")); err == nil {
			t.Errorf("configuration %+v acceptée", conf)
		}
	}
	if _, err := Nouveau(smtpConf(465), nil); err == nil {
		t.Error("mot de passe vide accepté")
	}
}

func TestEnvoiTexteClairBoucle(t *testing.T) {
	f := nouveauFaux(t, nil)
	e := envoyeur(t, f, 0)
	lancer(t, e)
	e.Mettre(Message{A: "lea@exemple.fr", Langue: "fr", Code: "123456"})
	if r := f.attendre(t, 1)[0]; r.tls {
		t.Fatal("TLS inattendu")
	}
}

func TestFilePleine(t *testing.T) {
	e, err := Nouveau(smtpConf(465), []byte("x"))
	if err != nil {
		t.Fatal(err)
	}
	for i := range Capacite {
		if err := e.Mettre(Message{A: "lea@exemple.fr", Langue: "fr", Code: "123456"}); err != nil {
			t.Fatalf("message %d : %v", i+1, err)
		}
	}
	if err := e.Mettre(Message{A: "lea@exemple.fr", Langue: "fr", Code: "123456"}); !errors.Is(err, ErrPlein) {
		t.Fatalf("257e message : %v, attendu ErrPlein", err)
	}
	if Capacite != 256 {
		t.Fatal("conception §8.7 : 256 messages en file au plus")
	}
}

func TestMettreRefuseInvalide(t *testing.T) {
	e, err := Nouveau(smtpConf(465), []byte("x"))
	if err != nil {
		t.Fatal(err)
	}
	for _, m := range []Message{
		{A: "lea@exemple.fr", Langue: "fr", Code: "12345"},
		{A: "lea@exemple.fr", Langue: "fr", Code: "1234567"},
		{A: "lea@exemple.fr", Langue: "fr", Code: "12a456"},
		{A: "lea@exemple.fr", Langue: "fr", Code: "١٢٣٤٥٦"},
		{A: "lea@exemple.fr", Langue: "de", Code: "123456"},
		{A: "lea@exemple.fr", Langue: "", Code: "123456"},
		{A: "lea@exemple.fr\r\nBcc: x@y.fr", Langue: "fr", Code: "123456"},
		{A: "lea@exemple.fr\nX: y", Langue: "fr", Code: "123456"},
		{A: "lea @exemple.fr", Langue: "fr", Code: "123456"},
		{A: "<lea@exemple.fr>", Langue: "fr", Code: "123456"},
		{A: "lea@exemple.fr>\r\nRCPT TO:<x@y.fr", Langue: "fr", Code: "123456"},
		{A: "lea", Langue: "fr", Code: "123456"},
		{A: "a@b@exemple.fr", Langue: "fr", Code: "123456"},
		{A: "@exemple.fr", Langue: "fr", Code: "123456"},
		{A: "lea@", Langue: "fr", Code: "123456"},
		{A: "léa@exemple.fr", Langue: "fr", Code: "123456"},
		{A: strings.Repeat("a", 250) + "@exemple.fr", Langue: "fr", Code: "123456"},
	} {
		if err := e.Mettre(m); !errors.Is(err, ErrInvalide) {
			t.Errorf("%q : %v, attendu ErrInvalide", m, err)
		}
		if err := e.Mettre(m); err != nil && strings.Contains(err.Error(), "lea") {
			t.Errorf("l'erreur cite l'adresse : %v", err)
		}
	}
	if len(e.file) != 0 {
		t.Fatal("message invalide mis en file")
	}
}

func TestEchecSilencieux(t *testing.T) {
	f := nouveauFaux(t, func(f *fauxSMTP) { f.implicite = true; f.refuserRcpt = "refusee" })
	e := envoyeur(t, f, 465)
	lancer(t, e)
	e.Mettre(Message{A: "refusee@exemple.fr", Langue: "fr", Code: "111111"})
	e.Mettre(Message{A: "lea@exemple.fr", Langue: "fr", Code: "222222"})
	r := f.attendre(t, 1)
	if len(r) != 1 || r[0].to != "<lea@exemple.fr>" {
		t.Fatalf("reçus %+v", r)
	}
	// Refus définitif (5xx) : aucun nouvel essai, message oublié.
	_, _, _, rcpts, _ := f.etat()
	if !slices.Equal(rcpts, []string{"<refusee@exemple.fr>", "<lea@exemple.fr>"}) {
		t.Fatalf("RCPT %v : un refus définitif ne se réessaie pas", rcpts)
	}
	// Aucune sortie : le paquet n'écrit rien nulle part (ni journal, ni stdout, ni stderr).
	sources, _ := filepath.Glob("*.go")
	for _, p := range sources {
		if strings.HasSuffix(p, "_test.go") {
			continue
		}
		f, err := parser.ParseFile(token.NewFileSet(), p, nil, 0)
		if err != nil {
			t.Fatal(err)
		}
		for _, imp := range f.Imports {
			switch q, _ := strconv.Unquote(imp.Path.Value); q {
			case "log", "log/slog", "os", "runtime/debug":
				t.Errorf("%s : import %s (aucune sortie, aucun journal de l'adresse)", p, q)
			}
		}
		ast.Inspect(f, func(n ast.Node) bool {
			if c, ok := n.(*ast.CallExpr); ok {
				switch fn := c.Fun.(type) {
				case *ast.Ident:
					if fn.Name == "print" || fn.Name == "println" || fn.Name == "panic" {
						t.Errorf("%s : %s", p, fn.Name)
					}
				case *ast.SelectorExpr:
					if id, ok := fn.X.(*ast.Ident); ok && id.Name == "fmt" && strings.Contains(fn.Sel.Name, "rint") &&
						fn.Sel.Name != "Sprintf" && fn.Sel.Name != "Sprint" {
						t.Errorf("%s : fmt.%s", p, fn.Sel.Name)
					}
				}
			}
			return true
		})
	}
}

func TestNouvelEssai(t *testing.T) {
	f := nouveauFaux(t, func(f *fauxSMTP) { f.implicite = true; f.refuserAccueil = 1 })
	e := envoyeur(t, f, 465)
	lancer(t, e)
	e.Mettre(Message{A: "lea@exemple.fr", Langue: "fr", Code: "123456"})
	f.attendre(t, 1)
	time.Sleep(100 * time.Millisecond)
	if c, _, _, _, n := f.etat(); c != 2 || n != 1 {
		t.Fatalf("connexions %d, reçus %d : attendu un nouvel essai, un seul message", c, n)
	}
	// Deux échecs temporaires : message oublié, la file continue.
	f2 := nouveauFaux(t, func(f *fauxSMTP) { f.implicite = true; f.refuserAccueil = 2 })
	e2 := envoyeur(t, f2, 465)
	lancer(t, e2)
	e2.Mettre(Message{A: "perdu@exemple.fr", Langue: "fr", Code: "111111"})
	e2.Mettre(Message{A: "lea@exemple.fr", Langue: "fr", Code: "222222"})
	if r := f2.attendre(t, 1); r[0].to != "<lea@exemple.fr>" {
		t.Fatalf("reçu %+v", r)
	}
	if c, _, _, _, _ := f2.etat(); c != 3 {
		t.Fatalf("connexions %d, attendu 3 (deux essais, puis le message suivant)", c)
	}
}

func TestDelaiParEnvoi(t *testing.T) {
	f := nouveauFaux(t, func(f *fauxSMTP) { f.muet = true })
	e := envoyeur(t, f, 465)
	e.delai = 200 * time.Millisecond
	debut := time.Now()
	lancer(t, e)
	e.Mettre(Message{A: "lea@exemple.fr", Langue: "fr", Code: "123456"})
	for time.Since(debut) < 3*time.Second {
		if c, _, _, _, _ := f.etat(); c == 2 && len(e.file) == 0 {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if c, _, _, _, _ := f.etat(); c != 2 || time.Since(debut) > 2*time.Second {
		t.Fatalf("connexions %d en %v : chaque essai doit être borné par le délai", c, time.Since(debut))
	}
	if Delai != 20*time.Second {
		t.Fatal("conception §8.7 : 20 s par envoi")
	}
}

// Plein (lot 6 du plan du compte) : vrai quand la file refuserait un message, pour qu'une étape
// sans e-mail (récupération d'une adresse sans compte) réponde busy comme les autres.
func TestPleinSuitLaFile(t *testing.T) {
	e, err := Nouveau(config.SMTP{Host: "127.0.0.1", Port: 2525, User: "u", From: "Shhgone <a@exemple.fr>"}, []byte("m"))
	if err != nil {
		t.Fatal(err)
	}
	for i := range Capacite {
		if e.Plein() {
			t.Fatal("pleine à", i)
		}
		if err := e.Mettre(Message{A: "lea@exemple.fr", Langue: "fr", Code: "123456"}); err != nil {
			t.Fatal(err)
		}
	}
	if !e.Plein() || !errors.Is(e.Mettre(Message{A: "lea@exemple.fr", Langue: "fr", Code: "123456"}), ErrPlein) {
		t.Fatal("file pleine non vue")
	}
}
