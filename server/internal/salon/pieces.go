package salon

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"io/fs"
	"slices"
	"sync"
	"syscall"
	"time"

	"github.com/skoow/shhdrop/server/internal/blob"
	"github.com/skoow/shhdrop/server/internal/share"
)

// Pièces jointes et vocaux (plan C-2 Task 13, v3 §5.1, spec §39.3.9). Une pièce est un
// fichier chiffré de bout en bout, de la taille exacte d'un palier (share.TotalSize), dans
// son propre blob.Store (jamais celui des partages, que janitor.Reconcile vide de ce qu'il n'y
// connaît pas). La base garde la ligne de §39.3.5 (salon, palier, état) ; l'auteur (siège,
// SHA-256 du jeton), le rang de création, le lien avec sa trame, la sorte (vocal) et les
// lectures restent en mémoire, sous le verrou du salon.
//
// Règles du propriétaire (v3 §5.1) : les fichiers consomment le budget de 2 Go du salon (13 novembre, décision du propriétaire ;
// 1 Go avant)
// (pieces_bytes) ; les vocaux n'y comptent pas et ne sont pas limités en nombre, seulement
// cadencés au rythme d'une voix (réserve du siège, limites.go). Tous comptent dans
// SHH_STORAGE_MAX.
//
// Vie d'une pièce : créée (« uploading », fichier réservé), segments reçus, finalisée (bourrage
// d'aléa, « ready »), liée à une trame non volatile (Recevoir), effacée avec cette trame
// (retrait, règle, lectures), par son auteur (RetirerPiece), à la fin du salon, PieceSansLien
// après sa finalisation si elle n'est jamais liée, ou PieceSansSegment après son dernier
// segment reçu (ou sa création) si elle n'est jamais finalisée. L'effacement est marqué sous
// le verrou du salon (plus jamais servie, flux coupés), puis fait hors de ce verrou (purger) :
// fichier, puis ligne et budget rendu.

const (
	// Budget : octets de pièces d'un salon (hors vocaux), 2 Gio comme un partage gratuit (§39.1,
	// v3 §5.1 ; 13 novembre, décision du propriétaire ; 1 Gio avant).
	Budget int64 = 2147483648
	// PalierMax : plus grand palier d'une pièce (8 000 morceaux, 524 416 048 octets).
	PalierMax = 8000
	// VocalOctetsParSeconde : réserve vocale gagnée par seconde de WebSocket ouvert (une voix
	// Opus en consomme environ 3 000).
	VocalOctetsParSeconde = 4000
	// VocalReserveMax : réserve vocale d'un siège au plus (1 h de présence).
	VocalReserveMax int64 = 14400000
	// PieceSansLien : pièce finalisée jamais liée à une trame, effacée après ce délai.
	PieceSansLien = 15 * time.Minute
	// PieceSansSegment : pièce non finalisée sans segment reçu depuis ce délai, effacée.
	PieceSansSegment = 15 * time.Minute
	// PiecesParHeure : pièces non vocales créées au plus par heure et par siège (seau plein au
	// départ, une de plus toutes les 30 s, neuf pour chaque nouvel occupant ; décision du
	// 12 novembre). Une pièce n'est pas une création de partage (limits.BeginPiece) : ce
	// plafond borne seul leur nombre ; les vocaux n'y comptent pas (réserve du siège).
	PiecesParHeure = 120
	// EcritureMax : octets de segments reçus au plus par pièce, réécritures comprises, en
	// multiples de sa taille (audit du 12 novembre, D2) : une reprise complète après coupure
	// passe, une réécriture sans fin (vocal hors de tout quota d'octets) non (ErrTropEcrit).
	EcritureMax = 2
	// BourrageFacteur, BourrageMarge : aléa écrit à la finalisation, en morceaux, au plus
	// BourrageFacteur × morceaux reçus + BourrageMarge (padAllowed des partages, D42-17 ;
	// audit du 12 novembre, D1), sinon ErrBadRequest.
	BourrageFacteur = 4
	BourrageMarge   = 8 * share.SegChunks
)

// VocalPaliers : paliers d'un vocal (plan, point 3 : 10 min tiennent dans 80).
var VocalPaliers = []int{1, 16, 80}

