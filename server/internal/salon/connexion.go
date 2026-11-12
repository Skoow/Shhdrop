package salon

import (
	"context"
	"crypto/rand"
	"encoding/binary"
	"errors"
	"math"
	"net/netip"
	"sync"
	"sync/atomic"
	"time"
)

// Connexions WebSocket du salon (plan C-2 Task 9, « Protocole », Review Focus 1 et 2) :
// accueil, séquence d'accueil, rattrapage puis direct, contre-pression, ping.
//
// Écrivain à deux modes, une goroutine par connexion :
//   - rattrapage : lots de lotRattrapage enregistrements de rang > curseur, copiés sous le
//     verrou du salon (refsLocked) puis lus et déchiffrés hors du verrou ; aucune file. Le
//     dernier lot (moins de lotRattrapage) est lu sous le verrou et la connexion passe au
//     direct dans la même section : rien ne peut tomber entre les deux (aucun trou ni
//     doublon) ;
//   - direct : chaque enregistrement est ajouté, sous le verrou du salon, à la file de la
//     connexion (fileMax au plus). File pleine : retour au rattrapage depuis le dernier rang
//     mis dans la file, sans jamais attendre (les autres membres ne sont pas ralentis).
//
// Fermetures (code, une seule fois) : retard de plus de retardMax en rattrapage après une
// file pleine alors que des enregistrements arrivent, ou Ecrire bloqué depuis ecritureMax →
// 0x05 raison 6 puis 4006 ; aucun pong ni message depuis silenceMax → 1001 ; panique dans une
// goroutine de la connexion → 1011 (jamais d'arrêt du processus, aucune sortie).
//
// Aucune adresse n'est gardée dans l'état du salon : ip ne vit que dans la goroutine de
// lecture, pour autoriser (limits.AllowFrame dans le serveur).

const (
	delaiAccueil = 5 * time.Second
	// fileMax : enregistrements en attente au plus dans la file du direct.
	fileMax = 256
	// lotRattrapage : enregistrements lus au plus par lot de rattrapage.
	lotRattrapage = 64
	retardMax     = 5 * time.Second
	ecritureMax   = 10 * time.Second
	periodePing   = 20 * time.Second
	delaiPing     = 25 * time.Second
	silenceMax    = 45 * time.Second
	// controlesParMinute : messages 0x02 à 0x05 par minute et par connexion (au-delà, 4003).
	controlesParMinute = 600
	// repriseMax : reprises (0x0A) par heure et par siège, par WebSocket (au-delà, 4003) ou
	// par rejoindre du créateur (au-delà, *Attente : 429 limit) : un membre qui recharge en
	// boucle ne remplit pas le journal des annonces (relecture Task 6).
	repriseMax = 20
	// priveMax : réponses propres à la connexion (pong, limite, plein) en attente au plus ;
	// au-delà, le client ne lit plus : 4006.
	priveMax = 1024
	// attenteFinale : délai laissé à l'écrivain pour remettre le dernier enregistrement
	// (0x05) avant Fermer.
	attenteFinale = time.Second
	// periodeVeille : période des contrôles de silence et d'écriture bloquée.
	periodeVeille = time.Second
)

// CodeInterne : erreur du serveur (panique récupérée, erreur d'entrée-sortie de la
// conversation, trame illisible au rattrapage, journal des annonces plein à une reprise).
const CodeInterne = 1011

var errPanique = errors.New("salon: panique récupérée dans une connexion")

// crochetAccueil : tests seulement (panique injectée en préparant l'accueil) ; nil en
// production. Ne pas paralléliser les tests qui le modifient (t.Parallel interdit).
var crochetAccueil func()

// Lien : WebSocket d'un membre, vu du salon (adaptateur coder/websocket à la Task 10).
//   - Lire rend le message binaire suivant ; un message texte rend ErrProtocole.
//   - Ecrire envoie b en un message binaire ; b ne doit pas être modifié ni gardé.
//   - Ping envoie un ping et attend le pong (ou l'échéance de ctx).
//   - Fermer envoie le code de fermeture et ferme ; elle peut être appelée pendant un Lire,
//     un Ecrire ou un Ping en cours, qu'elle débloque (ils rendent alors une erreur).
//
// Le salon n'annule le ctx de Lire, Ecrire et Ping qu'après Fermer : l'adaptateur peut donc
// fermer brutalement sur un ctx annulé sans perdre le code. Lire n'est appelée que par une
// goroutine à la fois, Ecrire de même.
type Lien interface {
	Lire(ctx context.Context) ([]byte, error)
	Ecrire(ctx context.Context, b []byte) error
	Ping(ctx context.Context) error
	Fermer(code int, raison string) error
}

