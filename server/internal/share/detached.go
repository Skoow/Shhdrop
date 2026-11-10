package share

import (
	"context"
	"database/sql"
	"errors"
	"io"
	"io/fs"
	"os"
	"strings"
	"sync"
	"time"
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
	bucket   int
	graceEnd int64
	opens    map[int]bool // ouvertures qui gardent le droit de finir
	refs     int          // segments en cours de lecture sur f
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
	leaves map[openKey]int64       // départs de la dernière ouverture (leave.go) : heure du « je pars »
}

func (g *goneState) init() {
	if g.active == nil {
		g.active = map[openKey]*activity{}
		g.dead = map[string]*detached{}
		g.watch = map[string]*watcher{}
		g.grants = map[openKey]*grantEntry{}
	}
}

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
// (ErrBudget). Aucun segment en cours d'écriture n'est servi (Finalize attend uploadMu).
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

// openOnce : une tentative sous gone.mu. retire : le partage est échu (échéance, 5 essais,
// purge) et doit d'abord être retiré, à l'heure event.
func (s *Service) openOnce(parent context.Context, id string, n, openN int) (seg *Segment, retire bool, event int64, err error) {
	now := s.now()
	k := openKey{id, openN}
	s.gone.mu.Lock()
	defer s.gone.mu.Unlock()
	s.gone.init()
	if d := s.gone.dead[id]; d != nil {
		seg, err := s.serveDetachedLocked(parent, id, d, k, n, now)
		return seg, false, 0, err
	}
	var bucket, issued, failed int
	var state string
	var doneMask int64
	var exp sql.NullInt64
	err = s.DB.QueryRow(`SELECT bucket, state, opens_issued, done_mask, failed_attempts, expires_at FROM shares WHERE id=?`, id).
		Scan(&bucket, &state, &issued, &doneMask, &failed, &exp)
	switch {
	case errors.Is(err, sql.ErrNoRows):
		return nil, false, 0, ErrGone
	case err != nil:
		return nil, false, 0, err
	case state == "uploading" || openN > issued:
		return nil, false, 0, ErrNotFound
	case doneMask&(int64(1)<<(openN-1)) != 0:
		return nil, false, 0, ErrGone
	}
	if due, ev := s.dueAt(id, state, exp, failed, now); due {
		return nil, true, ev, nil
	}
	if n < 0 || n >= SegmentCount(bucket) {
		return nil, false, 0, ErrBadSegment
	}
	size := int64(SegmentSize(bucket, n))
	sec, err := s.Blobs.Open(id, segOffset(bucket, n), size)
	if errors.Is(err, fs.ErrNotExist) {
		return nil, false, 0, ErrGone // effacé hors de ce processus (administrateur)
	}
	if err != nil {
		return nil, false, 0, err
	}
	// Compté après l'ouverture réussie : une erreur du serveur ne consomme pas le budget.
	if !s.budget.charge(k, size, s.budgetLocked(k, bucket), now) {
		sec.Close()
		return nil, false, 0, ErrBudget
	}
	return s.startLocked(parent, k, sec, size, func() { sec.Close() }, nil), false, 0, nil
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

// budgetLocked : budget de lecture de l'ouverture k, (2 + r) × le fichier chiffré + segment 0
// + dernier segment, où r est le nombre de rechargements acceptés (spec §41.4). Sous gone.mu.
func (s *Service) budgetLocked(k openKey, bucket int) int64 {
	return ReadBudget(bucket) + s.grantReopensLocked(k)*totalSize(bucket)
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
		defer s.gone.mu.Unlock()
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
// segment) et ferme le descripteur quand plus aucune ne le garde et qu'aucune lecture n'est
// en cours (jamais au milieu d'un segment).
func (s *Service) reapLocked(id string, d *detached, now int64) {
	for n := range d.opens {
		if now >= d.graceEnd || !s.gone.active[openKey{id, n}].activeAt(now) {
			delete(d.opens, n)
		}
	}
	if len(d.opens) == 0 && d.refs == 0 {
		d.f.Close()
		delete(s.gone.dead, id)
		for n := 1; n <= maxOpenN; n++ {
			if a := s.gone.active[openKey{id, n}]; a != nil && a.inflight == 0 {
				delete(s.gone.active, openKey{id, n})
			}
		}
	}
}

// detachedBytes : place encore tenue par les descripteurs détachés (décomptée à leur
// fermeture, spec §41.8 cas 2).
func (s *Service) detachedBytes() int64 {
	s.gone.mu.Lock()
	defer s.gone.mu.Unlock()
	var n int64
	for _, d := range s.gone.dead {
		n += totalSize(d.bucket)
	}
	return n
}

// retire efface un partage (fichier puis ligne) et prévient ses surveillances. grace : ses
// ouvertures actives (non terminées) gardent le droit de finir jusqu'à event + 2 h, sur un
// descripteur détaché ; sinon (signalement, administrateur) tous ses flux sont coupés.
// Renvoie si une ligne existait.
func (s *Service) retire(id string, grace bool, event int64) (bool, error) {
	now := s.now()
	s.gone.mu.Lock()
	defer s.gone.mu.Unlock()
	s.gone.init()
	var bucket, issued int
	var doneMask int64
	var accessV []byte
	err := s.DB.QueryRow(`SELECT bucket, opens_issued, done_mask, access_v FROM shares WHERE id=?`, id).Scan(&bucket, &issued, &doneMask, &accessV)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
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
			return false, err
		}
		if f != nil {
			s.gone.dead[id] = &detached{f: f, accessV: accessV, bucket: bucket, graceEnd: event + graceWindow, opens: allowed}
		}
	}
	if !grace {
		s.revokeAllLocked(id)
	}
	ok, err := s.destroy(id)
	if err != nil {
		if d := s.gone.dead[id]; d != nil && d.refs == 0 {
			d.f.Close()
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
	s.notifyLocked(id)
	return ok, nil
}

// revokeAllLocked coupe tous les flux du partage (aucune grâce).
func (s *Service) revokeAllLocked(id string) {
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
	defer s.gone.mu.Unlock()
	s.gone.init()
	if s.gone.dead[id] != nil {
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
			defer s.gone.mu.Unlock()
			if w.n--; w.n == 0 && s.gone.watch[id] == w {
				delete(s.gone.watch, id)
			}
		})
	}}, nil
}

// WatchCount : surveillances en cours (tests).
func (s *Service) WatchCount() int {
	s.gone.mu.Lock()
	defer s.gone.mu.Unlock()
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
	s.gone.mu.Lock()
	s.gone.init()
	// Toujours lu (un dossier, le plus souvent absent) : la demande « tout couper » de wipe
	// est confirmée même sans descripteur détaché (revue B5).
	if err := s.pollKillsLocked(); err != nil {
		s.gone.mu.Unlock()
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
	s.gone.mu.Unlock()
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
	defer s.gone.mu.Unlock()
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
	defer s.gone.mu.Unlock()
	s.gone.init()
	for id, d := range s.gone.dead {
		s.reapLocked(id, d, now)
	}
	for k, a := range s.gone.active {
		if !a.activeAt(now) {
			delete(s.gone.active, k)
		}
	}
}