// PalierValide : palier d'un vocal (VocalPaliers) ou d'un fichier (palier de share.Buckets
// jusqu'à PalierMax).
func PalierValide(bucket int, vocal bool) bool {
	if vocal {
		return slices.Contains(VocalPaliers, bucket)
	}
	return bucket <= PalierMax && share.ValidBucket(bucket)
}

type etatPiece uint8

const (
	envoi        etatPiece = iota // segments attendus
	finalisation                  // FinalizePiece en cours (bourrage hors du verrou)
	prete                         // « ready » : lisible, liable
)

// piece : état mémoire d'une pièce, sous le verrou de son salon.
type piece struct {
	id     string
	bucket int
	vocal  bool
	siege  uint8
	auteur [32]byte // SHA-256 du jeton de l'auteur
	// rang : dernier rang du salon à la création ; lien : rang de la trame liée (0 : aucune).
	rang, lien uint64
	// gen : renouvellements du salon à la création (salon.gen) ; une pièce commencée avant un
	// renouvellement n'est jamais inscrite (inscrirePiece).
	gen       uint64
	etat      etatPiece
	ecritures int       // PutSegment en cours (hors du verrou)
	recus     []bool    // segments reçus (envoi seulement)
	ecrit     int64     // octets de segments acceptés, réécritures comprises (EcritureMax)
	activite  time.Time // création, dernier segment reçu, puis finalisation
	lus       map[[32]byte]int64
	efface    bool
}

// purge : pièce à effacer hors du verrou du salon (fichier, puis ligne et budget).
type purge struct {
	id      string
	vocal   bool
	taille  int64
	abandon bool // jamais finalisée : envoi abandonné aux quotas (Config.OnAbandon)
}

// reserverPiece : réservation du fichier (variable pour les tests : fichiers creux, attente).
var reserverPiece = func(st *blob.Store, id string, n int64) error { return st.Reserve(id, n) }

func cleFluxMembre(jetonV [32]byte) string { return "m:" + hex.EncodeToString(jetonV[:]) }
func cleFluxPiece(id string) string        { return "p:" + id }

// Flux : lectures de segments en cours, par clé de révocation ("m:" + hex(SHA-256(jeton)),
// "p:" + id de pièce). Ne sert qu'aux tests du paquet api (coupure des lectures en cours à
// une exclusion, désinscription des flux) : un fichier _test.go de salon ne leur serait pas
// visible ; gardé, une ligne en lecture seule sans effet (revue finale C-2, mineur g).
func (m *Manager) Flux() *share.Streams { return &m.flux }

// Echeance : fin du salon de mb (jeton d'envoi d'une pièce valable au plus jusque-là).
func (mb Membre) Echeance() time.Time {
	if mb.salon == nil {
		return time.Time{}
	}
	mb.salon.mu.Lock()
	defer mb.salon.mu.Unlock()
	return mb.salon.expires
}

// membrePieceLocked : membreLocked, sinon ErrExcluded pour un jeton révoqué depuis (Membre
// obtenu avant l'exclusion, siège libéré) et ErrNotFound pour tout autre membre périmé
// (perimeLocked) ; un jeton révoqué encore assis (jamais le cas après Exclure, qui libère le
// siège) est refusé aussi. Appelé sous s.mu.
func (s *salon) membrePieceLocked(mb Membre, now time.Time) error {
	if !s.membreLocked(mb, now) {
		return s.perimeLocked(mb, now)
	}
	if _, ok := s.revoques[mb.jetonV]; ok {
		return ErrExcluded
	}
	return nil
}

// auteurDeLocked : mb est l'auteur de p : même siège, et occupant actuel (au siège 0,
// toujours le créateur ; ailleurs, pièce créée après l'arrivée de l'occupant, comme Retirer).
func (s *salon) auteurDeLocked(mb Membre, p *piece) bool {
	return p.siege == mb.siege && (mb.siege == 0 || p.rang >= s.sieges[mb.siege].arrivee)
}

