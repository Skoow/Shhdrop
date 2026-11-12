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

// chunksIn : morceaux du segment n au palier bucket (64, sauf le dernier segment du palier).
func chunksIn(bucket, n int) int { return min(SegChunks, bucket-n*SegChunks) }

// chunkOffset : position du morceau c du segment n (après l'en-tête au segment 0).
func chunkOffset(bucket, n, c int) int64 {
	off := segOffset(bucket, n) + int64(c)*ChunkCT
	if n == 0 {
		off += Header
	}
	return off
}

// PutChunks écrit les morceaux [from, from+k) du segment n d'un brouillon (audit H-2) :
// petits éléments empaquetés dans un segment partagé, et fin d'un grand élément, envoyés sans
// bourrage. Au segment 0, une plage qui part du morceau 0 commence par les 48 octets de
// l'en-tête (zéros, réécrits à finalize). Les morceaux reçus sont notés en mémoire ; un
// segment complet compte comme reçu (masque), le reste est rempli d'aléa à finalize.
func (s *Service) PutChunks(id string, n, from int, body []byte) error {
	if !validID(id) {
		return ErrNotFound
	}
	mu := s.uploadLock(id)
	mu.RLock()
	defer mu.RUnlock()
	if s.sealed(id) {
		return ErrBusy // finalisation en cours (audit F6)
	}
	bucket, _, err := s.draftRow(id)
	if err != nil {
		return err
	}
	if n < 0 || n >= SegmentCount(bucket) || from < 0 || from >= SegChunks {
		return ErrBadSegment
	}
	pre := 0
	if n == 0 && from == 0 {
		pre = Header
	}
	k := (len(body) - pre) / ChunkCT
	chunks := chunksIn(bucket, n)
	if len(body)-pre <= 0 || (len(body)-pre)%ChunkCT != 0 || from+k > chunks {
		return ErrBadSegment
	}
	start := chunkOffset(bucket, n, from) - int64(pre)
	if err := s.Blobs.WriteAt(id, start, body); err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return ErrNotFound // détruit pendant l'envoi
		}
		return err
	}
	s.noteReceived(id, n, k)
	all := ^uint64(0) >> (SegChunks - chunks)
	bits := (^uint64(0) >> (SegChunks - k)) << from
	s.mem.mu.Lock()
	if s.mem.part == nil {
		s.mem.part = map[string]map[int]uint64{}
	}
	p := s.mem.part[id]
	if p == nil {
		p = map[int]uint64{}
		s.mem.part[id] = p
	}
	p[n] |= bits
	full := p[n]&all == all
	if full {
		delete(p, n)
	}
	s.mem.mu.Unlock()
	if full {
		return s.markReceived(id, n)
	}
	s.touchUpload(id, s.now())
	return nil
}

// clearPart oublie les morceaux reçus en partie des segments [from, to).
func (s *Service) clearPart(id string, from, to int) {
	s.mem.mu.Lock()
	defer s.mem.mu.Unlock()
	if p := s.mem.part[id]; p != nil {
		for n := from; n < to; n++ {
			delete(p, n)
		}
	}
}

// partOf : copie des morceaux reçus en partie (segment → bits).
func (s *Service) partOf(id string) map[int]uint64 {
	s.mem.mu.Lock()
	defer s.mem.mu.Unlock()
	out := make(map[int]uint64, len(s.mem.part[id]))
	for n, b := range s.mem.part[id] {
		out[n] = b
	}
	return out
}

// validVoid : au plus maxVoid plages non vides de morceaux de données du palier final
// (jamais le morceau du manifeste).
func validVoid(v [][2]int, bucket int) bool {
	if len(v) > maxVoid {
		return false
	}
	for _, r := range v {
		if r[0] < 0 || r[0] >= r[1] || r[1] > bucket-1 {
			return false
		}
	}
	return true
}

// growMargin : segments réservables au-delà du dernier segment reçu (audit H1) : le client
// agrandit au fil de l'envoi, jamais d'avance pour tout un fichier.
const growMargin = 2

// growLimit : plus grand palier permis par Grow, le plus petit qui contient les segments
// jusqu'au plus haut dont un morceau a été reçu (top = 1 + son numéro, voir upload), plus
// growMargin segments pleins, plus le morceau du manifeste. Un segment reçu puis effacé
// (élément retiré) compte encore : effacer ne fait rien gagner à qui garde ses segments, et le
// client peut placer l'élément suivant juste après un élément en cours d'effacement.
func growLimit(top int) int {
	need := (top+growMargin)*SegChunks + 1
	for _, b := range Buckets {
		if b >= need {
			return b
		}
	}
	return Buckets[len(Buckets)-1]
}

// Grow : GrowCharged sans débit de quota.
func (s *Service) Grow(id string, bucket int) error { return s.GrowCharged(id, bucket, nil) }