// connexion : WebSocket ouvert d'un siège. Les champs marqués « s.mu » sont protégés par le
// verrou du salon (diffusion sous ce verrou) ; cmu protège la fermeture.
type connexion struct {
	m   *Manager
	s   *salon
	mb  Membre
	l   Lien
	ctx context.Context // annulé seulement après Fermer
	t0  time.Time       // base des durées vu et ecritDepuis (horloge monotone)

	// s.mu
	direct          bool
	file            [][]byte // direct : enregistrements à écrire, fileMax au plus
	prive           [][]byte // accueil, et réponses (pong, limite, plein) hors du direct ; écrits avant la file
	curseur         uint64   // dernier rang remis à l'écrivain (lu ou mis dans la file)
	retardDepuis    time.Time
	presenceManquee bool // une présence (0x07) diffusée hors du direct : état renvoyé au retour
	// effacesManques : cibles des 0x0E diffusés hors du direct (sans rang, le rattrapage ne
	// les sert pas) : renvoyés au retour au direct, après tout ce qui a été écrit avant.
	effacesManques []uint64

	reveil       chan struct{} // capacité 1
	stop         chan struct{} // fermé par arreter
	ecrivainFini chan struct{}
	arrete       atomic.Bool
	vu           atomic.Int64 // dernier message ou pong, en ns depuis t0 (0 : l'inscription)
	ecritDepuis  atomic.Int64 // début de l'Ecrire en cours, ns depuis t0 + 1 ; 0 sinon

	cmu  sync.Mutex
	code int
	fin  []byte // dernier enregistrement à écrire avant Fermer (0x05), ou nil
}

// fermeur : Fermer une seule fois ; une panique de Fermer est récupérée.
type fermeur struct {
	l    Lien
	once sync.Once
}

func (f *fermeur) fermer(code int) {
	f.once.Do(func() {
		defer func() { _ = recover() }()
		_ = f.l.Fermer(code, "")
	})
}

// Servir sert le WebSocket l d'un membre jusqu'à sa fermeture : accueil dans les 5 s (sinon
// 4001), jeton révoqué 4002, inconnu 4004 ; une seule connexion par siège (l'ancienne reçoit
// 0x05 raison 4 et 4005) ; séquence d'accueil du « Protocole » ; reprise (DepuisReprise) :
// nouveau nonce_arrivée annoncé par 0x0A, 20 par heure et par siège. autoriser(ip) est
// consultée avant chaque trame (limits.AllowFrame dans le serveur) : refus → 0x0B jusqu'à la
// minute suivante, trame non rangée. ctx annulé : 1001. Rend nil, ou une erreur fixe si une
// panique a été récupérée (rien n'est écrit dans un journal).
func (m *Manager) Servir(ctx context.Context, l Lien, ip netip.Addr, autoriser func(netip.Addr) bool) (err error) {
	f := &fermeur{l: l}
	var c *connexion
	defer func() {
		if r := recover(); r != nil {
			err = errPanique
			if c == nil {
				f.fermer(CodeInterne)
			}
		}
	}()
	if autoriser == nil {
		f.fermer(CodeInterne)
		return errConfig
	}
	a, code := accueillir(ctx, l, f)
	if code != 0 {
		f.fermer(code)
		return nil
	}
	mb, err := m.Membre(a.Jeton[:])
	clear(a.Jeton[:])
	switch {
	case errors.Is(err, ErrExcluded):
		f.fermer(CodeRevoque)
		return nil
	case err != nil:
		f.fermer(CodeInconnu)
		return nil
	}
	cctx, cancel := context.WithCancel(context.WithoutCancel(ctx))
	defer cancel()
	nc, code := m.inscrire(cctx, mb, a, l)
	if code != 0 {
		f.fermer(code)
		return nil
	}
	c = nc
	var wg sync.WaitGroup
	defer func() {
		if r := recover(); r != nil {
			c.arreter(CodeInterne, nil)
			err = errPanique
		}
		select {
		case <-c.ecrivainFini:
		case <-time.After(attenteFinale):
		}
		f.fermer(c.codeFinal())
		cancel()
		wg.Wait()
		m.desinscrire(c)
	}()
	wg.Add(3)
	go func() { defer wg.Done(); c.ecrivain() }()
	go func() { defer wg.Done(); c.lecteur(ip, autoriser) }()
	go func() { defer wg.Done(); c.pingeur() }()
	c.veiller(ctx)
	return nil
}

