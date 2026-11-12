package share

import (
	"context"
	"database/sql"
	"errors"
	"io"
	"io/fs"
	"os"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/skoow/shhdrop/server/internal/blob"
)

// Disparition pendant un téléchargement (spec §41.8, D41-10 ; §36 S60, S61).
//
// Ouverture active : une ouverture qui a un segment en cours, ou en a fini un dans les
// 120 s. Quand un partage disparaît (échéance, suppression par l'expéditeur ou le
// destinataire, 5 mots de passe faux), ses ouvertures actives gardent le droit de finir
// jusqu'à la fin de grâce (événement + 2 h ; le jeton, de 6 h, borne aussi) : le fichier est
// retiré du dossier et la ligne de la base tout de suite, mais un descripteur reste ouvert
// pour elles seules (« détaché »), fermé à la fin de grâce, quand plus aucune n'est active,
// ou à leur done. Aucune nouvelle ouverture, aucune reprise après 120 s de pause. Signalement
// et administrateur : aucune grâce, flux coupés (Streams.Revoke).

const (
	activeWindow = 120      // secondes sans segment au-delà desquelles une ouverture n'est plus active
	graceWindow  = 2 * 3600 // grâce maximale après l'événement
	maxOpenN     = 10       // ouvertures par partage (spec §4)
)

// ErrGone : le partage a disparu, ou cette ouverture n'a plus de droit. Rendu seulement à
// qui porte un jeton signé valide (réponse 410 « gone ») : aucun oracle d'existence.
var ErrGone = errors.New("partage disparu")

// activity : dernier segment servi (fin ou début) et segments en cours d'une ouverture.
type activity struct {
	last     int64
	inflight int
}

func (a *activity) activeAt(now int64) bool {
	return a != nil && (a.inflight > 0 || now-a.last < activeWindow)
}

// detached : fichier d'un partage disparu, gardé ouvert pour ses ouvertures actives.
type detached struct {
	f        *os.File
	accessV  []byte // V_accès, pour qu'une destruction par l'administrateur le coupe (kill.go)
	proofV   []byte // V_preuve, pour qu'un signalement le coupe (cutReported, audit F2)
	bucket   int
	graceEnd int64
	opens    map[int]bool // ouvertures qui gardent le droit de finir
	refs     int          // segments en cours de lecture sur f
	// rowGone : la ligne est effacée (retire a réussi). Sans elle (suppression du fichier en
	// échec), le partage vit encore : ses octrois et budgets restent à la fermeture.
	rowGone bool
}

// watcher : surveillances (GET /api/shares/watch) d'un partage ; ch fermé à sa disparition.
type watcher struct {
	ch chan struct{}
	n  int
}

// goneState : tout en mémoire (spec §9.5) ; mu protège les trois tables et sérialise les
// décisions « servir ou refuser » avec les retraits.
type goneState struct {
	mu     sync.Mutex
	active map[openKey]*activity
	dead   map[string]*detached
	watch  map[string]*watcher
	grants map[openKey]*grantEntry // octrois d'ouverture (grant.go)
	// closing : descripteurs détachés retirés de dead, à fermer hors de mu (unlock) ;
	// closingBytes : leur place, comptée jusqu'à la fermeture faite (detachedBytes).
	closing      []*detached
	closingBytes int64
	// retiring : partages dont le fichier est en cours de suppression hors de mu (retire) ;
	// présence seulement, le temps d'une suppression. Ils passent déjà pour disparus.
	retiring []string
	// epoch : augmenté à chaque retrait et à chaque coupure de flux ; une ouverture de segment
	// faite hors de mu (openOnce) se refait sous mu s'il a changé entre-temps.
	epoch uint64
}

// retiringLocked : le partage id est en cours de retrait (retire). Sous mu.
func (g *goneState) retiringLocked(id string) bool { return slices.Contains(g.retiring, id) }