// GrowCharged porte la réservation de l'envoi id au palier bucket (strictement plus grand) :
// place vérifiée contre StorageMax comme à la création, fichier agrandi, masque prolongé
// (segments reçus gardés). Refusé pendant un Finalize ou un autre Grow (ErrBusy).
//
// charge (facultatif) débite le quota du nouveau palier (revue B3a). Il est appelé ici, sous
// la réservation de l'envoi (claimFinalize : un seul Grow à la fois par id), une fois la
// demande reconnue valable et avant de toucher au fichier ; son erreur refuse
// l'agrandissement. Si la suite échoue, il est rappelé avec l'ancien palier, lu sous la même
// réservation (jamais plus tôt) : le quota ne passe pas sous ce que le disque réserve.
func (s *Service) GrowCharged(id string, bucket int, charge func(bucket int) error) (err error) {
	if !validID(id) {
		return ErrNotFound
	}
	if !s.claimFinalize(id) {
		return ErrBusy
	}
	defer s.releaseFinalize(id)
	mu := s.uploadLock(id)
	mu.Lock()
	defer mu.Unlock()
	old, mask, err := s.draftRow(id)
	if err != nil {
		return err
	}
	_, top := s.received(id)
	if !validBucket(bucket) || bucket <= old || bucket > growLimit(top) {
		return ErrBadRequest
	}
	if charge != nil {
		if err := charge(bucket); err != nil {
			return err
		}
		defer func() {
			if err != nil {
				charge(old) // plus bas que le débit : ne peut pas être refusé
			}
		}()
	}
	s.createMu.Lock()
	defer s.createMu.Unlock()
	used, err := s.Blobs.UsedBytes()
	if err != nil {
		return err
	}
	if used+s.detachedBytes()+s.extraUsed()+totalSize(bucket)-totalSize(old) > s.StorageMax {
		return ErrFull
	}
	if err := resizeBlob(s.Blobs, id, totalSize(bucket)); err != nil {
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
// système de fichiers ou mise à zéro, fsync, bits remis à zéro. Sous le verrou exclusif de
// l'envoi : une écriture de segment en vol de cet envoi se termine avant, celles des autres
// envois ne sont pas retenues. Refusé pendant un Finalize (ErrBusy).
func (s *Service) Erase(id string, from, to int) error {
	if !validID(id) {
		return ErrNotFound
	}
	if !s.claimFinalize(id) {
		return ErrBusy
	}
	defer s.releaseFinalize(id)
	mu := s.uploadLock(id)
	mu.Lock()
	defer mu.Unlock()
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
	if err := eraseBlob(s.Blobs, id, start, end-start); err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return ErrNotFound
		}
		return err
	}
	next := append([]byte(nil), mask...)
	for n := from; n < to; n++ {
		next[n/8] &^= 1 << (n % 8)
	}
	s.clearPart(id, from, to)
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
// puis, sous le verrou de l'envoi, en-tête et manifeste écrits, fichier ramené au palier
// final, « ready ».
func (s *Service) finalizeDraft(id string, reserved int, r FinalizeReq) (time.Duration, error) {
	b := r.Bucket
	if b > reserved {
		return 0, ErrBadRequest
	}
	_, mask, err := s.draftRow(id)
	if err != nil {
		return 0, err
	}
	part := s.partOf(id)
	recv, top := s.received(id)
	// Palier final borné par les segments reçus, avec la marge de Grow (revue M1) : sans
	// cela, un brouillon réservé à 2 Gio et finalisé vide ferait écrire 2 Gio d'aléa.
	// Le client finalise au plus petit palier qui contient son dernier morceau envoyé
	// (bucketFor), toujours sous cette borne.
	if b > growLimit(top) {
		return 0, ErrBadRequest
	}
	segs := SegmentCount(b)
	// Morceaux présents par segment : segment reçu en entier (masque ; reçu au palier de
	// réservation ≥ b, il couvre ses morceaux au palier b), ou en partie (part) ; moins les
	// morceaux des petits éléments retirés (Void, audit H-2).
	have := make([]uint64, segs)
	for n := range have {
		if mask[n/8]&(1<<(n%8)) != 0 {
			have[n] = ^uint64(0)
		} else {
			have[n] = part[n]
		}
	}
	for _, v := range r.Void {
		for c := v[0]; c < v[1]; c++ {
			have[c/SegChunks] &^= 1 << (c % SegChunks)
		}
	}
	// Plages [début, fin) du fichier à remplir d'aléa, et leur total en morceaux.
	var holes [][2]int64
	var fill int64
	for n := 0; n < segs; n++ {
		chunks := chunksIn(b, n)
		for c := 0; c < chunks; {
			if have[n]&(1<<c) != 0 {
				c++
				continue
			}
			e := c
			for e < chunks && have[n]&(1<<e) == 0 {
				e++
			}
			from := chunkOffset(b, n, c)
			if n == 0 && c == 0 {
				from = 0
			}
			holes = append(holes, [2]int64{from, chunkOffset(b, n, e)})
			fill += int64(e - c)
			c = e
		}
	}
	// Aléa borné par les morceaux reçus (D42-6) : un morceau par palier ne suffit plus à
	// faire écrire tout un grand palier. Le morceau du manifeste, réécrit ensuite, compte.
	if fill > padAllowed(recv) {
		return 0, ErrIncomplete
	}
	for _, h := range holes {
		if err := s.fillRange(id, h[0], h[1]); err != nil {
			if errors.Is(err, fs.ErrNotExist) {
				return 0, ErrNotFound
			}
			return 0, err
		}
	}
	// Le gros du fichier atteint le disque hors du verrou de l'envoi (revue B4, comme Finalize).
	if err := s.syncFile(id); err != nil {
		return 0, err
	}

	mu := s.uploadLock(id)
	mu.Lock()
	defer mu.Unlock()
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
	if err := resizeBlob(s.Blobs, id, totalSize(b)); err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return 0, ErrNotFound // détruit pendant la finalisation
		}
		return 0, err
	}
	// En-tête, manifeste et taille finale sur le disque avant « ready ».
	if err := s.syncFile(id); err != nil {
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
