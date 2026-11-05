// Package share applique les règles de vie d'un partage (spec §4, §7.4–7.7, §9).
//
// Chaque vérification suivie d'une action est une seule requête SQL conditionnelle
// (UPDATE … WHERE … RETURNING) ou une comparaison-échange : le code reste juste
// même avec plusieurs connexions à la base.
package share

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"database/sql"
	"encoding/base64"
	"errors"
	"io/fs"
	"math/bits"
	"os"
	"path/filepath"
	"strconv"
	"sync"
	"time"

	"github.com/skoow/shhdrop/server/internal/blob"
)

var (
	ErrNotFound   = errors.New("partage introuvable")
	ErrBadSegment = errors.New("segment invalide")
	ErrIncomplete = errors.New("envoi incomplet")
	ErrFull       = errors.New("stockage plein")
	ErrFrozen     = errors.New("créations suspendues")
	ErrBadRequest = errors.New("requête invalide")
	// ErrConflict : V_accès ou V_gestion déjà pris (seul qui connaît K_accès ou S_gestion
	// peut le provoquer, spec §29.8), ou id tiré par le serveur déjà pris (128 bits : jamais).
	ErrConflict = errors.New("partage déjà présent")
	// ErrBusy : un autre Finalize du même envoi est en cours (revue K1, I1).
	ErrBusy = errors.New("finalisation déjà en cours")
	// ErrBudget : l'ouverture a déjà lu son budget d'octets (ReadBudget).
	ErrBudget = errors.New("budget de lecture épuisé")
)

// BadPassword : mot de passe faux, avec les essais restants (0 = partage détruit).
type BadPassword struct{ AttemptsLeft int }

func (e *BadPassword) Error() string { return "mot de passe incorrect" }

const (
	maxAttempts  = 5
	uploadWindow = 3 * 3600 // secondes (spec §24 : 3 h, comme le jeton d'envoi)
	purgeWindow  = 3 * 3600 // durée d'un jeton de téléchargement (spec §24 : 3 h)
	// emptySweep : un envoi sans segment est effacé dès upload_deadline − emptySweep (sweepCond).
	emptySweep = uploadWindow - 300
	// stallSweep : un envoi commencé sans nouveau segment depuis 15 min est effacé.
	stallSweep = 900
)

// CreateReq : création v2 (spec §29.8). ID : identifiant interne tiré par le serveur
// (NewID), sans lien avec l'id du client (qui ne sort jamais du navigateur, spec §32) ;
// AccessV, ManageV : SHA-256 de K_accès et de S_gestion, calculés par le serveur depuis les
// secrets reçus. Ni durée, ni ouvertures, ni sel, ni V_preuve à ce stade.
type CreateReq struct {
	ID               string
	Bucket           int
	AccessV, ManageV []byte
}

// FinalizeReq : tout ce qui dépend du mot de passe, la durée, les ouvertures, et le
// bourrage [FillFrom, FillTo) que le serveur remplit d'aléa (spec §29.3, §29.8).
type FinalizeReq struct {
	TTLHours, MaxOpens, KdfOps, KdfMem int
	FillFrom, FillTo                   int
	Salt, ProofV, Envelope             []byte
}

// EnvelopeLen : taille de E (nonce 12 ‖ R chiffrée 32 ‖ tag 16).
const EnvelopeLen = 60

type Meta struct {
	ID                               string // identifiant interne (jetons, fichier)
	ExpiresIn                        time.Duration
	Salt                             []byte
	KdfOps, KdfMem, Bucket, Segments int
}

type Status struct {
	OpensUsed, MaxOpens int
	ExpiresIn           time.Duration
	State               string
}

// Config : dépendances et réglages d'un Service, validés par NewService.
type Config struct {
	DB         *sql.DB
	Blobs      *blob.Store
	Now        func() time.Time
	StorageMax int64  // octets réservables au total ; > 0
	FrozenFile string // chemin absolu du fichier de gel ; obligatoire
	// OnAbandon (facultatif) : appelé quand un envoi est effacé sans avoir été finalisé
	// (quotas d'octets abandonnés, spec §29.5). Ne doit pas bloquer.
	OnAbandon func(id string, bucket int)
}