// envoiLocked : pièce id d'un envoi par un auteur toujours là (jeton d'envoi seul : aucun
// Membre). ErrExcluded si le jeton de l'auteur a été révoqué ; ErrNotFound si la pièce, le
// salon ou l'auteur (parti, remplacé) n'existe plus. Appelé sous s.mu.
func (s *salon) envoiLocked(id string, now time.Time) (*piece, error) {
	p := s.lesPieces[id]
	if p == nil || s.fini || !now.Before(s.expires) {
		return nil, ErrNotFound
	}
	if _, ok := s.revoques[p.auteur]; ok {
		return nil, ErrExcluded
	}
	if x := s.sieges[p.siege]; x == nil || x.jetonV != p.auteur {
		return nil, ErrNotFound
	}
	switch p.etat {
	case finalisation:
		return nil, ErrBusy
	case prete:
		return nil, ErrNotFound
	}
	return p, nil
}

// CreerPieceID crée la pièce id (share.NewID, tiré par l'appelant pour ses quotas) : palier
// invalide → ErrBadRequest ; fichier : PiecesParHeure par siège, sinon *Attente ; pieces_bytes + taille ≤ Budget (SQL conditionnel,
// atomique), sinon ErrBudget ; vocal : taille débitée de la réserve du siège, sinon *Attente
// (manque ÷ 4 000 s, arrondi au-dessus) ; place totale (StorageMax), réservée dans la même
// section que sa vérification (placer), sinon ErrFull ; fichier réservé, ligne « uploading ».
// Tout refus rend ce qui a été pris. Membre périmé : ErrNotFound ; révoqué : ErrExcluded.
func (m *Manager) CreerPieceID(mb Membre, id string, bucket int, vocal bool) (err error) {
	s := mb.salon
	if s == nil {
		return ErrNotFound
	}
	if !PalierValide(bucket, vocal) || !idValide(id) {
		return ErrBadRequest
	}
	taille := share.TotalSize(bucket)
	p := &piece{id: id, bucket: bucket, vocal: vocal, siege: mb.siege, recus: make([]bool, share.SegmentCount(bucket)),
		lus: map[[32]byte]int64{}}
	arrivee, err := m.debuterPiece(s, mb, p, taille)
	if err != nil {
		return err
	}
	var annuler []func()
	defer func() {
		if err != nil {
			for _, f := range slices.Backward(annuler) {
				f()
			}
		}
	}()
	annuler = append(annuler, func() { s.rendre(mb.siege, arrivee, vocal, taille) })
	if !vocal {
		res, err := m.cfg.DB.Exec(`UPDATE salons SET pieces_bytes=pieces_bytes+? WHERE id=? AND pieces_bytes+?<=?`,
			taille, s.id, taille, Budget)
		if err != nil {
			return base(err)
		}
		if k, _ := res.RowsAffected(); k != 1 {
			return ErrBudget
		}
		annuler = append(annuler, func() { m.rendreBudget(s.id, taille) })
	}
	if !m.placer(taille) {
		return ErrFull
	}
	err = reserverPiece(m.cfg.Pieces, id, taille)
	m.reserves.Add(-taille) // compté par le blob.Store (ou rien de créé)
	switch {
	case errors.Is(err, blob.ErrNoAllocate), errors.Is(err, syscall.ENOSPC), errors.Is(err, syscall.EDQUOT):
		return ErrFull
	case err != nil:
		return es(err)
	}
	// Annulation : fichier d'abord, puis la ligne si elle a été insérée et seulement si le
	// fichier est parti (même règle qu'effacerPiece) : jamais de fichier sans ligne, compté
	// dans SHH_STORAGE_MAX jusqu'au redémarrage (revue finale C-2, mineur e). Une ligne
	// gardée est reprise à la fin du salon (effacerPiecesEnBase) ou au démarrage.
	ligne := false
	annuler = append(annuler, func() {
		if m.cfg.Pieces.Delete(id) == nil && ligne {
			m.cfg.DB.Exec(`DELETE FROM salon_pieces WHERE id=?`, id)
		}
	})
	if _, err := m.cfg.DB.Exec(`INSERT INTO salon_pieces(id,salon_id,bucket,state,segments_mask) VALUES(?,?,?,'uploading',?)`,
		id, s.id, bucket, make([]byte, (len(p.recus)+7)/8)); err != nil {
		return base(err)
	}
	ligne = true
	return m.inscrirePiece(s, mb, p)
}

