package salon

import (
	"database/sql"
	"errors"
	"hash/fnv"
	"os"
	"sync"
	"time"

	"github.com/skoow/shhdrop/server/internal/blob"
	"github.com/skoow/shhdrop/server/internal/share"
)

// Gestionnaire des salons (plan C-2 Task 6) : création, meta, entrée, sièges et jetons de
// membre. La base ne garde que les colonnes de §39.3.5 ; sièges, jetons (par SHA-256),
// nonces et rangs vivent en mémoire.
//
// Ordre des verrous : createMu → Manager.mu ; essais (rayé par id) → Manager.mu → salon.mu →
// Manager.idxMu ; Conversation a son propre verrou, pris en dernier. Aucune sortie (journal, stderr) : les
// erreurs remontent à l'appelant, messages fixes.

const (
	// maxEssais : 10 K_preuve_s fausses détruisent le salon (§39.3.6).
	maxEssais = 10
	// BudgetPieces : capacité de pièces d'un salon (hors vocaux), 1 Gio.
	BudgetPieces int64 = 1073741824
	// reserveCreation : place disque libre exigée pour créer un salon (plan, point 10).
	reserveCreation int64 = 2 << 30
	kdfOps                = 3
	kdfMem                = 67108864
	// VivantsParBloc : salons vivants au plus par bloc /48 (par adresse en IPv4), pour que
	// 14 blocs à 15 créations par jour ne prennent pas les SHH_SALONS_MAX places (spec
	// §39.3.6, décision de l'équipe du 12 novembre, réglable).
	VivantsParBloc = 5
	// quart : arrondi des échéances (share.Ceil15) ; un salon ne peut pas échoir avant le
	// prochain multiple.
	quart = 900
)

// Config : dépendances du gestionnaire, toutes obligatoires (NewManager).
type Config struct {
	DB                   *sql.DB
	Pieces               *blob.Store
	DossierConversations string
	Now                  func() time.Time
	Max                  int   // SHH_SALONS_MAX
	StorageMax           int64 // SHH_STORAGE_MAX
	// UsedPartages : octets des partages (blob.Store des partages).
	UsedPartages func() (int64, error)
}

// Manager : salons vivants du processus. Sûr pour un usage concurrent.
type Manager struct {
	cfg      Config
	createMu sync.Mutex // vérification du plafond et insertion d'une création, atomiques
	essais   [64]sync.Mutex

	mu     sync.Mutex
	salons map[string]*salon // id interne → état (créé au premier Rejoindre)
	// vivants : salons créés par ce processus et pas encore finis (id interne → bloc et
	// échéance) ; parBloc : leur nombre par bloc (clé opaque, CreerReq.Bloc). En mémoire
	// seulement : un redémarrage les oublie (les salons d'avant ne comptent plus).
	vivants map[string]vivant
	parBloc map[[32]byte]int

	idxMu sync.Mutex
	// index : SHA-256 d'un jeton (valide ou révoqué) → salon ; la vérité est dans salon.jetons
	// et salon.revoques (une entrée ici sans eux vaut « inconnu »).
	index map[[32]byte]*salon
}

var errConfig = errors.New("salon: configuration incomplète")

// NewManager vérifie que chaque champ est posé.
func NewManager(c Config) (*Manager, error) {
	if c.DB == nil || c.Pieces == nil || c.DossierConversations == "" || c.Now == nil || c.Max <= 0 ||
		c.StorageMax <= 0 || c.UsedPartages == nil {
		return nil, errConfig
	}
	// Dossier des pièces créé ici (0700) : absent, UsedBytes échouerait fermé et bloquerait
	// aussi les partages.
	if c.Pieces.Dir == "" {
		return nil, errConfig
	}
	if err := os.MkdirAll(c.Pieces.Dir, 0o700); err != nil {
		return nil, es(err)
	}
	return &Manager{cfg: c, salons: map[string]*salon{}, index: map[[32]byte]*salon{},
		vivants: map[string]vivant{}, parBloc: map[[32]byte]int{}}, nil
}

// vivant : bloc et échéance d'un salon compté dans parBloc.
type vivant struct {
	bloc [32]byte
	exp  int64
}

