package salon

import (
	"bytes"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"testing/synctest"
	"time"

	"github.com/skoow/shhdrop/server/internal/blob"
	"github.com/skoow/shhdrop/server/internal/share"
	"github.com/skoow/shhdrop/server/internal/store"
)

// horloge : horloge figée, avancée à la main.
type horloge struct {
	mu sync.Mutex
	t  time.Time
}

func (h *horloge) Now() time.Time {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.t
}

func (h *horloge) avancer(d time.Duration) {
	h.mu.Lock()
	h.t = h.t.Add(d)
	h.mu.Unlock()
}

type banc struct {
	m   *Manager
	db  *sql.DB
	h   *horloge
	dir string
	cfg Config
}

// nouveauBanc : base temporaire (shares.db), horloge figée au 12 novembre 2026, 10:07:30.
func nouveauBanc(t *testing.T, max int) *banc {
	t.Helper()
	dir := t.TempDir()
	db, err := store.Open(filepath.Join(dir, "shares.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	if err := os.MkdirAll(filepath.Join(dir, "pieces"), 0o700); err != nil {
		t.Fatal(err)
	}
	h := &horloge{t: time.Date(2026, 11, 12, 10, 7, 30, 0, time.UTC)}
	cfg := Config{
		DB: db, Pieces: &blob.Store{Dir: filepath.Join(dir, "pieces")},
		DossierConversations: filepath.Join(dir, "salons"), Now: h.Now, Max: max,
		StorageMax: 200 << 30, UsedPartages: func() (int64, error) { return 0, nil },
	}
	m, err := NewManager(cfg)
	if err != nil {
		t.Fatal(err)
	}
	// Limites par siège coupées : ces tests envoient des centaines de trames à horloge figée
	// (bancLimite, limites_test.go, les rétablit).
	m.sansLimiteSiege = true
	return &banc{m: m, db: db, h: h, dir: dir, cfg: cfg}
}

// secret : 32 octets reconnaissables.
func secret(graine byte) []byte { return bytes.Repeat([]byte{graine}, 32) }

type cles struct{ acces, preuve, gestion []byte }

// aleatoire : 32 octets de crypto/rand.
func aleatoire() []byte {
	b := make([]byte, 32)
	rand.Read(b)
	return b
}

// nouvellesCles : secrets tirés au hasard (jamais égaux entre eux ni à secret(0xEE)).
func nouvellesCles() cles { return cles{aleatoire(), aleatoire(), aleatoire()} }

// reqValide : création valide, d'un bloc tiré au hasard (le plafond par bloc ne joue pas).
func reqValide(c cles) CreerReq {
	return CreerReq{
		AccessV: share.Verifier(c.acces), ManageV: share.Verifier(c.gestion), ProofV: share.Verifier(c.preuve),
		Salt: bytes.Repeat([]byte{7}, 16), TTLHours: 24, MaxMembers: 10, KdfOps: 3, KdfMem: 67108864,
		Bloc: [32]byte(aleatoire()),
	}
}

// creer : salon valide de max membres.
func (b *banc) creer(t *testing.T, max int) cles {
	t.Helper()
	c := nouvellesCles()
	r := reqValide(c)
	r.MaxMembers = max
	if _, err := b.m.Creer(r); err != nil {
		t.Fatal(err)
	}
	return c
}

// etat : état mémoire du salon (nil s'il n'existe pas).
func (b *banc) etat(t *testing.T, c cles) *salon {
	t.Helper()
	var id string
	if err := b.db.QueryRow(`SELECT id FROM salons WHERE access_v=?`, share.Verifier(c.acces)).Scan(&id); err != nil {
		t.Fatal(err)
	}
	b.m.mu.Lock()
	defer b.m.mu.Unlock()
	return b.m.salons[id]
}

func (b *banc) entrer(t *testing.T, c cles, createur bool) Entree {
	t.Helper()
	var g []byte
	if createur {
		g = c.gestion
	}
	e, err := b.m.Rejoindre(c.acces, c.preuve, g)
	if err != nil {
		t.Fatal(err)
	}
	return e
}

// depart : libère le siège (comme 0x03).
func (b *banc) depart(s *salon, siege uint8) {
	s.mu.Lock()
	defer s.mu.Unlock()
	b.m.departLocked(s, siege)
}

func occupes(s *salon) int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.occupesLocked()
}

func TestNewManagerChampManquant(t *testing.T) {
	b := nouveauBanc(t, 200)
	casses := map[string]func(*Config){
		"DB":                   func(c *Config) { c.DB = nil },
		"Pieces":               func(c *Config) { c.Pieces = nil },
		"DossierConversations": func(c *Config) { c.DossierConversations = "" },
		"Now":                  func(c *Config) { c.Now = nil },
		"Max":                  func(c *Config) { c.Max = 0 },
		"StorageMax":           func(c *Config) { c.StorageMax = 0 },
		"UsedPartages":         func(c *Config) { c.UsedPartages = nil },
	}
	for nom, casser := range casses {
		c := b.cfg
		casser(&c)
		if _, err := NewManager(c); err == nil {
			t.Errorf("%s manquant accepté", nom)
		}
	}
}

