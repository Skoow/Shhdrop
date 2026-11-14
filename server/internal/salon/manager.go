package salon

import (
	"database/sql"
	"errors"
	"hash/fnv"
	"math"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"time"

	"github.com/skoow/shhdrop/server/internal/blob"
	"github.com/skoow/shhdrop/server/internal/limits"
	"github.com/skoow/shhdrop/server/internal/share"
	"github.com/skoow/shhdrop/server/internal/store"
)

// Gestionnaire des salons (plan C-2 Task 6) : création, meta, entrée, sièges et jetons de
// membre. La base ne garde que les colonnes de §39.3.5 ; sièges, jetons (par SHA-256),
// nonces et rangs vivent en mémoire.
//
// Ordre des verrous : createMu → Manager.mu → salon.mu (fin.go, lignes) ; essais (rayé par id) → Manager.mu → salon.mu →
// Manager.idxMu ; Conversation a son propre verrou, pris en dernier. Bornes des appels disque
// des conversations (ecr, lec) : une place ne s'attend JAMAIS sous Manager.mu, sous salon.mu
// ni sous le verrou d'une conversation (audit adverse du 13 novembre, front serveur, F1) ;
// elle se prend avant, et sous elle seul le verrou de la conversation est pris ; connexion.cmu
// (connexion.go) est un verrou feuille, pris sous salon.mu (diffusion) ou seul, sous lequel
// aucun autre verrou n'est pris ; le verrou de Manager.flux (share.Streams) aussi. placeMu
// (pieces.go) n'est jamais pris sous salon.mu ; sous lui, seuls les verrous internes des
// blob.Store (usage) sont pris. Aucune sortie (journal, stderr) : les erreurs remontent à
// l'appelant, messages fixes.

const (
	// maxEssais : 10 K_preuve_s fausses détruisent le salon (§39.3.6).
	maxEssais = 10
	// reserveCreation : place disque libre exigée pour créer un salon (plan, point 10) : le budget
	// de pièces d'un salon (Budget, 2 Gio). Ce n'est pas une réservation : chaque pièce et chaque
	// trame revérifient SHH_STORAGE_MAX (placer, plein), qui reste le vrai garde-fou du disque.
	reserveCreation int64 = Budget
	kdfOps                = 3
	kdfMem                = 67108864
	// VivantsParBloc : salons vivants au plus par bloc /48 (par adresse en IPv4), pour que
	// 14 blocs à 15 créations par jour ne prennent pas les SHH_SALONS_MAX places (spec
	// §39.3.6, décision de l'équipe du 12 novembre, réglable).
	VivantsParBloc = 5
	// TramesMaxDefaut : trames non volatiles rangées au plus par salon (audit du 13 novembre,
	// D3 : seul le plafond global du disque arrêtait une conversation, qui pouvait remplir le
	// disque de tous, puis faire tuer le processus faute de mémoire, 24 o d'index par trame).
	// 100 000 × 4 168 o ≈ 417 Mo sur le disque et 2,4 Mio d'index par salon ; c'est plus que
	// les 1 200 messages par heure d'un siège actif pendant 24 h (28 800), sans couvrir le pire
	// cas de 10 sièges au plafond (288 000). Réglable (Config.TramesMax).
	TramesMaxDefaut = 100000
	// videMax : un salon où personne n'est entré est effacé ce délai après sa création (audit
	// du 13 novembre, D2 : 40 adresses prenaient les SHH_SALONS_MAX places pour 24 h sans
	// jamais y entrer). « Entré » : un Rejoindre réussi (créateur ou invité) ; le siège 0,
	// gardé au créateur, ne compte pas tant qu'il n'est pas entré.
	videMax = 15 * time.Minute
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
	// TramesMax (facultatif, SHH_SALON_FRAMES_MAX) : trames non volatiles rangées au plus par
	// salon (0 : TramesMaxDefaut). Au-delà : 0x0C pour ce salon seulement.
	TramesMax int
	// SalonFramesTotal (facultatif, SHH_SALON_FRAMES_TOTAL) : trames non volatiles rangées au
	// plus EN MÉMOIRE, tous salons confondus (0 : sans plafond, tests seulement ; en production
	// toujours posé, calé sur GOMEMLIMIT, config.Capacity). Au-delà : 0x0C, quel que soit le
	// salon. Vrai garde-fou de la mémoire (audit adverse du 13 novembre, front serveur).
	SalonFramesTotal int
	// OnAbandon (facultatif) : pièce effacée sans avoir été finalisée (limits.AbandonUpload :
	// sa place d'envoi en cours est rendue, ses octets comptent comme abandonnés).
	OnAbandon func(id string)
	// ConvDiskOps (facultatif, config.Capacity.ConvDiskOps) : appels disque simultanés au plus
	// sur les fichiers de conversation, pour les écritures d'une part et pour les lectures de
	// l'autre (deux bornes de cette taille ; 0 : ConvDiskOpsDefaut).
	ConvDiskOps int
	// Vidage (facultatif) : vidages regroupés du WAL (store.Vidage, partagé avec les partages),
	// demandés après chaque effacement ou réécriture sensible d'une ligne de salon ou de
	// pièce ; le serveur en fait tourner la boucle. Absent : un Vidage propre, sans boucle.
	Vidage *store.Vidage
}