// accueillir lit l'accueil (51 octets) dans les 5 s ; rend le code de fermeture sinon.
// Le délai ferme le lien (Fermer débloque Lire) au lieu d'annuler le ctx de Lire.
func accueillir(ctx context.Context, l Lien, f *fermeur) (Accueil, int) {
	type lu struct {
		b   []byte
		err error
	}
	ch := make(chan lu, 1)
	actx, cancel := context.WithCancel(context.WithoutCancel(ctx))
	defer cancel()
	go func() {
		defer func() {
			if r := recover(); r != nil {
				ch <- lu{err: errPanique}
			}
		}()
		b, err := l.Lire(actx)
		ch <- lu{b, err}
	}()
	t := time.NewTimer(delaiAccueil)
	defer t.Stop()
	var r lu
	select {
	case r = <-ch:
	case <-t.C:
		f.fermer(CodeAccueil)
		cancel() // débloque aussi un Lire qui n'attend que son ctx
		<-ch
		return Accueil{}, CodeAccueil
	case <-ctx.Done():
		f.fermer(CodeArret)
		cancel() // débloque aussi un Lire qui n'attend que son ctx
		<-ch
		return Accueil{}, CodeArret
	}
	switch {
	case errors.Is(r.err, errPanique):
		return Accueil{}, CodeInterne
	case r.err != nil:
		return Accueil{}, CodeAccueil
	}
	a, err := LireAccueil(r.b)
	clear(r.b) // jeton en base64url
	if err != nil {
		return Accueil{}, CodeAccueil
	}
	return a, 0
}

// inscrire : séquence d'accueil sous le verrou du salon. Reconnexion : 0x0D au rang
// max(depuis, rang d'émission du jeton) plafonné au dernier rang (plan, point 7), puis un
// 0x07 par siège occupé ; le rattrapage suit (écrivain). Reprise : 0x0A diffusé avec un
// nonce neuf, 0x0D au rang de ce 0x0A, 0x07, direct. L'ancienne connexion du siège est
// remplacée ; horsLigneDepuis est remis à zéro (un membre en ligne garde son siège).
// En reprise, si la construction de l'accueil panique, il reste un 0x0A diffusé sans
// connexion et une reprise décomptée : accepté, on ne peut pas faire autrement, puisque le
// 0x0D est au rang de ce 0x0A (il faut l'avoir annoncé pour construire l'accueil).
func (m *Manager) inscrire(ctx context.Context, mb Membre, a Accueil, l Lien) (*connexion, int) {
	s := mb.salon
	now := m.cfg.Now()
	s.mu.Lock()
	defer s.mu.Unlock()
	// Lu sous s.mu : FermerTout pose arrete avant de parcourir les connexions sous ce même
	// verrou ; une connexion inscrite ici est donc vue par FermerTout, ou refusée.
	if m.arrete.Load() {
		return nil, CodeArret
	}
	if !s.membreLocked(mb, now) {
		return nil, CodeInconnu
	}
	x := s.sieges[mb.siege]
	var point uint64
	if a.Reprise {
		if x.attenteReprise(now) > 0 {
			return nil, CodeInvalide
		}
		var nonce [16]byte
		rand.Read(nonce[:]) // ne rend jamais d'erreur (Go ≥ 1.24)
		seq, err := s.annoncerLocked(func(seq uint64) []byte { return EnrReprise(seq, mb.siege, nonce) }, false)
		if err != nil {
			return nil, CodeInterne // journal des annonces plein (ErrLimit)
		}
		x.nonce = nonce
		x.reprises = append(x.reprises, now)
		s.plusAttenduLocked(mb.siege) // nouvelle identité (plan, point 8)
		point = seq
	} else {
		point = min(max(a.Depuis, x.emis), s.seq)
	}
	// Accueil construit avant toute inscription : une panique ici ne laisse ni connexion
	// fantôme ni siège « en ligne ».
	if crochetAccueil != nil {
		crochetAccueil()
	}
	accueil := append([][]byte{EnrListe(point, 0, s.etatAuLocked(point))}, s.presencesLocked(mb.siege)...)
	c := &connexion{
		m: m, s: s, mb: mb, l: l, ctx: ctx, t0: time.Now(), curseur: point, direct: point == s.seq,
		prive: accueil, reveil: make(chan struct{}, 1), stop: make(chan struct{}), ecrivainFini: make(chan struct{}),
	}
	if old := s.conns[mb.siege]; old != nil {
		old.arreter(CodeRemplace, EnrFin(s.seq, RaisonRemplace))
	}
	s.conns[mb.siege] = c
	x.horsLigneDepuis = time.Time{}
	s.diffuserLocked(EnrPresence(s.seq, mb.siege, true), genrePresence, c)
	return c, 0
}