func TestCreerValide(t *testing.T) {
	b := nouveauBanc(t, 200)
	c := nouvellesCles()
	r := reqValide(c)
	r.TTLHours, r.MaxMembers, r.MembersCanDestroy = 6, 4, true
	d, err := b.m.Creer(r)
	if err != nil {
		t.Fatal(err)
	}
	// 10:07:30 + 6 h → 16:15:00.
	if d != 6*time.Hour+7*time.Minute+30*time.Second {
		t.Fatal("expires_in", d)
	}
	var (
		id                     string
		av, mv, pv, salt       []byte
		ops, mem, max, mcd, fa int
		exp, pb                int64
	)
	if err := b.db.QueryRow(`SELECT id,access_v,manage_v,proof_v,salt,kdf_ops,kdf_mem,expires_at,max_members,
		members_can_destroy,failed_attempts,pieces_bytes FROM salons`).Scan(&id, &av, &mv, &pv, &salt, &ops, &mem, &exp,
		&max, &mcd, &fa, &pb); err != nil {
		t.Fatal(err)
	}
	if _, err := share.DecodeB64(id, 16); err != nil {
		t.Fatal("id", id)
	}
	if !bytes.Equal(av, r.AccessV) || !bytes.Equal(mv, r.ManageV) || !bytes.Equal(pv, r.ProofV) || !bytes.Equal(salt, r.Salt) ||
		ops != 3 || mem != 67108864 || max != 4 || mcd != 1 || fa != 0 || pb != 0 ||
		exp != time.Date(2026, 11, 12, 16, 15, 0, 0, time.UTC).Unix() {
		t.Fatal("ligne", ops, mem, max, mcd, fa, pb, exp)
	}
	m, err := b.m.Meta(c.acces)
	if err != nil || m.ExpiresIn != d || !bytes.Equal(m.Salt, r.Salt) || m.KdfOps != 3 || m.KdfMem != 67108864 {
		t.Fatal("meta", m, err)
	}
}

func TestCreerRefuse(t *testing.T) {
	b := nouveauBanc(t, 200)
	vide := sha256.Sum256(nil)
	cas := map[string]func(*CreerReq){
		"ttl 2":           func(r *CreerReq) { r.TTLHours = 2 },
		"ttl 0":           func(r *CreerReq) { r.TTLHours = 0 },
		"ttl énorme":      func(r *CreerReq) { r.TTLHours = 1 << 62 },
		"max_members 1":   func(r *CreerReq) { r.MaxMembers = 1 },
		"max_members 11":  func(r *CreerReq) { r.MaxMembers = 11 },
		"kdf_ops 2":       func(r *CreerReq) { r.KdfOps = 2 },
		"kdf_mem 32 Mio":  func(r *CreerReq) { r.KdfMem = 32 << 20 },
		"sel de 15":       func(r *CreerReq) { r.Salt = r.Salt[:15] },
		"sel absent":      func(r *CreerReq) { r.Salt = nil },
		"proof_v vide":    func(r *CreerReq) { r.ProofV = vide[:] },
		"proof_v de 31":   func(r *CreerReq) { r.ProofV = r.ProofV[:31] },
		"access_v vide":   func(r *CreerReq) { r.AccessV = vide[:] },
		"access_v absent": func(r *CreerReq) { r.AccessV = nil },
		"manage_v vide":   func(r *CreerReq) { r.ManageV = vide[:] },
		"manage_v de 33":  func(r *CreerReq) { r.ManageV = append(r.ManageV, 0) },
		"access = manage": func(r *CreerReq) { r.ManageV = r.AccessV },
		"proof = access":  func(r *CreerReq) { r.ProofV = r.AccessV },
		"proof = manage":  func(r *CreerReq) { r.ProofV = r.ManageV },
		"bloc nul":        func(r *CreerReq) { r.Bloc = [32]byte{} },
	}
	for nom, casser := range cas {
		r := reqValide(nouvellesCles())
		casser(&r)
		if _, err := b.m.Creer(r); !errors.Is(err, ErrBadRequest) {
			t.Errorf("%s : %v", nom, err)
		}
	}
	var n int
	if err := b.db.QueryRow(`SELECT count(*) FROM salons`).Scan(&n); err != nil || n != 0 {
		t.Fatal("salons créés :", n, err)
	}
}

func TestCreerConflit(t *testing.T) {
	b := nouveauBanc(t, 200)
	c := b.creer(t, 10)
	autre := reqValide(nouvellesCles())
	autre.AccessV = share.Verifier(c.acces)
	if _, err := b.m.Creer(autre); !errors.Is(err, ErrConflict) {
		t.Fatal("access_v repris :", err)
	}
	autre = reqValide(nouvellesCles())
	autre.ManageV = share.Verifier(c.gestion)
	if _, err := b.m.Creer(autre); !errors.Is(err, ErrConflict) {
		t.Fatal("manage_v repris :", err)
	}
	var n int
	if err := b.db.QueryRow(`SELECT count(*) FROM salons`).Scan(&n); err != nil || n != 1 {
		t.Fatal("salons :", n, err)
	}
	if _, err := b.m.Meta(c.acces); err != nil {
		t.Fatal("salon existant touché :", err)
	}
	if e := b.entrer(t, c, true); e.Siege != 0 {
		t.Fatal("siège", e.Siege)
	}
}

func TestCreerMax(t *testing.T) {
	b := nouveauBanc(t, 2)
	b.creer(t, 10)
	b.creer(t, 10)
	if _, err := b.m.Creer(reqValide(nouvellesCles())); !errors.Is(err, ErrBusy) {
		t.Fatal("3ᵉ salon :", err)
	}
	// Un salon échu ne compte plus.
	b.h.avancer(25 * time.Hour)
	if _, err := b.m.Creer(reqValide(nouvellesCles())); err != nil {
		t.Fatal("après échéance :", err)
	}
}

