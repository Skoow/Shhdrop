package main

import (
	"bufio"
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/skoow/shhdrop/server/internal/adminui"
	"github.com/skoow/shhdrop/server/internal/config"
)

const jetonAdmin = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"

// serveAdmin : serve avec le tableau de bord ; rend les lignes de sortie (2 attendues).
func serveAdmin(t *testing.T, cfg config.Config, lignes int) []string {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	pr, pw := io.Pipe()
	errc := make(chan error, 1)
	go func() { errc <- serve(ctx, cfg, pw); pw.Close() }()
	sc := bufio.NewScanner(pr)
	var out []string
	for len(out) < lignes && sc.Scan() {
		out = append(out, sc.Text())
	}
	if len(out) < lignes {
		cancel()
		t.Fatalf("serve : %d lignes sur %d : %v", len(out), lignes, <-errc)
	}
	go io.Copy(io.Discard, pr)
	t.Cleanup(func() {
		cancel()
		if err := <-errc; err != nil {
			t.Error(err)
		}
	})
	return out
}

func cfgAdmin(dir string) config.Config {
	c := baseCfg(dir)
	c.AdminListen, c.AdminTokenHash = "127.0.0.1:0", sha256.Sum256([]byte(jetonAdmin))
	return c
}

func adminReq(t *testing.T, method, url, jeton, corps string) (int, string) {
	t.Helper()
	r, err := http.NewRequest(method, url, strings.NewReader(corps))
	if err != nil {
		t.Fatal(err)
	}
	if jeton != "" {
		r.Header.Set("Authorization", "Bearer "+jeton)
	}
	res, err := http.DefaultClient.Do(r)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	b, _ := io.ReadAll(res.Body)
	return res.StatusCode, string(b)
}

// chainesDe : toutes les chaînes (valeurs) d'un JSON décodé.
func chainesDe(v any, out *[]string) {
	switch x := v.(type) {
	case string:
		*out = append(*out, x)
	case map[string]any:
		for _, e := range x {
			chainesDe(e, out)
		}
	case []any:
		for _, e := range x {
			chainesDe(e, out)
		}
	}
}

// Bout en bout : écouteur distinct, état agrégé sans identifiant ni adresse, gel et dégel,
// routes d'administration absentes du port public.
func TestTableauDeBord(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "data")
	out := serveAdmin(t, cfgAdmin(dir), 2)
	pub, ok1 := strings.CutPrefix(out[0], "SHH_LISTENING ")
	adm, ok2 := strings.CutPrefix(out[1], "SHH_ADMIN_LISTENING ")
	if !ok1 || !ok2 || pub == adm || !strings.HasPrefix(adm, "127.0.0.1:") {
		t.Fatalf("sortie %q", out)
	}

	// Une ligne de salon existe en base : son identifiant ne doit paraître nulle part.
	s := nouveauSalonTest(t)
	insererSalon(t, dir, s)

	code, body := adminReq(t, "GET", "http://"+adm+"/api/etat", jetonAdmin, "")
	if code != 200 {
		t.Fatalf("état : %d %s", code, body)
	}
	var brut any
	var st adminui.State
	if json.Unmarshal([]byte(body), &brut) != nil || json.Unmarshal([]byte(body), &st) != nil {
		t.Fatalf("JSON : %s", body)
	}
	var chaines []string
	chainesDe(brut, &chaines)
	goVersion, rev := adminui.Build()
	for _, c := range chaines {
		if c != goVersion && c != rev && c != "" {
			t.Errorf("chaîne inattendue dans l'état : %q", c)
		}
	}
	// Ni identifiant, ni adresse IP, ni date, ni chemin dans le texte de la réponse.
	if strings.Contains(body, s.id) || strings.Contains(body, dir) ||
		regexp.MustCompile(`\d+\.\d+\.\d+\.\d+|20\d\d-\d\d-\d\d`).MatchString(body) {
		t.Fatalf("fuite dans l'état : %s", body)
	}
	if st.Stockage.Plafond != 1<<30 || st.Stockage.Restant != 1<<30 || st.Stockage.Reserve != 1<<27 ||
		st.Stockage.DisqueLibre == 0 || st.Stockage.DisqueTotal < st.Stockage.DisqueLibre ||
		st.Sante.Gele || st.Sante.SalonActif || st.Salon != nil || st.Sante.AlerteSignalements ||
		st.Memoire.Goroutines == 0 || st.Memoire.Utilisee == 0 ||
		st.Capacite.EnvoisMax == 0 || st.Capacite.LecturesMax == 0 || st.Capacite.AppelsDisqueMax == 0 {
		t.Fatalf("état incohérent : %+v", st)
	}

	// Gel puis dégel, comme « shhdrop admin freeze|unfreeze ».
	gele := func() bool {
		_, b := adminReq(t, "GET", "http://"+adm+"/api/etat", jetonAdmin, "")
		var e adminui.State
		json.Unmarshal([]byte(b), &e)
		return e.Sante.Gele
	}
	if c, _ := adminReq(t, "POST", "http://"+adm+"/api/geler", jetonAdmin, ""); c != 200 || !gele() {
		t.Fatal("geler")
	}
	if _, err := os.Stat(filepath.Join(dir, "frozen")); err != nil {
		t.Fatal("fichier de gel absent")
	}
	if c, _ := adminReq(t, "POST", "http://"+adm+"/api/geler", jetonAdmin, ""); c != 200 || !gele() {
		t.Fatal("geler deux fois")
	}
	if c, _ := adminReq(t, "POST", "http://"+adm+"/api/degeler", jetonAdmin, ""); c != 200 || gele() {
		t.Fatal("dégeler")
	}

	// Sans jeton : rien. Sur le port public : aucune route d'administration, ni la page.
	if c, b := adminReq(t, "GET", "http://"+adm+"/api/etat", "", ""); c != 404 || strings.Contains(b, "sante") {
		t.Fatalf("état sans jeton : %d", c)
	}
	for _, p := range []string{"/api/etat", "/api/geler", "/api/detruire", "/admin.js", "/admin.css"} {
		for _, m := range []string{"GET", "POST"} {
			c, b := adminReq(t, m, "http://"+pub+p, jetonAdmin, "")
			if c == 200 || strings.Contains(b, "sante") || strings.Contains(b, "Poste de pilotage") || strings.Contains(b, "jeton") {
				t.Errorf("port public %s %s : %d %s", m, p, c, b)
			}
		}
	}
	if _, b := adminReq(t, "GET", "http://"+pub+"/", "", ""); strings.Contains(b, "Poste de pilotage") {
		t.Fatal("la page d'administration est servie sur le port public")
	}
	if _, err := os.Stat(filepath.Join(dir, "frozen")); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("le port public a gelé le serveur")
	}
}

