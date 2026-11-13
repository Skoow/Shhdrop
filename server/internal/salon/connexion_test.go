package salon

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"errors"
	"io"
	"io/fs"
	"net/netip"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"sync"
	"testing"
	"testing/synctest"
	"time"

	"github.com/skoow/shhdrop/server/internal/limits"
)

// Connexions du salon (plan C-2 Task 9) : faux Lien en mémoire, délais sous testing/synctest.
// Chaque test ferme toutes ses connexions : synctest.Test échoue si une goroutine reste.

var errCoupe = errors.New("faux lien : fermé")

// fauxLien : côté serveur d'un WebSocket simulé. Le test joue le client (envoyer, couper) et
// lit ce que le serveur a écrit (enrs) et le code de fermeture.
type fauxLien struct {
	entree    chan []byte
	erreurs   chan error
	ferme     chan struct{}
	fermeOnce sync.Once
	fini      chan error // résultat de Servir

	mu            sync.Mutex
	recus         [][]byte
	quand         []time.Time
	code          int
	fermeQuand    time.Time
	delai         time.Duration // durée de chaque écriture
	bloqueApres   int           // ≥ 0 : toute écriture après ce nombre bloque jusqu'à Fermer
	bloqueDepuis  time.Time     // début de la première écriture bloquée
	pingMuet      bool          // Ping ne reçoit jamais de pong
	pings         int
	paniqueEcrire bool
	paniqueLire   bool
	ignoreFerme   bool // Lire ne rend qu'à l'annulation de son ctx (adaptateur moins coopératif)
}

func nouveauLien() *fauxLien {
	return &fauxLien{entree: make(chan []byte), erreurs: make(chan error, 1), ferme: make(chan struct{}),
		fini: make(chan error, 1), bloqueApres: -1}
}

func (f *fauxLien) Lire(ctx context.Context) ([]byte, error) {
	f.mu.Lock()
	p, ignore := f.paniqueLire, f.ignoreFerme
	f.mu.Unlock()
	if p {
		panic("salon: panique injectée (Lire)")
	}
	if ignore {
		select {
		case b := <-f.entree:
			return b, nil
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}
	select {
	case b := <-f.entree:
		return b, nil
	case err := <-f.erreurs:
		return nil, err
	case <-f.ferme:
		return nil, errCoupe
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

func (f *fauxLien) Ecrire(ctx context.Context, b []byte) error {
	f.mu.Lock()
	if f.paniqueEcrire {
		f.mu.Unlock()
		panic("salon: panique injectée (Ecrire)")
	}
	bloque := f.bloqueApres >= 0 && len(f.recus) >= f.bloqueApres
	if bloque && f.bloqueDepuis.IsZero() {
		f.bloqueDepuis = time.Now()
	}
	delai := f.delai
	f.mu.Unlock()
	select {
	case <-f.ferme:
		return errCoupe
	default:
	}
	if bloque {
		select {
		case <-f.ferme:
			return errCoupe
		case <-ctx.Done():
			return ctx.Err()
		}
	}
	if delai > 0 {
		select {
		case <-time.After(delai):
		case <-f.ferme:
			return errCoupe
		case <-ctx.Done():
			return ctx.Err()
		}
	}
	f.mu.Lock()
	f.recus = append(f.recus, bytes.Clone(b))
	f.quand = append(f.quand, time.Now())
	f.mu.Unlock()
	return nil
}

func (f *fauxLien) Ping(ctx context.Context) error {
	f.mu.Lock()
	f.pings++
	muet := f.pingMuet
	f.mu.Unlock()
	if !muet {
		return nil
	}
	select {
	case <-f.ferme:
		return errCoupe
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (f *fauxLien) Fermer(code int, raison string) error {
	f.mu.Lock()
	if f.code == 0 {
		f.code, f.fermeQuand = code, time.Now()
	}
	f.mu.Unlock()
	f.fermeOnce.Do(func() { close(f.ferme) })
	return nil
}

// envoyer : message du client (sans effet une fois le lien fermé).
func (f *fauxLien) envoyer(b []byte) {
	select {
	case f.entree <- b:
	case <-f.ferme:
	}
}

// couper : le client s'en va (Lire rend io.EOF).
func (f *fauxLien) couper() {
	select {
	case f.erreurs <- io.EOF:
	default:
	}
}

func (f *fauxLien) codeFerme() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.code
}

func (f *fauxLien) set(fn func(f *fauxLien)) {
	f.mu.Lock()
	fn(f)
	f.mu.Unlock()
}

// enrC : enregistrement serveur → client décodé.
type enrC struct {
	ty    byte
	seq   uint64
	corps []byte
}

// prendRang : types qui prennent un rang du compteur seq.
func (e enrC) prendRang() bool {
	switch e.ty {
	case 0x01, 0x02, 0x03, 0x09, 0x0A:
		return true
	}
	return false
}

func (f *fauxLien) enrs() []enrC {
	f.mu.Lock()
	defer f.mu.Unlock()
	l := make([]enrC, len(f.recus))
	for i, r := range f.recus {
		l[i] = enrC{ty: r[0], seq: binary.BigEndian.Uint64(r[1:9]), corps: r[9:]}
	}
	return l
}

func (f *fauxLien) brut(i int) []byte {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.recus[i]
}

const ipTest = "2001:db8::1"

func toujours(netip.Addr) bool { return true }

func accueilWS(jeton [32]byte, depuis uint64) []byte {
	b := []byte(base64.RawURLEncoding.EncodeToString(jeton[:]))
	return binary.BigEndian.AppendUint64(b, depuis)
}

func (b *banc) servir(l *fauxLien, autoriser func(netip.Addr) bool) {
	go func() { l.fini <- b.m.Servir(context.Background(), l, netip.MustParseAddr(ipTest), autoriser) }()
}

// connecter : connexion du jeton avec depuis, accueil envoyé.
func (b *banc) connecter(jeton [32]byte, depuis uint64) *fauxLien {
	l := nouveauLien()
	b.servir(l, toujours)
	l.envoyer(accueilWS(jeton, depuis))
	return l
}

// attendreFin : Servir a rendu (une minute simulée au plus).
func attendreFin(t *testing.T, l *fauxLien) {
	t.Helper()
	select {
	case <-l.fini:
	case <-time.After(time.Minute):
		t.Fatal("Servir ne rend pas")
	}
}

// finir : le client s'en va, Servir rend.
func finir(t *testing.T, ls ...*fauxLien) {
	t.Helper()
	for _, l := range ls {
		l.couper()
		attendreFin(t, l)
	}
}

func demTrame(trame []byte) []byte { return append([]byte{DemTrame}, trame...) }

func demPing(p [8]byte) []byte { return append([]byte{DemPing}, p[:]...) }

func connDe(s *salon, n uint8) *connexion {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.conns[n]
}

// rangs : seq des enregistrements qui prennent un rang, dans l'ordre reçu.
func rangs(l []enrC) []uint64 {
	var r []uint64
	for _, e := range l {
		if e.prendRang() {
			r = append(r, e.seq)
		}
	}
	return r
}

// stockes : rangs servis au rattrapage après apres (trames non volatiles, annonces).
func stockes(t *testing.T, s *salon, apres uint64) []uint64 {
	t.Helper()
	var r []uint64
	for _, e := range lireSuite(t, s, apres, 1<<30) {
		r = append(r, e.seq)
	}
	return r
}

func TestAccueilAbsent(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		b := nouveauBanc(t, 200)
		l := nouveauLien()
		b.servir(l, toujours)
		time.Sleep(5*time.Second - time.Millisecond)
		synctest.Wait()
		if c := l.codeFerme(); c != 0 {
			t.Fatal("fermé avant 5 s :", c)
		}
		time.Sleep(time.Millisecond)
		attendreFin(t, l)
		if c := l.codeFerme(); c != CodeAccueil {
			t.Fatal("code", c)
		}
	})
}

func TestAccueilInvalide(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		b := nouveauBanc(t, 200)
		c := b.creer(t, 4)
		e := b.entrer(t, c, false)
		l := nouveauLien()
		b.servir(l, toujours)
		l.envoyer(accueilWS(e.Jeton, 0)[:50])
		attendreFin(t, l)
		if c := l.codeFerme(); c != CodeAccueil {
			t.Fatal("code", c)
		}
		if len(l.enrs()) != 0 {
			t.Fatal("enregistrements envoyés")
		}
	})
}