// finirLocked retire le salon id du compte de son bloc ; sans effet s'il n'y est pas (déjà
// fini, ou créé avant un redémarrage). Appelé sous m.mu.
func (m *Manager) finirLocked(id string) {
	v, ok := m.vivants[id]
	if !ok {
		return
	}
	delete(m.vivants, id)
	if m.parBloc[v.bloc]--; m.parBloc[v.bloc] <= 0 {
		delete(m.parBloc, v.bloc)
	}
}

// echusLocked retire du compte les salons échus à now. Appelé sous m.mu.
func (m *Manager) echusLocked(now int64) {
	for id, v := range m.vivants {
		if v.exp <= now {
			m.finirLocked(id)
		}
	}
}

// essaiLock : verrou des entrées du salon id (rayé, comme share.attemptLock) : vérification
// de K_preuve_s, décompte des essais et attribution du siège sont atomiques.
func (m *Manager) essaiLock(id string) *sync.Mutex {
	h := fnv.New32a()
	h.Write([]byte(id))
	return &m.essais[h.Sum32()%uint32(len(m.essais))]
}

func secs(n int64) time.Duration { return time.Duration(n) * time.Second }

// notFound : ErrNotFound pour une ligne absente, ErrBase (fixe) pour toute autre erreur.
func notFound(err error) error {
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	}
	return base(err)
}

// base : ErrBase à la place d'une erreur SQL (le texte du pilote peut citer la requête ou le
// chemin de la base) ; nil reste nil.
func base(err error) error {
	if err == nil {
		return nil
	}
	return ErrBase
}

// CreerReq : POST /api/salons. AccessV, ManageV, ProofV : SHA-256 de K_accès_s, S_gestion
// et K_preuve_s (les deux premiers calculés par le serveur depuis les secrets reçus). Bloc :
// clé opaque du bloc du client (limits.CleBloc), non nulle, gardée en mémoire seulement.
type CreerReq struct {
	AccessV, ManageV, ProofV, Salt       []byte
	TTLHours, MaxMembers, KdfOps, KdfMem int
	MembersCanDestroy                    bool
	Bloc                                 [32]byte
}

// Valide : valeurs de la spécification (durée, membres, Argon2id, longueurs, vérificateurs
// distincts et non vides). Vérifiée par la couche HTTP avant l'anti-robot et le quota.
func (r CreerReq) Valide() bool {
	return (r.TTLHours == 1 || r.TTLHours == 6 || r.TTLHours == 12 || r.TTLHours == 24) &&
		r.MaxMembers >= 2 && r.MaxMembers <= nbSieges && r.KdfOps == kdfOps && r.KdfMem == kdfMem &&
		len(r.Salt) == 16 && len(r.AccessV) == 32 && len(r.ManageV) == 32 && len(r.ProofV) == 32 &&
		share.NotEmptyHash(r.AccessV, r.ManageV, r.ProofV) && string(r.AccessV) != string(r.ManageV) &&
		string(r.ProofV) != string(r.AccessV) && string(r.ProofV) != string(r.ManageV) && r.Bloc != [32]byte{}
}