// Usage total + 2 Gio > StorageMax → ErrBusy ; erreur de l'usage des partages → refus.
func TestCreerStockage(t *testing.T) {
	b := nouveauBanc(t, 200)
	used := int64(200<<30 - 2<<30)
	var errUsage error
	b.m.cfg.UsedPartages = func() (int64, error) { return used, errUsage }
	if _, err := b.m.Creer(reqValide(nouvellesCles())); err != nil {
		t.Fatal("pile à la limite :", err)
	}
	used++
	if _, err := b.m.Creer(reqValide(nouvellesCles())); !errors.Is(err, ErrBusy) {
		t.Fatal("un octet de trop :", err)
	}
	used, errUsage = 0, errors.New("usage illisible")
	if _, err := b.m.Creer(reqValide(nouvellesCles())); err == nil {
		t.Fatal("usage illisible : création acceptée")
	}
}

func TestEcheanceAuQuart(t *testing.T) {
	b := nouveauBanc(t, 200)
	r := reqValide(nouvellesCles())
	r.TTLHours = 1
	d, err := b.m.Creer(r)
	if err != nil {
		t.Fatal(err)
	}
	var exp int64
	if err := b.db.QueryRow(`SELECT expires_at FROM salons`).Scan(&exp); err != nil {
		t.Fatal(err)
	}
	if want := time.Date(2026, 11, 12, 11, 15, 0, 0, time.UTC); exp != want.Unix() || d != want.Sub(b.h.Now()) {
		t.Fatal(time.Unix(exp, 0).UTC(), d)
	}
}

func TestMetaInconnu(t *testing.T) {
	b := nouveauBanc(t, 200)
	if _, err := b.m.Meta(secret(0xEE)); !errors.Is(err, ErrNotFound) {
		t.Fatal("clé inconnue :", err)
	}
	for _, k := range [][]byte{nil, secret(0xEE)[:31], append(secret(0xEE), 0)} {
		if _, err := b.m.Meta(k); !errors.Is(err, ErrNotFound) {
			t.Fatal("clé de longueur", len(k), err)
		}
	}
	expire := nouvellesCles()
	r := reqValide(expire)
	r.TTLHours = 1
	if _, err := b.m.Creer(r); err != nil {
		t.Fatal(err)
	}
	detruit := b.creer(t, 10)
	for range 10 {
		b.m.Rejoindre(detruit.acces, secret(0xEF), nil)
	}
	b.h.avancer(68*time.Minute - 30*time.Second) // 11:15:00 : échéance atteinte
	for nom, k := range map[string][]byte{"expiré": expire.acces, "détruit": detruit.acces} {
		if _, err := b.m.Meta(k); !errors.Is(err, ErrNotFound) {
			t.Errorf("%s : %v", nom, err)
		}
		if _, err := b.m.Rejoindre(k, expire.preuve, nil); !errors.Is(err, ErrNotFound) {
			t.Errorf("rejoindre %s : %v", nom, err)
		}
	}
}

func TestRejoindreCreateurSiege0(t *testing.T) {
	b := nouveauBanc(t, 200)
	c := b.creer(t, 4)
	e := b.entrer(t, c, true)
	if e.Siege != 0 || e.MaxMembers != 4 || e.MembersCanDestroy || e.BudgetLeft != 2147483648 ||
		e.ExpiresIn != 24*time.Hour+7*time.Minute+30*time.Second {
		t.Fatalf("créateur : %+v", e)
	}
	g := b.entrer(t, c, false)
	if g.Siege != 1 || g.Seq != e.Seq+1 {
		t.Fatalf("invité : siège %d, seq %d", g.Siege, g.Seq)
	}
	for _, x := range []Entree{e, g} {
		mb, err := b.m.Membre(x.Jeton[:])
		if err != nil || mb.siege != x.Siege || mb.emis != x.Seq || mb.plancher != x.Seq {
			t.Fatalf("Membre : %+v %v", mb, err)
		}
	}
	// Invité d'abord : siège 1 même si le 0 est libre.
	c2 := b.creer(t, 4)
	if g := b.entrer(t, c2, false); g.Siege != 1 {
		t.Fatal("invité sans créateur : siège", g.Siege)
	}
	if e := b.entrer(t, c2, true); e.Siege != 0 {
		t.Fatal("créateur après l'invité : siège", e.Siege)
	}
}

func TestRejoindreCreateurReprend0(t *testing.T) {
	b := nouveauBanc(t, 200)
	c := b.creer(t, 4)
	e1 := b.entrer(t, c, true)
	e2 := b.entrer(t, c, true)
	if e2.Siege != 0 || e2.Seq <= e1.Seq || e2.Nonce == e1.Nonce || e2.Jeton == e1.Jeton {
		t.Fatalf("reprise : %+v", e2)
	}
	if _, err := b.m.Membre(e1.Jeton[:]); !errors.Is(err, ErrNotFound) {
		t.Fatal("ancien jeton :", err)
	}
	if _, err := b.m.Membre(e2.Jeton[:]); err != nil {
		t.Fatal("nouveau jeton :", err)
	}
	s := b.etat(t, c)
	var dernier evenement
	sous(s, func() {
		dernier = s.journal[len(s.journal)-1]
	})
	if dernier.seq != e2.Seq || !bytes.Equal(dernier.enr, EnrReprise(e2.Seq, 0, e2.Nonce)) {
		t.Fatalf("journal : %+v", dernier)
	}
	if n := occupes(s); n != 1 {
		t.Fatal("sièges occupés", n)
	}
}

func TestPlaceDuCreateurGardee(t *testing.T) {
	b := nouveauBanc(t, 200)
	c := b.creer(t, 2)
	if g := b.entrer(t, c, false); g.Siege != 1 {
		t.Fatal("siège", g.Siege)
	}
	if _, err := b.m.Rejoindre(c.acces, c.preuve, nil); !errors.Is(err, ErrFull) {
		t.Fatal("deuxième invité :", err)
	}
	if e := b.entrer(t, c, true); e.Siege != 0 {
		t.Fatal("créateur : siège", e.Siege)
	}
}