func TestJetonInconnu(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		b := nouveauBanc(t, 200)
		l := b.connecter([32]byte(aleatoire()), 0)
		attendreFin(t, l)
		if c := l.codeFerme(); c != CodeInconnu {
			t.Fatal("code", c)
		}
	})
}

func TestJetonRevoque(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		b := nouveauBanc(t, 200)
		c := b.creer(t, 4)
		b.entrer(t, c, false)
		s := b.etat(t, c)
		jeton := [32]byte(aleatoire())
		h := sha256.Sum256(jeton[:])
		sous(s, func() {
			s.revoques[h] = struct{}{}
		})
		b.m.idxMu.Lock()
		b.m.index[h] = s
		b.m.idxMu.Unlock()
		l := b.connecter(jeton, 0)
		attendreFin(t, l)
		if c := l.codeFerme(); c != CodeRevoque {
			t.Fatal("code", c)
		}
	})
}

// 0x0D au rang depuis effectif, un 0x07 par siège occupé, le rattrapage, puis le direct.
func TestSequenceAccueil(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		b := nouveauBanc(t, 200)
		c := b.creer(t, 4)
		e0, g := b.entrerMembre(t, c, true)    // 1
		ea, a := b.entrerMembre(t, c, false)   // 2
		b.recevoir(t, g, trameD(0, 1))         // 3
		eb, _ := b.entrerMembre(t, c, false)   // 4
		b.recevoir(t, g, trameD(dVolatile, 9)) // 5, volatile : jamais au rattrapage
		lb := b.connecter(eb.Jeton, eb.Seq)
		synctest.Wait()
		b.recevoir(t, a, trameD(0, 2)) // 6
		b.recevoir(t, g, trameD(0, 3)) // 7
		la := b.connecter(ea.Jeton, ea.Seq)
		synctest.Wait()
		b.recevoir(t, g, trameD(0, 4)) // 8, direct
		synctest.Wait()

		l := la.enrs()
		if len(l) != 1+3+4+1 {
			t.Fatalf("%d enregistrements", len(l))
		}
		liste := EnrListe(ea.Seq, 0, []Annonce{{0, e0.Nonce, 0}, {1, ea.Nonce, 0}})
		if !bytes.Equal(la.brut(0), liste) {
			t.Fatalf("0x0D : %x", la.brut(0))
		}
		for i, p := range []struct {
			siege uint8
			en    bool
		}{{0, false}, {1, true}, {2, true}} {
			if !bytes.Equal(la.brut(1+i), EnrPresence(7, p.siege, p.en, 0)) {
				t.Fatalf("0x07 n°%d : %x", i, la.brut(1+i))
			}
		}
		want := []struct {
			ty  byte
			seq uint64
		}{{0x01, 3}, {0x02, 4}, {0x01, 6}, {0x01, 7}, {0x01, 8}}
		for i, w := range want {
			if e := l[4+i]; e.ty != w.ty || e.seq != w.seq {
				t.Fatalf("n°%d : %x %d, attendu %x %d", 4+i, e.ty, e.seq, w.ty, w.seq)
			}
		}
		finir(t, la, lb)
	})
}

// Point 7 : un jeton émis au rang 40 qui demande depuis = 0 ne reçoit rien de rang ≤ 40.
func TestDepuisBorne(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		b := nouveauBanc(t, 200)
		c := b.creer(t, 4)
		_, g := b.entrerMembre(t, c, true)
		for i := 2; i < 40; i++ {
			b.recevoir(t, g, trameD(0, i))
		}
		ea := b.entrer(t, c, false)
		if ea.Seq != 40 {
			t.Fatal("rang d'émission", ea.Seq)
		}
		la := b.connecter(ea.Jeton, 0)
		synctest.Wait()
		b.recevoir(t, g, trameD(0, 41))
		synctest.Wait()
		l := la.enrs()
		if l[0].ty != 0x0D || l[0].seq != 40 {
			t.Fatalf("0x0D : %x %d", l[0].ty, l[0].seq)
		}
		if r := rangs(l); len(r) != 1 || r[0] != 41 {
			t.Fatal("rangs reçus", r)
		}
		finir(t, la)
	})
}

// Relecture Task 8 : arrivé au rang N, depuis = 0 ne donne aucune trame de rang < N ; un
// depuis au-delà du dernier rang est plafonné.
func TestNouveauVenuDepuisZero(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		b := nouveauBanc(t, 200)
		c := b.creer(t, 4)
		_, g := b.entrerMembre(t, c, true)
		_, a := b.entrerMembre(t, c, false)
		for i := 0; i < 30; i++ {
			b.recevoir(t, g, trameD(0, i))
			b.recevoir(t, a, trameD(dVolatile, i))
		}
		b.m.Quitter(a)
		en := b.entrer(t, c, false)
		ln := b.connecter(en.Jeton, 0)
		synctest.Wait()
		for _, e := range ln.enrs() {
			if e.prendRang() && e.seq < en.Seq {
				t.Fatalf("rang %d < %d reçu (%x)", e.seq, en.Seq, e.ty)
			}
		}
		if e := ln.enrs()[0]; e.ty != 0x0D || e.seq != en.Seq {
			t.Fatalf("0x0D : %x %d", e.ty, e.seq)
		}
		finir(t, ln)
		ln = b.connecter(en.Jeton, 1<<40)
		synctest.Wait()
		if e := ln.enrs()[0]; e.ty != 0x0D || e.seq != dernierSeq(g.salon) {
			t.Fatalf("0x0D plafonné : %x %d", e.ty, e.seq)
		}
		finir(t, ln)
	})
}

// Review Focus 1 : reconnexion avec depuis = 10 pendant que deux membres envoient 500 trames :
// tout ce qui est rangé après 10, dans l'ordre, sans doublon ni trou.
func TestRattrapagePuisDirectSansTrou(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		b := nouveauBanc(t, 200)
		c := b.creer(t, 4)
		_, g := b.entrerMembre(t, c, true)
		_, a := b.entrerMembre(t, c, false)
		_, bm := b.entrerMembre(t, c, false)
		ec, _ := b.entrerMembre(t, c, false)
		for i, n := 0, 0; n < 2000; i++ {
			d := byte(0)
			if i%7 == 3 {
				d = dVolatile
			} else {
				n++
			}
			b.recevoir(t, []Membre{g, a}[i%2], trameD(d, i))
		}
		s := g.salon
		lc := b.connecter(ec.Jeton, 10)
		var wg sync.WaitGroup
		for _, mb := range []Membre{a, bm} {
			wg.Add(1)
			go func() {
				defer wg.Done()
				for i := 0; i < 250; i++ {
					d := byte(0)
					if i%5 == 0 {
						d = dVolatile
					}
					if _, err := b.m.Recevoir(mb, trameD(d, i), nil); err != nil {
						t.Error(err)
						return
					}
				}
			}()
		}
		wg.Wait()
		synctest.Wait()
		attendu := stockes(t, s, 10)
		if len(attendu) < 2300 {
			t.Fatal("rangées", len(attendu))
		}
		recu := rangs(lc.enrs())
		if !sort.SliceIsSorted(recu, func(i, j int) bool { return recu[i] < recu[j] }) {
			t.Fatal("ordre")
		}
		for i := 1; i < len(recu); i++ {
			if recu[i] == recu[i-1] {
				t.Fatal("doublon", recu[i])
			}
		}
		vu := map[uint64]bool{}
		for _, r := range recu {
			if r <= 10 {
				t.Fatal("rang ≤ depuis :", r)
			}
			vu[r] = true
		}
		for _, r := range attendu {
			if !vu[r] {
				t.Fatal("trou au rang", r)
			}
		}
		finir(t, lc)
	})
}

// L'expéditeur reçoit sa trame avec son rang et son siège, puis 0x0F.
func TestEchoExpediteur(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		b := nouveauBanc(t, 200)
		c := b.creer(t, 4)
		b.entrer(t, c, true)
		ea, a := b.entrerMembre(t, c, false)
		la := b.connecter(ea.Jeton, ea.Seq)
		synctest.Wait()
		tr := trameD(0, 77)
		la.envoyer(demTrame(tr))
		synctest.Wait()
		l := la.enrs()
		e := l[len(l)-2] // puis 0x0F (TestAccepteeApresEchoEnDirect)
		if e.ty != 0x01 || e.seq != dernierSeq(a.salon) || e.corps[0] != ea.Siege || !bytes.Equal(e.corps[9:], tr) {
			t.Fatalf("écho : %x %d", e.ty, e.seq)
		}
		if f := l[len(l)-1]; f.ty != 0x0F || f.seq != e.seq {
			t.Fatalf("0x0F après l'écho : %x %d", f.ty, f.seq)
		}
		finir(t, la)
	})
}

