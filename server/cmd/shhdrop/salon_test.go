package main

import (
	"bufio"
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"

	"github.com/skoow/shhdrop/server/internal/config"
	"github.com/skoow/shhdrop/server/internal/limits"
	"github.com/skoow/shhdrop/server/internal/salon"
	"github.com/skoow/shhdrop/server/internal/share"
	"github.com/skoow/shhdrop/server/internal/store"
)

// Salon câblé dans le serveur et l'administration (plan C-2 Task 15).

const origineTest = "https://shhdrop.app"

var b64 = base64.RawURLEncoding

func hash(b []byte) []byte { h := sha256.Sum256(b); return h[:] }

func alea(n int) []byte {
	b := make([]byte, n)
	rand.Read(b)
	return b
}

// salonTest : salon inséré directement en base (la création passe par l'anti-robot) : lien
// #c<K_lien>, K_preuve et S_gestion connus.
type salonTest struct {
	lien            string
	kAcces, kPreuve []byte
	sGestion        []byte
	id              string
}

func nouveauSalonTest(t *testing.T) salonTest {
	t.Helper()
	kLien := alea(32)
	lien := "https://shhdrop.app/#c" + b64.EncodeToString(kLien)
	ka, ok := salonAccessKeyOf(lien)
	if !ok {
		t.Fatal("lien de salon refusé")
	}
	return salonTest{lien: lien, kAcces: ka, kPreuve: alea(32), sGestion: alea(32), id: share.NewID()}
}