func TestArriveesPlafond(t *testing.T) {
	b := nouveauBanc(t, 200)
	c := b.creer(t, 2)
	for i := range 10 {
		g := b.entrer(t, c, false)
		if g.Siege != 1 {
			t.Fatalf("entrée %d : siège %d", i, g.Siege)
		}
		b.depart(b.etat(t, c), g.Siege)
	}
	if _, err := b.m.Rejoindre(c.acces, c.preuve, nil); !errors.Is(err, ErrFull) {
		t.Fatal("11ᵉ arrivée :", err)
	}
}

func TestRejoindreConcurrent(t *testing.T) {
	b := nouveauBanc(t, 200)
	c := b.creer(t, 3)
	b.entrer(t, c, false)
	var wg sync.WaitGroup
	res := make(chan error, 8)
	for range 8 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := b.m.Rejoindre(c.acces, c.preuve, nil)
			res <- err
		}()
	}
	wg.Wait()
	close(res)
	ok := 0
	for err := range res {
		switch {
		case err == nil:
			ok++
		case !errors.Is(err, ErrFull):
			t.Fatal(err)
		}
	}
	if ok != 1 || occupes(b.etat(t, c)) != 2 {
		t.Fatal("sièges donnés :", ok)
	}
}

func TestManageFaux(t *testing.T) {
	b := nouveauBanc(t, 200)
	c := b.creer(t, 4)
	for _, g := range [][]byte{secret(0xEE), secret(0xEE)[:31], {}} {
		if _, err := b.m.Rejoindre(c.acces, c.preuve, g); !errors.Is(err, ErrBadRequest) {
			t.Fatalf("sGestion de %d octets : %v", len(g), err)
		}
	}
	if s := b.etat(t, c); s != nil && occupes(s) != 0 {
		t.Fatal("siège donné")
	}
	var fa int
	if err := b.db.QueryRow(`SELECT failed_attempts FROM salons`).Scan(&fa); err != nil || fa != 0 {
		t.Fatal("essais comptés :", fa, err)
	}
	if _, err := b.m.Rejoindre(c.acces, c.preuve[:31], nil); !errors.Is(err, ErrBadRequest) {
		t.Fatal("preuve de 31 octets :", err)
	}
}

func TestMauvaisMotDePasse(t *testing.T) {
	b := nouveauBanc(t, 200)
	c := b.creer(t, 4)
	b.entrer(t, c, false)
	for i := 1; i <= 9; i++ {
		_, err := b.m.Rejoindre(c.acces, secret(0xEE), nil)
		var bp *BadPassword
		if !errors.As(err, &bp) || bp.AttemptsLeft != 10-i {
			t.Fatalf("essai %d : %v", i, err)
		}
		var fa int
		if err := b.db.QueryRow(`SELECT failed_attempts FROM salons`).Scan(&fa); err != nil || fa != i {
			t.Fatal("failed_attempts", fa, err)
		}
	}
	if _, err := b.m.Rejoindre(c.acces, secret(0xEE), nil); !errors.Is(err, ErrNotFound) {
		t.Fatal("10ᵉ essai :", err)
	}
	var n int
	if err := b.db.QueryRow(`SELECT count(*) FROM salons`).Scan(&n); err != nil || n != 0 {
		t.Fatal("ligne restante :", n, err)
	}
	if _, err := b.m.Rejoindre(c.acces, c.preuve, nil); !errors.Is(err, ErrNotFound) {
		t.Fatal("bon mot de passe après destruction :", err)
	}
	if es, _ := os.ReadDir(b.cfg.DossierConversations); len(es) != 0 {
		t.Fatal("fichier de conversation restant")
	}
	// Seule reste la tombe (fini, sans siège ni jeton), oubliée à l'échéance.
	b.m.mu.Lock()
	for _, s := range b.m.salons {
		sous(s, func() {
			if !s.fini || s.occupesLocked() != 0 || len(s.jetons) != 0 || len(s.journal) != 0 {
				t.Error("état mémoire restant")
			}
		})
	}
	b.m.mu.Unlock()
	b.m.idxMu.Lock()
	n = len(b.m.index)
	b.m.idxMu.Unlock()
	if n != 0 {
		t.Fatal("jetons restants dans l'index")
	}
}

func TestEssaisConcurrents(t *testing.T) {
	b := nouveauBanc(t, 200)
	c := b.creer(t, 4)
	var wg sync.WaitGroup
	res := make(chan error, 20)
	for range 20 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := b.m.Rejoindre(c.acces, secret(0xEE), nil)
			res <- err
		}()
	}
	wg.Wait()
	close(res)
	vus := map[int]bool{}
	introuvable := 0
	for err := range res {
		var bp *BadPassword
		switch {
		case errors.As(err, &bp):
			if vus[bp.AttemptsLeft] || bp.AttemptsLeft < 1 || bp.AttemptsLeft > 9 {
				t.Fatal("essais restants", bp.AttemptsLeft)
			}
			vus[bp.AttemptsLeft] = true
		case errors.Is(err, ErrNotFound):
			introuvable++
		default:
			t.Fatal(err)
		}
	}
	if len(vus) != 9 || introuvable != 11 {
		t.Fatal("évalués :", len(vus), introuvable)
	}
}

func TestEntreeAnnoncee(t *testing.T) {
	b := nouveauBanc(t, 200)
	c := b.creer(t, 4)
	for _, createur := range []bool{false, true, false} {
		e := b.entrer(t, c, createur)
		s := b.etat(t, c)
		var seq uint64
		var trouve bool
		sous(s, func() {
			for _, ev := range s.journal {
				if ev.seq == e.Seq {
					trouve = bytes.Equal(ev.enr, EnrArrivee(e.Seq, e.Siege, e.Nonce))
				}
			}
			seq = s.seq
		})
		if !trouve || seq != e.Seq || e.Nonce == [16]byte{} {
			t.Fatalf("arrivée %+v absente du journal", e)
		}
	}
}

