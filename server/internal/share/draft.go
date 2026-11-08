package share

import (
	"errors"
	"io/fs"
	"time"
)

// Envoi dès l'ajout (spec §41.14, D41-19) : le brouillon est un envoi « uploading » ordinaire,
// dont la réservation grandit par paliers (Grow), dont les segments d'un élément retiré sont
// effacés (Erase), que la page tient en vie (Keep), et que finalizeDraft ramène au palier final.

// draftRow lit le palier et le masque d'un envoi en cours ; ErrNotFound sinon.
func (s *Service) draftRow(id string) (int, []byte, error) {
	if !validID(id) || !s.uploadOpen(id, s.now()) {
		return 0, nil, ErrNotFound
	}
	var bucket int
	var mask []byte
	err := s.DB.QueryRow(`SELECT bucket, segments_mask FROM shares WHERE id=? AND state='uploading'`, id).Scan(&bucket, &mask)
	return bucket, mask, notFound(err)
}

// growMargin : segments réservables au-delà du dernier segment reçu (audit H1) : le client
// agrandit au fil de l'envoi, jamais d'avance pour tout un fichier.
const growMargin = 2

// growLimit : plus grand palier permis par Grow, le plus petit qui contient les segments
// jusqu'au dernier reçu, plus growMargin segments pleins, plus le morceau du manifeste.
func growLimit(mask []byte, segs int) int {
	hi := -1
	for n := 0; n < segs; n++ {
		if mask[n/8]&(1<<(n%8)) != 0 {
			hi = n
		}
	}
	need := (hi+1+growMargin)*SegChunks + 1
	for _, b := range Buckets {
		if b >= need {
			return b
		}
	}
	return Buckets[len(Buckets)-1]
}

// Grow porte la réservation de l'envoi id au palier bucket (strictement plus grand) : place
// vérifiée contre StorageMax comme à la création, fichier agrandi, masque prolongé (segments
// reçus gardés). Refusé pendant un Finalize (ErrBusy).
func (s *Service) Grow(id string, bucket int) error {
	if !validID(id) {
		return ErrNotFound
	}
	if !s.claimFinalize(id) {
		return ErrBusy
	}
	defer s.releaseFinalize(id)
	s.uploadMu.Lock()
	defer s.uploadMu.Unlock()
	old, mask, err := s.draftRow(id)
	if err != nil {
		return err
	}
	if !validBucket(bucket) || bucket <= old || bucket > growLimit(mask, SegmentCount(old)) {
		return ErrBadRequest
	}
	s.createMu.Lock()
	defer s.createMu.Unlock()
	used, err := s.Blobs.UsedBytes()
	if err != nil {
		return err
	}
	if used+s.detachedBytes()+totalSize(bucket)-totalSize(old) > s.StorageMax {
		return ErrFull
	}
	if err := s.Blobs.Resize(id, totalSize(bucket)); err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return ErrNotFound
		}
		return err
	}
	next := make([]byte, (SegmentCount(bucket)+7)/8)
	copy(next, mask)
	// Le dernier segment de l'ancien palier était partiel : son bit ne vaut plus pour un
	// segment plein (le client n'y envoie jamais de données, spec §41.14).
	if last := SegmentCount(old) - 1; old%SegChunks != 0 {
		next[last/8] &^= 1 << (last % 8)
	}
	res, err := s.DB.Exec(`UPDATE shares SET bucket=?, segments_mask=? WHERE id=? AND state='uploading' AND bucket=?`,
		bucket, next, id, old)
	if err != nil {
		return err
	}
	if k, _ := res.RowsAffected(); k != 1 {
		return ErrNotFound
	}
	s.touchUpload(id, s.now())
	return nil
}