// NewService valide la configuration : une valeur zéro ne doit jamais désactiver le gel
// en silence ni refuser toutes les créations (audit F10).
func NewService(c Config) (*Service, error) {
	switch {
	case c.DB == nil:
		return nil, errors.New("share : base absente")
	case c.Blobs == nil || c.Blobs.Dir == "":
		return nil, errors.New("share : dossier des fichiers absent")
	case c.Now == nil:
		return nil, errors.New("share : horloge absente")
	case c.StorageMax <= 0:
		return nil, errors.New("share : StorageMax doit être > 0")
	case c.FrozenFile == "" || !filepath.IsAbs(c.FrozenFile):
		return nil, errors.New("share : FrozenFile doit être un chemin absolu")
	}
	return &Service{DB: c.DB, Blobs: c.Blobs, Now: c.Now, StorageMax: c.StorageMax, FrozenFile: c.FrozenFile,
		OnAbandon: c.OnAbandon}, nil
}

// Service : à construire avec NewService.
type Service struct {
	DB         *sql.DB
	Blobs      *blob.Store
	Now        func() time.Time
	StorageMax int64
	FrozenFile string
	OnAbandon  func(id string, bucket int)

	createMu sync.Mutex   // rend atomiques « place libre ? » et la réservation
	uploadMu sync.RWMutex // Finalize attend la fin des écritures de segments en cours
	budget   readBudget   // octets lus par ouverture, en mémoire seulement
	// finalizing : envois dont un Finalize est en cours ; un seul à la fois par id, pour
	// qu'aucun appel concurrent ne réécrive le bourrage (revue K1, I1).
	finalizing struct {
		mu  sync.Mutex
		ids map[string]struct{}
	}
}

func (s *Service) now() int64 { return s.Now().Unix() }

// match compare sha256(x) au vérificateur stocké, en temps constant. Un secret fait
// toujours 32 octets : toute autre longueur (nil compris) est refusée (audit F4).
func match(x, stored []byte) bool {
	if len(x) != 32 {
		return false
	}
	h := sha256.Sum256(x)
	return subtle.ConstantTimeCompare(h[:], stored) == 1
}

// emptyHash : SHA-256 de la chaîne vide, refusé comme vérificateur (audit F4).
var emptyHash = sha256.Sum256(nil)

var b64 = base64.RawURLEncoding.Strict()

// DecodeB64 décode une valeur base64url sans bourrage de n octets, sous forme canonique :
// longueur exacte en caractères et alphabet base64url seulement. Le décodeur de Go
// ignore \r et \n même en mode Strict (audit F3) : ils sont refusés ici avant décodage.
func DecodeB64(s string, n int) ([]byte, error) {
	if len(s) != b64.EncodedLen(n) {
		return nil, ErrBadRequest
	}
	for i := 0; i < len(s); i++ {
		c := s[i]
		if !(c >= 'A' && c <= 'Z' || c >= 'a' && c <= 'z' || c >= '0' && c <= '9' || c == '-' || c == '_') {
			return nil, ErrBadRequest
		}
	}
	b, err := b64.DecodeString(s)
	if err != nil || len(b) != n {
		return nil, ErrBadRequest
	}
	return b, nil
}

// NewID tire un identifiant interne de 128 bits (crypto/rand) : clé de la ligne, nom du
// fichier et sujet des jetons. Il n'est jamais montré dans un chemin ni dérivé d'un secret.
func NewID() string {
	b := make([]byte, 16)
	rand.Read(b) // ne renvoie jamais d'erreur (Go ≥ 1.24 : échec fatal du système)
	return b64.EncodeToString(b)
}

// Verifier : SHA-256 d'un secret de 32 octets (K_accès, S_gestion), clé de recherche de la
// ligne (index uniques, spec §29.8) ; nil pour toute autre longueur (jamais de recherche).
func Verifier(secret []byte) []byte {
	if len(secret) != 32 {
		return nil
	}
	h := sha256.Sum256(secret)
	return h[:]
}

// validID : 22 caractères base64url canoniques (16 octets).
func validID(id string) bool {
	_, err := DecodeB64(id, 16)
	return err == nil
}

// ceil15 arrondit au quart d'heure supérieur : toutes les dates stockées le sont,
// pour ne pas révéler la minute de création ou d'ouverture (spec §9.2).
func ceil15(t int64) int64 { return (t + 899) / 900 * 900 }