func TestJetonAleatoire(t *testing.T) {
	b := nouveauBanc(t, 200)
	c := b.creer(t, 4)
	e1 := b.entrer(t, c, false)
	e2 := b.entrer(t, c, false)
	if e1.Jeton == e2.Jeton || e1.Jeton == [32]byte{} {
		t.Fatal("jetons identiques ou nuls")
	}
	var brut []byte
	for _, suffixe := range []string{"", "-wal"} {
		d, err := os.ReadFile(filepath.Join(b.dir, "shares.db"+suffixe))
		if err != nil && !errors.Is(err, os.ErrNotExist) {
			t.Fatal(err)
		}
		brut = append(brut, d...)
	}
	// Témoin : access_v est bien trouvé dans ces octets.
	if !bytes.Contains(brut, share.Verifier(c.acces)) {
		t.Fatal("témoin : access_v absent de la base")
	}
	for _, e := range []Entree{e1, e2} {
		h := sha256.Sum256(e.Jeton[:])
		if bytes.Contains(brut, e.Jeton[:]) || bytes.Contains(brut, h[:]) || bytes.Contains(brut, e.Nonce[:]) {
			t.Fatal("jeton, empreinte ou nonce dans la base")
		}
	}
}

func TestGestion(t *testing.T) {
	b := nouveauBanc(t, 200)
	c := b.creer(t, 4)
	d, n, err := b.m.Gestion(c.gestion)
	if err != nil || n != 0 || d != 24*time.Hour+7*time.Minute+30*time.Second {
		t.Fatal(d, n, err)
	}
	b.entrer(t, c, true)
	b.entrer(t, c, false)
	g := b.entrer(t, c, false)
	if _, n, err := b.m.Gestion(c.gestion); err != nil || n != 3 {
		t.Fatal("présents", n, err)
	}
	b.depart(b.etat(t, c), g.Siege)
	if _, n, err := b.m.Gestion(c.gestion); err != nil || n != 2 {
		t.Fatal("présents après départ", n, err)
	}
	for _, k := range [][]byte{secret(0xEE), c.acces, nil, c.gestion[:31]} {
		if _, _, err := b.m.Gestion(k); !errors.Is(err, ErrNotFound) {
			t.Fatal("sGestion inconnu :", err)
		}
	}
}

// Jeton révoqué (exclusion, Task 14) : ErrExcluded ; jeton inconnu ou de mauvaise longueur :
// ErrNotFound ; salon échu : ErrNotFound.
func TestMembre(t *testing.T) {
	b := nouveauBanc(t, 200)
	c := b.creer(t, 4)
	e := b.entrer(t, c, false)
	for _, j := range [][]byte{secret(0xEE), nil, e.Jeton[:31]} {
		if _, err := b.m.Membre(j); !errors.Is(err, ErrNotFound) {
			t.Fatal("jeton inconnu :", err)
		}
	}
	s := b.etat(t, c)
	h := sha256.Sum256(e.Jeton[:])
	sous(s, func() {
		delete(s.jetons, h)
		s.revoques[h] = struct{}{}
	})
	if _, err := b.m.Membre(e.Jeton[:]); !errors.Is(err, ErrExcluded) {
		t.Fatal("jeton révoqué :", err)
	}
	g := b.entrer(t, c, false)
	b.h.avancer(25 * time.Hour)
	if _, err := b.m.Membre(g.Jeton[:]); !errors.Is(err, ErrNotFound) {
		t.Fatal("salon échu :", err)
	}
}

// Revue finale C-2, I3 (règle « instantané » du propriétaire) : un siège hors ligne reste
// réservé pendant toute la vie du salon, quel que soit le temps d'absence ; Tick ne le libère
// jamais. Seuls un départ (0x03) ou une exclusion le libèrent : 0x03 au journal, jeton oublié,
// place rendue.
func TestSiegeReserveHorsLigne(t *testing.T) {
	synctest.Test(t, func(t *testing.T) { siegeReserveHorsLigne(t) })
}

func siegeReserveHorsLigne(t *testing.T) {
	b := nouveauBanc(t, 200)
	c := b.creer(t, 2)
	g := b.entrer(t, c, false)
	lg := b.connecter(g.Jeton, g.Seq) // connecté une fois (N1), puis hors ligne
	synctest.Wait()
	finir(t, lg)
	s := b.etat(t, c)
	seq := dernierSeq(s)
	for range 23 {
		b.h.avancer(time.Hour)
		b.m.Tick()
	}
	b.h.avancer(59 * time.Minute) // échéance à 10:15 le lendemain : encore vivant
	b.m.Tick()
	mb, err := b.m.Membre(g.Jeton[:])
	if err != nil {
		t.Fatal("siège libéré pendant la vie du salon :", err)
	}
	if dernierSeq(s) != seq || occupes(s) != 1 {
		t.Fatal("annonce ou siège changé par Tick :", dernierSeq(s), occupes(s))
	}
	if _, err := b.m.Rejoindre(c.acces, c.preuve, nil); !errors.Is(err, ErrFull) {
		t.Fatal("place d'un absent donnée à un autre :", err)
	}
	if err := b.m.Quitter(mb); err != nil {
		t.Fatal(err)
	}
	var dernier evenement
	sous(s, func() {
		dernier = s.journal[len(s.journal)-1]
	})
	if !bytes.Equal(dernier.enr, EnrDepart(dernier.seq, g.Siege)) || dernier.seq != seq+1 {
		t.Fatalf("journal : %+v", dernier)
	}
	if _, err := b.m.Membre(g.Jeton[:]); !errors.Is(err, ErrNotFound) {
		t.Fatal("jeton après départ :", err)
	}
	if g2 := b.entrer(t, c, false); g2.Siege != 1 {
		t.Fatal("place non rendue", g2.Siege)
	}
	b.m.idxMu.Lock()
	n := len(b.m.index)
	b.m.idxMu.Unlock()
	if n != 1 {
		t.Fatal("index des jetons :", n)
	}
}