// Reprise : 0x0A diffusé avec un nonce neuf, 0x0D au rang du 0x0A avec ce nonce, aucun
// rattrapage ; le jeton reste valable.
func TestReprise(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		b := nouveauBanc(t, 200)
		c := b.creer(t, 4)
		e0, g := b.entrerMembre(t, c, true)
		ea := b.entrer(t, c, false)
		b.recevoir(t, g, trameD(0, 1))
		b.recevoir(t, g, trameD(0, 2))
		eb := b.entrer(t, c, false)
		lb := b.connecter(eb.Jeton, eb.Seq)
		synctest.Wait()
		la := b.connecter(ea.Jeton, DepuisReprise)
		synctest.Wait()
		s := g.salon
		var ev evenement
		var nonce [16]byte
		sous(s, func() {
			ev = s.journal[len(s.journal)-1]
			nonce = s.sieges[ea.Siege].nonce
		})
		if nonce == ea.Nonce {
			t.Fatal("nonce inchangé")
		}
		if !bytes.Equal(ev.enr, EnrReprise(ev.seq, ea.Siege, nonce)) {
			t.Fatalf("journal : %x", ev.enr)
		}
		lbl := lb.enrs()
		if !bytes.Equal(lb.brut(len(lbl)-2), ev.enr) {
			t.Fatal("0x0A non diffusé")
		}
		l := la.enrs()
		if !bytes.Equal(la.brut(0), EnrListe(ev.seq, 0, []Annonce{{0, e0.Nonce, 0}, {1, nonce, 0}, {2, eb.Nonce, 0}})) {
			t.Fatalf("0x0D : %x", la.brut(0))
		}
		if len(l) != 4 {
			t.Fatalf("rattrapage après une reprise : %d enregistrements", len(l))
		}
		if _, err := b.m.Membre(ea.Jeton[:]); err != nil {
			t.Fatal("jeton après reprise :", err)
		}
		b.recevoir(t, g, trameD(0, 3))
		synctest.Wait()
		if r := rangs(la.enrs()); len(r) != 1 || r[0] != dernierSeq(s) {
			t.Fatal("direct après reprise", r)
		}
		finir(t, la, lb)
		invariantJournal(t, s)
	})
}

// Une reconnexion (depuis ≠ reprise) garde le nonce_arrivée et n'annonce rien.
func TestReconnexionGardeLeNonce(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		b := nouveauBanc(t, 200)
		c := b.creer(t, 4)
		e0 := b.entrer(t, c, true)
		ea := b.entrer(t, c, false)
		la := b.connecter(ea.Jeton, ea.Seq)
		synctest.Wait()
		finir(t, la)
		s := b.etat(t, c)
		seq := dernierSeq(s)
		la = b.connecter(ea.Jeton, ea.Seq)
		synctest.Wait()
		if !bytes.Equal(la.brut(0), EnrListe(ea.Seq, 0, []Annonce{{0, e0.Nonce, 0}, {1, ea.Nonce, 0}})) {
			t.Fatalf("0x0D : %x", la.brut(0))
		}
		if dernierSeq(s) != seq {
			t.Fatal("rang consommé par une reconnexion")
		}
		finir(t, la)
	})
}

// Seconde connexion du même siège : la première reçoit 0x05 raison 4 puis 4005.
func TestRemplace(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		b := nouveauBanc(t, 200)
		c := b.creer(t, 4)
		_, g := b.entrerMembre(t, c, true)
		ea := b.entrer(t, c, false)
		l1 := b.connecter(ea.Jeton, ea.Seq)
		synctest.Wait()
		l2 := b.connecter(ea.Jeton, ea.Seq)
		attendreFin(t, l1)
		if c := l1.codeFerme(); c != CodeRemplace {
			t.Fatal("code", c)
		}
		l := l1.enrs()
		if e := l[len(l)-1]; e.ty != 0x05 || !bytes.Equal(e.corps, []byte{RaisonRemplace}) {
			t.Fatalf("dernier enregistrement : %x %x", e.ty, e.corps)
		}
		b.recevoir(t, g, trameD(0, 1))
		synctest.Wait()
		if r := rangs(l2.enrs()); len(r) != 1 {
			t.Fatal("seconde connexion :", r)
		}
		if connDe(g.salon, ea.Siege) == nil {
			t.Fatal("seconde connexion désinscrite")
		}
		finir(t, l2)
	})
}

// Review Focus 2 : client lent. La file ne dépasse jamais 256, la connexion bascule en
// rattrapage puis rattrape quand le client accélère ; l'autre membre n'est pas ralenti.
func TestClientLentBascule(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		b := nouveauBanc(t, 200)
		c := b.creer(t, 4)
		_, g := b.entrerMembre(t, c, true)
		ea := b.entrer(t, c, false)
		eb := b.entrer(t, c, false)
		la := b.connecter(ea.Jeton, ea.Seq)
		lb := b.connecter(eb.Jeton, eb.Seq)
		synctest.Wait()
		lb.set(func(f *fauxLien) { f.delai = 5 * time.Millisecond })
		s := g.salon
		envoi := map[uint64]time.Time{}
		bascule := false
		for i := 0; i < 1000; i++ {
			d := byte(0)
			if i%10 == 0 {
				d = dVolatile
			}
			seq := b.recevoir(t, g, trameD(d, i))
			envoi[seq] = time.Now()
			recuAvantSuivant(t, la, seq)
			var cb *connexion
			sous(s, func() {
				cb = s.conns[eb.Siege]
				if len(cb.file) > fileMax {
					t.Fatal("file", len(cb.file))
				}
				if !cb.direct {
					bascule = true
				}
			})
			time.Sleep(time.Millisecond)
		}
		if !bascule {
			t.Fatal("jamais passé en rattrapage")
		}
		lb.set(func(f *fauxLien) { f.delai = 0 })
		time.Sleep(time.Second)
		synctest.Wait()
		if lb.codeFerme() != 0 {
			t.Fatal("client lent fermé :", lb.codeFerme())
		}
		recu := rangs(lb.enrs())
		vu := map[uint64]bool{}
		for i, r := range recu {
			if i > 0 && r <= recu[i-1] {
				t.Fatal("ordre ou doublon au rang", r)
			}
			vu[r] = true
		}
		for _, r := range stockes(t, s, eb.Seq) {
			if !vu[r] {
				t.Fatal("trou au rang", r)
			}
		}
		if cb := connDe(s, eb.Siege); func() bool { s.mu.Lock(); defer s.mu.Unlock(); return !cb.direct }() {
			t.Fatal("pas revenu au direct")
		}
		verifierRapide(t, la, envoi)
		finir(t, la, lb)
	})
}

// recuAvantSuivant : sous synctest, une goroutine qui attend un mutex ne fait pas avancer
// l'horloge simulée ; verifierRapide seul ne prouverait donc pas qu'aucun verrou ne retarde
// l'autre membre. synctest.Wait rend quand toutes les goroutines sont durablement bloquées :
// l doit alors avoir reçu la trame seq, avant que la suivante ne soit envoyée.
func recuAvantSuivant(t *testing.T, l *fauxLien, seq uint64) {
	t.Helper()
	synctest.Wait()
	l.mu.Lock()
	defer l.mu.Unlock()
	for i := len(l.recus) - 1; i >= 0; i-- {
		if r := l.recus[i]; r[0] == 0x01 && binary.BigEndian.Uint64(r[1:9]) == seq {
			return
		}
	}
	t.Fatal("trame", seq, "non reçue par l'autre membre avant l'envoi suivant")
}

// verifierRapide : chaque trame envoyée (volatiles comprises) reçue par l en moins de 50 ms
// d'horloge simulée (complété par recuAvantSuivant, voir sa limite).
func verifierRapide(t *testing.T, l *fauxLien, envoi map[uint64]time.Time) {
	t.Helper()
	l.mu.Lock()
	defer l.mu.Unlock()
	recu := map[uint64]time.Time{}
	for i, r := range l.recus {
		if r[0] == 0x01 {
			recu[binary.BigEndian.Uint64(r[1:9])] = l.quand[i]
		}
	}
	for seq, t0 := range envoi {
		t1, ok := recu[seq]
		if !ok {
			t.Fatal("trame non reçue par l'autre membre :", seq)
		}
		if t1.Sub(t0) >= 50*time.Millisecond {
			t.Fatal("autre membre ralenti :", t1.Sub(t0))
		}
	}
}