// minute : précision de progress_at, qui n'existe que pendant l'envoi (spec §9.1).
func minute(t int64) int64 { return t - t%60 }

func secs(n int64) time.Duration { return time.Duration(n) * time.Second }

func validTTL(h int) bool { return h == 1 || h == 6 || h == 12 || h == 24 }

// Frozen : créations suspendues. Échec fermé : tout autre résultat que « absent » gèle,
// et un FrozenFile vide (Service construit sans NewService) aussi.
func (s *Service) Frozen() bool {
	if s.FrozenFile == "" {
		return true
	}
	_, err := os.Stat(s.FrozenFile)
	return !errors.Is(err, fs.ErrNotExist)
}

// notEmptyHash : un vérificateur égal à SHA-256("") serait satisfait par un secret vide (audit F4).
func notEmptyHash(vs ...[]byte) bool {
	for _, v := range vs {
		if subtle.ConstantTimeCompare(v, emptyHash[:]) == 1 {
			return false
		}
	}
	return true
}

// Validate vérifie les champs d'une création (aussi revérifiés par Create).
func Validate(r CreateReq) error {
	if !validID(r.ID) || !validBucket(r.Bucket) || len(r.AccessV) != 32 || len(r.ManageV) != 32 ||
		!notEmptyHash(r.AccessV, r.ManageV) {
		return ErrBadRequest
	}
	return nil
}

// ValidateFinalize vérifie les champs d'une finalisation qui ne dépendent pas du palier
// (le bourrage est vérifié par Finalize, contre le palier du partage).
func ValidateFinalize(r FinalizeReq) error {
	if !validTTL(r.TTLHours) || r.MaxOpens < 1 || r.MaxOpens > 10 ||
		r.KdfOps < 3 || r.KdfOps > 10 || r.KdfMem < 67108864 || r.KdfMem > 268435456 ||
		len(r.Salt) != 16 || len(r.ProofV) != 32 || len(r.Envelope) != EnvelopeLen || !notEmptyHash(r.ProofV) {
		return ErrBadRequest
	}
	return nil
}

// validFill : bourrage vide [k, k) avec 0 ≤ k ≤ segs − 1, ou [from, to) avec
// 1 ≤ from < to ≤ segs − 1 : jamais le segment 0 (en-tête) ni le dernier (manifeste).
func validFill(from, to, segs int) bool {
	return from >= 0 && from <= to && to <= segs-1 && (from == to || from >= 1)
}

// Create réserve la place du palier et enregistre l'envoi sous r.ID (tiré par NewID, rendu
// tel quel). Un V_accès ou un V_gestion déjà présent (ou un id déjà pris, en base ou sur
// disque) donne ErrConflict, sans toucher au partage existant : sans K_accès ni S_gestion,
// personne ne peut provoquer ce refus (aucun oracle d'existence, revue K1, I2).
func (s *Service) Create(r CreateReq) (string, int, error) {
	if s.Frozen() {
		return "", 0, ErrFrozen
	}
	if err := Validate(r); err != nil {
		return "", 0, err
	}
	id := r.ID
	size := int64(totalSize(r.Bucket))
	segs := SegmentCount(r.Bucket)

	s.createMu.Lock()
	defer s.createMu.Unlock()
	var one int
	switch err := s.DB.QueryRow(`SELECT 1 FROM shares WHERE id=? OR access_v=? OR manage_v=?`,
		id, r.AccessV, r.ManageV).Scan(&one); {
	case err == nil:
		return "", 0, ErrConflict
	case !errors.Is(err, sql.ErrNoRows):
		return "", 0, err
	}
	used, err := s.Blobs.UsedBytes()
	if err != nil {
		return "", 0, err
	}
	if used+size > s.StorageMax {
		return "", 0, ErrFull
	}
	if err := reserveBlob(s.Blobs, id, size); err != nil {
		switch {
		case errors.Is(err, blob.ErrNoAllocate):
			return "", 0, ErrFull // place impossible à garantir : refus, comme un disque plein
		case errors.Is(err, fs.ErrExist):
			return "", 0, ErrConflict // fichier orphelin du même nom : jamais écrasé
		}
		return "", 0, err
	}
	// proof_v, salt, kdf_*, ttl_hours, max_opens et envelope restent NULL jusqu'à Finalize.
	_, err = s.DB.Exec(`INSERT INTO shares(id,state,bucket,opens_left,segments_mask,access_v,manage_v,upload_deadline)
		VALUES(?,'uploading',?,0,?,?,?,?)`,
		id, r.Bucket, make([]byte, (segs+7)/8), r.AccessV, r.ManageV, ceil15(s.now()+uploadWindow))
	if err != nil {
		return "", 0, errors.Join(err, s.Blobs.Delete(id))
	}
	return id, segs, nil
}

