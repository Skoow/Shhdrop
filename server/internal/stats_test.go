// Test « aucune statistique » côté serveur (spec §35.1, §9.5 ; Task M2), bloquant.
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
	"salon/manager.go:vivants":          "§9.5 salons vivants par bloc (§39.3.6, 12 novembre) : id interne → clé de bloc, jusqu'à la fin du salon",
	"salon/manager.go:parBloc":          "§9.5 salons vivants par bloc (§39.3.6, 12 novembre) : clé de bloc → nombre, jusqu'à la fin du salon",
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

// Aucun client HTTP sortant hors de captcha/recaptcha.go (repli de §26).
func TestNoOutgoingHTTP(t *testing.T) {
	for _, g := range sources(t, "..") {
		if strings.HasSuffix(g.rel, "internal/captcha/recaptcha.go") {
			continue
		}
		ast.Inspect(g.f, func(n ast.Node) bool {
			sel, ok := n.(*ast.SelectorExpr)
			if !ok {
				return true
			}
			if id, ok := sel.X.(*ast.Ident); ok {
				switch id.Name + "." + sel.Sel.Name {
				case "http.Client", "http.Get", "http.Post", "http.PostForm", "http.Head", "http.DefaultClient",
					"http.NewRequest", "http.NewRequestWithContext", "net.Dial", "net.DialTCP", "net.DialUDP",
					"net.DialTimeout", "net.Dialer", "http.Transport", "http.DefaultTransport":
					t.Errorf("%s : %s.%s (client sortant interdit, spec §35.1)", g.rel, id.Name, sel.Sel.Name)
				}
			}
			return true
		})
	}
}