// Désactivé par défaut : sans SHH_ADMIN_LISTEN, une seule ligne de sortie et un seul écouteur.
func TestTableauDeBordDesactiveParDefaut(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	pr, pw := io.Pipe()
	errc := make(chan error, 1)
	go func() { errc <- serve(ctx, baseCfg(filepath.Join(t.TempDir(), "data")), pw); pw.Close() }()
	sc := bufio.NewScanner(pr)
	if !sc.Scan() {
		t.Fatal(<-errc)
	}
	cancel()
	rest, _ := io.ReadAll(pr)
	if err := <-errc; err != nil || len(rest) != 0 || !strings.HasPrefix(sc.Text(), "SHH_LISTENING ") || sc.Scan() {
		t.Fatalf("sortie en trop : %q %v", rest, err)
	}
}

// L'écouteur d'administration ne s'ouvre pas : une ligne fixe le dit, sans détail système,
// et le serveur public sert quand même.
func TestTableauDeBordIndisponible(t *testing.T) {
	orig := adminListen
	adminListen = func(string) (net.Listener, error) { return nil, errors.New("bind /chemin/SECRET : refusé") }
	t.Cleanup(func() { adminListen = orig })
	out := serveAdmin(t, cfgAdmin(filepath.Join(t.TempDir(), "data")), 2)
	if out[1] != "SHH_ADMIN_INDISPONIBLE" {
		t.Fatalf("sortie %q", out)
	}
	pub := strings.TrimPrefix(out[0], "SHH_LISTENING ")
	res, err := http.Get("http://" + pub + "/")
	if err != nil || res.StatusCode != 200 {
		t.Fatalf("serveur public : %v", err)
	}
	res.Body.Close()
}

// Destruction d'un lien signalé depuis la page : partage, salon, lien de gestion refusé,
// lien inconnu ; les autres ne sont pas touchés.
func TestAdminDestroyDepuisLaPage(t *testing.T) {
	cfg, svc := adminSetup(t)
	d := adminDeps{svc: svc, db: svc.DB, start: time.Now(), alert: func() bool { return false }}
	_, lien := mkLink(t, svc)
	mk(t, svc)
	if kind, err := adminDestroy(cfg, d, []byte(lien+"\n")); err != nil || kind != "partage" || count(t, svc) != 1 {
		t.Fatalf("partage : %q %v, reste %d", kind, err, count(t, svc))
	}
	if _, err := adminDestroy(cfg, d, []byte(lien)); !errors.Is(err, adminui.ErrIntrouvable) || count(t, svc) != 1 {
		t.Fatalf("déjà détruit : %v", err)
	}
	for _, mauvais := range []string{"", "bonjour", "https://exemple.org/", "https://exemple.org/#m" + strings.Repeat("A", 43),
		lien + "\n" + lien, "https://exemple.org/#" + strings.Repeat("A", 42)} {
		if _, err := adminDestroy(cfg, d, []byte(mauvais)); !errors.Is(err, adminui.ErrLienInvalide) {
			t.Errorf("%q : %v", mauvais, err)
		}
	}
	s, autre := nouveauSalonTest(t), nouveauSalonTest(t)
	insererSalon(t, cfg.DataDir, s)
	insererSalon(t, cfg.DataDir, autre)
	if kind, err := adminDestroy(cfg, d, []byte(s.lien)); err != nil || kind != "salon" ||
		salonLignes(t, svc.DB, s.id) != 0 || salonLignes(t, svc.DB, autre.id) != 1 {
		t.Fatalf("salon : %q %v", kind, err)
	}
	if _, err := adminDestroy(cfg, d, []byte(s.lien)); !errors.Is(err, adminui.ErrIntrouvable) {
		t.Fatalf("salon déjà détruit : %v", err)
	}
	if count(t, svc) != 1 {
		t.Fatal("un partage a disparu")
	}
}