// debuterPiece : membre vérifié, rang et auteur de p posés, réserve vocale débitée ; rend le
// rang d'arrivée de l'occupant (rendreVocal).
func (m *Manager) debuterPiece(s *salon, mb Membre, p *piece, taille int64) (arrivee uint64, err error) {
	now := m.cfg.Now()
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.membrePieceLocked(mb, now); err != nil {
		return 0, err
	}
	x := s.sieges[mb.siege]
	p.auteur, p.rang, p.activite, p.gen = x.jetonV, s.seq, now, s.gen.Load()
	if p.vocal {
		if d := s.limites[mb.siege].vocal.prendre(now, taille); d > 0 {
			return 0, &Attente{Retry: d}
		}
	} else if !m.sansLimiteSiege {
		if ok, d := s.limites[mb.siege].pieces.prendre(now); !ok {
			// Arrondi à la milliseconde : 1 ÷ (120 / 3 600) n'est pas exact en flottant, et
			// Retry-After (arrondi au-dessus) dirait 31 s au lieu de 30.
			return 0, &Attente{Retry: max(time.Millisecond, d.Round(time.Millisecond))}
		}
	}
	return x.arrivee, nil
}

// rendre : réserve vocale (vocal) ou jeton du seau des pièces rendu au siège n, s'il a
// toujours le même occupant (création refusée plus loin).
func (s *salon) rendre(n uint8, arrivee uint64, vocal bool, taille int64) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if x := s.sieges[n]; x == nil || x.arrivee != arrivee {
		return
	}
	if vocal {
		s.limites[n].vocal.rendre(taille)
	} else {
		s.limites[n].pieces.rendre()
	}
}

// rendreBudget : taille rendue au budget du salon id (jamais sous 0).
func (m *Manager) rendreBudget(id string, taille int64) error {
	_, err := m.cfg.DB.Exec(`UPDATE salons SET pieces_bytes=max(0,pieces_bytes-?) WHERE id=?`, taille, id)
	return base(err)
}

// placer réserve n octets sous StorageMax (partages, pièces, conversations, réservations en
// cours), vérification et réservation dans une même section (placeMu) : deux créations
// simultanées ne dépassent jamais le plafond d'un palier (relecture Task 12). La réservation
// (Manager.reserves) est comptée par usedBytes jusqu'à ce que le blob.Store compte le fichier.
// Échec fermé : usage illisible → faux. Partages et trames créés en même temps peuvent encore
// le dépasser de leur propre taille (comme Manager.plein, décision du 12 novembre).
func (m *Manager) placer(n int64) bool {
	m.placeMu.Lock()
	defer m.placeMu.Unlock()
	partages, err := m.cfg.UsedPartages()
	if err != nil {
		return false
	}
	u, err := m.usedBytes()
	// Hors de la réserve des nouveaux venus (share.StorageLimit, audit D2).
	if err != nil || partages+u+n > share.StorageLimit(m.cfg.StorageMax, false) {
		return false
	}
	m.reserves.Add(n)
	return true
}

// inscrirePiece range p dans son salon (et l'index des pièces), sauf si le salon est fini, le
// membre parti ou le salon renouvelé entre-temps (ErrNotFound : l'appelant défait tout,
// fichier, ligne et budget).
func (m *Manager) inscrirePiece(s *salon, mb Membre, p *piece) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.membrePieceLocked(mb, m.cfg.Now()); err != nil {
		return err
	}
	if p.gen != s.gen.Load() {
		return ErrNotFound // commencée avant un renouvellement : rien d'avant ne survit
	}
	if s.lesPieces == nil {
		s.lesPieces, s.libres = map[string]*piece{}, map[string]*piece{}
	}
	s.lesPieces[p.id], s.libres[p.id] = p, p
	m.indexer(func(map[[32]byte]*salon) { m.pieceIdx[p.id] = s })
	return nil
}

// salonDePiece : salon de la pièce id (index en mémoire), nil si inconnue.
func (m *Manager) salonDePiece(id string) *salon {
	m.idxMu.Lock()
	defer m.idxMu.Unlock()
	return m.pieceIdx[id]
}