// Client bloqué en plein salon actif : 4006 (retard de plus de 5 s) avant 10 s d'écriture
// bloquée ; file bornée ; l'autre membre n'est pas ralenti.
func TestClientLentFerme(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		b := nouveauBanc(t, 200)
		c := b.creer(t, 4)
		_, g := b.entrerMembre(t, c, true)
		ea := b.entrer(t, c, false)
		eb := b.entrer(t, c, false)
		la := b.connecter(ea.Jeton, ea.Seq)
		lb := nouveauLien()
		lb.bloqueApres = 4 // 0x0D et trois 0x07
		b.servir(lb, toujours)
		lb.envoyer(accueilWS(eb.Jeton, eb.Seq))
		synctest.Wait()
		s := g.salon
		envoi := map[uint64]time.Time{}
		for i := 0; i < 1500; i++ {
			seq := b.recevoir(t, g, trameD(0, i))
			envoi[seq] = time.Now()
			recuAvantSuivant(t, la, seq)
			sous(s, func() {
				if cb := s.conns[eb.Siege]; cb != nil && len(cb.file) > fileMax {
					t.Fatal("file", len(cb.file))
				}
			})
			time.Sleep(10 * time.Millisecond)
		}
		attendreFin(t, lb)
		if c := lb.codeFerme(); c != CodeTropLent {
			t.Fatal("code", c)
		}
		lb.mu.Lock()
		bloque := lb.fermeQuand.Sub(lb.bloqueDepuis)
		lb.mu.Unlock()
		if bloque >= 10*time.Second || bloque <= 5*time.Second {
			t.Fatal("fermé après", bloque, "d'écriture bloquée")
		}
		if connDe(s, eb.Siege) != nil {
			t.Fatal("connexion encore inscrite")
		}
		verifierRapide(t, la, envoi)
		finir(t, la)
	})
}

// Écriture bloquée plus de 10 s sans trame nouvelle (rattrapage initial) : 4006.
func TestEcritureBloquee(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		b := nouveauBanc(t, 200)
		c := b.creer(t, 4)
		_, g := b.entrerMembre(t, c, true)
		ea := b.entrer(t, c, false)
		for i := 0; i < 100; i++ {
			b.recevoir(t, g, trameD(0, i))
		}
		la := nouveauLien()
		la.bloqueApres = 3
		b.servir(la, toujours)
		la.envoyer(accueilWS(ea.Jeton, ea.Seq))
		time.Sleep(10*time.Second - time.Millisecond)
		synctest.Wait()
		if la.codeFerme() != 0 {
			t.Fatal("fermé avant 10 s")
		}
		attendreFin(t, la)
		la.mu.Lock()
		bloque := la.fermeQuand.Sub(la.bloqueDepuis)
		la.mu.Unlock()
		if c := la.codeFerme(); c != CodeTropLent || bloque > 12*time.Second {
			t.Fatal("code", c, bloque)
		}
	})
}

// Ping sans pong et aucun message pendant 45 s : fermeture.
func TestPingSilence(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		b := nouveauBanc(t, 200)
		c := b.creer(t, 4)
		ea := b.entrer(t, c, false)
		la := nouveauLien()
		la.pingMuet = true
		b.servir(la, toujours)
		la.envoyer(accueilWS(ea.Jeton, ea.Seq))
		time.Sleep(44 * time.Second)
		synctest.Wait()
		if la.codeFerme() != 0 {
			t.Fatal("fermé avant 45 s")
		}
		la.mu.Lock()
		p := la.pings
		la.mu.Unlock()
		if p != 1 { // à 20 s, sans pong jusqu'à l'échéance de 25 s
			t.Fatal("pings", p)
		}
		time.Sleep(2 * time.Second)
		synctest.Wait()
		if la.codeFerme() == 0 {
			t.Fatal("ouvert après 46 s de silence")
		}
		attendreFin(t, la)
	})
}

func TestPingApplicatif(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		b := nouveauBanc(t, 200)
		c := b.creer(t, 4)
		ea, a := b.entrerMembre(t, c, false)
		la := b.connecter(ea.Jeton, ea.Seq)
		synctest.Wait()
		p := [8]byte{1, 2, 3, 4, 5, 6, 7, 8}
		la.envoyer(demPing(p))
		synctest.Wait()
		l := la.enrs()
		if !bytes.Equal(la.brut(len(l)-1), EnrPong(dernierSeq(a.salon), p)) {
			t.Fatalf("pong : %x", la.brut(len(l)-1))
		}
		finir(t, la)
	})
}

// 600 messages de contrôle par minute ; le 601ᵉ ferme en 4003 ; la minute suivante repart.
func TestControleLimite(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		b := nouveauBanc(t, 200)
		c := b.creer(t, 4)
		ea := b.entrer(t, c, false)
		la := b.connecter(ea.Jeton, ea.Seq)
		synctest.Wait()
		lu := binary.BigEndian.AppendUint64([]byte{DemLu}, 1)
		for i := 0; i < 600; i++ {
			if i%2 == 0 {
				la.envoyer(demPing([8]byte{byte(i)}))
			} else {
				la.envoyer(lu)
			}
		}
		synctest.Wait()
		if la.codeFerme() != 0 {
			t.Fatal("fermé à 600")
		}
		time.Sleep(time.Minute)
		for i := 0; i < 600; i++ {
			la.envoyer(lu)
		}
		synctest.Wait()
		if la.codeFerme() != 0 {
			t.Fatal("fermé à 600, minute suivante")
		}
		la.envoyer(lu)
		attendreFin(t, la)
		if c := la.codeFerme(); c != CodeInvalide {
			t.Fatal("code", c)
		}
	})
}

// Message texte (ErrProtocole de l'adaptateur) : 4003.
func TestMessageTexte(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		b := nouveauBanc(t, 200)
		c := b.creer(t, 4)
		ea := b.entrer(t, c, false)
		la := b.connecter(ea.Jeton, ea.Seq)
		synctest.Wait()
		la.erreurs <- ErrProtocole
		attendreFin(t, la)
		if c := la.codeFerme(); c != CodeInvalide {
			t.Fatal("code", c)
		}
	})
}

// Relecture Task 3 : ErrEnTete et ErrProtocole donnent toutes deux 4003.
func TestDemandeInvalide(t *testing.T) {
	marqueFausse := trameD(0, 1)
	marqueFausse[0] = 'X'
	reserve := trameD(0b1000, 1)
	cas := map[string][]byte{
		"en-tête, marque":   demTrame(marqueFausse),
		"en-tête, réservé":  demTrame(reserve),
		"trame courte":      demTrame(trameD(0, 1)[:TailleTrame-1]),
		"type inconnu":      {0x09, 0, 0, 0, 0, 0, 0, 0, 0},
		"retirer, 7 octets": {DemRetirer, 0, 0, 0, 0, 0, 0, 0},
		"vide":              {},
	}
	for nom, m := range cas {
		t.Run(nom, func(t *testing.T) {
			synctest.Test(t, func(t *testing.T) {
				b := nouveauBanc(t, 200)
				c := b.creer(t, 4)
				ea, a := b.entrerMembre(t, c, false)
				la := b.connecter(ea.Jeton, ea.Seq)
				synctest.Wait()
				seq := dernierSeq(a.salon)
				la.envoyer(m)
				attendreFin(t, la)
				if c := la.codeFerme(); c != CodeInvalide {
					t.Fatal("code", c)
				}
				if dernierSeq(a.salon) != seq {
					t.Fatal("rang consommé")
				}
			})
		})
	}
}