// presencesLocked : un 0x07 par siège occupé (en ligne s'il a une connexion ; soi, le siège
// de la connexion servie, toujours en ligne).
func (s *salon) presencesLocked(soi uint8) [][]byte {
	var out [][]byte
	for n, x := range s.sieges {
		if x != nil {
			out = append(out, EnrPresence(s.seq, uint8(n), s.conns[n] != nil || uint8(n) == soi))
		}
	}
	return out
}

// desinscrire retire c de son siège s'il l'occupe encore (pas remplacé) : siège hors ligne
// depuis maintenant (libéré 10 min plus tard par Tick) et 0x07 hors ligne diffusé.
func (m *Manager) desinscrire(c *connexion) {
	s := c.s
	s.mu.Lock()
	defer s.mu.Unlock()
	n := c.mb.siege
	if s.conns[n] != c {
		return
	}
	s.conns[n] = nil
	x := s.sieges[n]
	if x == nil {
		return // parti (0x03)
	}
	if x.emis == c.mb.emis {
		x.horsLigneDepuis = m.cfg.Now()
	}
	s.diffuserLocked(EnrPresence(s.seq, n, false), genrePresence, nil)
}

// relayerLocked diffuse la trame de rang s.seq (rangée ou volatile) aux connexions en direct ;
// l'enregistrement n'est construit que si une connexion existe.
func (s *salon) relayerLocked(siege uint8, recuMs int64, trame []byte) {
	for _, c := range s.conns {
		if c != nil {
			s.diffuserLocked(EnrTrame(s.seq, siege, recuMs, trame), genreRang, nil)
			return
		}
	}
}

// genre : ce que diffuserLocked remet.
type genre uint8

const (
	genreRang     genre = iota // 0x01, 0x02, 0x03, 0x09, 0x0A : prend un rang
	genrePresence              // 0x07
	genreEfface                // 0x0E (cible en enr[9:17])
)

// diffuserLocked remet enr à chaque connexion sauf sauf, sans jamais attendre. Hors du
// direct, un rang manqué sera servi par le rattrapage (sauf une trame volatile, perdue :
// normal) ; une présence manquée fait renvoyer l'état des présences au retour au direct ; un
// 0x0E manqué est renvoyé au retour au direct (effacesManques ; plus de priveMax en attente :
// le client ne suit plus, 4006). Appelé sous s.mu.
func (s *salon) diffuserLocked(enr []byte, g genre, sauf *connexion) {
	for _, c := range s.conns {
		if c == nil || c == sauf || c.arrete.Load() {
			continue
		}
		if c.direct && len(c.file) >= fileMax {
			c.direct = false
			c.retardDepuis = time.Now()
		} else if !c.direct && g == genreRang && !c.retardDepuis.IsZero() && time.Since(c.retardDepuis) > retardMax {
			c.arreter(CodeTropLent, EnrFin(s.seq, RaisonTropLent))
			continue
		}
		if !c.direct {
			switch g {
			case genrePresence:
				c.presenceManquee = true
			case genreEfface:
				if len(c.effacesManques) >= priveMax {
					c.arreter(CodeTropLent, EnrFin(s.seq, RaisonTropLent))
					continue
				}
				c.effacesManques = append(c.effacesManques, binary.BigEndian.Uint64(enr[9:17]))
			}
			continue
		}
		c.file = append(c.file, enr)
		if g == genreRang {
			c.curseur = binary.BigEndian.Uint64(enr[1:9])
		}
		c.signaler()
	}
}