// insererSalon : ligne du salon (vivant 1 h), comme Manager.Creer.
func insererSalon(t *testing.T, dataDir string, s salonTest) {
	t.Helper()
	db, err := store.OpenExisting(filepath.Join(dataDir, "shares.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	exp := share.Ceil15(time.Now().Unix() + 3600)
	if _, err := db.Exec(`INSERT INTO salons(id,access_v,manage_v,proof_v,salt,kdf_ops,kdf_mem,expires_at,max_members,
		members_can_destroy) VALUES(?,?,?,?,?,3,67108864,?,4,0)`, s.id, hash(s.kAcces), hash(s.sGestion), hash(s.kPreuve),
		alea(16), exp); err != nil {
		t.Fatal(err)
	}
}

// http : requête vers le serveur en marche ; rend le code et le corps.
func appel(t *testing.T, addr, method, path string, hdr map[string]string, body []byte) (int, []byte) {
	t.Helper()
	r, err := http.NewRequest(method, "http://"+addr+path, bytes.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	for k, v := range hdr {
		r.Header.Set(k, v)
	}
	res, err := http.DefaultClient.Do(r)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	b, _ := io.ReadAll(res.Body)
	return res.StatusCode, b
}

// serveurSalon : serve avec SHH_SALONS=1 ; rend l'adresse, la sortie standard et l'arrêt.
func serveurSalon(t *testing.T, dir string) (addr string, stdout *bytes.Buffer, stop func()) {
	t.Helper()
	cfg := config.Config{DataDir: dir, Listen: "127.0.0.1:0", StorageMaxBytes: 1 << 30, Now: time.Now,
		Salons: true, SalonsMax: 200, Origin: origineTest}
	ctx, cancel := context.WithCancel(context.Background())
	pr, pw := io.Pipe()
	errc := make(chan error, 1)
	go func() { errc <- serve(ctx, cfg, pw); pw.Close() }()
	stdout = &bytes.Buffer{}
	br := bufio.NewReader(pr)
	line, err := br.ReadString('\n')
	if err != nil {
		cancel()
		t.Fatalf("serve n'a pas démarré : %v", <-errc)
	}
	stdout.WriteString(line)
	copied := make(chan struct{})
	go func() { io.Copy(stdout, br); close(copied) }()
	stopped := false
	stop = func() {
		if stopped {
			return
		}
		stopped = true
		cancel()
		if err := <-errc; err != nil {
			t.Error("serve :", err)
		}
		<-copied
	}
	t.Cleanup(stop)
	return strings.TrimSuffix(strings.TrimPrefix(line, "SHH_LISTENING "), "\n"), stdout, stop
}

// rejoindre : POST /api/salons/rejoindre (créateur) ; rend le jeton et le rang.
func rejoindre(t *testing.T, addr string, s salonTest) (string, uint64) {
	t.Helper()
	code, b := appel(t, addr, "POST", "/api/salons/rejoindre",
		map[string]string{"X-Shh-Access": b64.EncodeToString(s.kAcces), "X-Shh-Manage": b64.EncodeToString(s.sGestion)},
		[]byte(`{"proof":"`+b64.EncodeToString(s.kPreuve)+`"}`))
	if code != 200 {
		t.Fatalf("rejoindre : %d %s", code, b)
	}
	var r struct {
		Token string `json:"member_token"`
		Seq   uint64 `json:"seq"`
	}
	if err := json.Unmarshal(b, &r); err != nil {
		t.Fatal(err)
	}
	return r.Token, r.Seq
}

// ws : WebSocket du membre, accueil envoyé.
func ws(t *testing.T, addr, jeton string, depuis uint64) *websocket.Conn {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	c, _, err := websocket.Dial(ctx, "ws://"+addr+"/api/salons/ws",
		&websocket.DialOptions{HTTPHeader: http.Header{"Origin": {origineTest}}})
	if err != nil {
		t.Fatal("Dial :", err)
	}
	t.Cleanup(func() { c.CloseNow() })
	if err := c.Write(ctx, websocket.MessageBinary, binary.BigEndian.AppendUint64([]byte(jeton), depuis)); err != nil {
		t.Fatal(err)
	}
	return c
}

// lireJusqua : enregistrements reçus jusqu'au premier de type ty (compris), ou l'erreur de
// lecture (fermeture).
func lireJusqua(t *testing.T, c *websocket.Conn, ty byte) ([][]byte, error) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	var out [][]byte
	for {
		_, b, err := c.Read(ctx)
		if err != nil {
			return out, err
		}
		out = append(out, b)
		if b[0] == ty {
			return out, nil
		}
	}
}

func trame() []byte {
	t := alea(salon.TailleTrame)
	copy(t, "SHC3")
	t[4] = 0 // non volatile, règle « désactivé »
	return t
}

// Un salon complet (entrée, WebSocket, trame, pièce envoyée puis lue), puis destruction par
// l'administrateur pendant que le serveur tourne : 0x05 raison 2 et fermeture 1000 au tick
// suivant ; ligne, pièce et conversation effacées ; la sortie de la commande ne reprend pas le
// lien ; stdout du serveur ne contient que SHH_LISTENING, stderr reste vide.
func TestSalonCompletPuisAdminDestroy(t *testing.T) {
	stderr := capturerStderr(t)
	dir := t.TempDir()
	addr, stdout, stop := serveurSalon(t, dir)
	s := nouveauSalonTest(t)
	insererSalon(t, dir, s)
	jeton, seq := rejoindre(t, addr, s)
	c := ws(t, addr, jeton, seq)
	if _, err := lireJusqua(t, c, 0x07); err != nil {
		t.Fatal("accueil :", err)
	}
	tr := trame()
	if err := c.Write(context.Background(), websocket.MessageBinary, append([]byte{0x01}, tr...)); err != nil {
		t.Fatal(err)
	}
	recus, err := lireJusqua(t, c, 0x01)
	if err != nil || !bytes.Equal(recus[len(recus)-1][18:], tr) {
		t.Fatal("écho de la trame :", err)
	}
	membre := map[string]string{"X-Shh-Membre": jeton}
	code, b := appel(t, addr, "POST", "/api/salons/pieces", membre, []byte(`{"bucket":1,"vocal":false}`))
	if code != 201 {
		t.Fatalf("pièce : %d %s", code, b)
	}
	var p struct {
		Piece string `json:"piece"`
		Token string `json:"upload_token"`
	}
	if err := json.Unmarshal(b, &p); err != nil {
		t.Fatal(err)
	}
	envoi := map[string]string{"Authorization": "Bearer " + p.Token}
	for n := range share.SegmentCount(1) {
		if code, b := appel(t, addr, "PUT", fmt.Sprintf("/api/salons/pieces/segments/%d", n), envoi,
			alea(share.SegmentSize(1, n))); code != 204 {
			t.Fatalf("segment %d : %d %s", n, code, b)
		}
	}
	if code, b := appel(t, addr, "POST", "/api/salons/pieces/finalize", envoi, []byte(`{"fill_from":0,"fill_to":0}`)); code != 200 {
		t.Fatalf("finalize : %d %s", code, b)
	}
	lecture := map[string]string{"X-Shh-Membre": jeton, "X-Shh-Piece": p.Piece}
	if code, b := appel(t, addr, "GET", "/api/salons/pieces/segments/0", lecture, nil); code != 200 || len(b) != share.SegmentSize(1, 0) {
		t.Fatalf("lecture : %d (%d octets)", code, len(b))
	}
	conv := filepath.Join(dir, "salons", s.id)
	if _, err := os.Stat(conv); err != nil {
		t.Fatal("conversation absente :", err)
	}

	cfg := config.Config{DataDir: dir, Now: time.Now, StorageMaxBytes: 1 << 30}
	var o, e bytes.Buffer
	if code := runAdmin([]string{"destroy", "-"}, cfg, strings.NewReader(s.lien+"\n"), &o, &e); code != 0 {
		t.Fatalf("admin destroy : %d %q", code, e.String())
	}
	if want := "1 salon détruit (" + dir + ")\n"; o.String() != want || e.Len() != 0 {
		t.Fatalf("sortie %q %q, attendu %q", o.String(), e.String(), want)
	}
	cle := s.lien[strings.LastIndexByte(s.lien, '#')+1:]
	if strings.Contains(o.String()+e.String(), cle) || strings.Contains(o.String()+e.String(), s.id) {
		t.Fatal("la sortie reprend le lien ou l'identifiant")
	}
	fin, err := lireJusqua(t, c, 0x05)
	if err != nil || !bytes.Equal(fin[len(fin)-1][9:], []byte{2}) {
		t.Fatal("0x05 raison 2 attendu :", err)
	}
	if _, err := lireJusqua(t, c, 0xFF); websocket.CloseStatus(err) != websocket.StatusNormalClosure {
		t.Fatal("fermeture 1000 attendue :", err)
	}
	if _, err := os.Stat(conv); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("conversation gardée :", err)
	}
	if _, err := os.Stat(filepath.Join(dir, "salon-pieces", p.Piece)); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("pièce gardée :", err)
	}
	if code, _ := appel(t, addr, "GET", "/api/salons/meta", map[string]string{"X-Shh-Access": b64.EncodeToString(s.kAcces)}, nil); code != 404 {
		t.Fatal("meta après destruction :", code)
	}
	// Deuxième fois : introuvable (code 1), sans le lien.
	o.Reset()
	e.Reset()
	if code := runAdmin([]string{"destroy", "-"}, cfg, strings.NewReader(s.lien+"\n"), &o, &e); code != 1 ||
		!strings.Contains(e.String(), "introuvable") || strings.Contains(e.String(), cle) {
		t.Fatalf("deuxième destroy : %d %q", code, e.String())
	}
	stop()
	if got := stdout.String(); !strings.HasPrefix(got, "SHH_LISTENING 127.0.0.1:") || strings.Count(got, "\n") != 1 {
		t.Fatalf("stdout : %q", got)
	}
	if got := stderr(); got != "" {
		t.Fatalf("stderr : %q", got)
	}
}