// 481ᵉ trame de la minute depuis la même adresse (revue finale C-2, I4) : 0x0B (secondes
// jusqu'à la minute suivante), trame non rangée.
func TestTrameFrequenceIP(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		b := nouveauBanc(t, 200)
		c := b.creer(t, 4)
		ea, a := b.entrerMembre(t, c, false)
		lim := limits.New(b.h.Now)
		la := nouveauLien()
		b.servir(la, lim.AllowFrame)
		la.envoyer(accueilWS(ea.Jeton, ea.Seq))
		synctest.Wait()
		for i := 0; i < 481; i++ {
			la.envoyer(demTrame(trameD(0, i)))
		}
		synctest.Wait()
		s := a.salon
		var n int
		sous(s, func() {
			n = len(s.index)
		})
		if n != 480 {
			t.Fatal("trames rangées", n)
		}
		// Envoi en rafale (le client de C-3 n'a qu'une trame en vol) : le 0x0B peut précéder
		// des 0x0F de trames d'avant ; un seul 0x0B, un 0x0F par trame rangée.
		var limites [][]byte
		for i, e := range la.enrs() {
			if e.ty == 0x0B {
				limites = append(limites, la.brut(i))
			}
		}
		if len(limites) != 1 || !bytes.Equal(limites[0], EnrLimite(dernierSeq(s), 30)) { // horloge à 10:07:30
			t.Fatalf("0x0B : %x", limites)
		}
		if n := len(acceptees(t, la)); n != 480 {
			t.Fatal("0x0F :", n)
		}
		if la.codeFerme() != 0 {
			t.Fatal("fermé")
		}
		finir(t, la)
	})
}

// 0x07 1 à l'ouverture, 0 à la fermeture, chez les autres.
func TestPresence(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		b := nouveauBanc(t, 200)
		c := b.creer(t, 4)
		ea := b.entrer(t, c, false)
		eb := b.entrer(t, c, false)
		s := b.etat(t, c)
		lb := b.connecter(eb.Jeton, eb.Seq)
		synctest.Wait()
		n := len(lb.enrs())
		la := b.connecter(ea.Jeton, ea.Seq)
		synctest.Wait()
		if l := lb.enrs(); len(l) != n+1 || !bytes.Equal(lb.brut(n), EnrPresence(dernierSeq(s), ea.Siege, true, 0)) {
			t.Fatalf("présence à l'ouverture : %d", len(l)-n)
		}
		finir(t, la)
		synctest.Wait()
		if l := lb.enrs(); len(l) != n+2 || !bytes.Equal(lb.brut(n+1), EnrPresence(dernierSeq(s), ea.Siege, false, uint64(b.h.Now().Unix()/60))) {
			t.Fatalf("présence à la fermeture : %d", len(l)-n)
		}
		finir(t, lb)
	})
}

// Relecture Task 6, bloquant : un membre en ligne ne perd jamais son siège ; hors ligne non
// plus (revue finale C-2, I3 : siège réservé pour la vie du salon), jusqu'à l'échéance.
func TestEnLigneGardeSonSiege(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		b := nouveauBanc(t, 200)
		c := b.creer(t, 4)
		ea := b.entrer(t, c, false)
		la := b.connecter(ea.Jeton, ea.Seq)
		synctest.Wait()
		for i := 0; i < 11; i++ {
			time.Sleep(time.Minute)
			b.h.avancer(time.Minute)
			b.m.Tick()
		}
		synctest.Wait()
		if la.codeFerme() != 0 {
			t.Fatal("connexion fermée (pings répondus) :", la.codeFerme())
		}
		if _, err := b.m.Membre(ea.Jeton[:]); err != nil {
			t.Fatal("siège perdu en ligne :", err)
		}
		finir(t, la)
		for range 22 {
			b.h.avancer(time.Hour)
			b.m.Tick()
		}
		if _, err := b.m.Membre(ea.Jeton[:]); err != nil {
			t.Fatal("siège perdu hors ligne pendant la vie du salon :", err)
		}
		b.h.avancer(2 * time.Hour) // échéance passée
		b.m.Tick()
		if _, err := b.m.Membre(ea.Jeton[:]); !errors.Is(err, ErrNotFound) {
			t.Fatal("siège gardé après la fin du salon :", err)
		}
	})
}

// Relecture Task 6 : 20 reprises par heure et par siège, la 21ᵉ ferme en 4003 sans rien
// annoncer ; l'heure suivante repart.
func TestReprisesPlafonnees(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		b := nouveauBanc(t, 200)
		c := b.creer(t, 4)
		ea := b.entrer(t, c, false)
		s := b.etat(t, c)
		for i := 0; i < 20; i++ {
			la := b.connecter(ea.Jeton, DepuisReprise)
			synctest.Wait()
			if la.codeFerme() != 0 {
				t.Fatal("reprise", i+1, "refusée :", la.codeFerme())
			}
			finir(t, la)
			b.h.avancer(time.Minute)
		}
		seq := dernierSeq(s)
		la := b.connecter(ea.Jeton, DepuisReprise)
		attendreFin(t, la)
		if c := la.codeFerme(); c != CodeInvalide || dernierSeq(s) != seq {
			t.Fatal("21ᵉ reprise :", c, dernierSeq(s)-seq)
		}
		invariantJournal(t, s)
		b.h.avancer(41 * time.Minute) // la 1ʳᵉ reprise a plus d'une heure
		la = b.connecter(ea.Jeton, DepuisReprise)
		synctest.Wait()
		if la.codeFerme() != 0 || dernierSeq(s) != seq+1 {
			t.Fatal("reprise l'heure suivante :", la.codeFerme())
		}
		finir(t, la)
		invariantJournal(t, s)
	})
}

// Relecture Task 8 : erreur d'entrée-sortie de la conversation → 1011, jamais 4003.
func TestErreurESFerme1011(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		b := nouveauBanc(t, 200)
		c := b.creer(t, 4)
		ea, a := b.entrerMembre(t, c, false)
		avecPanne(t, a.salon.conv).ecriturePartielle = true
		la := b.connecter(ea.Jeton, ea.Seq)
		synctest.Wait()
		la.envoyer(demTrame(trameD(0, 1)))
		attendreFin(t, la)
		if c := la.codeFerme(); c != 1011 {
			t.Fatal("code", c)
		}
	})
}

// Relecture Task 8 : une trame illisible au rattrapage ferme en 1011 (jamais sautée) ; une
// trame retirée est sautée sans erreur.
func TestTrameIllisibleFerme1011(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		b := nouveauBanc(t, 200)
		c := b.creer(t, 4)
		_, g := b.entrerMembre(t, c, true)
		ea := b.entrer(t, c, false)
		var seqs []uint64
		for i := 0; i < 200; i++ {
			seqs = append(seqs, b.recevoir(t, g, trameD(0, i)))
		}
		if err := b.m.Retirer(g, seqs[3]); err != nil {
			t.Fatal(err)
		}
		s := g.salon
		f, err := os.OpenFile(s.conv.chemin, os.O_WRONLY, 0)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := f.WriteAt([]byte{0xFF, 0xFF}, decalage(150)+40); err != nil { // emplacement 150 = seqs[150]
			t.Fatal(err)
		}
		f.Close()
		la := b.connecter(ea.Jeton, ea.Seq)
		attendreFin(t, la)
		if c := la.codeFerme(); c != 1011 {
			t.Fatal("code", c)
		}
		recu := rangs(la.enrs())
		for _, r := range recu {
			if r == seqs[3] || r >= seqs[150] {
				t.Fatal("rang reçu", r)
			}
		}
		if len(recu) != 149 || recu[len(recu)-1] != seqs[149] {
			t.Fatal("reçus", len(recu))
		}
	})
}

// Panique injectée dans Ecrire, puis dans Lire : 1011, Servir rend, le processus continue.
func TestPaniqueRecuperee(t *testing.T) {
	for _, nom := range []string{"Ecrire", "Lire"} {
		t.Run(nom, func(t *testing.T) {
			synctest.Test(t, func(t *testing.T) {
				b := nouveauBanc(t, 200)
				c := b.creer(t, 4)
				ea := b.entrer(t, c, false)
				eb := b.entrer(t, c, false)
				s := b.etat(t, c)
				lb := b.connecter(eb.Jeton, eb.Seq)
				la := nouveauLien()
				la.paniqueEcrire = nom == "Ecrire"
				b.servir(la, toujours)
				la.envoyer(accueilWS(ea.Jeton, ea.Seq))
				if nom == "Lire" {
					synctest.Wait()
					la.set(func(f *fauxLien) { f.paniqueLire = true })
					la.envoyer(demPing([8]byte{}))
				}
				attendreFin(t, la)
				if c := la.codeFerme(); c != 1011 {
					t.Fatal("code", c)
				}
				if connDe(s, ea.Siege) != nil {
					t.Fatal("connexion encore inscrite")
				}
				finir(t, lb)
			})
		})
	}
}