func (c *connexion) signaler() {
	select {
	case c.reveil <- struct{}{}:
	default:
	}
}

// arreter décide la fermeture (la première décision gagne) : code de Fermer et dernier
// enregistrement à écrire. Ne bloque pas ; sûre sous s.mu.
func (c *connexion) arreter(code int, fin []byte) {
	c.cmu.Lock()
	defer c.cmu.Unlock()
	if c.code != 0 {
		return
	}
	c.code, c.fin = code, fin
	c.arrete.Store(true)
	close(c.stop)
}

func (c *connexion) codeFinal() int {
	c.cmu.Lock()
	defer c.cmu.Unlock()
	return c.code
}

func (c *connexion) finale() []byte {
	c.cmu.Lock()
	defer c.cmu.Unlock()
	return c.fin
}

// recuperer : à différer en tête de chaque goroutine de la connexion.
func (c *connexion) recuperer() {
	if r := recover(); r != nil {
		c.arreter(CodeInterne, nil)
	}
}

func (c *connexion) depuisT0() int64 { return int64(time.Since(c.t0)) }

// veiller : silence (aucun message ni pong depuis silenceMax), écriture bloquée depuis
// ecritureMax, ctx annulé ; rend quand la fermeture est décidée.
func (c *connexion) veiller(ctx context.Context) {
	t := time.NewTicker(periodeVeille)
	defer t.Stop()
	for {
		select {
		case <-c.stop:
			return
		case <-ctx.Done():
			c.arreter(CodeArret, nil)
			return
		case <-t.C:
		}
		now := c.depuisT0()
		if time.Duration(now-c.vu.Load()) >= silenceMax {
			c.arreter(CodeArret, nil)
			return
		}
		if d := c.ecritDepuis.Load(); d != 0 && time.Duration(now-(d-1)) >= ecritureMax {
			c.arreterTropLent()
			return
		}
	}
}

// arreterTropLent : 0x05 raison 6 au rang courant, puis 4006.
func (c *connexion) arreterTropLent() {
	c.s.mu.Lock()
	defer c.s.mu.Unlock()
	c.arreter(CodeTropLent, EnrFin(c.s.seq, RaisonTropLent))
}

// pingeur : Ping toutes les periodePing (délai delaiPing) ; un pong compte comme activité.
func (c *connexion) pingeur() {
	defer c.recuperer()
	t := time.NewTicker(periodePing)
	defer t.Stop()
	for {
		select {
		case <-c.stop:
			return
		case <-t.C:
		}
		pctx, cancel := context.WithTimeout(c.ctx, delaiPing)
		err := c.l.Ping(pctx)
		cancel()
		if err == nil {
			c.vu.Store(c.depuisT0())
		}
	}
}

// lecteur : demandes du client jusqu'à la fermeture.
func (c *connexion) lecteur(ip netip.Addr, autoriser func(netip.Addr) bool) {
	defer c.recuperer()
	var fenetre time.Time
	controles := 0
	for {
		b, err := c.l.Lire(c.ctx)
		if err != nil {
			if errors.Is(err, ErrProtocole) {
				c.arreter(CodeInvalide, nil)
			} else {
				c.arreter(CodeFin, nil) // client parti, ou lien fermé par le serveur
			}
			return
		}
		c.vu.Store(c.depuisT0())
		d, err := LireDemande(b)
		if err != nil { // ErrEnTete ou ErrProtocole
			c.arreter(CodeInvalide, nil)
			return
		}
		if d.Type != DemTrame {
			if now := time.Now(); now.Sub(fenetre) >= time.Minute {
				fenetre, controles = now, 0
			}
			if controles++; controles > controlesParMinute {
				c.arreter(CodeInvalide, nil)
				return
			}
		}
		if !c.traiter(d, ip, autoriser) {
			return
		}
	}
}