// PieceEnvoi : la pièce id attend encore des segments (connue, ni prête ni effacée, salon
// vivant), en mémoire seulement ; vocal dit si c'est un vocal (hors quotas des envois). Vérifié
// avant de prendre une place de transfert et de lire le corps (audit du 13 novembre, D1).
func (m *Manager) PieceEnvoi(id string) (vocal, ok bool) {
	s := m.salonDePiece(id)
	if s == nil {
		return false, false
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	p := s.lesPieces[id]
	if p == nil || p.efface || p.etat == prete || s.fini || !m.cfg.Now().Before(s.expires) {
		return false, false
	}
	return p.vocal, true
}

// PutSegment écrit le segment n de la pièce id (jeton d'envoi) : taille exacte du palier
// (sinon ErrBadRequest) ; total reçu pour la pièce, réécritures comprises, au plus
// EcritureMax × sa taille (sinon ErrTropEcrit, rien compté). L'écriture se fait hors du
// verrou du salon. Pièce inconnue,
// finalisée ou effacée, auteur parti : ErrNotFound ; auteur révoqué : ErrExcluded ;
// finalisation en cours : ErrBusy.
func (m *Manager) PutSegment(id string, n int, body []byte) error {
	s := m.salonDePiece(id)
	if s == nil {
		return ErrNotFound
	}
	p, err := m.debuterEcriture(s, id, n, len(body))
	if err != nil {
		return err
	}
	err = m.cfg.Pieces.WriteAt(id, share.SegOffset(p.bucket, n), body)
	m.finirEcriture(s, p, n, err == nil)
	if errors.Is(err, fs.ErrNotExist) {
		return ErrNotFound // effacée pendant l'écriture
	}
	return es(err)
}

func (m *Manager) debuterEcriture(s *salon, id string, n, longueur int) (*piece, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	p, err := s.envoiLocked(id, m.cfg.Now())
	if err != nil {
		return nil, err
	}
	if n < 0 || n >= len(p.recus) || longueur != share.SegmentSize(p.bucket, n) {
		return nil, ErrBadRequest
	}
	// Compté avant l'écriture : une écriture qui échoue compte quand même (jamais gratuite).
	if p.ecrit+int64(longueur) > EcritureMax*share.TotalSize(p.bucket) {
		return nil, ErrTropEcrit
	}
	p.ecrit += int64(longueur)
	p.ecritures++
	return p, nil
}

func (m *Manager) finirEcriture(s *salon, p *piece, n int, ok bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	p.ecritures--
	if ok && !p.efface {
		p.recus[n] = true
		p.activite = m.cfg.Now()
	}
}

// FinalizePiece termine l'envoi de la pièce id : tous les segments reçus sauf le bourrage
// [from, to) (share.ValidFill, sinon ErrBadRequest), bourrage d'au plus BourrageFacteur ×
// morceaux reçus + BourrageMarge morceaux (sinon ErrBadRequest, rien écrit : deux segments
// reçus ne font pas écrire 516 Mo d'aléa), bourrage rempli d'aléa (crypto/rand) et
// fichier synchronisé hors du verrou du salon (aucun segment accepté pendant ce temps :
// ErrBusy), puis état « ready ». Rejouée après succès : ErrNotFound.
func (m *Manager) FinalizePiece(id string, from, to int) error {
	s := m.salonDePiece(id)
	if s == nil {
		return ErrNotFound
	}
	p, err := m.debuterFinal(s, id, from, to)
	if err != nil {
		return err
	}
	err = m.finaliser(p, from, to)
	return m.finirFinal(s, p, err)
}

func (m *Manager) debuterFinal(s *salon, id string, from, to int) (*piece, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	p, err := s.envoiLocked(id, m.cfg.Now())
	if err != nil {
		return nil, err
	}
	if p.ecritures > 0 {
		return nil, ErrBusy
	}
	if !share.ValidFill(from, to, len(p.recus)) {
		return nil, ErrBadRequest
	}
	var recus int64 // morceaux des segments reçus (chacun une fois)
	for n, ok := range p.recus {
		if !ok && (n < from || n >= to) {
			return nil, ErrBadRequest // segment manquant hors du bourrage
		}
		if ok {
			recus += int64(min(share.SegChunks, p.bucket-n*share.SegChunks))
		}
	}
	if int64(to-from)*share.SegChunks > BourrageFacteur*recus+BourrageMarge {
		return nil, ErrBadRequest
	}
	p.etat = finalisation
	return p, nil
}

// remplir : écriture d'une tranche du bourrage (variable pour les tests).
var remplir = func(st *blob.Store, id string, off int64, b []byte) error { return st.WriteAt(id, off, b) }

// finaliser : bourrage d'aléa, synchronisation, puis ligne « ready » (hors du verrou du salon).
func (m *Manager) finaliser(p *piece, from, to int) error {
	debut, fin := share.SegOffset(p.bucket, from), share.SegOffset(p.bucket, to)
	if debut < fin {
		buf := make([]byte, min(4<<20, fin-debut))
		for off := debut; off < fin; {
			b := buf[:min(int64(len(buf)), fin-off)]
			rand.Read(b) // ne rend jamais d'erreur (Go ≥ 1.24)
			if err := remplir(m.cfg.Pieces, p.id, off, b); err != nil {
				return err
			}
			off += int64(len(b))
		}
	}
	if err := m.cfg.Pieces.Sync(p.id); err != nil {
		return err
	}
	plein := make([]byte, (len(p.recus)+7)/8)
	for n := range p.recus {
		plein[n/8] |= 1 << (n % 8)
	}
	res, err := m.cfg.DB.Exec(`UPDATE salon_pieces SET state='ready', segments_mask=? WHERE id=? AND state='uploading'`,
		plein, p.id)
	if err != nil {
		return base(err)
	}
	if k, _ := res.RowsAffected(); k != 1 {
		return ErrNotFound
	}
	return nil
}

func (m *Manager) finirFinal(s *salon, p *piece, err error) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if p.efface {
		return ErrNotFound // effacée pendant la finalisation
	}
	if err != nil {
		p.etat = envoi
		if errors.Is(err, fs.ErrNotExist) {
			return ErrNotFound
		}
		if errors.Is(err, ErrNotFound) || errors.Is(err, ErrBase) {
			return err
		}
		return es(err)
	}
	p.etat, p.recus, p.activite = prete, nil, m.cfg.Now()
	return nil
}