// 0x03 : départ diffusé, jeton oublié, fermeture 1000.
func TestQuitterWS(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		b := nouveauBanc(t, 200)
		c := b.creer(t, 4)
		ea := b.entrer(t, c, false)
		eb := b.entrer(t, c, false)
		s := b.etat(t, c)
		lb := b.connecter(eb.Jeton, eb.Seq)
		la := b.connecter(ea.Jeton, ea.Seq)
		synctest.Wait()
		la.envoyer([]byte{DemQuitter})
		attendreFin(t, la)
		synctest.Wait()
		if c := la.codeFerme(); c != CodeFin {
			t.Fatal("code", c)
		}
		if _, err := b.m.Membre(ea.Jeton[:]); !errors.Is(err, ErrNotFound) {
			t.Fatal("jeton après départ :", err)
		}
		found := false
		for _, e := range lb.enrs() {
			if e.ty == 0x03 && e.corps[0] == ea.Siege {
				found = true
			}
		}
		if !found {
			t.Fatal("départ non diffusé")
		}
		finir(t, lb)
		invariantJournal(t, s)
	})
}

// 0x02 : la trame de l'auteur est retirée.
func TestRetirerWS(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		b := nouveauBanc(t, 200)
		c := b.creer(t, 4)
		ea, a := b.entrerMembre(t, c, false)
		seq := b.recevoir(t, a, trameD(0, 1))
		la := b.connecter(ea.Jeton, ea.Seq)
		synctest.Wait()
		la.envoyer(binary.BigEndian.AppendUint64([]byte{DemRetirer}, seq))
		synctest.Wait()
		s := a.salon
		var eff bool
		sous(s, func() {
			eff = s.index[0].efface()
		})
		if !eff || la.codeFerme() != 0 {
			t.Fatal("trame non retirée", la.codeFerme())
		}
		finir(t, la)
	})
}

// Le créateur rentre par rejoindre (appareil perdu ou volé) : la connexion de l'ancien
// jeton du siège 0 reçoit 0x05 raison 4, est fermée en 4005 et ne reçoit plus rien ; le
// siège passe hors ligne pour les autres.
func TestRejoindreFermeAncienneConnexion(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		b := nouveauBanc(t, 200)
		c := b.creer(t, 4)
		e0 := b.entrer(t, c, true)
		ea, a := b.entrerMembre(t, c, false)
		l0 := b.connecter(e0.Jeton, e0.Seq)
		la := b.connecter(ea.Jeton, ea.Seq)
		synctest.Wait()
		n := len(l0.enrs())
		b.entrer(t, c, true)
		attendreFin(t, l0)
		if c := l0.codeFerme(); c != CodeRemplace {
			t.Fatal("code", c)
		}
		l := l0.enrs()
		if len(l) != n+1 || l[n].ty != 0x05 || !bytes.Equal(l[n].corps, []byte{RaisonRemplace}) {
			t.Fatalf("après rejoindre : %d enregistrements, dernier %x", len(l)-n, l[len(l)-1].ty)
		}
		b.recevoir(t, a, trameD(0, 1))
		synctest.Wait()
		if len(l0.enrs()) != n+1 {
			t.Fatal("trame reçue après rejoindre")
		}
		if connDe(a.salon, 0) != nil {
			t.Fatal("ancienne connexion encore inscrite")
		}
		var hors bool
		for i, e := range la.enrs() {
			if e.ty == 0x07 && bytes.Equal(la.brut(i)[9:], EnrPresence(0, 0, false, uint64(b.h.Now().Unix()/60))[9:]) {
				hors = true
			}
		}
		if !hors {
			t.Fatal("siège 0 non annoncé hors ligne")
		}
		finir(t, la)
	})
}

// Point 4 : les reprises par rejoindre (créateur) et par WebSocket (0x0A) partagent le
// plafond de 20 par heure et par siège. Au-delà : rejoindre rend *Attente (429 limit)
// jusqu'à ce que la plus ancienne sorte de l'heure, le WebSocket ferme en 4003.
func TestReprisesRejoindrePlafonnees(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		b := nouveauBanc(t, 200)
		c := b.creer(t, 4)
		e := b.entrer(t, c, true) // première entrée : pas une reprise
		s := b.etat(t, c)
		for i := 0; i < 20; i++ {
			if i%2 == 0 {
				e = b.entrer(t, c, true)
			} else {
				l := b.connecter(e.Jeton, DepuisReprise)
				synctest.Wait()
				if l.codeFerme() != 0 {
					t.Fatal("reprise", i+1, "refusée :", l.codeFerme())
				}
				finir(t, l)
			}
			b.h.avancer(time.Minute)
		}
		seq := dernierSeq(s)
		_, err := b.m.Rejoindre(c.acces, c.preuve, c.gestion)
		var at *Attente
		if !errors.As(err, &at) || at.Retry != 40*time.Minute {
			t.Fatal("21ᵉ reprise par rejoindre :", err)
		}
		l := b.connecter(e.Jeton, DepuisReprise)
		attendreFin(t, l)
		if c := l.codeFerme(); c != CodeInvalide || dernierSeq(s) != seq {
			t.Fatal("21ᵉ reprise par WebSocket :", c, dernierSeq(s)-seq)
		}
		if _, err := b.m.Membre(e.Jeton[:]); err != nil {
			t.Fatal("jeton perdu par un refus :", err)
		}
		invariantJournal(t, s)
		b.h.avancer(40 * time.Minute)
		if _, err := b.m.Rejoindre(c.acces, c.preuve, c.gestion); err != nil {
			t.Fatal("reprise l'heure suivante :", err)
		}
	})
}

// Contexte de Servir annulé (arrêt) : 1001.
func TestContexteAnnule(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		b := nouveauBanc(t, 200)
		c := b.creer(t, 4)
		ea := b.entrer(t, c, false)
		ctx, cancel := context.WithCancel(context.Background())
		la := nouveauLien()
		go func() { la.fini <- b.m.Servir(ctx, la, netip.MustParseAddr(ipTest), toujours) }()
		la.envoyer(accueilWS(ea.Jeton, ea.Seq))
		synctest.Wait()
		cancel()
		attendreFin(t, la)
		if c := la.codeFerme(); c != CodeArret {
			t.Fatal("code", c)
		}
	})
}

// attendre : cond vraie avant 10 s (temps réel, hors synctest).
func attendre(t *testing.T, cond func() bool) {
	t.Helper()
	for fin := time.Now().Add(10 * time.Second); !cond(); time.Sleep(100 * time.Microsecond) {
		if time.Now().After(fin) {
			t.Fatal("délai dépassé")
		}
	}
}

// Review Focus 1, en temps réel (hors synctest, où le temps ne passe jamais pendant le
// passage au direct) : 40 reconnexions pendant un envoi continu de deux membres ; chaque
// session reçoit, sans trou ni doublon, tout ce qui est rangé entre son depuis et le dernier
// rang reçu.
func TestBasculeSousEnvoiContinu(t *testing.T) {
	b := nouveauBanc(t, 200)
	c := b.creer(t, 4)
	_, a := b.entrerMembre(t, c, false)
	_, bm := b.entrerMembre(t, c, false)
	ec, _ := b.entrerMembre(t, c, false)
	s := a.salon
	stop := make(chan struct{})
	var wg sync.WaitGroup
	for _, mb := range []Membre{a, bm} {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for i := 0; ; i++ {
				select {
				case <-stop:
					return
				default:
				}
				d := byte(0)
				if i%5 == 0 {
					d = dVolatile
				}
				if _, err := b.m.Recevoir(mb, trameD(d, i), nil); err != nil {
					t.Error(err)
					return
				}
				time.Sleep(20 * time.Microsecond)
			}
		}()
	}
	defer func() { close(stop); wg.Wait() }()
	depuis := ec.Seq
	for k := 0; k < 40; k++ {
		l := b.connecter(ec.Jeton, depuis)
		attendre(t, func() bool {
			s.mu.Lock()
			defer s.mu.Unlock()
			cc := s.conns[ec.Siege]
			return cc != nil && cc.direct
		})
		// Au moins une trame reçue avant de partir (audit D4 : 2 ms d'attente ne suffisaient
		// pas sous -race avec tous les paquets en parallèle).
		attendre(t, func() bool { return len(rangs(l.enrs())) > 0 })
		finir(t, l)
		recu := rangs(l.enrs())
		if len(recu) == 0 {
			t.Fatal("session", k, "vide")
		}
		vu := map[uint64]bool{}
		for i, r := range recu {
			if r <= depuis || (i > 0 && r <= recu[i-1]) {
				t.Fatal("session", k, ": ordre, doublon ou rang ≤ depuis :", r)
			}
			vu[r] = true
		}
		dernier := recu[len(recu)-1]
		for _, r := range stockes(t, s, depuis) {
			if r > dernier {
				break
			}
			if !vu[r] {
				t.Fatal("session", k, ": trou au rang", r)
			}
		}
		depuis = dernier
	}
}

