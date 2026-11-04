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
)

// BadPassword : mot de passe faux, avec les essais restants (0 = partage détruit).
type BadPassword struct{ AttemptsLeft int }

func (e *BadPassword) Error() string { return "mot de passe incorrect" }

const (
	maxAttempts  = 5
	uploadWindow = 3600 // secondes
	purgeWindow  = 3600 // durée d'un jeton de téléchargement
)

type CreateReq struct {
	Bucket, TTLHours, MaxOpens, KdfOps, KdfMem int
	Salt, AccessV, ProofV, ManageV             []byte
}

type Meta struct {
	ExpiresIn                        time.Duration
	Salt                             []byte
	KdfOps, KdfMem, Bucket, Segments int
}

type Status struct {
	OpensUsed, MaxOpens int
	ExpiresIn           time.Duration
	State               string
}

type Service struct {
	DB         *sql.DB
	Blobs      *blob.Store
	Now        func() time.Time
	StorageMax int64
	FrozenFile string

	createMu sync.Mutex   // rend atomiques « place libre ? » et la réservation
	uploadMu sync.RWMutex // Finalize attend la fin des écritures de segments en cours
}

func (s *Service) now() int64 { return s.Now().Unix() }

// match compare sha256(x) au vérificateur stocké, en temps constant.
func match(x, stored []byte) bool {
	h := sha256.Sum256(x)
	return subtle.ConstantTimeCompare(h[:], stored) == 1
}

// validID : 22 caractères base64url (16 octets).
func validID(id string) bool {
	b, err := base64.RawURLEncoding.Strict().DecodeString(id)
	return err == nil && len(b) == 16
}

func ceil15(t int64) int64 { return (t + 899) / 900 * 900 }

func secs(n int64) time.Duration { return time.Duration(n) * time.Second }

func validTTL(h int) bool { return h == 1 || h == 6 || h == 12 || h == 24 }

func (s *Service) Create(r CreateReq) (string, int, error) {
	if s.FrozenFile != "" {
		// Échec fermé : tout autre résultat que « absent » gèle les créations.
		if _, err := os.Stat(s.FrozenFile); !errors.Is(err, fs.ErrNotExist) {
			return "", 0, ErrFrozen
		}
	}
	if !validBucket(r.Bucket) || !validTTL(r.TTLHours) || r.MaxOpens < 1 || r.MaxOpens > 10 ||
		r.KdfOps < 3 || r.KdfOps > 10 || r.KdfMem < 67108864 || r.KdfMem > 268435456 ||
		len(r.Salt) != 16 || len(r.AccessV) != 32 || len(r.ProofV) != 32 || len(r.ManageV) != 32 {
		return "", 0, ErrBadRequest
	}
	raw := make([]byte, 16)
	if _, err := rand.Read(raw); err != nil {
		return "", 0, err
	}
	id := base64.RawURLEncoding.EncodeToString(raw)
	size := int64(totalSize(r.Bucket))
	segs := SegmentCount(r.Bucket)

	s.createMu.Lock()
	defer s.createMu.Unlock()
	used, err := s.Blobs.UsedBytes()
	if err != nil {
		return "", 0, err
	}
	if used+size > s.StorageMax {
		return "", 0, ErrFull
	}
	if err := s.Blobs.Reserve(id, size); err != nil {
		return "", 0, err
	}
	_, err = s.DB.Exec(`INSERT INTO shares(id,state,bucket,ttl_hours,max_opens,opens_left,segments_mask,
		salt,kdf_ops,kdf_mem,access_v,proof_v,manage_v,upload_deadline)
		VALUES(?,'uploading',?,?,?,?,?,?,?,?,?,?,?,?)`,
		id, r.Bucket, r.TTLHours, r.MaxOpens, r.MaxOpens, make([]byte, (segs+7)/8),
		r.Salt, r.KdfOps, r.KdfMem, r.AccessV, r.ProofV, r.ManageV, s.now()+uploadWindow)
	if err != nil {
		s.Blobs.Delete(id)
		return "", 0, err
	}
	return id, segs, nil
}