// reserveBlob : réservation de la place (variable pour tester la conversion ErrNoAllocate).
var reserveBlob = func(b *blob.Store, id string, size int64) error { return b.Reserve(id, size) }

func (s *Service) PutSegment(id string, n int, body []byte) error {
	if !validID(id) {
		return ErrNotFound
	}
	s.uploadMu.RLock()
	defer s.uploadMu.RUnlock()
	var bucket int
	err := s.DB.QueryRow(`SELECT bucket FROM shares WHERE id=? AND state='uploading' AND upload_deadline>?`,
		id, s.now()).Scan(&bucket)
	if err != nil {
		return notFound(err)
	}
	if n < 0 || n >= SegmentCount(bucket) || len(body) != SegmentSize(bucket, n) {
		return ErrBadSegment
	}
	if err := s.Blobs.WriteAt(id, int64(segOffset(bucket, n)), body); err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return ErrNotFound // détruit pendant l'envoi
		}
		return err
	}
	// Comparaison-échange : deux segments envoyés en parallèle ne s'écrasent pas.
	for {
		var mask []byte
		err := s.DB.QueryRow(`SELECT segments_mask FROM shares WHERE id=? AND state='uploading'`, id).Scan(&mask)
		if err != nil {
			return notFound(err)
		}
		if mask[n/8]&(1<<(n%8)) != 0 {
			// Segment remplacé (reprise) : c'est aussi un progrès.
			_, err := s.DB.Exec(`UPDATE shares SET progress_at=? WHERE id=? AND state='uploading'`, minute(s.now()), id)
			return err
		}
		next := append([]byte(nil), mask...)
		next[n/8] |= 1 << (n % 8)
		res, err := s.DB.Exec(`UPDATE shares SET segments_mask=?, progress_at=? WHERE id=? AND state='uploading' AND segments_mask=?`,
			next, minute(s.now()), id, mask)
		if err != nil {
			return err
		}
		if k, _ := res.RowsAffected(); k == 1 {
			return nil
		}
	}
}

// Finalize termine un envoi (spec §29.4, point 4) : tous les segments hors bourrage
// présents, bourrage rempli d'octets aléatoires (crypto/rand, indiscernables d'un chiffré
// pour qui lit le disque), puis passage en « ready » avec le sel, Argon2id, V_preuve, E,
// la durée et les ouvertures. Le bourrage est écrit hors du verrou global (jusqu'à 1 Gio) ;
// le changement d'état revérifie les segments sous uploadMu. Rejoué après succès : 404.
func (s *Service) Finalize(id string, r FinalizeReq) (time.Duration, error) {
	if !validID(id) {
		return 0, ErrNotFound
	}
	if err := ValidateFinalize(r); err != nil {
		return 0, err
	}
	if !s.claimFinalize(id) {
		return 0, ErrBusy // aucune lecture ni écriture : réponse immédiate
	}
	defer s.releaseFinalize(id)
	var bucket int
	var mask []byte
	err := s.DB.QueryRow(`SELECT bucket, segments_mask FROM shares WHERE id=? AND state='uploading' AND upload_deadline>?`,
		id, s.now()).Scan(&bucket, &mask)
	if err != nil {
		return 0, notFound(err)
	}
	segs := SegmentCount(bucket)
	if !validFill(r.FillFrom, r.FillTo, segs) {
		return 0, ErrBadRequest
	}
	if !hasAllBut(mask, segs, r.FillFrom, r.FillTo) {
		return 0, ErrIncomplete
	}
	if err := s.fillRandom(id, bucket, r.FillFrom, r.FillTo); err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return 0, ErrNotFound // effacé pendant le remplissage
		}
		return 0, err
	}

	s.uploadMu.Lock() // plus aucune écriture de segment en vol
	defer s.uploadMu.Unlock()
	now := s.now()
	err = s.DB.QueryRow(`SELECT segments_mask FROM shares WHERE id=? AND state='uploading' AND upload_deadline>?`,
		id, now).Scan(&mask)
	if err != nil {
		return 0, notFound(err)
	}
	if !hasAllBut(mask, segs, r.FillFrom, r.FillTo) {
		return 0, ErrIncomplete
	}
	exp := ceil15(now + int64(r.TTLHours)*3600)
	// segments_mask passe à « tous reçus » : la base ne garde pas la frontière du bourrage,
	// qui donnerait la taille du contenu à 4 Mio près (revue K1, I3).
	// upload_deadline et progress_at effacés : ils trahiraient la date de l'envoi (spec §9.1).
	var got int64
	err = s.DB.QueryRow(`UPDATE shares SET state='ready', expires_at=?, upload_deadline=NULL, progress_at=NULL,
		ttl_hours=?, max_opens=?, opens_left=?, salt=?, kdf_ops=?, kdf_mem=?, proof_v=?, envelope=?, segments_mask=?
		WHERE id=? AND state='uploading' AND upload_deadline>? AND segments_mask=? RETURNING expires_at`,
		exp, r.TTLHours, r.MaxOpens, r.MaxOpens, r.Salt, r.KdfOps, r.KdfMem, r.ProofV, r.Envelope, fullMask(segs),
		id, now, mask).Scan(&got)
	if err != nil {
		return 0, notFound(err)
	}
	return secs(got - now), nil
}

