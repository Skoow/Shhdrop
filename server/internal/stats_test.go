// Test « aucune statistique » côté serveur (spec §35.1, §9.5 ; Task M2), bloquant.
// Amendé le 13 novembre (décision du propriétaire) : des compteurs d'usage globaux, un entier
// chacun, en mémoire, existent pour le tableau de bord d'administration (internal/usage) ;
// ce test garde le reste : aucune télémétrie, aucune table (map) non justifiée, donc rien
// par personne, par adresse ni par partage.
package internal_test

import (
	"go/ast"
	"go/parser"
	"go/token"
	"io/fs"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

// forbidden : imports de mesure, de télémétrie ou de rapports d'erreurs (spec §35.1).
var forbidden = []string{"expvar", "net/http/pprof", "runtime/pprof", "github.com/prometheus/", "go.opentelemetry.io/",
	"github.com/getsentry/", "gopkg.in/DataDog/", "github.com/newrelic/", "github.com/DataDog/", "statsd"}

// allowedMaps : chaque map déclarée (champ de structure ou variable de paquet) de
// server/internal, avec la ligne de spec §9.5 qui la justifie. Toute autre fait échouer.
var allowedMaps = map[string]string{
	"limits/limits.go:count64":          "§9.5 créations et octets du jour",
	"limits/limits.go:count48":          "§9.5 créations et octets du jour",
	"limits/limits.go:bytes64":          "§9.5 créations et octets du jour",
	"limits/limits.go:bytes48":          "§9.5 créations et octets du jour",
	"limits/limits.go:req":              "§9.5 requêtes et segments de la minute",
	"limits/limits.go:seg":              "§9.5 requêtes et segments de la minute",
	"limits/limits.go:seg48":            "§9.5 requêtes et segments de la minute",
	"limits/limits.go:uploads":          "§9.5 envois anticipés en cours",
	"limits/limits.go:pend64":           "§9.5 envois anticipés en cours",
	"limits/limits.go:pend48":           "§9.5 envois anticipés en cours",
	"limits/limits.go:aband64":          "§9.5 octets abandonnés",
	"limits/limits.go:aband48":          "§9.5 octets abandonnés",
	"limits/limits.go:salon64":          "§9.5 salons créés du jour (§39.3.6)",
	"limits/limits.go:salon48":          "§9.5 salons créés du jour (§39.3.6)",
	"limits/limits.go:join64":           "§9.5 entrées de l'heure (§39.3.6)",
	"limits/limits.go:join48":           "§9.5 entrées de l'heure (§39.3.6)",
	"limits/limits.go:frame64":          "§9.5 trames de la minute (§39.3.6)",
	"limits/limits.go:frame48":          "§9.5 trames de la minute (§39.3.6)",
	"limits/slots.go:c64":               "§9.5 transferts simultanés",
	"limits/slots.go:c48":               "§9.5 transferts simultanés",
	"limits/slots.go:n":                 "§9.5 transferts simultanés, par envoi et par ouverture (audit I3, M4 ; id interne, durée du transfert)",
	"captcha/captcha.go:used":           "§9.5 défis anti-robot consommés",
	"captcha/captcha.go:creates":        "§9.5 créations de l'heure par connexion",
	"share/budget.go:m":                 "§9.5 budget de lecture par ouverture",
	"share/service.go:up":               "§9.5 colonnes d'un partage vivant (échéance d'envoi, dernier segment), en mémoire (§36 S5, S12)",
	"share/service.go:purge":            "§9.5 colonnes d'un partage vivant (purge d'un « draining »), en mémoire (§36 S12)",
	"share/service.go:part":             "§9.5 colonnes d'un partage vivant (morceaux reçus d'un segment partagé, audit H-2), en mémoire",
	"share/service.go:ids":              "verrou de finalisation (aucun compte : présence seulement, le temps d'un finalize)",
	"share/service.go:sealing":          "verrou de finalisation : segments refusés (présence seulement, le temps d'un finalize, audit F6)",
	"share/detached.go:active":          "§9.5 ouvertures actives (§41.8)",
	"share/detached.go:dead":            "§9.5 ouvertures actives : descripteurs détachés (§41.8)",
	"share/detached.go:opens":           "§9.5 ouvertures actives : ouvertures d'un descripteur détaché (§41.8)",
	"share/detached.go:watch":           "§9.5 requêtes watch tenues (§41.8)",
	"share/detached.go:grants":          "§9.5 octrois d'ouverture (§41.4)",
	"share/streams.go:live":             "§9.5 flux de segments annulables (§41.8)",
	"api/static_paths.go:pdfFrameFiles": "constante (liste de fichiers), aucun compteur",
	"salon/manager.go:salons":           "§39.3.6 état d'un salon vivant (pas une statistique au sens de §9.5), effacé avec le salon",
	"salon/manager.go:index":            "§39.3.6 empreintes des jetons de membre → salon vivant, effacées avec le salon",
	"salon/salon.go:jetons":             "§39.3.6 empreintes des jetons de membre → siège, effacées avec le salon",
	"salon/salon.go:revoques":           "§39.3.6 empreintes des jetons révoqués (exclusion, §39.13), effacées avec le salon",
	"salon/salon.go:pieces":             "§39.3.4 auteur d'une pièce en mémoire : rang de la trame → pièce liée (plan, point 2), effacé avec le salon",
	"salon/salon.go:lesPieces":          "§9.5 état d'un salon vivant : pièces vivantes par id (plan C-2 Task 13), effacées avec elles ou le salon",
	"salon/salon.go:libres":             "§9.5 état d'un salon vivant : pièces pas encore liées (échéances de 15 min), effacées avec elles ou le salon",
	"salon/manager.go:pieceIdx":         "§9.5 état d'un salon vivant : id de pièce → salon (routes à jeton d'envoi), effacé avec la pièce",
	"salon/pieces.go:lus":               "§9.5 budget de lecture par (jeton de membre, pièce) (§24, M1), effacé avec la pièce",
	"salon/manager.go:vivants":          "§9.5 salons vivants par bloc (§39.3.6, 12 novembre) : id interne → clé de bloc, jusqu'à la fin du salon",
	"salon/manager.go:parBloc":          "§9.5 salons vivants par bloc (§39.3.6, 12 novembre) : clé de bloc → nombre, jusqu'à la fin du salon",
	"compte/jetables.go:jetables":       "constante (liste de domaines jetables, conception du compte §5.3), lue une fois au démarrage, aucun compteur",
	// Limites du compte (conception du compte §8.3, §8.8 ; plan lot 3) : clés HMAC du jour, aucune
	// adresse ni empreinte en clair, vidées à l'heure ou à minuit UTC.
	"limits/limits.go:insc64":    "conception du compte §8.8 inscriptions du jour par connexion (3), minuit UTC",
	"limits/limits.go:insc48":    "conception du compte §8.8 inscriptions du jour par /48 (10), minuit UTC",
	"limits/limits.go:mail64":    "conception du compte §8.8 e-mails du jour par connexion (10), minuit UTC",
	"limits/limits.go:mail48":    "plan lot 3 e-mails du jour par /48 (30), minuit UTC",
	"limits/limits.go:mailAdr":   "conception du compte §8.3, §8.8 e-mails du jour par adresse (3), HMAC du jour de e_canon, minuit UTC",
	"limits/limits.go:echec64":   "conception du compte §8.8 échecs de connexion de l'heure par connexion (20)",
	"limits/limits.go:echec48":   "conception du compte §8.8 échecs de connexion de l'heure par /48 (60)",
	"limits/limits.go:echecCpt":  "conception du compte §8.3, §8.8 échecs de connexion de l'heure par compte (preuve après 5), HMAC du jour de e_canon",
	"limits/limits.go:totpCpt":   "conception du compte §8.8 échecs TOTP de l'heure par compte (10), HMAC du jour de h",
	"limits/limits.go:coffreCpt": "conception du compte §8.8, §21.6.2 écritures des coffres de l'heure par compte (60), HMAC du jour de h",
	"limits/limits.go:pseudoCpt": "conception du compte §21.5 vérifications de pseudo de l'heure (30), HMAC du jour de h ou de l'étape",
	// Compte (conception du compte §8.3 ; plan lot 4) : mémoire seulement, perdue au redémarrage.
	"compte/etapes.go:m":   "conception du compte §8.3 étapes en attente (inscription : e_canon, e_envoi, HMAC du code, essais ; connexion : double authentification), clé SHA-256 du jeton d'étape, 15 min (5 min), 20 000 au plus ; aucune adresse en clair",
	"compte/sessions.go:m": "conception du compte §8.3 dernier usage et « session récente » d'une session, clé t_v (SHA-256 du jeton), oublié 2 h sans usage",
}

type goFile struct {
	rel string
	f   *ast.File
}

func sources(t *testing.T, root string) []goFile {
	t.Helper()
	var out []goFile
	err := filepath.WalkDir(root, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() || !strings.HasSuffix(p, ".go") || strings.HasSuffix(p, "_test.go") {
			return nil
		}
		f, err := parser.ParseFile(token.NewFileSet(), p, nil, 0)
		if err != nil {
			return err
		}
		rel, _ := filepath.Rel(root, p)
		out = append(out, goFile{filepath.ToSlash(rel), f})
		return nil
	})
	if err != nil || len(out) < 10 {
		t.Fatal("sources", len(out), err)
	}
	return out
}