// Relecture Task 9, point 1 : une panique sous le verrou du salon (dernier lot du
// rattrapage) est récupérée sans garder le verrou : la connexion ferme en 1011, puis
// Recevoir d'un autre membre et Tick rendent la main. Temps réel (un verrou gardé ne
// bloque pas durablement sous synctest).
func TestPaniqueSousVerrouRendLeVerrou(t *testing.T) {
	b := nouveauBanc(t, 200)
	c := b.creer(t, 4)
	_, g := b.entrerMembre(t, c, true)
	ea := b.entrer(t, c, false)
	for i := 0; i < 5; i++ {
		b.recevoir(t, g, trameD(0, i))
	}
	crochetLireRefs = func() { panic("salon: panique injectée (lireRefs)") }
	t.Cleanup(func() { crochetLireRefs = nil })
	la := b.connecter(ea.Jeton, ea.Seq)
	select {
	case <-la.fini:
	case <-time.After(5 * time.Second):
		t.Fatal("Servir ne rend pas : verrou du salon gardé après la panique")
	}
	crochetLireRefs = nil
	if c := la.codeFerme(); c != 1011 {
		t.Fatal("code", c)
	}
	fait := make(chan struct{})
	go func() {
		defer close(fait)
		b.m.Recevoir(g, trameD(0, 9), nil)
		b.m.Tick()
	}()
	select {
	case <-fait:
	case <-time.After(2 * time.Second):
		t.Fatal("Recevoir ou Tick bloqué : verrou du salon gardé")
	}
}

// Point 2 : une panique en préparant l'accueil (0x0D, 0x07) ne laisse ni connexion fantôme
// ni siège « en ligne » : rien n'est inscrit avant que l'accueil soit prêt.
func TestPaniqueAccueilSansFantome(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		b := nouveauBanc(t, 200)
		c := b.creer(t, 4)
		ea := b.entrer(t, c, false)
		s := b.etat(t, c)
		crochetAccueil = func() { panic("salon: panique injectée (accueil)") }
		defer func() { crochetAccueil = nil }()
		la := b.connecter(ea.Jeton, ea.Seq)
		if err := <-la.fini; !errors.Is(err, errPanique) || la.codeFerme() != 1011 {
			t.Fatal("Servir :", err, la.codeFerme())
		}
		var fantome, garde bool
		sous(s, func() {
			fantome, garde = s.conns[ea.Siege] != nil, s.sieges[ea.Siege] != nil
		})
		if fantome || !garde {
			t.Fatal("connexion fantôme :", fantome, "siège gardé :", garde)
		}
	})
}

// Point 3 : accueil absent avec un lien dont Lire ne rend qu'à l'annulation du ctx : 4001
// et Servir rend quand même (ctx annulé juste après Fermer).
func TestAccueilAbsentLireSourd(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		b := nouveauBanc(t, 200)
		l := nouveauLien()
		l.ignoreFerme = true
		b.servir(l, toujours)
		time.Sleep(delaiAccueil)
		attendreFin(t, l)
		if c := l.codeFerme(); c != CodeAccueil {
			t.Fatal("code", c)
		}
	})
}

// FermerTout (arrêt du serveur) : toute connexion ouverte est fermée en 1001 ; une connexion
// dont l'accueil arrive ensuite aussi, sans être inscrite.
func TestFermerTout(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		b := nouveauBanc(t, 200)
		c := b.creer(t, 3)
		e0, _ := b.entrerMembre(t, c, true)
		e1, _ := b.entrerMembre(t, c, false)
		l0, l1 := b.connecter(e0.Jeton, e0.Seq), b.connecter(e1.Jeton, e1.Seq)
		synctest.Wait()
		b.m.FermerTout()
		for _, l := range []*fauxLien{l0, l1} {
			attendreFin(t, l)
			if code := l.codeFerme(); code != CodeArret {
				t.Fatalf("code %d, attendu 1001", code)
			}
		}
		l := b.connecter(e0.Jeton, e0.Seq)
		attendreFin(t, l)
		if code := l.codeFerme(); code != CodeArret {
			t.Fatalf("après l'arrêt : code %d, attendu 1001", code)
		}
		if connDe(b.etat(t, c), 0) != nil {
			t.Fatal("connexion inscrite après l'arrêt")
		}
	})
}

// Dernière connexion (Task 9b, spec v3 §14.1) : heure de la dernière déconnexion de chaque
// siège, en mémoire seulement, arrondie à la minute inférieure.

// poser : l'horloge du banc à t.
func (h *horloge) poser(t time.Time) {
	h.mu.Lock()
	h.t = t
	h.mu.Unlock()
}

// minuteDe : minutes Unix de t (arrondi inférieur), calculées ici sans le code du serveur.
func minuteDe(t time.Time) uint64 { return uint64(t.Truncate(time.Minute).Unix() / 60) }

// derniere07 : corps (siège ‖ état ‖ minute) du dernier 0x07 reçu pour le siège n.
func derniere07(t *testing.T, l *fauxLien, n uint8) (enLigne bool, minute uint64) {
	t.Helper()
	enrs := l.enrs()
	for i := len(enrs) - 1; i >= 0; i-- {
		if e := enrs[i]; e.ty == 0x07 && e.corps[0] == n {
			if len(e.corps) != 10 {
				t.Fatalf("0x07 de %d octets", 9+len(e.corps))
			}
			return e.corps[1] == 1, binary.BigEndian.Uint64(e.corps[2:])
		}
	}
	t.Fatalf("aucun 0x07 pour le siège %d", n)
	return false, 0
}

// annonce0D : minute de l'annonce du siège n dans le premier 0x0D reçu (présent : false si
// le siège n'y est pas).
func annonce0D(t *testing.T, l *fauxLien, n uint8) (minute uint64, present bool) {
	t.Helper()
	b := l.brut(0)
	if b[0] != 0x0D || len(b) != 11+25*int(b[10]) {
		t.Fatalf("premier enregistrement : %x (%d octets)", b[0], len(b))
	}
	for i := 0; i < int(b[10]); i++ {
		if o := b[11+25*i:]; o[0] == n {
			return binary.BigEndian.Uint64(o[17:25]), true
		}
	}
	return 0, false
}

var heureB = time.Date(2026, 11, 12, 14, 32, 47, 0, time.UTC)

// B se déconnecte à 14:32:47 : A reçoit 0x07 hors ligne avec la minute de 14:32 ; en ligne,
// la minute est nulle.
func TestDerniereConnexionDiffusee(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		b := nouveauBanc(t, 200)
		c := b.creer(t, 4)
		ea := b.entrer(t, c, false)
		eb := b.entrer(t, c, false)
		la := b.connecter(ea.Jeton, ea.Seq)
		lb := b.connecter(eb.Jeton, eb.Seq)
		synctest.Wait()
		if en, m := derniere07(t, la, eb.Siege); !en || m != 0 {
			t.Fatalf("B en ligne : %v, minute %d", en, m)
		}
		b.h.poser(heureB)
		finir(t, lb)
		synctest.Wait()
		en, m := derniere07(t, la, eb.Siege)
		want := uint64(time.Date(2026, 11, 12, 14, 32, 0, 0, time.UTC).Unix() / 60)
		if en || m != want || m != minuteDe(heureB) {
			t.Fatalf("B hors ligne : %v, minute %d, attendu %d", en, m, want)
		}
		// Arrondi inférieur : 14:32:59.999 reste 14:32.
		lb = b.connecter(eb.Jeton, eb.Seq)
		synctest.Wait()
		b.h.poser(time.Date(2026, 11, 12, 14, 32, 59, 999_999_999, time.UTC))
		finir(t, lb)
		synctest.Wait()
		if _, m := derniere07(t, la, eb.Siege); m != want {
			t.Fatalf("14:32:59.999 : minute %d, attendu %d", m, want)
		}
		finir(t, la)
	})
}