// hasAllBut : tous les segments de [0, segs) sont reçus, sauf peut-être ceux de [from, to).
func hasAllBut(mask []byte, segs, from, to int) bool {
	if len(mask) != (segs+7)/8 {
		return false
	}
	for n := 0; n < segs; n++ {
		if (n < from || n >= to) && mask[n/8]&(1<<(n%8)) == 0 {
			return false
		}
	}
	return true
}

// claimFinalize réserve l'id pour un seul Finalize à la fois ; faux s'il est déjà pris.
func (s *Service) claimFinalize(id string) bool {
	s.finalizing.mu.Lock()
	defer s.finalizing.mu.Unlock()
	if s.finalizing.ids == nil {
		s.finalizing.ids = map[string]struct{}{}
	}
	if _, busy := s.finalizing.ids[id]; busy {
		return false
	}
	s.finalizing.ids[id] = struct{}{}
	return true
}

func (s *Service) releaseFinalize(id string) {
	s.finalizing.mu.Lock()
	delete(s.finalizing.ids, id)
	s.finalizing.mu.Unlock()
}

// fullMask : tous les segments marqués reçus.
func fullMask(segs int) []byte {
	m := make([]byte, (segs+7)/8)
	for i := 0; i < segs; i++ {
		m[i/8] |= 1 << (i % 8)
	}
	return m
}

// fillWrite : écriture d'une tranche du bourrage (variable pour compter les écritures en test).
var fillWrite = func(s *Service, id string, off int64, b []byte) error { return s.Blobs.WriteAt(id, off, b) }

// fillChunk : taille des écritures du bourrage (un seul tampon, réutilisé).
const fillChunk = 4 << 20

// fillRandom écrit des octets de crypto/rand dans les segments [from, to).
func (s *Service) fillRandom(id string, bucket, from, to int) error {
	if from >= to {
		return nil
	}
	start := int64(segOffset(bucket, from))
	end := int64(segOffset(bucket, to))
	buf := make([]byte, fillChunk)
	for off := start; off < end; {
		n := min(int64(len(buf)), end-off)
		b := buf[:n]
		if _, err := rand.Read(b); err != nil {
			return err
		}
		if err := fillWrite(s, id, off, b); err != nil {
			return err
		}
		off += n
	}
	return nil
}