// Lecture : segment d'une pièce, lu en flux ; Read échoue dès que la lecture est révoquée
// (pièce effacée, jeton révoqué) ou que le contexte parent est annulé. À fermer.
type Lecture struct {
	sec  *blob.Section
	ctx  context.Context
	fin  func()
	once sync.Once
}

func (l *Lecture) Read(p []byte) (int, error) {
	if l.ctx.Err() != nil {
		return 0, context.Cause(l.ctx)
	}
	return l.sec.Read(p)
}

// Size : taille du segment.
func (l *Lecture) Size() int64 { return l.sec.Size() }

// Context : annulé par une révocation (cause share.ErrRevoked) ou par le parent.
func (l *Lecture) Context() context.Context { return l.ctx }

// Close désinscrit le flux et ferme le fichier (idempotent).
func (l *Lecture) Close() error {
	var err error
	l.once.Do(func() {
		l.fin()
		err = l.sec.Close()
	})
	return err
}

// OuvrirSegment ouvre le segment n de la pièce id pour mb : pièce « ready » de son salon,
// créée (ou liée à une trame) à partir du plancher du jeton (rang de son arrivée), sinon
// ErrNotFound ; n hors du palier : ErrBadRequest ; budget de lecture du jeton pour cette pièce
// (share.ReadBudget) dépassé : ErrBudget. Le flux est inscrit sous "m:" + hex(SHA-256(jeton))
// et "p:" + id (révocation par exclusion ou effacement de la pièce).
func (m *Manager) OuvrirSegment(ctx context.Context, mb Membre, id string, n int) (*Lecture, error) {
	s := mb.salon
	if s == nil {
		return nil, ErrNotFound
	}
	bucket, err := m.lisible(s, mb, id, n)
	if err != nil {
		return nil, err
	}
	taille := int64(share.SegmentSize(bucket, n))
	sec, err := m.cfg.Pieces.Open(id, share.SegOffset(bucket, n), taille)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return nil, ErrNotFound
		}
		return nil, es(err)
	}
	l, err := m.commencerLecture(ctx, s, mb, id, n, sec, taille)
	if err != nil {
		sec.Close()
		return nil, err
	}
	return l, nil
}