// unlock rend mu, puis ferme les descripteurs détachés qui ne servent plus : la fermeture
// rend jusqu'à 2 Gio au système de fichiers et ne doit pas retenir les lectures de segments
// (revue du 10 novembre).
func (g *goneState) unlock() {
	ds := g.closing
	g.closing = nil
	g.mu.Unlock()
	if len(ds) == 0 {
		return
	}
	var n int64
	for _, d := range ds {
		closeDetached(d.f)
		n += totalSize(d.bucket)
	}
	g.mu.Lock()
	g.closingBytes -= n
	g.mu.Unlock()
}

func (g *goneState) init() {
	if g.active == nil {
		g.active = map[openKey]*activity{}
		g.dead = map[string]*detached{}
		g.watch = map[string]*watcher{}
		g.grants = map[openKey]*grantEntry{}
	}
}

// openBlob : ouverture d'un segment (variable pour tester les verrous tenus pendant ce temps).
var openBlob = func(b *blob.Store, id string, off, n int64) (*blob.Section, error) { return b.Open(id, off, n) }

// Segment : un segment lu en flux ; la lecture s'arrête dès la révocation de son ouverture.
type Segment struct {
	r     io.Reader
	size  int64
	ctx   context.Context
	once  sync.Once
	close func()
}

func (g *Segment) Read(p []byte) (int, error) { return g.r.Read(p) }

// Size : taille exacte du segment.
func (g *Segment) Size() int64 { return g.size }

// Context : annulé à la révocation (signalement, administrateur, exclusion) ou à la fermeture.
func (g *Segment) Context() context.Context { return g.ctx }

// Close termine le flux (idempotent).
func (g *Segment) Close() error {
	g.once.Do(g.close)
	return nil
}

// OpenSegment : OpenSegmentCtx sans contexte parent.
func (s *Service) OpenSegment(id string, n, openN int) (*Segment, error) {
	return s.OpenSegmentCtx(context.Background(), id, n, openN)
}

// OpenSegmentCtx ouvre le segment n pour l'ouverture openN (venue d'un jeton signé). Partage
// vivant (« ready » ou « draining ») : l'ouverture doit avoir été émise et ne pas être
// terminée. Partage disparu : seulement pour une ouverture active, jusqu'à la fin de grâce,
// depuis le descripteur détaché ; sinon ErrGone. Chaque ouverture a un budget de lecture
// (ErrBudget). Aucun segment en cours d'écriture n'est servi (Finalize attend le verrou de
// l'envoi).
func (s *Service) OpenSegmentCtx(parent context.Context, id string, n, openN int) (*Segment, error) {
	if !validID(id) || openN < 1 || openN > maxOpenN {
		return nil, ErrNotFound
	}
	for range 2 { // au plus un retrait (partage échu non encore balayé), puis le chemin détaché
		seg, retire, event, err := s.openOnce(parent, id, n, openN)
		if !retire {
			return seg, err
		}
		if _, err := s.retire(id, true, event); err != nil {
			return nil, err
		}
	}
	return nil, ErrGone
}

// openOnce : une tentative. retire : le partage est échu (échéance, 5 essais, purge) et doit
// d'abord être retiré, à l'heure event.
//
// La ligne est lue et le fichier ouvert hors de gone.mu, que prennent toutes les lectures et
// les surveillances (optimisation du 11 novembre : une ouverture lente ne les retient plus).
// gone.epoch, relu sous le verrou, dit si un retrait ou une coupure a eu lieu entre-temps :
// alors tout est refait sous le verrou, comme avant (jamais un partage retiré servi depuis un
// fichier ouvert juste avant son retrait).
func (s *Service) openOnce(parent context.Context, id string, n, openN int) (seg *Segment, retire bool, event int64, err error) {
	now := s.now()
	k := openKey{id, openN}
	s.gone.mu.Lock()
	s.gone.init()
	if d := s.gone.dead[id]; d != nil {
		defer s.gone.unlock()
		seg, err := s.serveDetachedLocked(parent, id, d, k, n, now)
		return seg, false, 0, err
	}
	if s.gone.retiringLocked(id) {
		s.gone.unlock()
		return nil, false, 0, ErrGone // en cours de retrait, sans droit de finir
	}
	ep := s.gone.epoch
	s.gone.unlock()

	sec, bucket, size, retire, event, err := s.openRow(id, n, openN, now)
	if sec == nil {
		return nil, retire, event, err
	}
	s.gone.mu.Lock()
	defer s.gone.unlock()
	if s.gone.epoch != ep {
		// Retrait ou coupure pendant l'ouverture : tout est refait sous le verrou.
		sec.Close()
		if d := s.gone.dead[id]; d != nil {
			seg, err := s.serveDetachedLocked(parent, id, d, k, n, now)
			return seg, false, 0, err
		}
		if s.gone.retiringLocked(id) {
			return nil, false, 0, ErrGone
		}
		if sec, bucket, size, retire, event, err = s.openRow(id, n, openN, now); sec == nil {
			return nil, retire, event, err
		}
	}
	// Compté après l'ouverture réussie : une erreur du serveur ne consomme pas le budget.
	if !s.budget.charge(k, size, s.budgetLocked(k, bucket), now) {
		sec.Close()
		return nil, false, 0, ErrBudget
	}
	return s.startLocked(parent, k, sec, size, func() { sec.Close() }, nil), false, 0, nil
}