// A se reconnecte : le 0x0D et le 0x07 portent la minute de B ; le siège 0, jamais
// connecté, porte 0 (inconnue) ; le siège de A lui-même, en ligne, 0. Une reprise (0x0A,
// par WebSocket ou par rejoindre du créateur) ne pose ni n'efface la minute.
func TestDerniereConnexionAccueil(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		b := nouveauBanc(t, 200)
		c := b.creer(t, 4)
		e0 := b.entrer(t, c, true)
		ea := b.entrer(t, c, false)
		eb := b.entrer(t, c, false)
		s := b.etat(t, c)
		la := b.connecter(ea.Jeton, ea.Seq)
		lb := b.connecter(eb.Jeton, eb.Seq)
		synctest.Wait()
		b.h.poser(heureB)
		finir(t, lb)
		b.h.poser(heureB.Add(5 * time.Minute))
		finir(t, la)
		b.h.poser(heureB.Add(8 * time.Minute))
		la = b.connecter(ea.Jeton, dernierSeq(s))
		synctest.Wait()
		for _, k := range []struct {
			n    uint8
			want uint64
		}{{e0.Siege, 0}, {ea.Siege, 0}, {eb.Siege, minuteDe(heureB)}} {
			if m, ok := annonce0D(t, la, k.n); !ok || m != k.want {
				t.Errorf("0x0D, siège %d : minute %d (%v), attendu %d", k.n, m, ok, k.want)
			}
			en, m := derniere07(t, la, k.n)
			if m != k.want || en != (k.n == ea.Siege) {
				t.Errorf("0x07, siège %d : %v, minute %d, attendu %d", k.n, en, m, k.want)
			}
		}
		// Reprise de B par WebSocket : en ligne (minute nulle), puis la minute de sa nouvelle
		// déconnexion, pas celle de la reprise.
		b.h.poser(heureB.Add(20 * time.Minute))
		lb = b.connecter(eb.Jeton, DepuisReprise)
		synctest.Wait()
		if en, m := derniere07(t, la, eb.Siege); !en || m != 0 {
			t.Fatalf("B repris : %v, minute %d", en, m)
		}
		b.h.poser(heureB.Add(21 * time.Minute))
		finir(t, lb)
		synctest.Wait()
		if _, m := derniere07(t, la, eb.Siege); m != minuteDe(heureB.Add(21*time.Minute)) {
			t.Fatalf("B après reprise : minute %d", m)
		}
		// Créateur : connecté puis parti à 14:40, il reprend le siège 0 par rejoindre (0x0A) :
		// sa dernière connexion reste 14:40 tant qu'il n'a pas rouvert de WebSocket.
		l0 := b.connecter(e0.Jeton, e0.Seq)
		synctest.Wait()
		b.h.poser(time.Date(2026, 11, 12, 14, 40, 10, 0, time.UTC))
		finir(t, l0)
		b.h.poser(time.Date(2026, 11, 12, 15, 0, 0, 0, time.UTC))
		b.entrer(t, c, true)
		finir(t, la)
		la = b.connecter(ea.Jeton, dernierSeq(s))
		synctest.Wait()
		want := minuteDe(time.Date(2026, 11, 12, 14, 40, 0, 0, time.UTC))
		if m, _ := annonce0D(t, la, 0); m != want {
			t.Errorf("0x0D du créateur repris : minute %d, attendu %d", m, want)
		}
		if _, m := derniere07(t, la, 0); m != want {
			t.Errorf("0x07 du créateur repris : minute %d, attendu %d", m, want)
		}
		finir(t, la)
	})
}

// Revue finale C-2, I3 : la dernière connexion d'un absent reste annoncée (0x0D et 0x07) tant
// que son siège existe, même après des heures d'absence.
func TestDerniereConnexionGardeeLongtemps(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		b := nouveauBanc(t, 200)
		c := b.creer(t, 4)
		ea := b.entrer(t, c, false)
		eb := b.entrer(t, c, false)
		s := b.etat(t, c)
		l0 := b.connecter(ea.Jeton, ea.Seq) // A connecté une fois : réservé à vie (N1)
		synctest.Wait()
		finir(t, l0)
		lb := b.connecter(eb.Jeton, eb.Seq)
		synctest.Wait()
		b.h.poser(heureB)
		finir(t, lb)
		for range 19 { // 9 h 32 le lendemain : échéance à 10 h 15
			b.h.avancer(time.Hour)
			b.m.Tick()
		}
		la := b.connecter(ea.Jeton, dernierSeq(s))
		synctest.Wait()
		if m, ok := annonce0D(t, la, eb.Siege); !ok || m != minuteDe(heureB) {
			t.Fatalf("0x0D de l'absent : minute %d (%v), attendu %d", m, ok, minuteDe(heureB))
		}
		if en, m := derniere07(t, la, eb.Siege); en || m != minuteDe(heureB) {
			t.Fatalf("0x07 de l'absent : %v, minute %d", en, m)
		}
		finir(t, la)
	})
}

// Siège libéré : la minute est oubliée, le nouvel occupant porte 0 ; fin du salon : plus
// rien n'est gardé.
func TestDerniereConnexionOubliee(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		b := nouveauBanc(t, 200)
		c := b.creer(t, 4)
		ea := b.entrer(t, c, false)
		eb := b.entrer(t, c, false)
		s := b.etat(t, c)
		lb := b.connecter(eb.Jeton, eb.Seq)
		synctest.Wait()
		b.h.poser(heureB)
		finir(t, lb)
		sous(s, func() {
			if x := s.sieges[eb.Siege]; x == nil || x.derniere != minuteDe(heureB) {
				t.Fatal("minute non gardée en mémoire")
			}
		})
		b.depart(s, eb.Siege)
		ec := b.entrer(t, c, false)
		if ec.Siege != eb.Siege {
			t.Fatal("siège du nouvel occupant", ec.Siege)
		}
		la := b.connecter(ea.Jeton, dernierSeq(s))
		synctest.Wait()
		if m, ok := annonce0D(t, la, ec.Siege); !ok || m != 0 {
			t.Fatalf("0x0D du nouvel occupant : minute %d (%v)", m, ok)
		}
		if en, m := derniere07(t, la, ec.Siege); en || m != 0 {
			t.Fatalf("0x07 du nouvel occupant : %v, minute %d", en, m)
		}
		finir(t, la)
		if err := b.m.detruire(b.idDe(t, c)); err != nil {
			t.Fatal(err)
		}
		sous(s, func() {
			for n, x := range s.sieges {
				if x != nil {
					t.Fatalf("siège %d gardé après la fin du salon", n)
				}
			}
		})
	})
}

// La minute (et la seconde) de la dernière déconnexion n'est jamais écrite : ni dans le
// fichier de conversation, ni dans la base, ni dans son WAL, ni ailleurs sous le dossier.
func TestDerniereConnexionJamaisSurDisque(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		b := nouveauBanc(t, 200)
		c := b.creer(t, 4)
		ea := b.entrer(t, c, false)
		eb, mb := b.entrerMembre(t, c, false)
		s := b.etat(t, c)
		lb := b.connecter(eb.Jeton, eb.Seq)
		synctest.Wait()
		for i := range 5 {
			b.recevoir(t, mb, trameD(0, i))
		}
		heure := time.Date(2026, 11, 12, 14, 32, 47, 0, time.UTC)
		b.h.poser(heure)
		finir(t, lb)
		b.entrer(t, c, false) // une écriture de plus dans la base après la déconnexion
		la := b.connecter(ea.Jeton, dernierSeq(s))
		synctest.Wait()
		minute := minuteDe(heure)
		if _, m := derniere07(t, la, eb.Siege); m != minute {
			t.Fatal("témoin : minute non servie", m)
		}
		finir(t, la)
		var motifs [][]byte
		for _, v := range []uint64{minute, uint64(heure.Unix()), minute * 60} {
			motifs = append(motifs, binary.BigEndian.AppendUint64(nil, v), binary.LittleEndian.AppendUint64(nil, v),
				[]byte(strconv.FormatUint(v, 10)))
		}
		lus := 0
		err := filepath.WalkDir(b.dir, func(p string, d fs.DirEntry, err error) error {
			if err != nil || d.IsDir() {
				return err
			}
			brut, err := os.ReadFile(p)
			if err != nil {
				return err
			}
			lus++
			for _, m := range motifs {
				if bytes.Contains(brut, m) {
					t.Errorf("%s contient %x", filepath.Base(p), m)
				}
			}
			return nil
		})
		if err != nil {
			t.Fatal(err)
		}
		if _, err := os.Stat(filepath.Join(b.dir, "shares.db-wal")); err != nil {
			t.Fatal("témoin : WAL absent", err)
		}
		if _, err := os.Stat(filepath.Join(b.dir, "salons")); err != nil || lus < 3 {
			t.Fatal("témoin : fichiers lus", lus, err)
		}
	})
}