// capturerStderr : os.Stderr redirigé pendant le test ; la fonction rendue le restaure et rend
// ce qui y a été écrit.
func capturerStderr(t *testing.T) func() string {
	t.Helper()
	r, w, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	orig := os.Stderr
	os.Stderr = w
	var buf bytes.Buffer
	done := make(chan struct{})
	go func() { io.Copy(&buf, r); close(done) }()
	fini := false
	rendre := func() string {
		if !fini {
			fini = true
			os.Stderr = orig
			w.Close()
			<-done
		}
		return buf.String()
	}
	t.Cleanup(func() { rendre() })
	return rendre
}

// Vecteurs « cles » de engine/vectors/salon-v3.json : K_accès_s = HKDF-SHA-256(K_lien, sel vide,
// « shhdrop/v2/salon/acces », 32), V_accès_s = SHA-256(K_accès_s). Seul un lien #c<43> est un
// lien de salon (ni #<43> d'un partage, ni #m<43> de gestion).
func TestSalonAccessKeyOfVecteurs(t *testing.T) {
	raw, err := os.ReadFile("../../../engine/vectors/salon-v3.json")
	if err != nil {
		t.Fatal(err)
	}
	var v struct {
		Cles []struct {
			KLien  string `json:"k_lien"`
			KAcces string `json:"k_acces"`
			VAcces string `json:"v_acces"`
		} `json:"cles"`
	}
	if err := json.Unmarshal(raw, &v); err != nil || len(v.Cles) == 0 {
		t.Fatal("vecteurs illisibles :", err)
	}
	for _, c := range v.Cles {
		kl, _ := hex.DecodeString(c.KLien)
		key := b64.EncodeToString(kl)
		for _, in := range []string{"c" + key, "https://shhdrop.app/#c" + key} {
			ka, ok := salonAccessKeyOf(in)
			if !ok || hex.EncodeToString(ka) != c.KAcces || hex.EncodeToString(hash(ka)) != c.VAcces {
				t.Fatalf("%s : %x %v", c.KLien, ka, ok)
			}
		}
		for _, bad := range []string{key, "https://x/#" + key, "https://x/#m" + key, "c" + key[:42], "c" + key + "A"} {
			if _, ok := salonAccessKeyOf(bad); ok {
				t.Fatalf("%q accepté comme lien de salon", bad)
			}
		}
	}
}