// traiter : une demande ; false si la connexion doit se fermer (code déjà décidé).
func (c *connexion) traiter(d Demande, ip netip.Addr, autoriser func(netip.Addr) bool) bool {
	switch d.Type {
	case DemTrame:
		if !autoriser(ip) {
			// Fenêtre fixe d'une minute (limits.AllowFrame), même horloge que le limiteur.
			t := c.m.cfg.Now().Unix()
			attente := uint32(60 - (t%60+60)%60)
			c.repondre(func(seq uint64) []byte { return EnrLimite(seq, attente) })
			return true
		}
		_, err := c.m.Recevoir(c.mb, d.Trame, d.Piece)
		var at *Attente
		switch {
		case err == nil:
		case errors.As(err, &at):
			c.repondre(func(seq uint64) []byte { return EnrLimite(seq, secondesAuDessus(at.Retry)) })
		case errors.Is(err, ErrPlein):
			c.repondre(EnrPlein)
		default:
			c.arreter(codeErreur(err), nil)
			return false
		}
	case DemRetirer:
		if err := c.m.Retirer(c.mb, d.Seq); err != nil {
			c.arreter(codeErreur(err), nil)
			return false
		}
	case DemQuitter:
		code := CodeFin
		if err := c.m.Quitter(c.mb); err != nil {
			code = codeErreur(err)
		}
		c.arreter(code, nil)
		return false
	case DemPing:
		c.repondre(func(seq uint64) []byte { return EnrPong(seq, d.Ping) })
	case DemLu:
		if err := c.m.Lu(c.mb, d.Seq); err != nil {
			c.arreter(codeErreur(err), nil)
			return false
		}
	}
	return true
}

// codeErreur : code de fermeture d'une erreur de Recevoir, Retirer, Lu ou Quitter. Requête
// invalide : 4003 ; membre périmé (jeton remplacé, oublié, salon fini) : 4004 ; toute autre
// erreur (ErrES, ErrInutilisable, ErrPleine…) : 1011, jamais 4003 (relecture Task 8).
func codeErreur(err error) int {
	switch {
	case errors.Is(err, ErrBadRequest):
		return CodeInvalide
	case errors.Is(err, ErrNotFound):
		return CodeInconnu
	}
	return CodeInterne
}

// secondesAuDessus : d en secondes arrondies au-dessus, au moins 1.
func secondesAuDessus(d time.Duration) uint32 {
	s := (d + time.Second - 1) / time.Second
	return uint32(min(max(s, 1), math.MaxUint32))
}

// repondre ajoute une réponse propre à la connexion (rang courant) : dans la file en direct
// (même ordre que les enregistrements diffusés), sinon avant le prochain lot de rattrapage ;
// trop de réponses en attente : le client ne lit plus, 4006.
func (c *connexion) repondre(enr func(seq uint64) []byte) {
	s := c.s
	s.mu.Lock()
	defer s.mu.Unlock()
	if c.direct && len(c.file) < fileMax {
		c.file = append(c.file, enr(s.seq))
		c.signaler()
		return
	}
	if len(c.prive) >= priveMax {
		c.arreter(CodeTropLent, EnrFin(s.seq, RaisonTropLent))
		return
	}
	c.prive = append(c.prive, enr(s.seq))
	c.signaler()
}

// ecrivain : seule goroutine qui appelle Ecrire. À la fermeture, écrit le dernier
// enregistrement décidé (0x05) s'il y en a un.
func (c *connexion) ecrivain() {
	defer close(c.ecrivainFini)
	defer c.recuperer()
	for {
		lot, continuer := c.prochainLot()
		for _, r := range lot {
			if !c.ecrire(r) {
				return
			}
		}
		if !continuer {
			break
		}
	}
	if fin := c.finale(); fin != nil {
		c.ecrire(fin)
	}
}

func (c *connexion) ecrire(b []byte) bool {
	c.ecritDepuis.Store(c.depuisT0() + 1)
	err := c.l.Ecrire(c.ctx, b)
	c.ecritDepuis.Store(0)
	if err != nil {
		c.arreter(CodeFin, nil) // lien coupé
		return false
	}
	return true
}