// openRow lit la ligne du partage id, vérifie l'ouverture openN et le segment n, puis ouvre le
// segment. sec == nil : refus (err) ou partage échu à retirer (retire, event).
func (s *Service) openRow(id string, n, openN int, now int64) (sec *blob.Section, bucket int, size int64, retire bool, event int64, err error) {
	var issued, failed int
	var state string
	var doneMask int64
	var exp sql.NullInt64
	err = s.DB.QueryRow(`SELECT bucket, state, opens_issued, done_mask, failed_attempts, expires_at FROM shares WHERE id=?`, id).
		Scan(&bucket, &state, &issued, &doneMask, &failed, &exp)
	switch {
	case errors.Is(err, sql.ErrNoRows):
		return nil, 0, 0, false, 0, ErrGone
	case err != nil:
		return nil, 0, 0, false, 0, err
	case state == "uploading" || openN > issued:
		return nil, 0, 0, false, 0, ErrNotFound
	case doneMask&(int64(1)<<(openN-1)) != 0:
		return nil, 0, 0, false, 0, ErrGone
	}
	if due, ev := s.dueAt(id, state, exp, failed, now); due {
		return nil, 0, 0, true, ev, nil
	}
	if n < 0 || n >= SegmentCount(bucket) {
		return nil, 0, 0, false, 0, ErrBadSegment
	}
	size = int64(SegmentSize(bucket, n))
	sec, err = openBlob(s.Blobs, id, segOffset(bucket, n), size)
	if errors.Is(err, fs.ErrNotExist) {
		return nil, 0, 0, false, 0, ErrGone // effacé hors de ce processus (administrateur)
	}
	if err != nil {
		return nil, 0, 0, false, 0, err
	}
	return sec, bucket, size, false, 0, nil
}

// serveDetachedLocked sert un segment d'un partage disparu à une ouverture qui garde le droit.
func (s *Service) serveDetachedLocked(parent context.Context, id string, d *detached, k openKey, n int, now int64) (*Segment, error) {
	if !d.opens[k.openN] || now >= d.graceEnd || !s.gone.active[k].activeAt(now) {
		delete(d.opens, k.openN)
		s.reapLocked(id, d, now)
		return nil, ErrGone
	}
	if n < 0 || n >= SegmentCount(d.bucket) {
		return nil, ErrBadSegment
	}
	size := int64(SegmentSize(d.bucket, n))
	if !s.budget.charge(k, size, s.budgetLocked(k, d.bucket), now) {
		return nil, ErrBudget
	}
	d.refs++
	sec := io.NewSectionReader(d.f, segOffset(d.bucket, n), size)
	return s.startLocked(parent, k, sec, size, nil, func() { d.refs-- }), nil
}

// reopenExtraMin : relecture permise au-delà de trois fichiers complets, pour les petits
// partages (revue D42-22, point 3).
const reopenExtraMin = 256 << 20