// lisibleLocked : pièce id lisible par mb (segment n compris). Appelé sous s.mu.
func (s *salon) lisibleLocked(mb Membre, id string, n int, now time.Time) (*piece, error) {
	if err := s.membrePieceLocked(mb, now); err != nil {
		return nil, err
	}
	p := s.lesPieces[id]
	if p == nil || p.etat != prete {
		return nil, ErrNotFound
	}
	// Plancher (plan, point 11) : rang de la trame liée s'il y en a une, sinon rang de
	// création (décision du 12 novembre). Une pièce envoyée avant l'arrivée du membre mais
	// liée à une trame reçue après est lisible : il lit cette trame, donc la clé de la pièce ;
	// rien d'antérieur à son arrivée ne l'est sans une trame qu'il a reçue.
	ref := p.rang
	if p.lien != 0 {
		ref = p.lien
	}
	if ref < s.sieges[mb.siege].plancher {
		return nil, ErrNotFound
	}
	if n < 0 || n >= share.SegmentCount(p.bucket) {
		return nil, ErrBadRequest
	}
	return p, nil
}

func (m *Manager) lisible(s *salon, mb Membre, id string, n int) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	p, err := s.lisibleLocked(mb, id, n, m.cfg.Now())
	if err != nil {
		return 0, err
	}
	return p.bucket, nil
}

// commencerLecture : revérifie la pièce sous le verrou (effacée pendant l'ouverture du
// fichier : ErrNotFound), compte le budget, inscrit le flux. Sous ce verrou, un effacement
// voit le flux inscrit (et le coupe) ou a déjà retiré la pièce.
func (m *Manager) commencerLecture(ctx context.Context, s *salon, mb Membre, id string, n int, sec *blob.Section,
	taille int64) (*Lecture, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	p, err := s.lisibleLocked(mb, id, n, m.cfg.Now())
	if err != nil {
		return nil, err
	}
	jv := s.sieges[mb.siege].jetonV
	if p.lus[jv]+taille > share.ReadBudget(p.bucket) {
		return nil, ErrBudget
	}
	p.lus[jv] += taille
	ctxM, finM := m.flux.Start(ctx, cleFluxMembre(jv))
	ctxP, finP := m.flux.Start(ctxM, cleFluxPiece(id))
	return &Lecture{sec: sec, ctx: ctxP, fin: func() { finP(); finM() }}, nil
}

// RetirerPiece : la pièce id est effacée par son auteur (auteurDeLocked, sinon ErrForbidden) ;
// inconnue ou déjà effacée : ErrNotFound. Sa trame éventuelle reste (le client la retire).
func (m *Manager) RetirerPiece(mb Membre, id string) error {
	s := mb.salon
	if s == nil {
		return ErrNotFound
	}
	defer m.purger(s)
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.membrePieceLocked(mb, m.cfg.Now()); err != nil {
		return err
	}
	p := s.lesPieces[id]
	if p == nil {
		return ErrNotFound
	}
	if !s.auteurDeLocked(mb, p) {
		return ErrForbidden
	}
	s.supprimerPieceLocked(p)
	return nil
}

// pieceLiableLocked : pièce de la trame que mb envoie (audit D6, décision du 12 novembre).
// Pièce d'un autre auteur (autre siège, ou ancien occupant du siège) : ErrBadRequest (4003).
// Pièce disparue (inconnue, effacée, d'un autre salon), pas encore « ready » ou déjà liée :
// nil sans erreur, la trame est rangée sans lien (course honnête : PieceSansLien, retrait
// depuis un autre onglet, message modifié ; le client affichera « pièce indisponible »).
// Sinon la pièce, à lier. Appelé sous s.mu.
func (s *salon) pieceLiableLocked(mb Membre, id [16]byte) (*piece, error) {
	p := s.lesPieces[b64.EncodeToString(id[:])]
	switch {
	case p == nil:
		return nil, nil
	case !s.auteurDeLocked(mb, p):
		return nil, ErrBadRequest
	case p.etat != prete || p.lien != 0:
		return nil, nil
	}
	return p, nil
}