// UsedBytes : pièces + conversations.
func TestUsedBytes(t *testing.T) {
	b := nouveauBanc(t, 200)
	if err := os.WriteFile(filepath.Join(b.cfg.Pieces.Dir, "AAAAAAAAAAAAAAAAAAAAAA"), make([]byte, 1000), 0o600); err != nil {
		t.Fatal(err)
	}
	c := b.creer(t, 4)
	b.entrer(t, c, false)
	if _, err := b.etat(t, c).conv.Ajouter(trameTest(0)); err != nil {
		t.Fatal(err)
	}
	if u := b.m.UsedBytes(); u != 1000+TailleEmplacement {
		t.Fatal("UsedBytes", u)
	}
}

// Journal plein : une entrée est refusée (ErrLimit) sans rien changer ; un départ passe
// toujours (nbSieges places gardées) et le journal ne dépasse jamais journalMax.
func TestJournalPlein(t *testing.T) {
	b := nouveauBanc(t, 200)
	c := b.creer(t, 10)
	g := b.entrer(t, c, false)
	s := b.etat(t, c)
	var seq uint64
	sous(s, func() {
		for len(s.journal) < journalMax-nbSieges {
			s.annoncerLocked(func(seq uint64) []byte { return EnrDepart(seq, 9) }, false)
		}
		seq = s.seq
	})
	if _, err := b.m.Rejoindre(c.acces, c.preuve, nil); !errors.Is(err, ErrLimit) {
		t.Fatal("entrée, journal plein :", err)
	}
	if _, err := b.m.Rejoindre(c.acces, c.preuve, c.gestion); !errors.Is(err, ErrLimit) {
		t.Fatal("créateur, journal plein :", err)
	}
	sous(s, func() {
		if s.seq != seq || s.occupesLocked() != 1 || s.arrivees != 1 || len(s.jetons) != 1 {
			t.Fatal("état changé par une entrée refusée")
		}
	})
	b.depart(s, g.Siege)
	var n int
	sous(s, func() {
		n = len(s.journal)
	})
	if n != journalMax-nbSieges+1 || n > journalMax {
		t.Fatal("journal", n)
	}
	if _, err := b.m.Membre(g.Jeton[:]); !errors.Is(err, ErrNotFound) {
		t.Fatal("jeton après départ :", err)
	}
}

// idDe : identifiant interne du salon.
func (b *banc) idDe(t *testing.T, c cles) string {
	t.Helper()
	var id string
	if err := b.db.QueryRow(`SELECT id FROM salons WHERE access_v=?`, share.Verifier(c.acces)).Scan(&id); err != nil {
		t.Fatal(err)
	}
	return id
}

// invariantJournal : chaque siège occupé peut toujours être annoncé parti (plan Task 6, M3) ;
// à réutiliser aux Tasks 9 et 14.
func invariantJournal(t *testing.T, s *salon) {
	t.Helper()
	s.mu.Lock()
	defer s.mu.Unlock()
	if n := len(s.journal) + s.occupesLocked(); n > journalMax {
		t.Fatalf("journal %d + occupés %d > %d", len(s.journal), s.occupesLocked(), journalMax)
	}
}

// I1 : la suppression de la ligne échoue au 10ᵉ essai. L'état mémoire, les jetons et la
// conversation sont détruits quand même ; la ligne restée (failed_attempts = 10) vaut
// « détruit » partout ; echec rend ErrNotFound.
func TestDestructionSansDelete(t *testing.T) {
	b := nouveauBanc(t, 200)
	c := b.creer(t, 4)
	e := b.entrer(t, c, true)
	id := b.idDe(t, c)
	if _, err := b.db.Exec(`CREATE TRIGGER pas_de_delete BEFORE DELETE ON salons BEGIN SELECT RAISE(FAIL, 'panne injectée'); END`); err != nil {
		t.Fatal(err)
	}
	for range 9 {
		b.m.Rejoindre(c.acces, secret(0xEE), nil)
	}
	if _, err := b.m.Rejoindre(c.acces, secret(0xEE), nil); !errors.Is(err, ErrNotFound) {
		t.Fatal("10ᵉ essai :", err)
	}
	var fa int
	if err := b.db.QueryRow(`SELECT failed_attempts FROM salons WHERE id=?`, id).Scan(&fa); err != nil || fa != maxEssais {
		t.Fatal("témoin : la ligne devait rester", fa, err)
	}
	if _, err := b.m.Membre(e.Jeton[:]); !errors.Is(err, ErrNotFound) {
		t.Fatal("Membre :", err)
	}
	if _, err := os.Stat(filepath.Join(b.cfg.DossierConversations, id)); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("fichier de conversation :", err)
	}
	if _, err := b.m.Meta(c.acces); !errors.Is(err, ErrNotFound) {
		t.Fatal("Meta :", err)
	}
	for _, g := range [][]byte{nil, c.gestion} {
		if _, err := b.m.Rejoindre(c.acces, c.preuve, g); !errors.Is(err, ErrNotFound) {
			t.Fatal("Rejoindre :", err)
		}
	}
	if _, _, err := b.m.Gestion(c.gestion); !errors.Is(err, ErrNotFound) {
		t.Fatal("Gestion :", err)
	}
	if _, err := os.Stat(filepath.Join(b.cfg.DossierConversations, id)); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("fichier recréé :", err)
	}
}