func fullMask(segs int) []byte {
	m := make([]byte, (segs+7)/8)
	for i := 0; i < segs; i++ {
		m[i/8] |= 1 << (i % 8)
	}
	return m
}

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
			return nil
		}
		next := append([]byte(nil), mask...)
		next[n/8] |= 1 << (n % 8)
		res, err := s.DB.Exec(`UPDATE shares SET segments_mask=? WHERE id=? AND state='uploading' AND segments_mask=?`,
			next, id, mask)
		if err != nil {
			return err
		}
		if k, _ := res.RowsAffected(); k == 1 {
			return nil
		}
	}
}

func (s *Service) Finalize(id string) (time.Duration, error) {
	if !validID(id) {
		return 0, ErrNotFound
	}
	s.uploadMu.Lock() // plus aucune écriture de segment en vol
	defer s.uploadMu.Unlock()
	now := s.now()
	var bucket, ttl int
	var mask []byte
	err := s.DB.QueryRow(`SELECT bucket, ttl_hours, segments_mask FROM shares
		WHERE id=? AND state='uploading' AND upload_deadline>?`, id, now).Scan(&bucket, &ttl, &mask)
	if err != nil {
		return 0, notFound(err)
	}
	full := fullMask(SegmentCount(bucket))
	if subtle.ConstantTimeCompare(mask, full) != 1 {
		return 0, ErrIncomplete
	}
	exp := ceil15(now + int64(ttl)*3600)
	// upload_deadline effacé : il trahirait la date de création (spec §9.1).
	var got int64
	err = s.DB.QueryRow(`UPDATE shares SET state='ready', expires_at=?, upload_deadline=NULL
		WHERE id=? AND state='uploading' AND upload_deadline>? AND segments_mask=? RETURNING expires_at`,
		exp, id, now, full).Scan(&got)
	if err != nil {
		return 0, notFound(err)
	}
	return secs(got - now), nil
}

func (s *Service) Meta(id string, kAcces []byte) (Meta, error) {
	if !validID(id) {
		return Meta{}, ErrNotFound
	}
	now := s.now()
	var m Meta
	var exp int64
	var accessV []byte
	err := s.DB.QueryRow(`SELECT expires_at, salt, kdf_ops, kdf_mem, bucket, access_v FROM shares
		WHERE id=? AND state='ready' AND expires_at>?`, id, now).
		Scan(&exp, &m.Salt, &m.KdfOps, &m.KdfMem, &m.Bucket, &accessV)
	if err != nil {
		return Meta{}, notFound(err)
	}
	if !match(kAcces, accessV) {
		return Meta{}, ErrNotFound
	}
	m.ExpiresIn = secs(exp - now)
	m.Segments = SegmentCount(m.Bucket)
	return m, nil
}

func (s *Service) Unlock(id string, kAcces, kPreuve []byte) (int, error) {
	if !validID(id) {
		return 0, ErrNotFound
	}
	now := s.now()
	var accessV, proofV []byte
	err := s.DB.QueryRow(`SELECT access_v, proof_v FROM shares WHERE id=? AND state='ready' AND expires_at>?`,
		id, now).Scan(&accessV, &proofV)
	if err != nil {
		return 0, notFound(err)
	}
	if !match(kAcces, accessV) {
		return 0, ErrNotFound // ne compte pas comme essai
	}
	if match(kPreuve, proofV) {
		var openN int
		err := s.DB.QueryRow(`UPDATE shares SET opens_left=opens_left-1, opens_issued=opens_issued+1,
			state=CASE WHEN opens_left-1=0 THEN 'draining' ELSE state END,
			purge_at=CASE WHEN opens_left-1=0 THEN min(?, expires_at) ELSE purge_at END
			WHERE id=? AND state='ready' AND opens_left>0 AND expires_at>? AND failed_attempts<?
			RETURNING opens_issued`, now+purgeWindow, id, now, maxAttempts).Scan(&openN)
		if err != nil {
			return 0, notFound(err)
		}
		return openN, nil
	}
	var failed int
	err = s.DB.QueryRow(`UPDATE shares SET failed_attempts=failed_attempts+1
		WHERE id=? AND state='ready' AND expires_at>? AND failed_attempts<?
		RETURNING failed_attempts`, id, now, maxAttempts).Scan(&failed)
	if err != nil {
		return 0, notFound(err)
	}
	if failed >= maxAttempts {
		if _, err := s.destroy(id); err != nil {
			return 0, err
		}
	}
	return 0, &BadPassword{AttemptsLeft: maxAttempts - failed}
}