// etape : ce que fait l'écrivain ensuite.
type etape uint8

const (
	eEcrire   etape = iota // écrire lot
	eAttendre              // direct, rien à écrire : attendre un réveil
	eLire                  // lire refs hors du verrou (lot de rattrapage complet)
	eArreter               // fermeture décidée ; lot éventuel écrit d'abord
)

// prochainLot : enregistrements à écrire ensuite, dans l'ordre ; continuer = false quand la
// fermeture est décidée (le lot rendu avec, s'il y en a un, est écrit d'abord). Chaque
// section sous le verrou du salon est une fonction à defer Unlock : une panique (EnrTrame,
// EnrPresence) ne garde jamais le verrou.
func (c *connexion) prochainLot() (lot [][]byte, continuer bool) {
	s := c.s
	for {
		lot, refs, e := c.etapeLocked()
		switch e {
		case eEcrire:
			return lot, true
		case eArreter:
			return lot, false
		case eAttendre:
			select {
			case <-c.reveil:
			case <-c.stop:
			}
			continue
		}
		lot, err := s.lireRefs(refs, s.effaceeDepuis)
		if err != nil {
			code := CodeInterne
			if s.estFini() {
				code = CodeInconnu
			}
			c.arreter(code, nil)
			return lot, false
		}
		c.avancer(refs[len(refs)-1].seq)
		return lot, true
	}
}

// etapeLocked : réponses propres (l'accueil en premier) et file, qui précèdent ce que le
// rattrapage lira ensuite (rang > curseur) ; sinon attente en direct ; sinon lot de
// rattrapage complet à lire hors du verrou ; sinon dernier lot, lu sous le verrou, et passage
// au direct dans la même section.
func (c *connexion) etapeLocked() (lot [][]byte, refs []ref, e etape) {
	s := c.s
	s.mu.Lock()
	defer s.mu.Unlock()
	if c.arrete.Load() {
		return nil, nil, eArreter
	}
	lot = c.prive
	c.prive = nil
	if len(c.file) > 0 {
		lot = append(lot, c.file...)
		c.file = nil
	}
	if len(lot) > 0 {
		return lot, nil, eEcrire
	}
	if c.direct {
		return nil, nil, eAttendre
	}
	if s.fini {
		c.arreter(CodeInconnu, nil)
		return nil, nil, eArreter
	}
	refs = s.refsLocked(c.curseur, lotRattrapage)
	if len(refs) == lotRattrapage {
		return nil, refs, eLire
	}
	lot, err := s.lireRefs(refs, nil)
	if err != nil {
		c.arreter(CodeInterne, nil)
		return lot, nil, eArreter
	}
	c.direct, c.retardDepuis, c.curseur = true, time.Time{}, s.seq
	if c.presenceManquee {
		lot = append(lot, s.presencesLocked(c.mb.siege)...)
		c.presenceManquee = false
	}
	for _, cible := range c.effacesManques {
		lot = append(lot, EnrEfface(s.seq, cible))
	}
	c.effacesManques = nil
	return lot, nil, eEcrire
}

// avancer : curseur après un lot de rattrapage lu hors du verrou (seul l'écrivain le change
// hors du direct).
func (c *connexion) avancer(seq uint64) {
	c.s.mu.Lock()
	defer c.s.mu.Unlock()
	c.curseur = seq
}

func (s *salon) estFini() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.fini
}

// FermerTout (arrêt du serveur, srv.RegisterOnShutdown, Task 15) ferme toutes les connexions
// en 1001 sans attendre leur fin ; une connexion dont l'accueil arrive ensuite est fermée en
// 1001 sans être inscrite (net/http ne suit plus une connexion mise à niveau : Shutdown ne
// l'attend pas). Définitif pour ce Manager.
func (m *Manager) FermerTout() {
	m.arrete.Store(true)
	m.mu.Lock()
	salons := make([]*salon, 0, len(m.salons))
	for _, s := range m.salons {
		salons = append(salons, s)
	}
	m.mu.Unlock()
	for _, s := range salons {
		s.mu.Lock()
		for _, c := range s.conns {
			if c != nil {
				c.arreter(CodeArret, nil)
			}
		}
		s.mu.Unlock()
	}
}