// ConvDiskOpsDefaut : taille par défaut de chacune des deux bornes des conversations.
const ConvDiskOpsDefaut = 16

// Manager : salons vivants du processus. Sûr pour un usage concurrent.
type Manager struct {
	cfg      Config
	createMu sync.Mutex // vérification du plafond et insertion d'une création, atomiques
	// ecr, lec : bornes des appels disque des fichiers de conversation (chacun tient un fil du
	// système tant que le disque ne répond pas), écritures et lectures. Séparées de la borne des
	// partages et des pièces (blob.Store.Gate), et l'une de l'autre (audit adverse du
	// 13 novembre, F1 et F2) : des transferts de partages sur un disque lent ne retardent ni
	// les messages ni leurs effacements, et des lecteurs lents (rattrapage) n'affament pas les
	// écritures. Prises hors de tout verrou (voir l'ordre des verrous).
	ecr, lec *blob.Gate
	// vidage : Config.Vidage, jamais nil après NewManager (nil pour un Manager bâti à la main,
	// commandes hors du serveur : Demander ne fait alors rien).
	vidage *store.Vidage
	essais [64]sync.Mutex

	mu     sync.Mutex
	salons map[string]*salon // id interne → état (créé au premier Rejoindre)
	// vivants : salons créés par ce processus et pas encore finis (id interne → bloc et
	// échéance) ; parBloc : leur nombre par bloc (clé opaque, CreerReq.Bloc). En mémoire
	// seulement : un redémarrage les oublie (les salons d'avant ne comptent plus).
	vivants map[string]vivant
	parBloc map[[32]byte]int
	// curseurEchues : dernier id du dernier lot plein lu par echuesSansEtat (fin.go), "" pour
	// repartir du début (relecture C-2, N6).
	curseurEchues string

	idxMu sync.Mutex
	// index : SHA-256 d'un jeton (valide ou révoqué) → salon ; la vérité est dans salon.jetons
	// et salon.revoques (une entrée ici sans eux vaut « inconnu »).
	index map[[32]byte]*salon

	// arrete : FermerTout appelée (arrêt du serveur) ; plus aucune connexion inscrite.
	arrete atomic.Bool
	// servis : appels de Servir en cours (AttendreConnexions).
	servis atomic.Int64
	// paniquesTick : paniques récupérées dans Tick (Run, PaniquesTick), sans identifiant.
	paniquesTick atomic.Int64
	// octetsConv : somme des tailles des conversations ouvertes (Conversation.compterDans) :
	// usage lu sans verrou ni parcours des salons (UsedBytes, plein).
	octetsConv atomic.Int64
	// tramesGlob : trames non volatiles rangées en mémoire, tous salons confondus (somme des
	// len(s.index) des salons vivants). Incrémenté à chaque trame rangée (relais.go), diminué
	// quand un index est vidé (fin, renouvellement). Comparé à tramesTotalMax (plafond global,
	// audit adverse du 13 novembre) sous le verrou du salon : un léger dépassement (une trame
	// par Recevoir simultané, comme pour m.plein) est accepté.
	tramesGlob atomic.Int64
	// passesDisque, passesPieces : passes de entretienDisque et de entretienPieces (brouillage
	// des dates une fois sur passesParBrouillage).
	passesDisque, passesPieces atomic.Int64
	// resyncPieces : des fichiers de pièces ont été supprimés par un autre processus (lignes
	// disparues) : usage du blob.Store à relire par entretienPieces.
	resyncPieces atomic.Bool
	// tramesPot : trames rangées au-delà de la part réservée de leur salon, tous salons
	// confondus (salon.globInc, globDec) : le pot commun, plafonné par potTramesMax (F3).
	tramesPot atomic.Int64
	// placeMu, reserves : place des pièces en cours de réservation (placer, pieces.go).
	placeMu  sync.Mutex
	reserves atomic.Int64
	// pieceIdx : identifiant de pièce → salon (sous idxMu), pour les routes à jeton d'envoi.
	pieceIdx map[string]*salon
	// flux : lectures de segments de pièces en cours (pieces.go).
	flux share.Streams

	// sansLimiteSiege : tests seulement (limites par siège coupées, limites.go) ; jamais posé
	// en production (NewManager le laisse à false : limites actives).
	sansLimiteSiege bool
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
	// Dates du dossier à l'epoch dès sa création (blob.Store les y remet ensuite, audit D7).
	if err := os.Chtimes(c.Pieces.Dir, time.Unix(0, 0), time.Unix(0, 0)); err != nil {
		return nil, es(err)
	}
	ops := c.ConvDiskOps
	if ops <= 0 {
		ops = ConvDiskOpsDefaut
	}
	v := c.Vidage
	if v == nil {
		v = store.NewVidage(c.DB)
	}
	return &Manager{cfg: c, salons: map[string]*salon{}, index: map[[32]byte]*salon{},
		vivants: map[string]vivant{}, parBloc: map[[32]byte]int{}, pieceIdx: map[string]*salon{},
		ecr: blob.NewGate(ops), lec: blob.NewGate(ops), vidage: v}, nil
}