// Meta trouve le partage par V_accès = SHA-256(K_accès) (index unique) : sans K_accès,
// aucune requête ne désigne un partage (spec §29.8).
func (s *Service) Meta(kAcces []byte) (Meta, error) {
	v := Verifier(kAcces)
	if v == nil {
		return Meta{}, ErrNotFound
	}
	now := s.now()
	var m Meta
	var exp int64
	err := s.DB.QueryRow(`SELECT id, expires_at, salt, kdf_ops, kdf_mem, bucket FROM shares
		WHERE access_v=? AND state='ready' AND expires_at>? AND failed_attempts<?`, v, now, maxAttempts).
		Scan(&m.ID, &exp, &m.Salt, &m.KdfOps, &m.KdfMem, &m.Bucket)
	if err != nil {
		return Meta{}, notFound(err)
	}
	m.ExpiresIn = secs(exp - now)
	m.Segments = SegmentCount(m.Bucket)
	return m, nil
}

// Unlock (id rendu par Meta) vérifie K_accès puis K_preuve ; juste : consomme une ouverture et rend son
// numéro avec l'enveloppe E (spec §29.8), seulement en « ready » (proof_v et envelope ne
// sont posés que par Finalize).
func (s *Service) Unlock(id string, kAcces, kPreuve []byte) (int, []byte, error) {
	if !validID(id) {
		return 0, nil, ErrNotFound
	}
	now := s.now()
	var accessV, proofV, envelope []byte
	err := s.DB.QueryRow(`SELECT access_v, proof_v, envelope FROM shares WHERE id=? AND state='ready' AND expires_at>?
		AND proof_v IS NOT NULL AND envelope IS NOT NULL`, id, now).Scan(&accessV, &proofV, &envelope)
	if err != nil {
		return 0, nil, notFound(err)
	}
	if !match(kAcces, accessV) {
		return 0, nil, ErrNotFound // ne compte pas comme essai
	}
	if match(kPreuve, proofV) {
		var openN int
		err := s.DB.QueryRow(`UPDATE shares SET opens_left=opens_left-1, opens_issued=opens_issued+1,
			state=CASE WHEN opens_left-1=0 THEN 'draining' ELSE state END,
			purge_at=CASE WHEN opens_left-1=0 THEN min(?, expires_at) ELSE purge_at END
			WHERE id=? AND state='ready' AND opens_left>0 AND expires_at>? AND failed_attempts<?
			RETURNING opens_issued`, ceil15(now+purgeWindow), id, now, maxAttempts).Scan(&openN)
		if err != nil {
			return 0, nil, notFound(err)
		}
		return openN, envelope, nil
	}
	left, err := s.countFailure(id)
	if err != nil {
		return 0, nil, err
	}
	return 0, nil, &BadPassword{AttemptsLeft: left}
}

// countFailure compte un mauvais K_preuve (Unlock et Destroy partagent le compteur)
// et détruit au 5ᵉ. Renvoie les essais restants.
func (s *Service) countFailure(id string) (int, error) {
	var failed int
	err := s.DB.QueryRow(`UPDATE shares SET failed_attempts=failed_attempts+1
		WHERE id=? AND failed_attempts<? RETURNING failed_attempts`, id, maxAttempts).Scan(&failed)
	if err != nil {
		return 0, notFound(err)
	}
	if failed >= maxAttempts {
		// En cas d'échec, Sweep réessaie (failed_attempts>=5) ; le partage est déjà inaccessible.
		if _, err := s.destroy(id); err != nil {
			return 0, err
		}
	}
	return maxAttempts - failed, nil
}

// OpenSegment ouvre un segment en lecture en flux pour l'ouverture openN (venue d'un jeton
// signé) : elle doit avoir été émise et ne pas être terminée (done), sinon ErrNotFound.
// Seul un partage « ready » ou « draining » est lisible : Finalize attend la fin de toute
// écriture (uploadMu) avant de quitter « uploading », et PutSegment n'écrit plus ensuite,
// donc aucun segment en cours d'écriture n'est jamais servi. Chaque ouverture a un budget
// de lecture (ReadBudget) ; au-delà, ErrBudget. L'appelant ferme la section.
func (s *Service) OpenSegment(id string, n, openN int) (*blob.Section, error) {
	if !validID(id) || openN < 1 || openN > 10 {
		return nil, ErrNotFound
	}
	now := s.now()
	var bucket int
	err := s.DB.QueryRow(`SELECT bucket FROM shares WHERE id=? AND expires_at>? AND failed_attempts<? AND
		(state='ready' OR (state='draining' AND purge_at>?)) AND ?<=opens_issued AND (done_mask & ?)=0`,
		id, now, maxAttempts, now, openN, int64(1)<<(openN-1)).Scan(&bucket)
	if err != nil {
		return nil, notFound(err)
	}
	if n < 0 || n >= SegmentCount(bucket) {
		return nil, ErrBadSegment
	}
	size := int64(SegmentSize(bucket, n))
	sec, err := s.Blobs.Open(id, int64(segOffset(bucket, n)), size)
	if errors.Is(err, fs.ErrNotExist) {
		return nil, ErrNotFound // détruit entre-temps
	}
	if err != nil {
		return nil, err
	}
	// Compté après l'ouverture réussie : une erreur du serveur ne consomme pas le budget.
	if !s.budget.charge(openKey{id, openN}, size, ReadBudget(bucket), now) {
		sec.Close()
		return nil, ErrBudget
	}
	return sec, nil
}