func TestNoTelemetryImports(t *testing.T) {
	for _, g := range sources(t, "..") {
		for _, imp := range g.f.Imports {
			p, _ := strconv.Unquote(imp.Path.Value)
			for _, f := range forbidden {
				if p == f || strings.Contains(p, f) {
					t.Errorf("%s : import interdit %s (spec §35.1)", g.rel, p)
				}
			}
		}
	}
	sum, err := os.ReadFile(filepath.Join("..", "go.sum"))
	if err != nil {
		t.Fatal(err)
	}
	for _, f := range forbidden[3:] {
		if strings.Contains(string(sum), f) {
			t.Errorf("go.sum : %s (spec §35.1)", f)
		}
	}
}

// mapDecls : champs de structure et variables de paquet de type map (déclarations qui
// survivent à une requête ; les variables locales, transitoires, ne comptent pas).
func mapDecls(f *ast.File) []string {
	var names []string
	isMap := func(e ast.Expr) bool { _, ok := e.(*ast.MapType); return ok }
	ast.Inspect(f, func(n ast.Node) bool {
		switch x := n.(type) {
		case *ast.FuncDecl:
			return false // corps de fonctions : locaux
		case *ast.StructType:
			for _, fl := range x.Fields.List {
				if isMap(fl.Type) {
					for _, nm := range fl.Names {
						names = append(names, nm.Name)
					}
				}
			}
		case *ast.ValueSpec:
			for i, nm := range x.Names {
				if (x.Type != nil && isMap(x.Type)) || (i < len(x.Values) && isCompositeMap(x.Values[i])) {
					names = append(names, nm.Name)
				}
			}
		}
		return true
	})
	return names
}