// vivant : bloc et échéance d'un salon compté dans parBloc ; ne : création (secondes Unix) ;
// entre : un Rejoindre a réussi (videMax).
type vivant struct {
	bloc  [32]byte
	exp   int64
	ne    int64
	entre bool
}

// tramesMax : Config.TramesMax ou TramesMaxDefaut.
func (m *Manager) tramesMax() int {
	if m.cfg.TramesMax > 0 {
		return m.cfg.TramesMax
	}
	return TramesMaxDefaut
}

// tramesTotalMax : plafond global des trames en mémoire (Config.SalonFramesTotal) ;
// math.MaxInt32 si non posé (tests : sans plafond global).
func (m *Manager) tramesTotalMax() int {
	if m.cfg.SalonFramesTotal > 0 {
		return m.cfg.SalonFramesTotal
	}
	return math.MaxInt32
}

// PartTrames : part de trames en mémoire réservée à chaque salon, pour un plafond global total
// et max salons au plus (audit adverse du 13 novembre, front serveur, F3 : le plafond global
// était un pot commun, qu'un groupe de salons pouvait vider pour tous les autres). La moitié
// du plafond global est réservée, à parts égales entre les max salons possibles (jamais plus
// que le plafond par salon) ; le reste (pot) est commun. max × part + pot = total : le
// garde-fou de la mémoire ne bouge pas. Exportée pour le contrôle de démarrage
// (config : une part trop petite refuse le démarrage).
func PartTrames(total, max, parSalon int) (part, pot int) {
	if total <= 0 || max <= 0 {
		return 0, total
	}
	part = min(total/2/max, parSalon)
	return part, total - max*part
}

// partTrames : part réservée et pot commun de ce gestionnaire (0, 0 sans plafond global).
func (m *Manager) partTrames() (part, pot int) {
	if m.cfg.SalonFramesTotal <= 0 {
		return 0, 0
	}
	return PartTrames(m.cfg.SalonFramesTotal, m.cfg.Max, m.tramesMax())
}

// parBlocMax : salons vivants au plus par bloc : VivantsParBloc, et au plus 1/8 de Max (part
// équitable, audit du 13 novembre, D2 ; limits.FairShare).
func (m *Manager) parBlocMax() int { return max(1, min(VivantsParBloc, m.cfg.Max/limits.FairShare)) }