// M1 : une destruction appelée sans essaiLock (purge, Task 15) entre la lecture de la ligne et
// la création de l'état : aucun état ni fichier n'est recréé, Rejoindre et Membre refusent.
func TestPasDeRecreationApresDestruction(t *testing.T) {
	b := nouveauBanc(t, 200)
	c := b.creer(t, 4)
	e := b.entrer(t, c, false)
	id := b.idDe(t, c)
	s := b.etat(t, c)
	if err := b.m.detruire(id); err != nil {
		t.Fatal(err)
	}
	var fini bool
	sous(s, func() {
		fini = s.fini
	})
	if !fini {
		t.Fatal("drapeau fini absent")
	}
	if _, err := b.m.etat(id, b.h.Now().Add(time.Hour).Unix(), 4); !errors.Is(err, ErrNotFound) {
		t.Fatal("etat après destruction :", err)
	}
	if _, err := b.m.Membre(e.Jeton[:]); !errors.Is(err, ErrNotFound) {
		t.Fatal("Membre :", err)
	}
	// Salon jamais rejoint, détruit sans état : etat ne crée rien non plus.
	c2 := b.creer(t, 4)
	id2 := b.idDe(t, c2)
	if err := b.m.detruire(id2); err != nil {
		t.Fatal(err)
	}
	if _, err := b.m.etat(id2, b.h.Now().Add(time.Hour).Unix(), 4); !errors.Is(err, ErrNotFound) {
		t.Fatal("etat d'un salon détruit sans état :", err)
	}
	if es, _ := os.ReadDir(b.cfg.DossierConversations); len(es) != 0 {
		t.Fatal("fichier de conversation recréé")
	}
	// Les tombes sont oubliées après l'échéance et sa marge.
	b.h.avancer(25*time.Hour + margeTombe)
	b.m.Tick()
	b.m.mu.Lock()
	n := len(b.m.salons)
	b.m.mu.Unlock()
	if n != 0 {
		t.Fatal("tombes restantes", n)
	}
}

// M3 : l'invariant tient après des entrées, reprises et départs, journal presque plein ou non.
func TestInvariantJournal(t *testing.T) {
	b := nouveauBanc(t, 200)
	c := b.creer(t, 10)
	s := (*salon)(nil)
	for tour := range 2 {
		for i := range 9 {
			if _, err := b.m.Rejoindre(c.acces, c.preuve, nil); err != nil && !errors.Is(err, ErrLimit) && !errors.Is(err, ErrFull) {
				t.Fatal(tour, i, err)
			}
			b.m.Rejoindre(c.acces, c.preuve, c.gestion)
			s = b.etat(t, c)
			invariantJournal(t, s)
		}
		if tour == 0 {
			sous(s, func() {
				for len(s.journal)+s.occupesLocked() < journalMax-nbSieges {
					s.seq++
					s.journal = append(s.journal, evenement{seq: s.seq, enr: EnrDepart(s.seq, 9)})
				}
			})
		}
		for n := range uint8(nbSieges) { // départs (0x03) : ne peuvent pas échouer, journal presque plein
			b.depart(s, n)
		}
		invariantJournal(t, s)
		if occupes(s) != 0 {
			t.Fatal("sièges non libérés", occupes(s))
		}
	}
}

// M5 : NewManager crée le dossier des pièces (0700) : UsedBytes ne bloque pas les partages.
func TestDossierPiecesCree(t *testing.T) {
	b := nouveauBanc(t, 200)
	cfg := b.cfg
	cfg.Pieces = &blob.Store{Dir: filepath.Join(b.dir, "neuf", "pieces")}
	m, err := NewManager(cfg)
	if err != nil {
		t.Fatal(err)
	}
	fi, err := os.Stat(cfg.Pieces.Dir)
	if err != nil || !fi.IsDir() || fi.Mode().Perm() != 0o700 {
		t.Fatal("dossier des pièces :", err)
	}
	if u := m.UsedBytes(); u != 0 {
		t.Fatal("UsedBytes", u)
	}
	cfg.Pieces = &blob.Store{}
	if _, err := NewManager(cfg); err == nil {
		t.Fatal("dossier des pièces vide accepté")
	}
}

// M6 : erreurs de la base et du stockage des pièces sans chemin ni texte SQL.
func TestErreursGestionnaireFixes(t *testing.T) {
	b := nouveauBanc(t, 200)
	c := b.creer(t, 4)
	b.entrer(t, c, false)
	id := b.idDe(t, c)
	// Pièce impossible à supprimer : un dossier non vide porte son nom.
	const piece = "AAAAAAAAAAAAAAAAAAAAAA"
	if err := os.MkdirAll(filepath.Join(b.cfg.Pieces.Dir, piece, "plein"), 0o700); err != nil {
		t.Fatal(err)
	}
	if _, err := b.db.Exec(`INSERT INTO salon_pieces(id,salon_id,bucket,state,segments_mask) VALUES(?,?,1,'ready',x'00')`, piece, id); err != nil {
		t.Fatal(err)
	}
	err := b.m.detruire(id)
	if err == nil || strings.Contains(err.Error(), "/") || strings.Contains(err.Error(), b.dir) {
		t.Fatal("pièce :", err)
	}
	b.db.Close()
	for nom, f := range map[string]func() error{
		"Meta":  func() error { _, err := b.m.Meta(c.acces); return err },
		"Creer": func() error { _, err := b.m.Creer(reqValide(nouvellesCles())); return err },
		"Rejoindre": func() error {
			_, err := b.m.Rejoindre(c.acces, c.preuve, nil)
			return err
		},
		"Gestion": func() error { _, _, err := b.m.Gestion(c.gestion); return err },
	} {
		err := f()
		if !errors.Is(err, ErrBase) || err.Error() != ErrBase.Error() {
			t.Errorf("%s : %v", nom, err)
		}
	}
}