func isCompositeMap(e ast.Expr) bool {
	c, ok := e.(*ast.CompositeLit)
	if !ok {
		return false
	}
	_, ok = c.Type.(*ast.MapType)
	return ok
}

func TestNoUnlistedCounter(t *testing.T) {
	seen := map[string]bool{}
	for _, g := range sources(t, ".") {
		for _, nm := range mapDecls(g.f) {
			k := g.rel + ":" + nm
			seen[k] = true
			if _, ok := allowedMaps[k]; !ok {
				t.Errorf("%s : nouveau compteur : ajouter une ligne justifiée à spec §9.5 (puis à allowedMaps)", k)
			}
		}
	}
	for k := range allowedMaps {
		if !seen[k] {
			t.Errorf("liste blanche périmée : %s n'existe plus", k)
		}
	}
}

// sortants : appels qui ouvrent une connexion sortante (spec §35.1) ; interdits partout, sauf
// captcha/recaptcha.go (repli de §26) et, pour le seul client SMTP, internal/courriel/smtp.go
// (conception du compte §3.2, §15 ; plan lot 3).
var sortants = map[string]bool{
	"http.Client": true, "http.Get": true, "http.Post": true, "http.PostForm": true, "http.Head": true,
	"http.DefaultClient": true, "http.NewRequest": true, "http.NewRequestWithContext": true,
	"http.Transport": true, "http.DefaultTransport": true,
	"net.Dial": true, "net.DialTCP": true, "net.DialUDP": true, "net.DialIP": true, "net.DialUnix": true,
	"net.DialTimeout": true, "net.Dialer": true,
	"smtp.Dial": true, "smtp.SendMail": true, "smtp.NewClient": true,
	"tls.Dial": true, "tls.DialWithDialer": true, "tls.Dialer": true, "tls.Client": true,
}