// budgetLocked : budget de lecture de l'ouverture k : ReadBudget + min(r × F, max(3 × F,
// 256 Mio)), où F est le fichier chiffré et r le nombre de retours acceptés (spec §24, §41.4,
// D42-22) : un petit partage se relit à chaque retour (20 au plus), un gros fichier trois fois
// de plus au plus. Sous gone.mu.
func (s *Service) budgetLocked(k openKey, bucket int) int64 {
	f := totalSize(bucket)
	return ReadBudget(bucket) + min(s.grantReopensLocked(k)*f, max(3*f, reopenExtraMin))
}

// startLocked inscrit le flux (Streams) et l'activité de l'ouverture ; la fermeture met à jour
// l'activité, puis ferme le descripteur détaché s'il ne sert plus.
func (s *Service) startLocked(parent context.Context, k openKey, r io.Reader, size int64, closeFile, release func()) *Segment {
	a := s.gone.active[k]
	if a == nil {
		a = &activity{}
		s.gone.active[k] = a
	}
	a.inflight++
	a.last = s.now()
	ctx, end := s.streams.Start(parent, ShareKey(k.id, k.openN))
	return &Segment{r: ctxReader{ctx: ctx, r: r}, size: size, ctx: ctx, close: func() {
		end()
		if closeFile != nil {
			closeFile()
		}
		s.gone.mu.Lock()
		defer s.gone.unlock()
		now := s.now()
		a.inflight--
		a.last = now
		if release != nil {
			release()
		}
		if d := s.gone.dead[k.id]; d != nil {
			s.reapLocked(k.id, d, now)
		}
	}}
}

// reapLocked oublie les ouvertures qui ont perdu leur droit (fin de grâce, 120 s sans
// segment) et retire le descripteur quand plus aucune ne le garde et qu'aucune lecture n'est
// en cours (jamais au milieu d'un segment) ; il est fermé à la sortie du verrou (unlock).
func (s *Service) reapLocked(id string, d *detached, now int64) {
	for n := range d.opens {
		if now >= d.graceEnd || !s.gone.active[openKey{id, n}].activeAt(now) {
			delete(d.opens, n)
		}
	}
	if len(d.opens) == 0 && d.refs == 0 {
		s.gone.closing = append(s.gone.closing, d)
		s.gone.closingBytes += totalSize(d.bucket)
		delete(s.gone.dead, id)
		for n := 1; n <= maxOpenN; n++ {
			if a := s.gone.active[openKey{id, n}]; a != nil && a.inflight == 0 {
				delete(s.gone.active, openKey{id, n})
			}
		}
		if d.rowGone {
			s.forgetOpensLocked(id, nil) // grâce finie : octrois et budgets oubliés
		}
	}
}

// detachedBytes : place encore tenue par les descripteurs détachés (décomptée à leur
// fermeture, spec §41.8 cas 2).
func (s *Service) detachedBytes() int64 {
	s.gone.mu.Lock()
	defer s.gone.unlock()
	n := s.gone.closingBytes
	for _, d := range s.gone.dead {
		n += totalSize(d.bucket)
	}
	return n
}