func (s *Service) ReadSegment(id string, n int) ([]byte, error) {
	if !validID(id) {
		return nil, ErrNotFound
	}
	now := s.now()
	var bucket int
	err := s.DB.QueryRow(`SELECT bucket FROM shares WHERE id=? AND expires_at>? AND
		(state='ready' OR (state='draining' AND purge_at>?))`, id, now, now).Scan(&bucket)
	if err != nil {
		return nil, notFound(err)
	}
	if n < 0 || n >= SegmentCount(bucket) {
		return nil, ErrBadSegment
	}
	b, err := s.Blobs.ReadAt(id, int64(segOffset(bucket, n)), SegmentSize(bucket, n))
	if errors.Is(err, fs.ErrNotExist) {
		return nil, ErrNotFound // détruit entre-temps
	}
	return b, err
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

func (s *Service) Destroy(id string, kAcces, kPreuve, sGestion []byte) error {
	if !validID(id) {
		return ErrNotFound
	}
	var accessV, proofV, manageV []byte
	err := s.DB.QueryRow(`SELECT access_v, proof_v, manage_v FROM shares WHERE id=?`, id).
		Scan(&accessV, &proofV, &manageV)
	if err != nil {
		return notFound(err)
	}
	// Les trois comparaisons sont toujours faites (pas de court-circuit).
	a, p, g := match(kAcces, accessV), match(kPreuve, proofV), match(sGestion, manageV)
	if !(a && p || g) {
		return ErrNotFound
	}
	return s.destroyOrNotFound(id)
}

func (s *Service) Status(id string, sGestion []byte) (Status, error) {
	if !validID(id) {
		return Status{}, ErrNotFound
	}
	now := s.now()
	var st Status
	var left int
	var exp sql.NullInt64
	var manageV []byte
	err := s.DB.QueryRow(`SELECT max_opens, opens_left, expires_at, state, manage_v FROM shares
		WHERE id=? AND ((state='uploading' AND upload_deadline>?) OR (state<>'uploading' AND expires_at>?))`,
		id, now, now).Scan(&st.MaxOpens, &left, &exp, &st.State, &manageV)
	if err != nil {
		return Status{}, notFound(err)
	}
	if !match(sGestion, manageV) {
		return Status{}, ErrNotFound
	}
	st.OpensUsed = st.MaxOpens - left
	if exp.Valid {
		st.ExpiresIn = secs(exp.Int64 - now)
	}
	return st, nil
}

func (s *Service) DestroyAdmin(id string) error {
	if !validID(id) {
		return ErrNotFound
	}
	return s.destroyOrNotFound(id)
}

// Sweep efface les partages expirés, les envois abandonnés et les « draining » échus.
// Ces conditions ne dépendent que du temps et ne peuvent pas redevenir fausses.
func (s *Service) Sweep() (int, error) {
	now := s.now()
	rows, err := s.DB.Query(`SELECT id FROM shares WHERE
		(state IN ('ready','draining') AND expires_at<=?) OR
		(state='uploading' AND upload_deadline<=?) OR
		(state='draining' AND purge_at<=?)`, now, now, now)
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
	for _, id := range ids {
		ok, err := s.destroy(id)
		if err != nil {
			return removed, err
		}
		if ok {
			removed++
		}
	}
	return removed, nil
}

// destroy efface le fichier d'abord, puis la ligne ; renvoie si une ligne existait.
func (s *Service) destroy(id string) (bool, error) {
	if err := s.Blobs.Delete(id); err != nil {
		return false, err
	}
	res, err := s.DB.Exec(`DELETE FROM shares WHERE id=?`, id)
	if err != nil {
		return false, err
	}
	k, err := res.RowsAffected()
	return k == 1, err
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