// reserveSalons : dernières places de Max, ouvertes seulement à un bloc sans salon vivant
// (nouveau venu ; limits.FairReserve).
func (m *Manager) reserveSalons() int { return m.cfg.Max / limits.FairReserve }

// vides : salons où personne n'est entré, créés depuis videMax au moins. Sous m.mu.
func (m *Manager) videsLocked(now int64) []string {
	var ids []string
	for id, v := range m.vivants {
		if !v.entre && v.ne+int64(videMax/time.Second) <= now {
			ids = append(ids, id)
		}
	}
	return ids
}

// effacerVides : chaque salon vide depuis videMax est détruit (comme une destruction : ligne,
// fichier de conversation et pièces effacés, place du bloc rendue). Sous essaiLock, revérifié :
// un Rejoindre en cours, qui tient ce verrou jusqu'à marquer l'entrée, n'est jamais pris de
// vitesse.
func (m *Manager) effacerVides(now int64) {
	ids := func() []string { m.mu.Lock(); defer m.mu.Unlock(); return m.videsLocked(now) }()
	for _, id := range ids {
		m.effacerVide(id)
	}
}

// effacerVide : le salon id, s'il est toujours vide, est détruit sous son verrou d'entrée,
// rendu par defer : une panique dans la fin (récupérée par l'entretien, passeSure) ne garde pas
// la raie (audit adverse du 13 novembre, 3e campagne, front serveur, B : le verrou restait pris
// pour toujours, et avec lui toute entrée d'un salon sur 64, puis la passe disque).
func (m *Manager) effacerVide(id string) {
	mu := m.essaiLock(id)
	mu.Lock()
	defer mu.Unlock()
	if m.encoreVide(id) {
		_ = m.detruire(id) // partie disque ratée : reprise par l'entretien (reprendreFin)
	}
}

// encoreVide : personne n'est entré dans le salon id, toujours compté.
func (m *Manager) encoreVide(id string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	v, ok := m.vivants[id]
	return ok && !v.entre
}