// retire efface un partage (fichier puis ligne) et prévient ses surveillances. grace : ses
// ouvertures actives (non terminées) gardent le droit de finir jusqu'à event + 2 h, sur un
// descripteur détaché ; sinon (signalement, administrateur) tous ses flux sont coupés.
// Renvoie si une ligne existait.
//
// Le fichier (jusqu'à 2 Gio) est supprimé du dossier hors de gone.mu, que prend chaque
// lecture de segment (revue du 10 novembre). En trois temps : sous gone.mu, la décision
// (descripteur détaché, flux coupés) et l'inscription du partage dans retiring, qui le fait
// passer pour disparu aux lectures et aux surveillances ; hors verrou, la suppression du
// fichier ; sous gone.mu de nouveau, la ligne. L'ordre « fichier puis ligne » est gardé : si
// la suppression échoue, la ligne reste et Sweep réessaie. Un retrait déjà en cours du même
// partage : (false, nil), comme une ligne déjà effacée.
func (s *Service) retire(id string, grace bool, event int64) (bool, error) {
	now := s.now()
	s.gone.mu.Lock()
	s.gone.init()
	if s.gone.retiringLocked(id) {
		s.gone.unlock()
		return false, nil
	}
	var bucket, issued int
	var doneMask int64
	var accessV, proofV []byte
	err := s.DB.QueryRow(`SELECT bucket, opens_issued, done_mask, access_v, proof_v FROM shares WHERE id=?`, id).
		Scan(&bucket, &issued, &doneMask, &accessV, &proofV)
	if err != nil {
		s.gone.unlock()
		if errors.Is(err, sql.ErrNoRows) {
			return false, nil
		}
		return false, err
	}
	allowed := map[int]bool{}
	if grace && s.gone.dead[id] == nil {
		for n := 1; n <= min(issued, maxOpenN); n++ {
			if doneMask&(int64(1)<<(n-1)) == 0 && s.gone.active[openKey{id, n}].activeAt(now) {
				allowed[n] = true
			}
		}
	}
	if len(allowed) > 0 {
		f, err := s.Blobs.OpenFile(id)
		if err != nil && !errors.Is(err, fs.ErrNotExist) {
			s.gone.unlock()
			return false, err
		}
		if f != nil {
			s.gone.dead[id] = &detached{f: f, accessV: accessV, proofV: proofV, bucket: bucket, graceEnd: event + graceWindow, opens: allowed}
		}
	}
	if !grace {
		s.revokeAllLocked(id)
	}
	s.gone.retiring = append(s.gone.retiring, id)
	s.gone.epoch++
	s.gone.unlock()

	ok, err := s.destroy(id) // hors de gone.mu

	s.gone.mu.Lock()
	defer s.gone.unlock()
	s.gone.retiring = slices.DeleteFunc(s.gone.retiring, func(x string) bool { return x == id })
	if err != nil {
		if d := s.gone.dead[id]; d != nil && d.refs == 0 {
			d.f.Close() // fichier encore dans le dossier : rien n'est rendu au disque ici
			delete(s.gone.dead, id)
		}
		return false, err
	}
	for n := 1; n <= maxOpenN; n++ {
		k := openKey{id, n}
		if a := s.gone.active[k]; a != nil && !allowed[n] && a.inflight == 0 {
			delete(s.gone.active, k)
		}
	}
	// Plus aucun retour possible : octrois et budgets oubliés, sauf pour les ouvertures qui
	// finissent sur le descripteur détaché (oubliés à la fin de grâce, reapLocked).
	var keep map[int]bool
	if d := s.gone.dead[id]; d != nil {
		d.rowGone = true
		keep = d.opens // y compris un descripteur gardé d'un retrait précédent en échec
	}
	s.forgetOpensLocked(id, keep)
	s.notifyLocked(id)
	return ok, nil
}

// revokeAllLocked coupe tous les flux du partage (aucune grâce).
func (s *Service) revokeAllLocked(id string) {
	s.gone.epoch++
	for n := 1; n <= maxOpenN; n++ {
		s.streams.Revoke(ShareKey(id, n))
	}
}

func (s *Service) notifyLocked(id string) {
	if w := s.gone.watch[id]; w != nil {
		close(w.ch)
		delete(s.gone.watch, id)
	}
}

// Watch : surveillance d'une ouverture (GET /api/shares/watch). Gone se ferme à la
// disparition du partage ; Expires : son échéance ; Stop (idempotent) se désabonne. ErrGone
// si le partage a déjà disparu, est échu, ou si l'ouverture est terminée.
type Watch struct {
	Gone    <-chan struct{}
	Expires time.Time
	Stop    func()
}