func (s *Service) Done(id string, openN int) error {
	if !validID(id) || openN < 1 || openN > 10 {
		return ErrNotFound
	}
	var state string
	var mask int64
	var issued int
	err := s.DB.QueryRow(`UPDATE shares SET done_mask = done_mask | ?
		WHERE id=? AND ? <= opens_issued RETURNING state, done_mask, opens_issued`,
		int64(1)<<(openN-1), id, openN).Scan(&state, &mask, &issued)
	if err != nil {
		return notFound(err)
	}
	// En « draining », opens_issued est figé et done_mask ne fait que croître : sûr.
	if state == "draining" && bits.OnesCount64(uint64(mask)) == issued {
		_, err := s.destroy(id)
		return err
	}
	return nil
}

// alive : condition de vie commune à la destruction et au statut. Un partage expiré (ou un
// envoi échu) est introuvable, et aucun essai n'y est compté ; Sweep l'effacera.
const alive = `((state='uploading' AND upload_deadline>?1) OR (state<>'uploading' AND expires_at>?1))`

// DestroyWithProof : destruction par le destinataire (K_accès et K_preuve). Partage
// trouvé par V_accès ; K_preuve faux = un essai de mot de passe (compteur commun avec Unlock).
func (s *Service) DestroyWithProof(kAcces, kPreuve []byte) error {
	v := Verifier(kAcces)
	if v == nil {
		return ErrNotFound
	}
	var id string
	var proofV []byte
	err := s.DB.QueryRow(`SELECT id, proof_v FROM shares WHERE access_v=?2 AND `+alive, s.now(), v).Scan(&id, &proofV)
	if err != nil {
		return notFound(err)
	}
	if match(kPreuve, proofV) { // proof_v NULL (envoi en cours) : jamais juste
		return s.destroyOrNotFound(id)
	}
	if _, err := s.countFailure(id); err != nil && !errors.Is(err, ErrNotFound) {
		return err
	}
	return ErrNotFound
}

// DestroyManaged : destruction par l'expéditeur (S_gestion), partage trouvé par V_gestion.
func (s *Service) DestroyManaged(sGestion []byte) error {
	id, err := s.managed(sGestion)
	if err != nil {
		return err
	}
	return s.destroyOrNotFound(id)
}

// managed : id du partage vivant dont V_gestion = SHA-256(sGestion).
func (s *Service) managed(sGestion []byte) (string, error) {
	v := Verifier(sGestion)
	if v == nil {
		return "", ErrNotFound
	}
	var id string
	err := s.DB.QueryRow(`SELECT id FROM shares WHERE manage_v=?2 AND `+alive, s.now(), v).Scan(&id)
	return id, notFound(err)
}

// Status : compteurs, échéance et état, partage trouvé par V_gestion (spec §32).
func (s *Service) Status(sGestion []byte) (Status, error) {
	v := Verifier(sGestion)
	if v == nil {
		return Status{}, ErrNotFound
	}
	now := s.now()
	var st Status
	var left int
	var exp, maxOpens sql.NullInt64
	err := s.DB.QueryRow(`SELECT max_opens, opens_left, expires_at, state FROM shares WHERE manage_v=?2 AND `+alive,
		now, v).Scan(&maxOpens, &left, &exp, &st.State)
	if err != nil {
		return Status{}, notFound(err)
	}
	if maxOpens.Valid { // NULL pendant l'envoi : 0 / 0
		st.MaxOpens = int(maxOpens.Int64)
		st.OpensUsed = st.MaxOpens - left
	}
	if exp.Valid {
		st.ExpiresIn = secs(exp.Int64 - now)
	}
	return st, nil
}