// Erase efface les segments [from, to) de l'envoi id (élément retiré) : plage rendue au
// système de fichiers ou mise à zéro, fsync, bits remis à zéro. Sous uploadMu exclusif : une
// écriture de segment en vol se termine avant. Refusé pendant un Finalize (ErrBusy).
func (s *Service) Erase(id string, from, to int) error {
	if !validID(id) {
		return ErrNotFound
	}
	if !s.claimFinalize(id) {
		return ErrBusy
	}
	defer s.releaseFinalize(id)
	s.uploadMu.Lock()
	defer s.uploadMu.Unlock()
	bucket, mask, err := s.draftRow(id)
	if err != nil {
		return err
	}
	segs := SegmentCount(bucket)
	if from < 0 || from >= to || to > segs {
		return ErrBadRequest
	}
	start := segOffset(bucket, from)
	end := segOffset(bucket, to-1) + int64(SegmentSize(bucket, to-1))
	if err := s.Blobs.Erase(id, start, end-start); err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return ErrNotFound
		}
		return err
	}
	next := append([]byte(nil), mask...)
	for n := from; n < to; n++ {
		next[n/8] &^= 1 << (n % 8)
	}
	if _, err := s.DB.Exec(`UPDATE shares SET segments_mask=? WHERE id=? AND state='uploading'`, next, id); err != nil {
		return err
	}
	s.touchUpload(id, s.now())
	return nil
}

// Keep : signe de vie de la page qui compose (spec §41.14) ; l'envoi n'est pas effacé tant
// qu'il en reçoit un toutes les 15 min (stallSweep), jusqu'à l'échéance de 6 h.
func (s *Service) Keep(id string) error {
	if _, _, err := s.draftRow(id); err != nil {
		return err
	}
	s.touchUpload(id, s.now())
	return nil
}

// finalizeDraft termine un brouillon (Finalize avec r.Bucket ≠ 0, claimFinalize déjà pris) :
// segments manquants du palier final remplis d'aléa (trous d'éléments retirés et bourrage),
// puis, sous uploadMu, en-tête et manifeste écrits, fichier ramené au palier final, « ready ».
func (s *Service) finalizeDraft(id string, reserved int, r FinalizeReq) (time.Duration, error) {
	b := r.Bucket
	if b > reserved {
		return 0, ErrBadRequest
	}
	_, mask, err := s.draftRow(id)
	if err != nil {
		return 0, err
	}
	segs := SegmentCount(b)
	for n := 0; n < segs; n++ {
		// Un segment reçu au palier de réservation (≥ b) couvre au moins ses morceaux au palier b.
		if mask[n/8]&(1<<(n%8)) != 0 {
			continue
		}
		off := segOffset(b, n)
		if err := s.fillRange(id, off, off+int64(SegmentSize(b, n))); err != nil {
			if errors.Is(err, fs.ErrNotExist) {
				return 0, ErrNotFound
			}
			return 0, err
		}
	}

	s.uploadMu.Lock()
	defer s.uploadMu.Unlock()
	now := s.now()
	if !s.uploadOpen(id, now) {
		return 0, ErrNotFound
	}
	for _, w := range []struct {
		off int64
		b   []byte
	}{{0, r.Header}, {Header + int64(b-1)*ChunkCT, r.Tail}} {
		if err := s.Blobs.WriteAt(id, w.off, w.b); err != nil {
			if errors.Is(err, fs.ErrNotExist) {
				return 0, ErrNotFound
			}
			return 0, err
		}
	}
	if err := s.Blobs.Resize(id, totalSize(b)); err != nil {
		return 0, err
	}
	exp := ceil15(now + int64(r.TTLHours)*3600)
	var got int64
	err = s.DB.QueryRow(`UPDATE shares SET state='ready', bucket=?, expires_at=?, ttl_hours=NULL,
		max_opens=?, opens_left=?, salt=?, kdf_ops=?, kdf_mem=?, proof_v=?, envelope=?, segments_mask=?
		WHERE id=? AND state='uploading' AND bucket=? RETURNING expires_at`,
		b, exp, r.MaxOpens, r.MaxOpens, r.Salt, r.KdfOps, r.KdfMem, r.ProofV, r.Envelope, fullMask(segs),
		id, reserved).Scan(&got)
	if err != nil {
		return 0, notFound(err)
	}
	s.forget(id)
	return secs(got - now), nil
}

// UploadBucket : palier d'un envoi en cours (quotas de la finalisation) ; ErrNotFound sinon.
func (s *Service) UploadBucket(id string) (int, error) {
	b, _, err := s.draftRow(id)
	return b, err
}