// lierLocked : p suit désormais la trame de rang seq. Appelé sous s.mu.
func (s *salon) lierLocked(p *piece, seq uint64) {
	p.lien = seq
	if s.pieces == nil {
		s.pieces = map[uint64]*piece{}
	}
	s.pieces[seq] = p
	delete(s.libres, p.id)
}

// supprimerPieceLocked : p n'est plus jamais servie ni liée (maps, lien), ses flux sont
// coupés ; fichier et ligne seront effacés hors du verrou (purger). Sans effet si déjà fait.
// Appelé sous s.mu.
func (s *salon) supprimerPieceLocked(p *piece) {
	if p.efface {
		return
	}
	p.efface = true
	delete(s.lesPieces, p.id)
	delete(s.libres, p.id)
	if p.lien != 0 {
		delete(s.pieces, p.lien)
	}
	if s.flux != nil {
		s.flux.Revoke(cleFluxPiece(p.id))
	}
	s.aPurger = append(s.aPurger, purge{id: p.id, vocal: p.vocal, taille: share.TotalSize(p.bucket), abandon: p.etat != prete})
}

// pieceDeTrameLocked : pièce liée à la trame de rang seq, effacée avec elle (retrait, règle,
// lectures, départs : marquerLocked). Appelé sous s.mu.
func (s *salon) pieceDeTrameLocked(seq uint64) {
	if p := s.pieces[seq]; p != nil {
		s.supprimerPieceLocked(p) // delete(s.pieces, seq) compris (relecture Task 8)
	}
}

// echuesPiecesLocked : pièces non liées échues (PieceSansSegment, PieceSansLien) marquées
// effacées ; rend vrai s'il reste des pièces à purger. Appelé sous s.mu.
func (s *salon) echuesPiecesLocked(now time.Time) bool {
	for _, p := range s.libres {
		switch {
		case p.etat == envoi && p.ecritures == 0 && now.Sub(p.activite) >= PieceSansSegment,
			p.etat == prete && now.Sub(p.activite) >= PieceSansLien:
			s.supprimerPieceLocked(p)
		}
	}
	return len(s.aPurger) > 0
}

// purger efface hors du verrou du salon les pièces marquées (supprimerPieceLocked) : fichier,
// puis ligne et budget rendu (une seule fois : seulement si la ligne existait), puis index et
// quotas (envoi abandonné). Un fichier qui ne s'efface pas garde sa ligne et sera réessayé au
// prochain passage (Tick).
func (m *Manager) purger(s *salon) {
	l := s.prendrePurge()
	var reste []purge
	for _, p := range l {
		if err := m.effacerPiece(s.id, p); err != nil {
			reste = append(reste, p)
			continue
		}
		m.indexer(func(map[[32]byte]*salon) { delete(m.pieceIdx, p.id) })
		if p.abandon && m.cfg.OnAbandon != nil {
			m.cfg.OnAbandon(p.id)
		}
	}
	if len(reste) > 0 {
		s.mu.Lock()
		defer s.mu.Unlock()
		s.aPurger = append(s.aPurger, reste...)
	}
}

func (s *salon) prendrePurge() []purge {
	s.mu.Lock()
	defer s.mu.Unlock()
	l := s.aPurger
	s.aPurger = nil
	return l
}

// effacerPiece : fichier, puis ligne (et budget du salon, pour un fichier) dans une
// transaction.
func (m *Manager) effacerPiece(salonID string, p purge) error {
	if err := m.cfg.Pieces.Delete(p.id); err != nil {
		return es(err)
	}
	tx, err := m.cfg.DB.Begin()
	if err != nil {
		return base(err)
	}
	defer tx.Rollback()
	res, err := tx.Exec(`DELETE FROM salon_pieces WHERE id=?`, p.id)
	if err != nil {
		return base(err)
	}
	if k, _ := res.RowsAffected(); k == 1 && !p.vocal {
		if _, err := tx.Exec(`UPDATE salons SET pieces_bytes=max(0,pieces_bytes-?) WHERE id=?`, p.taille, salonID); err != nil {
			return base(err)
		}
	}
	if err := tx.Commit(); err != nil {
		return base(err)
	}
	m.vidage.Demander() // ligne de pièce effacée : vidage du WAL regroupé (stockage, F1)
	return nil
}