func (s *Service) Watch(id string, openN int) (Watch, error) {
	if !validID(id) || openN < 1 || openN > maxOpenN {
		return Watch{}, ErrNotFound
	}
	now := s.now()
	s.gone.mu.Lock()
	defer s.gone.unlock()
	s.gone.init()
	if s.gone.dead[id] != nil || s.gone.retiringLocked(id) {
		return Watch{}, ErrGone
	}
	var state string
	var issued, failed int
	var doneMask int64
	var exp sql.NullInt64
	err := s.DB.QueryRow(`SELECT state, opens_issued, done_mask, failed_attempts, expires_at FROM shares WHERE id=?`, id).
		Scan(&state, &issued, &doneMask, &failed, &exp)
	switch {
	case errors.Is(err, sql.ErrNoRows):
		return Watch{}, ErrGone
	case err != nil:
		return Watch{}, err
	case state == "uploading" || openN > issued:
		return Watch{}, ErrNotFound
	case doneMask&(int64(1)<<(openN-1)) != 0:
		return Watch{}, ErrGone
	}
	if due, _ := s.dueAt(id, state, exp, failed, now); due {
		return Watch{}, ErrGone
	}
	w := s.gone.watch[id]
	if w == nil {
		w = &watcher{ch: make(chan struct{})}
		s.gone.watch[id] = w
	}
	w.n++
	var once sync.Once
	return Watch{Gone: w.ch, Expires: time.Unix(exp.Int64, 0).UTC(), Stop: func() {
		once.Do(func() {
			s.gone.mu.Lock()
			defer s.gone.unlock()
			if w.n--; w.n == 0 && s.gone.watch[id] == w {
				delete(s.gone.watch, id)
			}
		})
	}}, nil
}

// WatchCount : surveillances en cours (tests).
func (s *Service) WatchCount() int {
	s.gone.mu.Lock()
	defer s.gone.unlock()
	n := 0
	for _, w := range s.gone.watch {
		n += w.n
	}
	return n
}

// PollRemoved repère les partages surveillés ou en cours de lecture dont la ligne a disparu
// hors de ce processus (« shhdrop admin destroy ») : leurs flux sont coupés et leurs
// surveillances prévenues, sans grâce. Coupe aussi les partages détachés que la commande a
// demandé de couper (kill.go). À appeler chaque seconde (janitor.Watch).
func (s *Service) PollRemoved() error {
	// Toujours lu (un dossier, le plus souvent absent) : la demande « tout couper » de wipe
	// est confirmée même sans descripteur détaché (revue B5). Lu hors de gone.mu.
	kills, err := s.readKills()
	if err != nil {
		return err
	}
	s.gone.mu.Lock()
	s.gone.init()
	if err := s.pollKillsLocked(kills); err != nil {
		s.gone.unlock()
		return err
	}
	set := map[string]bool{}
	for id := range s.gone.watch {
		set[id] = true
	}
	for k, a := range s.gone.active {
		if a.inflight > 0 && s.gone.dead[k.id] == nil {
			set[k.id] = true
		}
	}
	s.gone.unlock()
	if len(set) == 0 {
		return nil
	}
	ids := make([]any, 0, len(set))
	for id := range set {
		ids = append(ids, id)
	}
	present := map[string]bool{}
	for i := 0; i < len(ids); i += 500 {
		part := ids[i:min(i+500, len(ids))]
		rs, err := s.DB.Query(`SELECT id FROM shares WHERE id IN (?`+strings.Repeat(",?", len(part)-1)+`)`, part...)
		if err != nil {
			return err
		}
		for rs.Next() {
			var id string
			if err := rs.Scan(&id); err != nil {
				rs.Close()
				return err
			}
			present[id] = true
		}
		rs.Close()
		if err := rs.Err(); err != nil {
			return err
		}
	}
	s.gone.mu.Lock()
	defer s.gone.unlock()
	for id := range set {
		if present[id] || s.gone.dead[id] != nil {
			continue
		}
		// La ligne d'un partage retiré par ce processus disparaît aussi : sans descripteur
		// détaché, ses flux n'avaient de toute façon plus de droit (retire les a coupés ou
		// aucune ouverture n'était active).
		s.revokeAllLocked(id)
		s.notifyLocked(id)
	}
	return nil
}

// sweepGoneLocked : balayage des ouvertures inactives et des descripteurs détachés.
func (s *Service) sweepGone(now int64) {
	s.gone.mu.Lock()
	defer s.gone.unlock()
	s.gone.init()
	for id, d := range s.gone.dead {
		s.reapLocked(id, d, now)
	}
	s.sweepGrantsLocked(now)
	for k, a := range s.gone.active {
		if !a.activeAt(now) {
			delete(s.gone.active, k)
		}
	}
}