// smtpPermis : ce que internal/courriel/smtp.go, et lui seul, peut appeler parmi sortants :
// la connexion TCP (STARTTLS) ou TLS vers SHH_SMTP_HOST et le client SMTP posé dessus. Rien
// d'autre : ni client HTTP, ni smtp.SendMail (qui accepterait le texte clair), ni tls.Dial.
var smtpPermis = map[string]bool{"net.Dialer": true, "tls.Dialer": true, "smtp.NewClient": true}

// paquetsReseau : imports qui ne doivent jamais être renommés (un alias tromperait la recherche
// par nom de paquet ci-dessous).
var paquetsReseau = map[string]bool{"net": true, "net/http": true, "net/smtp": true, "crypto/tls": true}

// TestNoOutgoingHTTP : aucun client sortant hors de captcha/recaptcha.go et, pour SMTP
// seulement, internal/courriel/smtp.go.
func TestNoOutgoingHTTP(t *testing.T) {
	smtpVu := false
	for _, g := range sources(t, "..") {
		if strings.HasSuffix(g.rel, "internal/captcha/recaptcha.go") {
			continue
		}
		smtpGo := g.rel == "internal/courriel/smtp.go"
		for _, imp := range g.f.Imports {
			p, _ := strconv.Unquote(imp.Path.Value)
			if paquetsReseau[p] && imp.Name != nil {
				t.Errorf("%s : import renommé de %s (interdit : la recherche des clients sortants se fait par nom)", g.rel, p)
			}
			if p == "net/smtp" && !smtpGo {
				t.Errorf("%s : net/smtp hors de internal/courriel/smtp.go (seul client SMTP)", g.rel)
			}
		}
		ast.Inspect(g.f, func(n ast.Node) bool {
			sel, ok := n.(*ast.SelectorExpr)
			if !ok {
				return true
			}
			if id, ok := sel.X.(*ast.Ident); ok {
				k := id.Name + "." + sel.Sel.Name
				switch {
				case smtpGo && smtpPermis[k]:
					smtpVu = smtpVu || k == "smtp.NewClient"
				case sortants[k]:
					t.Errorf("%s : %s (client sortant interdit, spec §35.1)", g.rel, k)
				}
			}
			return true
		})
	}
	if !smtpVu {
		t.Error("internal/courriel/smtp.go n'appelle plus smtp.NewClient : exemption périmée, à retirer")
	}
}

// TestCourrielSeulementAvecComptes : avec SHH_COMPTES=0, aucune connexion sortante n'est
// possible. Le seul envoyeur (courriel.Nouveau) n'est créé qu'à l'intérieur d'un « if » qui
// lit Comptes (cfg.Comptes), dans son corps « alors », hors du paquet courriel et de ses tests.
func TestCourrielSeulementAvecComptes(t *testing.T) {
	for _, g := range sources(t, "..") {
		if strings.HasPrefix(g.rel, "internal/courriel/") {
			continue
		}
		var pile []ast.Node
		ast.Inspect(g.f, func(n ast.Node) bool {
			if n == nil {
				pile = pile[:len(pile)-1]
				return true
			}
			pile = append(pile, n)
			sel, ok := n.(*ast.SelectorExpr)
			if !ok {
				return true
			}
			if id, ok := sel.X.(*ast.Ident); !ok || id.Name != "courriel" || sel.Sel.Name != "Nouveau" {
				return true
			}
			for i := len(pile) - 2; i >= 0; i-- {
				if st, ok := pile[i].(*ast.IfStmt); ok && litComptes(st.Cond) && pile[i+1] == st.Body {
					return true
				}
			}
			t.Errorf("%s : courriel.Nouveau hors d'un « if …Comptes » (avec SHH_COMPTES=0, aucune sortie)", g.rel)
			return true
		})
	}
}

func litComptes(e ast.Expr) bool {
	vu := false
	ast.Inspect(e, func(n ast.Node) bool {
		if s, ok := n.(*ast.SelectorExpr); ok && s.Sel.Name == "Comptes" {
			vu = true
		}
		return !vu
	})
	return vu
}