// Creer range un salon et rend le délai jusqu'à son échéance (ceil15(now + ttl), seule date
// stockée). ErrConflict si access_v ou manage_v est déjà pris ; ErrBusy si Max salons vivants
// existent déjà ou si l'usage total plus 2 Gio dépasse StorageMax ; *Attente (jusqu'au
// quart d'heure suivant, où une échéance peut libérer une place) si le bloc a déjà
// VivantsParBloc salons vivants. Un refus ne prend aucune place du bloc.
func (m *Manager) Creer(r CreerReq) (time.Duration, error) {
	if !r.Valide() {
		return 0, ErrBadRequest
	}
	now := m.cfg.Now().Unix()
	exp := share.Ceil15(now + int64(r.TTLHours)*3600)
	m.createMu.Lock()
	defer m.createMu.Unlock()
	var un int
	switch err := m.cfg.DB.QueryRow(`SELECT 1 FROM salons WHERE access_v=? OR manage_v=?`, r.AccessV, r.ManageV).Scan(&un); {
	case err == nil:
		return 0, ErrConflict
	case !errors.Is(err, sql.ErrNoRows):
		return 0, base(err)
	}
	var vivants int
	if err := m.cfg.DB.QueryRow(`SELECT count(*) FROM salons WHERE expires_at>? AND failed_attempts<?`,
		now, maxEssais).Scan(&vivants); err != nil {
		return 0, base(err)
	}
	if vivants >= m.cfg.Max {
		return 0, ErrBusy
	}
	partages, err := m.cfg.UsedPartages()
	if err != nil {
		return 0, es(err)
	}
	salons, err := m.usedBytes()
	if err != nil {
		return 0, err
	}
	if partages+salons+reserveCreation > m.cfg.StorageMax {
		return 0, ErrBusy
	}
	// Place du bloc prise avant l'insertion (une destruction de ce salon, même immédiate,
	// la retrouve), rendue si l'insertion échoue.
	id := share.NewID()
	m.mu.Lock()
	m.echusLocked(now)
	if m.parBloc[r.Bloc] >= VivantsParBloc {
		m.mu.Unlock()
		return 0, &Attente{Retry: secs(quart - (now%quart+quart)%quart)}
	}
	m.vivants[id] = vivant{bloc: r.Bloc, exp: exp}
	m.parBloc[r.Bloc]++
	m.mu.Unlock()
	mcd := 0
	if r.MembersCanDestroy {
		mcd = 1
	}
	if _, err := m.cfg.DB.Exec(`INSERT INTO salons(id,access_v,manage_v,proof_v,salt,kdf_ops,kdf_mem,expires_at,
		max_members,members_can_destroy) VALUES(?,?,?,?,?,?,?,?,?,?)`, id, r.AccessV, r.ManageV, r.ProofV,
		r.Salt, r.KdfOps, r.KdfMem, exp, r.MaxMembers, mcd); err != nil {
		m.mu.Lock()
		m.finirLocked(id)
		m.mu.Unlock()
		return 0, base(err)
	}
	return secs(exp - now), nil
}

// Meta : GET /api/salons/meta. Salon inconnu, échu ou détruit : ErrNotFound.
type Meta struct {
	ExpiresIn      time.Duration
	Salt           []byte
	KdfOps, KdfMem int
}

func (m *Manager) Meta(kAcces []byte) (Meta, error) {
	v := share.Verifier(kAcces)
	if v == nil {
		return Meta{}, ErrNotFound
	}
	now := m.cfg.Now().Unix()
	var r Meta
	var exp int64
	if err := m.cfg.DB.QueryRow(`SELECT expires_at, salt, kdf_ops, kdf_mem FROM salons
		WHERE access_v=? AND expires_at>? AND failed_attempts<?`, v, now, maxEssais).
		Scan(&exp, &r.Salt, &r.KdfOps, &r.KdfMem); err != nil {
		return Meta{}, notFound(err)
	}
	r.ExpiresIn = secs(exp - now)
	return r, nil
}

// Entree : réponse de rejoindre (§39.3.3, plan point 21). Seq : rang de l'annonce (0x02, ou
// 0x0A quand le créateur reprend le siège 0) ; Nonce : nonce_arrivée de cette annonce.
type Entree struct {
	Jeton             [32]byte
	Siege             uint8
	Seq               uint64
	Nonce             [16]byte
	ExpiresIn         time.Duration
	MaxMembers        int
	MembersCanDestroy bool
	BudgetLeft        int64
}