// marquerEntre : un Rejoindre a réussi dans le salon id.
func (m *Manager) marquerEntre(id string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if v, ok := m.vivants[id]; ok && !v.entre {
		v.entre = true
		m.vivants[id] = v
	}
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

// avecMu : f sous Manager.mu, rendu par defer : une panique de f, récupérée par l'entretien
// (passeSure) ou par net/http, ne garde pas le verrou (audit adverse du 13 novembre, 3e
// campagne, front serveur, B : même défaut cherché dans tout le paquet).
func (m *Manager) avecMu(f func()) {
	m.mu.Lock()
	defer m.mu.Unlock()
	f()
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
	var nouveau bool
	m.avecMu(func() { m.echusLocked(now); nouveau = m.parBloc[r.Bloc] == 0 })
	// Réserve des nouveaux venus (audit D2) : les dernières places de Max et le dernier
	// huitième du stockage ne vont qu'à un bloc sans salon vivant.
	if !nouveau && vivants >= m.cfg.Max-m.reserveSalons() {
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
	if partages+salons+reserveCreation > share.StorageLimit(m.cfg.StorageMax, nouveau) {
		return 0, ErrBusy
	}
	// Place du bloc prise avant l'insertion (une destruction de ce salon, même immédiate,
	// la retrouve), rendue si l'insertion échoue.
	id := share.NewID()
	var pris bool
	m.avecMu(func() {
		m.echusLocked(now)
		if pris = m.parBloc[r.Bloc] < m.parBlocMax(); pris {
			m.vivants[id] = vivant{bloc: r.Bloc, exp: exp, ne: now}
			m.parBloc[r.Bloc]++
		}
	})
	if !pris {
		return 0, &Attente{Retry: secs(quart - (now%quart+quart)%quart)}
	}
	mcd := 0
	if r.MembersCanDestroy {
		mcd = 1
	}
	if _, err := m.cfg.DB.Exec(`INSERT INTO salons(id,access_v,manage_v,proof_v,salt,kdf_ops,kdf_mem,expires_at,
		max_members,members_can_destroy) VALUES(?,?,?,?,?,?,?,?,?,?)`, id, r.AccessV, r.ManageV, r.ProofV,
		r.Salt, r.KdfOps, r.KdfMem, exp, r.MaxMembers, mcd); err != nil {
		m.avecMu(func() { m.finirLocked(id) })
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
// s'il est occupé (ancien jeton oublié, ses lectures de pièces en cours coupées, 0x0A).
// Invité : plus petit siège libre de 1 à 9, tant que les invités sont moins de
// max_members − 1 et les arrivées d'invités moins de 5 × max_members (sinon ErrFull). Reprise
// du siège 0 : plafond de repriseMax par heure (sinon *Attente), et l'ancienne connexion du
// siège est fermée (4005). K_preuve_s fausse : *BadPassword, puis ErrNotFound au 10ᵉ essai
// (salon détruit). sGestion faux : ErrBadRequest, sans essai compté.
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
	if c := s.conns[n]; ancien != nil && c != nil {
		// Ancien jeton remplacé (appareil perdu ou volé) : sa connexion ne reçoit plus rien,
		// 0x05 raison 4 puis 4005 (une seule connexion par siège ; 4004 pousserait un client
		// à refaire rejoindre, et deux appareils du créateur se délogeraient en boucle).
		c.arreter(CodeRemplace, EnrFin(s.seq, RaisonRemplace))
	}
	if ancien != nil {
		delete(s.jetons, ancien.jetonV)
		// Lectures de pièces en cours de l'ancien jeton coupées (Streams.mu : feuille).
		m.flux.Revoke(cleFluxMembre(ancien.jetonV))
	}
	m.indexer(func(index map[[32]byte]*salon) {
		if ancien != nil {
			delete(index, ancien.jetonV)
		}
		index[x.jetonV] = s
	})
	m.marquerEntre(id) // sous essaiLock : effacerVides ne peut plus le prendre pour vide
	return Entree{
		Jeton: jeton, Siege: n, Seq: x.emis, Nonce: x.nonce, ExpiresIn: secs(exp - now.Unix()),
		MaxMembers: maxMembers, MembersCanDestroy: mcd == 1, BudgetLeft: Budget - piecesBytes,
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
		conv.lec = m.lec // lectures bornées, hors de tout verrou (Conversation.Lire)
		conv.compterDans(&m.octetsConv)
		neuf := nouveauSalon(id, time.Unix(exp, 0), maxMembers, conv, m.now)
		neuf.flux = &m.flux
		neuf.glob = &m.tramesGlob
		if m.cfg.SalonFramesTotal > 0 {
			neuf.pot = &m.tramesPot
			neuf.part, neuf.potMax = m.partTrames()
		}
		m.mu.Lock()
		if s = m.salons[id]; s == nil {
			m.salons[id], s = neuf, neuf
		}
		m.mu.Unlock()
		if s != neuf {
			conv.Detruire() // une destruction (tombe) ou une autre création est passée entre-temps
		}
	}
	if s.estFini() {
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
	// et l'état mémoire est détruit en premier (0x05 raison 2 aux connectés, fin.go) ; si la
	// suppression de la ligne échoue, elle reste « détruite » partout, et Tick la reprend.
	_ = m.detruire(id)
	return ErrNotFound
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
		present = s.occupes()
	}
	return secs(exp - now), present, nil
}

// Membre : membre désigné par un jeton (accueil du WebSocket, routes des pièces). jetonV :
// SHA-256 du jeton (jamais le jeton), pour reconnaître un jeton révoqué depuis (perimeLocked).
type Membre struct {
	salon          *salon
	siege          uint8
	emis, plancher uint64
	jetonV         [32]byte
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
	return Membre{salon: s, siege: n, emis: x.emis, plancher: x.plancher, jetonV: h}, nil
}

// departLocked : départ du siège n (Quitter, « Quitter et signaler », siège jamais connecté
// après jamaisConnecteMax) : 0x03 au
// journal (sortirLocked) ; sans effet s'il est libre. Appelé sous s.mu.
func (m *Manager) departLocked(s *salon, n uint8) {
	m.sortirLocked(s, n, func(seq uint64) []byte { return EnrDepart(seq, n) }, false)
}

// sortirLocked : le siège n est libéré, annoncé par enr (0x03 départ, ou 0x09 exclusion,
// exclusion.go) : annonce au journal, siège retiré des lecteurs attendus de toutes les trames
// (effacements en chaîne, 0x0E après l'annonce), jeton oublié et ses lectures de pièces en
// cours coupées. revoquer (exclusion) : l'empreinte du jeton est gardée parmi les révoqués et
// dans l'index jusqu'à la fin du salon (Membre rend alors ErrExcluded) ; sinon elle est
// retirée de l'index. Sans effet si le siège est libre. Ne peut pas échouer (invariant du
// journal, annoncerLocked : un siège occupé peut toujours être annoncé libéré). Appelé sous
// s.mu.
func (m *Manager) sortirLocked(s *salon, n uint8, enr func(seq uint64) []byte, revoquer bool) {
	if s.sieges[n] == nil {
		return
	}
	s.annoncerLocked(enr, true)
	s.plusAttenduLocked(n)
	jv, _ := s.oublierLocked(n)
	if revoquer {
		s.revoques[jv] = struct{}{}
	} else {
		m.indexer(func(index map[[32]byte]*salon) { delete(index, jv) })
	}
	m.flux.Revoke(cleFluxMembre(jv)) // lectures de pièces en cours de ce jeton coupées
}

// Tick : une passe d'entretien complète, mémoire, disque puis pièces (tests, et tout appelant
// qui veut l'entretien fait au retour). En marche (Run), les trois passes tournent chacune dans
// sa goroutine : la passe mémoire n'attend jamais le disque (audit adverse du 13 novembre, front
// serveur, F1 : une borne des appels disque saturée, ou un disque lent, figeait l'entretien de
// tous les salons, donc les effacements à échéance et les fins de vie), et la passe disque
// n'attend jamais la borne des partages et des pièces (3e campagne, H).
func (m *Manager) Tick() {
	m.entretienMemoire()
	m.entretienDisque()
	m.entretienPieces()
}

// copieSalons : salons en mémoire, copiés sous Manager.mu (defer : une panique, récupérée par
// Run, ne garde pas le verrou).
func (m *Manager) copieSalons(avant func()) []*salon {
	m.mu.Lock()
	defer m.mu.Unlock()
	if avant != nil {
		avant()
	}
	salons := make([]*salon, 0, len(m.salons))
	for _, s := range m.salons {
		salons = append(salons, s)
	}
	return salons
}

// entretienMemoire : passe d'entretien sans aucun appel disque ni requête SQL, et sans
// attendre aucune borne (chaque seconde, Run) : trames des règles 1 à 3 échues (délai après
// lecture par tous) marquées effacées, donc plus jamais servies, et 0x0E diffusé (Task 11) ;
// pièces échues marquées effacées, flux coupés (Task 13) ; sièges jamais connectés libérés ;
// salons arrivés à échéance finis en raison 1 pour tout ce qui est en mémoire (oublier : 0x05
// aux connectés, jetons, journal et index oubliés) ; places de bloc des salons échus rendues.
// Tout ce qui reste à faire sur le disque est laissé à entretienDisque.
func (m *Manager) entretienMemoire() {
	now := m.cfg.Now()
	for _, s := range m.copieSalons(func() { m.echusLocked(now.Unix()) }) {
		if m.entretenir(s, now) {
			m.avecMu(func() { m.finirLocked(s.id) })
			m.oublier(s, RaisonExpire, false) // partie disque : entretienDisque (reprendreFin)
		}
	}
}

// entretienDisque : passe d'entretien sur les fichiers de conversation et la base (chaque
// seconde, Run, dans sa propre goroutine ; elle peut attendre un disque lent sans retarder
// entretienMemoire). Elle ne prend JAMAIS la borne des partages et des pièces
// (blob.Store.Gate, que des transferts de partages sur un disque lent saturent) : tout ce qui
// la prend est dans entretienPieces (audit adverse du 13 novembre, 3e campagne, front serveur,
// H : une pièce à purger faisait attendre, derrière cette borne, l'écrasement des trames
// effacées et les fins de tous les salons). Dans l'ordre, chaque étape pour tous les salons
// avant la suivante : salons où personne n'est entré effacés (jamais de pièce : personne n'y a
// de jeton) ; emplacements des trames effacées écrasés (ecraser, borne des écritures de
// conversation) ; fins restées à faire : conversation détruite, clé oubliée et ligne rendue
// morte (finHorsPieces ; pièces et suppression de la ligne : entretienPieces) ; salons dont la
// ligne vivante a disparu (admin destroy, wipe) finis de même.
func (m *Manager) entretienDisque() {
	now := m.cfg.Now()
	m.effacerVides(now.Unix())
	salons := m.copieSalons(nil)
	for _, s := range salons {
		_ = m.ecraser(s) // erreur : trames déjà plus servies (marquerLocked)
	}
	for _, s := range salons {
		if s.finIncomplete() {
			m.finHorsPieces(s)
		}
	}
	if partis := m.disparus(); len(partis) > 0 {
		for _, s := range partis {
			m.oublier(s, RaisonDetruit, false) // place du bloc déjà rendue (disparus)
			m.finHorsPieces(s)
		}
		// Fichiers de pièces supprimés par un autre processus : usage à relire (entretienPieces).
		m.resyncPieces.Store(true)
	}
	// Une fois par minute : dates d'inode des conversations brouillées.
	if m.passesDisque.Add(1)%passesParBrouillage == 0 {
		_ = m.brouillerConversations()
	}
}

// entretienPieces : passe d'entretien de tout ce qui passe par la borne des partages et des
// pièces (chaque seconde, Run, dans sa propre goroutine : elle peut attendre cette borne sans
// retarder ni entretienMemoire ni entretienDisque) : pièces effacées (fichier puis ligne) ;
// fins restées à faire achevées (achever : pièces, puis ligne du salon) ; tombes échues
// oubliées une fois leur fin complète et leurs pièces purgées (un effacement raté est retenté
// au passage suivant) ; puis passe sur la base (lignes, fin.go : lignes à 10 essais, lignes
// échues sans état).
func (m *Manager) entretienPieces() {
	now := m.cfg.Now()
	for _, s := range m.copieSalons(nil) {
		m.purger(s) // hors du verrou du salon
		m.reprendreFin(s)
		if s.tombeEchue(now) && !s.resteAPurger() && !s.finIncomplete() {
			m.oublierTombe(s)
		}
	}
	m.lignes(now)
	if m.resyncPieces.Swap(false) {
		if m.cfg.Pieces.Resync() != nil {
			m.resyncPieces.Store(true) // relu au passage suivant
		}
	}
	// Une fois par minute : dates d'inode des pièces brouillées.
	if m.passesPieces.Add(1)%passesParBrouillage == 0 {
		_ = es(m.cfg.Pieces.ScrubTimes())
	}
}

// passesParBrouillage : passes disque de l'entretien (une par seconde) entre deux brouillages
// des dates d'inode.
const passesParBrouillage = 60

// BrouillerDates remet à l'epoch les dates de chaque fichier de conversation et de pièce, et
// de leurs dossiers : leur date de changement d'inode (ctime) devient l'heure de ce passage, la
// même pour tous, et non plus celle du dernier message, du dernier retrait ou de la dernière
// suppression (audit adverse du 13 novembre, stockage, F4 ; blob.Store.ScrubTimes). Entre deux
// passages (une minute), le ctime d'une conversation qui vient de recevoir un message donne
// encore l'heure de ce message ; la date de création (btime) ne peut pas être changée. Hors
// de tout verrou ; écritures sous la borne des écritures de conversation.
func (m *Manager) BrouillerDates() error {
	return errors.Join(m.brouillerConversations(), es(m.cfg.Pieces.ScrubTimes()))
}

// brouillerConversations : BrouillerDates pour les fichiers de conversation et leur dossier
// (sans la borne des partages et des pièces : passe disque de l'entretien).
func (m *Manager) brouillerConversations() error {
	es0, err := os.ReadDir(m.cfg.DossierConversations)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return es(err)
	}
	var premiere error
	noter := func(err error) {
		if err != nil && !errors.Is(err, os.ErrNotExist) && premiere == nil {
			premiere = err
		}
	}
	for _, e := range es0 {
		if !e.IsDir() && idValide(e.Name()) {
			noter(m.ecr.Do(func() error { return sansDate(filepath.Join(m.cfg.DossierConversations, e.Name())) }))
		}
	}
	if err == nil {
		noter(m.ecr.Do(func() error { return sansDate(m.cfg.DossierConversations) }))
	}
	return premiere
}

// oublierTombe : tombe s retirée de Manager.salons (si c'est toujours elle).
func (m *Manager) oublierTombe(s *salon) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.salons[s.id] == s {
		delete(m.salons, s.id)
	}
}

// margeTombe : une tombe est gardée jusqu'à l'échéance plus cette marge (plan, Task 15) : un
// Rejoindre qui a lu la ligne juste avant l'échéance ne recrée ni état ni fichier.
const margeTombe = time.Minute

// entretenir : passe mémoire de l'entretien sur un salon, sous son verrou (defer : une panique
// ne le garde jamais) ; rend vrai pour un salon vivant arrivé à son échéance (à finir).
func (m *Manager) entretenir(s *salon, now time.Time) (echu bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.fini {
		return false
	}
	if !now.Before(s.expires) {
		return true
	}
	s.effacerEchuesLocked(now.UnixMilli())
	// Un siège connecté au moins une fois n'est jamais libéré ici : un absent reste réservé et
	// attendu par les trames des règles 1 à 3 jusqu'à son retour, son départ, son exclusion ou la
	// fin du salon (revue finale C-2, I3). Seul un siège invité qui n'a jamais ouvert de
	// WebSocket dans les jamaisConnecteMax après son entrée part (0x03 : réponse de rejoindre
	// perdue, remplissage ; relecture C-2, N1) ; son arrivée reste comptée (s.arrivees).
	for n, x := range s.sieges {
		if x != nil && x.jamaisConnecte && now.Sub(x.entre) >= jamaisConnecteMax {
			m.departLocked(s, uint8(n))
		}
	}
	s.echuesPiecesLocked(now) // pièces échues marquées (aPurger) : effacées par entretienDisque
	return false
}

// tombeEchue : tombe (salon fini) dont l'échéance plus margeTombe est passée.
func (s *salon) tombeEchue(now time.Time) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.fini && !now.Before(s.expires.Add(margeTombe))
}

