package api

import (
	"go/ast"
	"go/parser"
	"go/token"
	"io/fs"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"testing"
	"time"
)

// Spec §36 S2 (Task M2) : le serveur ne lit aucun en-tête hors de la liste blanche, jamais
// User-Agent ni Referer, et l'adresse du pair seulement dans clientip.go et /healthz.
// Accept-Encoding (retours CLEAN2) : choix de la variante précompressée d'un fichier du site
// (cmd/shhdrop/static.go) ; même valeur dans tous les navigateurs visés, jamais gardé ni journalisé.
var readHeaders = []string{"Authorization", "X-Shh-Client-IP", "X-Shh-Access", "X-Shh-Manage", "X-Shh-Grant", "Accept-Encoding"}

type srcFile struct {
	path string
	fset *token.FileSet
	f    *ast.File
}

func serverSources(t *testing.T) []srcFile {
	t.Helper()
	root := filepath.Join("..", "..")
	var out []srcFile
	err := filepath.WalkDir(root, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() || !strings.HasSuffix(p, ".go") || strings.HasSuffix(p, "_test.go") {
			return nil
		}
		fset := token.NewFileSet()
		f, err := parser.ParseFile(fset, p, nil, 0)
		if err != nil {
			return err
		}
		out = append(out, srcFile{p, fset, f})
		return nil
	})
	if err != nil || len(out) < 10 {
		t.Fatal("sources du serveur", len(out), err)
	}
	return out
}

// enclosing : nom de la fonction qui contient pos.
func enclosing(f *ast.File, pos token.Pos) string {
	for _, d := range f.Decls {
		if fd, ok := d.(*ast.FuncDecl); ok && fd.Pos() <= pos && pos <= fd.End() {
			return fd.Name.Name
		}
	}
	return ""
}

func strLit(e ast.Expr) (string, bool) {
	if b, ok := e.(*ast.BasicLit); ok && b.Kind == token.STRING {
		s, err := strconv.Unquote(b.Value)
		return s, err == nil
	}
	return "", false
}

func TestNoHeaderReadOutsideAllowList(t *testing.T) {
	for _, sf := range serverSources(t) {
		where := func(n ast.Node) string { return sf.fset.Position(n.Pos()).String() }
		ast.Inspect(sf.f, func(n ast.Node) bool {
			switch x := n.(type) {
			case *ast.SelectorExpr:
				switch x.Sel.Name {
				case "UserAgent", "Referer":
					t.Errorf("%s : %s() interdit (spec §36 S2)", where(x), x.Sel.Name)
				case "RemoteAddr":
					fn := enclosing(sf.f, x.Pos())
					if filepath.Base(sf.path) != "clientip.go" && fn != "healthz" {
						t.Errorf("%s : RemoteAddr lu dans %s (seulement clientip.go et /healthz)", where(x), fn)
					}
				case "Cookie", "Cookies", "FormValue", "PostFormValue", "UserAgentData":
					t.Errorf("%s : %s interdit", where(x), x.Sel.Name)
				}
			case *ast.CallExpr:
				sel, ok := x.Fun.(*ast.SelectorExpr)
				if !ok {
					return true
				}
				if inner, ok := sel.X.(*ast.SelectorExpr); ok && inner.Sel.Name == "Header" &&
					(sel.Sel.Name == "Get" || sel.Sel.Name == "Values") {
					name, lit := strLit(x.Args[0])
					switch {
					case lit && slices.Contains(readHeaders, name):
					case lit && name == "Origin" && enclosing(sf.f, x.Pos()) == "salonWS":
						// Salon (spec §39.3.1, « Origine », plan C-2 Task 10) : comparé à SHH_ORIGIN
						// avant la mise à niveau du WebSocket, jamais gardé ni journalisé. Caddy
						// ne doit donc pas retirer Origin sur /api/salons/ws (§36 S2 à amender).
					case !lit && enclosing(sf.f, x.Pos()) == "headerSecret":
						// nom passé par l'appelant : vérifié sur les appels de headerSecret
					default:
						t.Errorf("%s : lecture d'en-tête hors liste blanche (%s)", where(x), name)
					}
				}
				if id, ok := x.Fun.(*ast.Ident); ok && id.Name == "headerSecret" {
					if name, lit := strLit(x.Args[1]); !lit || !slices.Contains(readHeaders, name) {
						t.Errorf("%s : headerSecret(%s) hors liste blanche", where(x), name)
					}
				}
				_ = sel
			case *ast.IndexExpr:
				if s, ok := x.X.(*ast.SelectorExpr); ok && s.Sel.Name == "Header" {
					t.Errorf("%s : Header[…] interdit (passer par Values)", where(x))
				}
			}
			return true
		})
	}
}

// Spec §36 S14 : reason absent ou exactement "report" ; toute autre valeur → 400 ; jamais
// recopiée dans une réponse.
func TestDestroyReasonClosed(t *testing.T) {
	e := newEnv(t, false, nil)
	for _, tc := range []struct {
		name string
		body map[string]any
		code int
	}{
		{"absent", map[string]any{}, 204},
		{"report", map[string]any{"reason": "report"}, 204},
		{"libre", map[string]any{"reason": "ReperRaison"}, 400},
		{"vide", map[string]any{"reason": ""}, 400},
		{"majuscules", map[string]any{"reason": "REPORT"}, 400},
		{"null", map[string]any{"reason": nil}, 400},
		{"nombre", map[string]any{"reason": 1}, 400},
	} {
		t.Run(tc.name, func(t *testing.T) {
			e.clk.Add(time.Minute)
			k := newKeys()
			c := e.create(t, "", k, 1, 1)
			e.upload(t, c, 1)
			tc.body["proof"] = enc.EncodeToString(k.preuve)
			w := e.do(req{method: "POST", path: "/api/shares/destroy", hdr: access(k), body: mustJSON(tc.body)})
			if w.Code != tc.code || strings.Contains(w.Body.String(), "ReperRaison") {
				t.Fatal(w.Code, w.Body.String())
			}
			if tc.code == 400 {
				expect(t, w, 400, badRequest)
				expect(t, e.do(req{method: "GET", path: "/api/shares/meta", hdr: access(k)}), 200, "") // intact
			}
		})
	}
}