// DestroyAdmin : destruction par l'administrateur, à partir de K_accès (dérivée du lien
// signalé par la commande d'administration), quel que soit l'état du partage.
func (s *Service) DestroyAdmin(kAcces []byte) error {
	v := Verifier(kAcces)
	if v == nil {
		return ErrNotFound
	}
	var id string
	if err := s.DB.QueryRow(`SELECT id FROM shares WHERE access_v=?`, v).Scan(&id); err != nil {
		return notFound(err)
	}
	return s.destroyOrNotFound(id)
}

// sweepCond : partages à effacer. Ne dépend que du temps et de failed_attempts,
// qui ne peuvent pas redevenir faux, sauf « uploading » qu'un Finalize ou un
// PutSegment (masque non vide) peut changer : sweepOne revérifie sous uploadMu.
// Envoi vide (aucun segment reçu) : effacé dès upload_deadline − 2 h 55 (10 500 s), soit
// 5 à 20 min après la création selon l'arrondi au quart d'heure : une réservation vide
// ne bloque pas l'espace pendant trois heures. La date de création n'étant pas stockée,
// on la déduit de l'échéance ; rien de plus n'est enregistré.
// Envoi bloqué : commencé, mais aucun segment reçu depuis 15 min (progress_at, à la minute,
// NULL hors envoi) : effacé sans attendre l'échéance de 3 h.
// Paramètres numérotés : ?1 = maintenant, ?2 = maxAttempts.
var sweepCond = `((state IN ('ready','draining') AND expires_at<=?1) OR
	(state='uploading' AND upload_deadline<=?1) OR
	(state='uploading' AND upload_deadline-` + strconv.Itoa(emptySweep) + `<=?1 AND segments_mask=zeroblob(length(segments_mask))) OR
	(state='uploading' AND progress_at IS NOT NULL AND progress_at+` + strconv.Itoa(stallSweep) + `<=?1) OR
	(state='draining' AND purge_at<=?1) OR failed_attempts>=?2)`

// Sweep efface les partages expirés, les envois abandonnés, les « draining » échus
// et les destructions au 5ᵉ essai restées inachevées. Continue malgré les erreurs.
func (s *Service) Sweep() (int, error) {
	now := s.now()
	rows, err := s.DB.Query(`SELECT id FROM shares WHERE `+sweepCond, now, maxAttempts)
	if err != nil {
		return 0, err
	}
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return 0, err
		}
		ids = append(ids, id)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return 0, err
	}
	removed := 0
	var errs []error
	for _, id := range ids {
		ok, err := s.sweepOne(id, now)
		if err != nil {
			errs = append(errs, err)
		} else if ok {
			removed++
		}
	}
	return removed, errors.Join(errs...)
}

// sweepOne revérifie la condition sous uploadMu : aucun Finalize ne peut
// s'intercaler entre la vérification et l'effacement (fichier, puis ligne).
func (s *Service) sweepOne(id string, now int64) (bool, error) {
	s.uploadMu.Lock()
	defer s.uploadMu.Unlock()
	var one int
	err := s.DB.QueryRow(`SELECT 1 FROM shares WHERE id=?3 AND `+sweepCond, now, maxAttempts, id).Scan(&one)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return s.destroy(id)
}

// destroy efface le fichier d'abord, puis la ligne ; renvoie si une ligne existait. Un
// envoi effacé avant Finalize est signalé à OnAbandon (octets abandonnés, spec §29.5).
func (s *Service) destroy(id string) (bool, error) {
	if err := s.Blobs.Delete(id); err != nil {
		return false, err
	}
	var state string
	var bucket int
	err := s.DB.QueryRow(`DELETE FROM shares WHERE id=? RETURNING state, bucket`, id).Scan(&state, &bucket)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if state == "uploading" && s.OnAbandon != nil {
		s.OnAbandon(id, bucket)
	}
	return true, nil
}

func (s *Service) destroyOrNotFound(id string) error {
	ok, err := s.destroy(id)
	if err == nil && !ok {
		return ErrNotFound
	}
	return err
}

func notFound(err error) error {
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	}
	return err
}