// resteAPurger : des pièces du salon attendent encore leur effacement (purger en échec).
func (s *salon) resteAPurger() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.aPurger) > 0
}

// now : Config.Now lue à chaque appel (un test peut la remplacer après la création d'un salon).
func (m *Manager) now() time.Time { return m.cfg.Now() }

// usedBytes : octets des pièces (blob.Store, usage en cache, et réservations en cours) et des
// fichiers de conversation (octetsConv, atomique) : O(1), sans Manager.mu ni parcours des
// salons.
func (m *Manager) usedBytes() (int64, error) {
	// Réservations lues avant l'usage des fichiers : une réservation n'est rendue qu'une fois
	// son fichier compté par le blob.Store, elle est donc vue d'un côté ou de l'autre (au pire
	// deux fois), jamais d'aucun.
	r := m.reserves.Load()
	u, err := m.cfg.Pieces.UsedBytes()
	if err != nil {
		return 0, es(err)
	}
	return r + u + m.octetsConv.Load(), nil
}

// plein : n octets de plus dépasseraient StorageMax (partages, pièces et conversations) ;
// échec fermé : usage illisible → plein. Sans Manager.mu ; pas sous salon.mu quand même :
// UsedPartages et l'usage des pièces prennent leurs propres verrous et peuvent relire un
// dossier (premier appel, Resync).
func (m *Manager) plein(n int64) bool {
	partages, err := m.cfg.UsedPartages()
	if err != nil {
		return true
	}
	return partages+m.UsedBytes()+n > m.cfg.StorageMax
}

// Usage : octets des pièces et des conversations (usedBytes), avec l'erreur de lecture
// (démarrage : checkStorage).
func (m *Manager) Usage() (int64, error) { return m.usedBytes() }

// UsedBytes : usedBytes pour le décompte des partages ; échec fermé : usage illisible des
// pièces → StorageMax (aucune création tant qu'il ne se relit pas).
func (m *Manager) UsedBytes() int64 {
	u, err := m.usedBytes()
	if err != nil {
		return m.cfg.StorageMax
	}
	return u
}

// occupes : sièges occupés, sous le verrou du salon.
func (s *salon) occupes() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.occupesLocked()
}

// indexer : f sur Manager.index, sous idxMu (souvent pris sous salon.mu : defer, jamais
// d'Unlock explicite sous ce verrou).
func (m *Manager) indexer(f func(index map[[32]byte]*salon)) {
	m.idxMu.Lock()
	defer m.idxMu.Unlock()
	f(m.index)
}