// Spec §36 S18 : aucune réponse (corps ou en-têtes) ne recopie un identifiant, un chemin,
// un en-tête ou un corps reçu ; seules les valeurs d'erreur de la liste fixe sortent.
func TestNoEcho(t *testing.T) {
	e := newEnv(t, false, nil)
	k := newKeys()
	c := e.create(t, "", k, 1, 1)
	e.upload(t, c, 1)
	dl, _ := e.unlock(t, c.ID, k)
	const idOK, idBad = "ReperIdAAAAAAAAAAAAAAA", "ReperIdAAAAAAAAAAAAAAAAAAAA"
	markers := []string{"ReperId", "ReperEntete", "ReperCorps"}
	codes := map[string]bool{"not_found": true, "bad_request": true, "limit": true, "busy": true, "budget": true,
		"internal": true, "gone": true, "incomplete": true, "full": true, "frozen": true, "bad_password": true}
	bodies := [][]byte{nil, []byte(`{"proof":"ReperCorps","reason":"ReperCorps"}`), []byte(`ReperCorps`),
		mustJSON(map[string]string{"ReperCorps": "ReperCorps"})}
	routes := []struct{ method, path string }{
		{"GET", "/api/captcha"}, {"POST", "/api/shares"}, {"PUT", "/api/shares/segments/0"},
		{"POST", "/api/shares/finalize"}, {"GET", "/api/shares/meta"}, {"POST", "/api/shares/unlock"},
		{"GET", "/api/shares/segments/0"}, {"POST", "/api/shares/done"}, {"POST", "/api/shares/destroy"},
		{"GET", "/api/shares/watch"}, {"GET", "/api/manage/status"}, {"POST", "/api/manage/destroy"},
		{"GET", "/api/" + idOK}, {"GET", "/api/shares/" + idBad}, {"PUT", "/api/shares/segments/" + idOK},
		{"GET", "/API/" + idOK}, {"GET", "/healthz"},
	}
	hdrs := []map[string]string{
		{"X-Repere": "ReperEntete", "X-Shh-Access": idOK, "X-Shh-Manage": "ReperEntete"},
		{"X-Repere": "ReperEntete", "Authorization": "Bearer ReperEntete." + idOK},
		{"X-Repere": "ReperEntete", "Authorization": "Bearer " + dl, "User-Agent": "ReperEntete/1.0", "Referer": "https://ReperEntete/" + idOK},
	}
	for _, r := range routes {
		for _, b := range bodies {
			for _, h := range hdrs {
				e.clk.Add(time.Minute) // nouvelle fenêtre de débit
				w := e.do(req{method: r.method, path: r.path, body: b, hdr: h})
				all := w.Body.String()
				for name, vs := range w.Header() {
					all += name + ":" + strings.Join(vs, ",")
				}
				for _, m := range markers {
					if strings.Contains(all, m) {
						t.Fatalf("%s %s : la réponse recopie %s : %q", r.method, r.path, m, all)
					}
				}
				if w.Code >= 400 {
					m := jsonOf(t, w)
					if code, _ := m["error"].(string); !codes[code] {
						t.Fatalf("%s %s : erreur hors liste %q", r.method, r.path, w.Body.String())
					}
				}
			}
		}
	}
}

// Spec §36 S21, §9.5 : /healthz (boucle locale) rend {"ok":true,"reports_alert":…} ; vrai
// à partir de 5 signalements dans l'heure, faux l'heure suivante ; aucun autre champ.
func TestHealthzReportsAlert(t *testing.T) {
	e := newEnv(t, false, nil)
	health := func() string {
		w := e.do(req{method: "GET", path: "/healthz", remote: "127.0.0.1:9"})
		expect(t, w, 200, "")
		if w.Header().Get("Content-Type") != "application/json" {
			t.Fatal(w.Header())
		}
		return strings.TrimSpace(w.Body.String())
	}
	if h := health(); h != `{"ok":true,"reports_alert":false}` {
		t.Fatal(h)
	}
	e.clk.Add(58 * time.Minute) // 11:00
	for i := 0; i < 5; i++ {
		if h := health(); h != `{"ok":true,"reports_alert":false}` {
			t.Fatal(i, h)
		}
		k := newKeys()
		c := e.create(t, "", k, 1, 1)
		e.upload(t, c, 1)
		expect(t, e.do(req{method: "POST", path: "/api/shares/destroy", hdr: access(k),
			body: mustJSON(map[string]string{"proof": enc.EncodeToString(k.preuve), "reason": "report"})}), 204, "")
		e.clk.Add(time.Minute)
	}
	if h := health(); h != `{"ok":true,"reports_alert":true}` {
		t.Fatal(h)
	}
	e.clk.Add(time.Hour)
	if h := health(); h != `{"ok":true,"reports_alert":false}` {
		t.Fatal("heure suivante", h)
	}
}