// Plafond de salons vivants par bloc (/48, ou adresse IPv4 ; décision du 12 novembre) : la
// 6ᵉ création d'un bloc est refusée (Attente jusqu'au quart d'heure suivant), sans ligne ;
// la place revient quand un salon du bloc est détruit (10ᵉ essai) ou échu (Tick), et un
// autre bloc n'est pas touché. Le compte vit en mémoire seulement.
func TestVivantsParBloc(t *testing.T) {
	if VivantsParBloc != 5 {
		t.Fatal("VivantsParBloc", VivantsParBloc)
	}
	b := nouveauBanc(t, 200)
	bloc := [32]byte(aleatoire())
	creer := func(ttl int) (cles, error) {
		c := nouvellesCles()
		r := reqValide(c)
		r.Bloc, r.TTLHours = bloc, ttl
		_, err := b.m.Creer(r)
		return c, err
	}
	var salons []cles
	for i := 0; i < VivantsParBloc; i++ {
		ttl := 24
		if i == 0 {
			ttl = 1
		}
		c, err := creer(ttl)
		if err != nil {
			t.Fatal("création", i+1, err)
		}
		salons = append(salons, c)
	}
	compter := func() int {
		var n int
		if err := b.db.QueryRow(`SELECT count(*) FROM salons`).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}
	_, err := creer(24)
	var at *Attente
	// 10:07:30 → quart d'heure suivant 10:15:00 : 7 min 30 s.
	if !errors.As(err, &at) || at.Retry != 7*time.Minute+30*time.Second {
		t.Fatal("6ᵉ création :", err)
	}
	if compter() != VivantsParBloc {
		t.Fatal("ligne écrite pour une création refusée")
	}
	// Autre bloc : permis.
	if _, err := b.m.Creer(reqValide(nouvellesCles())); err != nil {
		t.Fatal("autre bloc :", err)
	}
	// Destruction au 10ᵉ essai : la place revient (une seule).
	for range maxEssais {
		b.m.Rejoindre(salons[1].acces, secret(0xEE), nil)
	}
	if _, err := creer(24); err != nil {
		t.Fatal("après destruction :", err)
	}
	if _, err := creer(24); !errors.As(err, &at) {
		t.Fatal("place rendue deux fois :", err)
	}
	// Une destruction répétée (purge) ne rend rien de plus.
	id2 := b.idDe(t, salons[2])
	b.m.detruire(id2)
	b.m.detruire(id2)
	if _, err := creer(24); err != nil {
		t.Fatal("après la 2ᵉ destruction :", err)
	}
	if _, err := creer(24); !errors.As(err, &at) {
		t.Fatal("destruction comptée deux fois :", err)
	}
	// Salon d'une heure échu : rendu par Tick.
	b.h.avancer(time.Hour + 10*time.Minute) // 11:17:30 > 11:15:00
	b.m.Tick()
	b.m.mu.Lock()
	n := b.m.parBloc[bloc]
	b.m.mu.Unlock()
	if n != VivantsParBloc-1 {
		t.Fatal("Tick n'a pas rendu la place du salon échu", n)
	}
	if _, err := creer(24); err != nil {
		t.Fatal("après échéance :", err)
	}
	// Tout échu : le compte du bloc est oublié (aucune clé gardée sans salon).
	b.h.avancer(25 * time.Hour)
	b.m.Tick()
	b.m.mu.Lock()
	restes := len(b.m.parBloc) + len(b.m.vivants)
	b.m.mu.Unlock()
	if restes != 0 {
		t.Fatal("compte gardé après la fin de tous les salons", restes)
	}
}

// Salons échus sans Tick : la création suivante les retire elle-même du compte.
func TestVivantsEchusSansTick(t *testing.T) {
	b := nouveauBanc(t, 200)
	bloc := [32]byte(aleatoire())
	for i := 0; i < VivantsParBloc; i++ {
		r := reqValide(nouvellesCles())
		r.Bloc, r.TTLHours = bloc, 1
		if _, err := b.m.Creer(r); err != nil {
			t.Fatal(err)
		}
	}
	b.h.avancer(2 * time.Hour)
	r := reqValide(nouvellesCles())
	r.Bloc = bloc
	if _, err := b.m.Creer(r); err != nil {
		t.Fatal("salons échus encore comptés :", err)
	}
}

// Création refusée pour une autre raison (conflit, service occupé) : aucune place prise.
func TestVivantsRefusNonCompte(t *testing.T) {
	b := nouveauBanc(t, 1)
	bloc := [32]byte(aleatoire())
	c := nouvellesCles()
	r := reqValide(c)
	r.Bloc = bloc
	if _, err := b.m.Creer(r); err != nil {
		t.Fatal(err)
	}
	for range 10 {
		r := reqValide(nouvellesCles())
		r.Bloc = bloc
		if _, err := b.m.Creer(r); !errors.Is(err, ErrBusy) {
			t.Fatal("Max atteint :", err)
		}
		r.AccessV = share.Verifier(c.acces)
		if _, err := b.m.Creer(r); !errors.Is(err, ErrConflict) {
			t.Fatal("conflit :", err)
		}
	}
	b.m.mu.Lock()
	n := b.m.parBloc[bloc]
	b.m.mu.Unlock()
	if n != 1 {
		t.Fatal("refus comptés", n)
	}
}

// sous : f sous le verrou du salon (defer : jamais d'Unlock explicite, même sur t.Fatal).
func sous(s *salon, f func()) {
	s.mu.Lock()
	defer s.mu.Unlock()
	f()
}