// Sans serveur : destroy - d'un lien #c supprime ligne, pièces (fichier puis ligne) et
// conversation ; une base d'une version antérieure est refusée (rien n'est fait).
func TestAdminDestroySalonHorsLigne(t *testing.T) {
	cfg, _ := adminSetup(t)
	s := nouveauSalonTest(t)
	insererSalon(t, cfg.DataDir, s)
	autre := nouveauSalonTest(t)
	insererSalon(t, cfg.DataDir, autre)
	piece := share.NewID()
	db, err := store.OpenExisting(filepath.Join(cfg.DataDir, "shares.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if _, err := db.Exec(`INSERT INTO salon_pieces(id,salon_id,bucket,state,segments_mask) VALUES(?,?,1,'ready',x'')`,
		piece, s.id); err != nil {
		t.Fatal(err)
	}
	for _, f := range []string{filepath.Join("salon-pieces", piece), filepath.Join("salons", s.id), filepath.Join("salons", autre.id)} {
		if err := os.MkdirAll(filepath.Dir(filepath.Join(cfg.DataDir, f)), 0o700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(cfg.DataDir, f), []byte("x"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := db.Exec(`PRAGMA user_version=1`); err != nil {
		t.Fatal(err)
	}
	code, out, e := runIn(cfg, s.lien+"\n", "destroy", "-")
	if code != 1 || !strings.Contains(e, "version antérieure") || salonLignes(t, db, s.id) != 1 {
		t.Fatalf("base ancienne : %d %q %q", code, out, e)
	}
	if _, err := db.Exec(`PRAGMA user_version=` + fmt.Sprint(store.SchemaVersion)); err != nil {
		t.Fatal(err)
	}
	code, out, e = runIn(cfg, s.lien+"\n", "destroy", "-")
	if code != 0 || !strings.Contains(out, "1 salon détruit") {
		t.Fatalf("destroy : %d %q %q", code, out, e)
	}
	for _, f := range []string{filepath.Join("salon-pieces", piece), filepath.Join("salons", s.id)} {
		if _, err := os.Stat(filepath.Join(cfg.DataDir, f)); !errors.Is(err, os.ErrNotExist) {
			t.Fatal(f, "gardé :", err)
		}
	}
	var n int
	db.QueryRow(`SELECT count(*) FROM salon_pieces`).Scan(&n)
	if salonLignes(t, db, s.id) != 0 || n != 0 {
		t.Fatal("lignes gardées")
	}
	if salonLignes(t, db, autre.id) != 1 {
		t.Fatal("autre salon touché")
	}
	if _, err := os.Stat(filepath.Join(cfg.DataDir, "salons", autre.id)); err != nil {
		t.Fatal("conversation d'un autre salon touchée :", err)
	}
}

func salonLignes(t *testing.T, db *sql.DB, id string) int {
	t.Helper()
	var n int
	if err := db.QueryRow(`SELECT count(*) FROM salons WHERE id=?`, id).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

// wipe --yes efface aussi salons, pièces et conversations.
func TestWipeSalons(t *testing.T) {
	cfg, _ := adminSetup(t)
	s := nouveauSalonTest(t)
	insererSalon(t, cfg.DataDir, s)
	for _, f := range []string{filepath.Join("salon-pieces", share.NewID()), filepath.Join("salons", s.id)} {
		if err := os.MkdirAll(filepath.Dir(filepath.Join(cfg.DataDir, f)), 0o700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(cfg.DataDir, f), []byte("x"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	code, out, e := run(cfg, "wipe", "--yes")
	if code != 0 || !strings.Contains(out, "1 salons effacés") {
		t.Fatalf("wipe : %d %q %q", code, out, e)
	}
	for _, d := range []string{"salon-pieces", "salons"} {
		if es, err := os.ReadDir(filepath.Join(cfg.DataDir, d)); err != nil || len(es) != 0 {
			t.Fatalf("%s : %d entrées, %v", d, len(es), err)
		}
	}
	db, err := store.OpenExisting(filepath.Join(cfg.DataDir, "shares.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if salonLignes(t, db, s.id) != 0 {
		t.Fatal("ligne du salon gardée")
	}
}

// Salon désactivé : aucun gestionnaire, ExtraUsed des partages non câblé, aucun dossier du
// salon créé. Activé : gestionnaire, ExtraUsed câblé, dossiers 0700 (même s'ils existaient en
// 0755), purge faite (fichiers laissés par un arrêt effacés).
func TestSetupSalons(t *testing.T) {
	for _, actif := range []bool{false, true} {
		cfg, svc := adminSetup(t)
		cfg.Salons, cfg.SalonsMax, cfg.Origin = actif, 200, origineTest
		reste := filepath.Join(cfg.DataDir, "salons", share.NewID())
		if actif {
			if err := os.MkdirAll(filepath.Dir(reste), 0o755); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(reste, []byte("x"), 0o600); err != nil {
				t.Fatal(err)
			}
		}
		m, err := setupSalons(cfg, svc.DB, svc, limits.New(time.Now), nil, nil, nil)
		if err != nil {
			t.Fatal(err)
		}
		if !actif {
			if m != nil || svc.ExtraUsed != nil {
				t.Fatal("salon désactivé : gestionnaire ou ExtraUsed câblé")
			}
			for _, d := range []string{"salons", "salon-pieces"} {
				if _, err := os.Stat(filepath.Join(cfg.DataDir, d)); !errors.Is(err, os.ErrNotExist) {
					t.Fatal(d, "créé alors que le salon est désactivé")
				}
			}
			continue
		}
		if m == nil || svc.ExtraUsed == nil {
			t.Fatal("salon actif : gestionnaire ou ExtraUsed absent")
		}
		if _, err := os.Stat(reste); !errors.Is(err, os.ErrNotExist) {
			t.Fatal("purge au démarrage non faite :", err)
		}
		for _, d := range []string{"salons", "salon-pieces"} {
			if fi, err := os.Stat(filepath.Join(cfg.DataDir, d)); err != nil || fi.Mode().Perm() != 0o700 {
				t.Fatal(d, "droits :", err)
			}
		}
	}
}

// Relecture Task 12 : aucun double compte. Le gestionnaire voit les partages par UsedShares
// (sans ExtraUsed), les partages voient le salon par ExtraUsed : avec SHH_STORAGE_MAX juste
// égal à partages + salon + 2 Gio, une création de salon passe ; un octet de moins, non. Le
// partage voit, lui, exactement partages + salon.
func TestSalonSansDoubleCompte(t *testing.T) {
	salonOctets := int64(salon.TaillePalier) // une trame non volatile sur disque : un palier
	for _, marge := range []int64{0, -1} {
		cfg, svc := adminSetup(t)
		cfg.Salons, cfg.SalonsMax, cfg.Origin = true, 200, origineTest
		if _, _, err := svc.Create(share.CreateReq{ID: share.NewID(), Bucket: 1, AccessV: hash(alea(32)),
			ManageV: hash(alea(32))}); err != nil {
			t.Fatal(err)
		}
		partage := share.TotalSize(1)
		cfg.StorageMaxBytes = partage + salonOctets + 2<<30 + marge
		svc.StorageMax = cfg.StorageMaxBytes
		m, err := setupSalons(cfg, svc.DB, svc, limits.New(time.Now), nil, nil, nil)
		if err != nil {
			t.Fatal(err)
		}
		creer := func() error {
			cs := nouveauSalonTest(t)
			_, err := m.Creer(salon.CreerReq{AccessV: hash(cs.kAcces), ManageV: hash(cs.sGestion), ProofV: hash(cs.kPreuve),
				Salt: alea(16), TTLHours: 1, MaxMembers: 2, KdfOps: 3, KdfMem: 67108864, Bloc: [32]byte(alea(32))})
			if err == nil {
				e, err := m.Rejoindre(cs.kAcces, cs.kPreuve, cs.sGestion)
				if err != nil {
					t.Fatal(err)
				}
				mb, err := m.Membre(e.Jeton[:])
				if err != nil {
					t.Fatal(err)
				}
				if _, err := m.Recevoir(mb, trame(), nil); err != nil {
					t.Fatal(err)
				}
			}
			return err
		}
		if err := creer(); err != nil {
			t.Fatal("premier salon :", err)
		}
		if u, err := svc.UsedShares(); err != nil || u != partage {
			t.Fatal("UsedShares :", u, err)
		}
		if u := svc.ExtraUsed(); u != salonOctets {
			t.Fatal("ExtraUsed :", u)
		}
		switch err := creer(); {
		case marge == 0 && err != nil:
			t.Fatal("place juste suffisante refusée (double compte ?) :", err)
		case marge < 0 && !errors.Is(err, salon.ErrBusy):
			t.Fatal("un octet de trop accepté :", err)
		}
	}
}

// checkStorage compte, au démarrage, l'usage des partages et celui du salon.
func TestUsageAuDemarrage(t *testing.T) {
	cfg, svc := adminSetup(t)
	cfg.Salons, cfg.SalonsMax, cfg.Origin = true, 200, origineTest
	m, err := setupSalons(cfg, svc.DB, svc, limits.New(time.Now), nil, nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := svc.Create(share.CreateReq{ID: share.NewID(), Bucket: 1, AccessV: hash(alea(32)),
		ManageV: hash(alea(32))}); err != nil {
		t.Fatal(err)
	}
	cs := nouveauSalonTest(t)
	if _, err := m.Creer(salon.CreerReq{AccessV: hash(cs.kAcces), ManageV: hash(cs.sGestion), ProofV: hash(cs.kPreuve),
		Salt: alea(16), TTLHours: 1, MaxMembers: 2, KdfOps: 3, KdfMem: 67108864, Bloc: [32]byte(alea(32))}); err != nil {
		t.Fatal(err)
	}
	if _, err := m.Rejoindre(cs.kAcces, cs.kPreuve, nil); err != nil {
		t.Fatal(err)
	}
	e, _ := m.Rejoindre(cs.kAcces, cs.kPreuve, cs.sGestion)
	mb, _ := m.Membre(e.Jeton[:])
	if _, err := m.Recevoir(mb, trame(), nil); err != nil {
		t.Fatal(err)
	}
	u, err := usedAtStart(svc, m)
	if err != nil || u != share.TotalSize(1)+salon.TaillePalier {
		t.Fatal("usage au démarrage :", u, err)
	}
}

// Audit adverse du 13 novembre, front serveur : le contrôle de démarrage (config.checkSalons)
// et le gestionnaire du salon calculent la même part de trames par salon et le même budget de
// journal (config ne dépend pas du paquet salon : deux écritures, tenues égales ici).
func TestPartDesSalonsMemeCalcul(t *testing.T) {
	for _, c := range [][3]int{{1966080, 200, 100000}, {1000000, 500, 100000}, {1000, 200, 100000}, {5, 2000, 10},
		{10000000, 10, 100000}, {0, 200, 100000}, {20000000, 10000, 100000}} {
		part, pot := salon.PartTrames(c[0], c[1], c[2])
		if got := config.SalonFramesShare(c[0], c[1], c[2]); got != part || (c[0] > 0 && c[1]*part+pot != c[0]) {
			t.Errorf("%v : config %d, salon %d (pot %d)", c, got, part, pot)
		}
	}
	if config.WebSocketMem != salon.MemoireParConnexion {
		t.Fatal("budget d'un WebSocket :", config.WebSocketMem, salon.MemoireParConnexion)
	}
	if config.SalonJournalMem != salon.MemoireJournalMax {
		t.Fatal("budget du journal :", config.SalonJournalMem, salon.MemoireJournalMax)
	}
}