// Rejoindre : POST /api/salons/rejoindre. sGestion (nil si absent) juste : siège 0, repris
// s'il est occupé (ancien jeton oublié, 0x0A). Invité : plus petit siège libre de 1 à 9, tant
// que les invités sont moins de max_members − 1 et les arrivées d'invités moins de
// 5 × max_members (sinon ErrFull). K_preuve_s fausse : *BadPassword, puis ErrNotFound au
// 10ᵉ essai (salon détruit). sGestion faux : ErrBadRequest, sans essai compté.
func (m *Manager) Rejoindre(kAcces, kPreuve, sGestion []byte) (Entree, error) {
	v := share.Verifier(kAcces)
	if v == nil {
		return Entree{}, ErrNotFound
	}
	if len(kPreuve) != 32 || (sGestion != nil && len(sGestion) != 32) {
		return Entree{}, ErrBadRequest
	}
	now := m.cfg.Now()
	var id string
	if err := m.cfg.DB.QueryRow(`SELECT id FROM salons WHERE access_v=? AND expires_at>? AND failed_attempts<?`,
		v, now.Unix(), maxEssais).Scan(&id); err != nil {
		return Entree{}, notFound(err)
	}
	mu := m.essaiLock(id)
	mu.Lock()
	defer mu.Unlock()
	// Relu sous le verrou : un essai concurrent a pu détruire le salon.
	var proofV, manageV []byte
	var exp, piecesBytes int64
	var maxMembers, mcd int
	if err := m.cfg.DB.QueryRow(`SELECT proof_v, manage_v, expires_at, max_members, members_can_destroy, pieces_bytes
		FROM salons WHERE id=? AND access_v=? AND expires_at>? AND failed_attempts<?`, id, v, now.Unix(), maxEssais).
		Scan(&proofV, &manageV, &exp, &maxMembers, &mcd, &piecesBytes); err != nil {
		return Entree{}, notFound(err)
	}
	if !share.Match(kPreuve, proofV) {
		return Entree{}, m.echec(id)
	}
	createur := sGestion != nil
	if createur && !share.Match(sGestion, manageV) {
		return Entree{}, ErrBadRequest
	}
	s, err := m.etat(id, exp, maxMembers)
	if err != nil {
		return Entree{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.fini {
		return Entree{}, ErrNotFound
	}
	n, err := s.choisirLocked(createur)
	if err != nil {
		return Entree{}, err
	}
	ancien := s.sieges[n] // créateur qui reprend le siège 0
	jeton, x, err := s.installerLocked(n, ancien != nil, now)
	if err != nil {
		return Entree{}, err
	}
	if !createur {
		s.arrivees++
	}
	m.idxMu.Lock()
	if ancien != nil {
		delete(s.jetons, ancien.jetonV)
		delete(m.index, ancien.jetonV)
	}
	m.index[x.jetonV] = s
	m.idxMu.Unlock()
	return Entree{
		Jeton: jeton, Siege: n, Seq: x.emis, Nonce: x.nonce, ExpiresIn: secs(exp - now.Unix()),
		MaxMembers: maxMembers, MembersCanDestroy: mcd == 1, BudgetLeft: BudgetPieces - piecesBytes,
	}, nil
}

// choisirLocked : siège donné à une entrée (plan, point 1). Le créateur n'est soumis ni au
// plafond des sièges invités ni à celui des arrivées : sa place lui est gardée.
func (s *salon) choisirLocked(createur bool) (uint8, error) {
	if createur {
		return 0, nil
	}
	if s.arrivees >= arriveesParMembre*s.maxMembers {
		return 0, ErrFull
	}
	invites, libre := 0, -1
	for n := 1; n < nbSieges; n++ {
		if s.sieges[n] != nil {
			invites++
		} else if libre < 0 {
			libre = n
		}
	}
	if invites >= s.maxMembers-1 || libre < 0 {
		return 0, ErrFull
	}
	return uint8(libre), nil
}

// etat : état mémoire du salon id, créé (fichier de conversation compris) s'il n'existe pas ;
// ErrNotFound si le salon a été détruit (tombe), même par un appel sans essaiLock.
func (m *Manager) etat(id string, exp int64, maxMembers int) (*salon, error) {
	m.mu.Lock()
	s := m.salons[id]
	m.mu.Unlock()
	if s == nil {
		conv, err := OuvrirConversation(m.cfg.DossierConversations, id)
		if err != nil {
			return nil, err
		}
		neuf := nouveauSalon(id, time.Unix(exp, 0), maxMembers, conv)
		m.mu.Lock()
		if s = m.salons[id]; s == nil {
			m.salons[id], s = neuf, neuf
		}
		m.mu.Unlock()
		if s != neuf {
			conv.Detruire() // une destruction (tombe) ou une autre création est passée entre-temps
		}
	}
	s.mu.Lock()
	fini := s.fini
	s.mu.Unlock()
	if fini {
		return nil, ErrNotFound
	}
	return s, nil
}

// echec compte une K_preuve_s fausse (sous essaiLock(id)) et détruit le salon au 10ᵉ.
func (m *Manager) echec(id string) error {
	var failed int
	if err := m.cfg.DB.QueryRow(`UPDATE salons SET failed_attempts=failed_attempts+1
		WHERE id=? AND failed_attempts<? RETURNING failed_attempts`, id, maxEssais).Scan(&failed); err != nil {
		return notFound(err)
	}
	if failed < maxEssais {
		return &BadPassword{AttemptsLeft: maxEssais - failed}
	}
	// failed_attempts = 10 : la ligne est déjà exclue de toute requête (failed_attempts<10)
	// et l'état mémoire est détruit en premier ; si la suppression de la ligne échoue, elle
	// reste « détruite » partout (la purge de la Task 15 la supprimera).
	m.detruire(id)
	return ErrNotFound
}

// detruire détruit le salon id : d'abord l'état mémoire (drapeau fini, jetons oubliés,
// conversation : clé mise à zéro, fichier supprimé), puis la ligne (pièces en base, ON DELETE
// CASCADE), puis les fichiers des pièces. Sûre sans essaiLock (purge de la Task 15) : la tombe
// laissée dans Manager.salons empêche de recréer état ou fichier. Erreurs fixes, sans chemin.
// Complétée à la Task 15 (0x05 aux connectés).
func (m *Manager) detruire(id string) error {
	m.mu.Lock()
	s := m.salons[id]
	if s == nil {
		// Échéance inconnue sans la ligne : la plus lointaine possible (24 h, arrondie).
		s = nouveauSalon(id, m.cfg.Now().Add(25*time.Hour), 0, nil)
		m.salons[id] = s
	}
	m.finirLocked(id)
	m.mu.Unlock()
	var errs []error
	s.mu.Lock()
	if !s.fini {
		s.fini = true
		m.idxMu.Lock()
		for h := range s.jetons {
			delete(m.index, h)
		}
		for h := range s.revoques {
			delete(m.index, h)
		}
		m.idxMu.Unlock()
		clear(s.jetons)
		clear(s.revoques)
		s.sieges = [nbSieges]*siege{}
		s.journal = nil
		s.index = nil
	}
	if s.conv != nil {
		errs = append(errs, s.conv.Detruire()) // idempotent : réessaie la suppression
	}
	s.mu.Unlock()

	var pieces []string
	rows, err := m.cfg.DB.Query(`SELECT id FROM salon_pieces WHERE salon_id=?`, id)
	if err == nil {
		for rows.Next() {
			var p string
			if rows.Scan(&p) == nil {
				pieces = append(pieces, p)
			}
		}
		err = errors.Join(rows.Err(), rows.Close())
	}
	errs = append(errs, base(err))
	_, err = m.cfg.DB.Exec(`DELETE FROM salons WHERE id=?`, id)
	errs = append(errs, base(err))
	for _, p := range pieces {
		errs = append(errs, es(m.cfg.Pieces.Delete(p)))
	}
	return errors.Join(errs...)
}

// Gestion : GET /api/salons/gestion ; present = sièges occupés.
func (m *Manager) Gestion(sGestion []byte) (expiresIn time.Duration, present int, err error) {
	v := share.Verifier(sGestion)
	if v == nil {
		return 0, 0, ErrNotFound
	}
	now := m.cfg.Now().Unix()
	var id string
	var exp int64
	if err := m.cfg.DB.QueryRow(`SELECT id, expires_at FROM salons WHERE manage_v=? AND expires_at>? AND failed_attempts<?`,
		v, now, maxEssais).Scan(&id, &exp); err != nil {
		return 0, 0, notFound(err)
	}
	m.mu.Lock()
	s := m.salons[id]
	m.mu.Unlock()
	if s != nil {
		s.mu.Lock()
		present = s.occupesLocked()
		s.mu.Unlock()
	}
	return secs(exp - now), present, nil
}

// Membre : membre désigné par un jeton (accueil du WebSocket, routes des pièces).
type Membre struct {
	salon          *salon
	siege          uint8
	emis, plancher uint64
}

// Membre : ErrExcluded pour un jeton révoqué ; ErrNotFound pour un jeton inconnu (jamais
// donné, oublié, remplacé), de mauvaise longueur, ou d'un salon échu. La recherche se fait
// par SHA-256 du jeton (32 octets aléatoires) : le temps de recherche ne renseigne pas sur
// un jeton valide.
func (m *Manager) Membre(jeton []byte) (Membre, error) {
	v := share.Verifier(jeton)
	if v == nil {
		return Membre{}, ErrNotFound
	}
	h := [32]byte(v)
	m.idxMu.Lock()
	s := m.index[h]
	m.idxMu.Unlock()
	if s == nil {
		return Membre{}, ErrNotFound
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.fini || !m.cfg.Now().Before(s.expires) {
		return Membre{}, ErrNotFound
	}
	if _, ok := s.revoques[h]; ok {
		return Membre{}, ErrExcluded
	}
	n, ok := s.jetons[h]
	if !ok || n >= nbSieges || s.sieges[n] == nil || s.sieges[n].jetonV != h {
		return Membre{}, ErrNotFound
	}
	x := s.sieges[n]
	return Membre{salon: s, siege: n, emis: x.emis, plancher: x.plancher}, nil
}

// departLocked : départ du siège n (0x03 au journal, jeton oublié) ; sans effet s'il est
// libre. Ne peut pas échouer (invariant du journal, annoncerLocked). Appelé sous s.mu.
func (m *Manager) departLocked(s *salon, n uint8) {
	if s.sieges[n] == nil {
		return
	}
	s.annoncerLocked(func(seq uint64) []byte { return EnrDepart(seq, n) }, true)
	jv, _ := s.oublierLocked(n)
	m.idxMu.Lock()
	delete(m.index, jv)
	m.idxMu.Unlock()
}

// Tick : une passe d'entretien. Task 6 : libère les sièges hors ligne depuis 10 min et
// oublie les tombes échues ; rend les places de bloc des salons échus (complétée aux Tasks
// 11, 13 et 15).
func (m *Manager) Tick() {
	now := m.cfg.Now()
	m.mu.Lock()
	m.echusLocked(now.Unix())
	salons := make([]*salon, 0, len(m.salons))
	for _, s := range m.salons {
		salons = append(salons, s)
	}
	m.mu.Unlock()
	for _, s := range salons {
		s.mu.Lock()
		tombe := s.fini && !now.Before(s.expires)
		for n, x := range s.sieges {
			if x != nil && !x.horsLigneDepuis.IsZero() && now.Sub(x.horsLigneDepuis) >= horsLigneMax {
				m.departLocked(s, uint8(n))
			}
		}
		s.mu.Unlock()
		if tombe {
			m.mu.Lock()
			if m.salons[s.id] == s {
				delete(m.salons, s.id)
			}
			m.mu.Unlock()
		}
	}
}

// usedBytes : octets des pièces et des fichiers de conversation.
func (m *Manager) usedBytes() (int64, error) {
	u, err := m.cfg.Pieces.UsedBytes()
	if err != nil {
		return 0, es(err)
	}
	m.mu.Lock()
	convs := make([]*Conversation, 0, len(m.salons))
	for _, s := range m.salons {
		if s.conv != nil {
			convs = append(convs, s.conv)
		}
	}
	m.mu.Unlock()
	for _, c := range convs {
		u += c.Taille()
	}
	return u, nil
}

// UsedBytes : usedBytes pour le décompte des partages ; échec fermé : usage illisible des
// pièces → StorageMax (aucune création tant qu'il ne se relit pas).
func (m *Manager) UsedBytes() int64 {
	u, err := m.usedBytes()
	if err != nil {
		return m.cfg.StorageMax
	}
	return u
}
