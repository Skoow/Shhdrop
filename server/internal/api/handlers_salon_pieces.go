package api

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/skoow/shhdrop/server/internal/limits"
	"github.com/skoow/shhdrop/server/internal/salon"
	"github.com/skoow/shhdrop/server/internal/share"
	"github.com/skoow/shhdrop/server/internal/token"
)

// Pièces jointes et vocaux du salon (plan C-2 Task 13, spec §39.3.9). Aucun identifiant ni
// secret dans le chemin : le membre par X-Shh-Membre (jeton de membre), la pièce par
// X-Shh-Piece (22 caractères) ou par le jeton d'envoi signé (token.SalonPiece). Segments
// envoyés et servis comme ceux des partages : places de transfert, débit minimal (pacer),
// lecture en flux, coupure immédiate d'une lecture révoquée.

func (a salonAPI) routesPieces(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/salons/pieces", a.creerPiece)
	mux.HandleFunc("PUT /api/salons/pieces/segments/{n}", a.envoyerSegmentPiece)
	mux.HandleFunc("POST /api/salons/pieces/finalize", a.finaliserPiece)
	mux.HandleFunc("GET /api/salons/pieces/segments/{n}", a.lireSegmentPiece)
	mux.HandleFunc("/api/salons/pieces/segments/{n}", methodNotAllowed)
	mux.HandleFunc("POST /api/salons/pieces/retirer", a.retirerPiece)
}

// validPieceSegment : validSegmentToken pour /api/salons/pieces/segments/{n} (n non vide,
// sans « / ») : PUT avec un jeton d'envoi de pièce signé et non expiré, GET avec un
// X-Shh-Membre valable ; faux si le salon est désactivé. Ici et non dans api.go : X-Shh-Membre
// n'est lu que dans les fichiers handlers_salon*.go (minimize_test.go).
func (s *server) validPieceSegment(r *http.Request, n string) bool {
	if s.salons == nil || n == "" || strings.Contains(n, "/") {
		return false
	}
	switch r.Method {
	case http.MethodPut:
		tok, err := bearer(r)
		if err != nil {
			return false
		}
		_, _, err = s.sig.Subject(tok, token.SalonPiece)
		return err == nil
	case http.MethodGet:
		j, err := headerSecret(r, "X-Shh-Membre")
		if err != nil {
			return false
		}
		_, err = s.salons.Membre(j)
		return err == nil
	}
	return false
}

// pieceTTL : durée maximale du jeton d'envoi d'une pièce (comme celui d'un partage), bornée
// par la fin du salon.
const pieceTTL = 6 * time.Hour

// membre : jeton de X-Shh-Membre (présent une fois, 43 caractères) → membre ; révoqué :
// ErrExcluded (403 excluded) ; inconnu : ErrNotFound.
func (a salonAPI) membre(r *http.Request) (salon.Membre, []byte, error) {
	j, err := headerSecret(r, "X-Shh-Membre")
	if err != nil {
		return salon.Membre{}, nil, err
	}
	mb, err := a.m.Membre(j)
	return mb, j, err
}

// pieceID : X-Shh-Piece présent une fois, 22 caractères base64url canoniques (16 octets).
func pieceID(r *http.Request) (string, error) {
	v := r.Header.Values("X-Shh-Piece")
	if len(v) != 1 {
		return "", errBadRequest
	}
	if _, err := secret(v[0], 16); err != nil {
		return "", err
	}
	return v[0], nil
}

// creerPiece : POST /api/salons/pieces {bucket, vocal}. Un fichier passe par les quotas des
// envois sans compter comme création de partage (limits.BeginPiece : octets utiles du jour,
// 2 envois non finalisés à la fois par connexion, partagés avec les partages ; rendus si la
// création échoue) ; leur nombre est borné par le salon (salon.PiecesParHeure par siège :
// 429 limit). Un vocal ne passe par aucun des deux (réserve du siège, v3 §5.1). Jeton
// d'envoi valable min(6 h, fin du salon).
func (a salonAPI) creerPiece(w http.ResponseWriter, r *http.Request) {
	var b struct {
		Bucket *int  `json:"bucket"`
		Vocal  *bool `json:"vocal"`
	}
	if err := readJSON(w, r, &b); err != nil || b.Bucket == nil || b.Vocal == nil {
		failSalon(w, errBadRequest)
		return
	}
	mb, _, err := a.membre(r)
	if err != nil {
		failSalon(w, err)
		return
	}
	bucket, vocal := *b.Bucket, *b.Vocal
	if !salon.PalierValide(bucket, vocal) {
		failSalon(w, errBadRequest)
		return
	}
	id := share.NewID()
	ip := ipOf(r)
	if !vocal {
		switch retry, err := a.lim.BeginPiece(ip, id, share.ContentBytes(bucket)); {
		case errors.Is(err, limits.ErrDuplicate): // id de 128 bits déjà en cours : impossible
			failSalon(w, errors.New("id de pièce en double"))
			return
		case err != nil:
			writeLimit(w, retry)
			return
		}
	}
	if err := a.m.CreerPieceID(mb, id, bucket, vocal); err != nil {
		if !vocal {
			a.lim.CancelUpload(id)
		}
		failSalon(w, err)
		return
	}
	exp := a.svc.Now().Add(pieceTTL)
	if fin := mb.Echeance(); fin.Before(exp) {
		exp = fin
	}
	writeJSON(w, http.StatusCreated, struct {
		Piece string `json:"piece"`
		Token string `json:"upload_token"`
	}{id, a.sig.Issue(token.SalonPiece, id, 0, exp)})
}

// envoyerSegmentPiece : PUT /api/salons/pieces/segments/{n} (jeton d'envoi), patron de
// putSegment : corps borné, place de transfert, débit minimal, octets reçus comptés au quota
// du jour même si le segment est refusé ensuite. Total reçu par pièce au-delà de
// salon.EcritureMax × sa taille (réécritures, vocal compris) : 413 too_large.
func (a salonAPI) envoyerSegmentPiece(w http.ResponseWriter, r *http.Request) {
	id, _, err := a.checkToken(r, token.SalonPiece)
	if err != nil {
		failSalon(w, err)
		return
	}
	n, err := segNum(r.PathValue("n"))
	if err != nil {
		failSalon(w, err)
		return
	}
	if r.ContentLength > maxSegmentLen {
		failSalon(w, errBadRequest)
		return
	}
	// Pièce finie, effacée ou inconnue : refusée avant toute place et toute lecture (audit du
	// 13 novembre, D1).
	vocal, open := a.m.PieceEnvoi(id)
	if !open {
		refuseUnread(w)
		return
	}
	release, ok := a.xferSlot(w, r, a.xfer.perUp, "p:"+id, a.xfer.ul)
	if !ok {
		return
	}
	defer release()
	rc := http.NewResponseController(w)
	p := newPacer(rc.SetReadDeadline, a.xfer)
	if err := p.arm(); err != nil {
		failSalon(w, err)
		return
	}
	buf := segBufs.Get().(*[]byte)
	defer segBufs.Put(buf)
	k, err := readBody(paceReader{http.MaxBytesReader(w, r.Body, maxSegmentLen), p}, r.ContentLength, *buf)
	// Un vocal n'est jamais compté aux quotas des envois (réserve du siège, creerPiece).
	var retry time.Duration
	var qerr error
	if !vocal {
		retry, qerr = a.lim.Receive(id, share.PayloadBytes(int64(k)))
	}
	if err != nil {
		failSalon(w, errBadRequest)
		return
	}
	if qerr != nil {
		writeLimit(w, retry)
		return
	}
	if err := a.m.PutSegment(id, n, (*buf)[:k]); err != nil {
		failSalon(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// finaliserPiece : POST /api/salons/pieces/finalize (jeton d'envoi) {fill_from, fill_to}, tous
// deux exigés ; quotas débités (FinishUpload).
func (a salonAPI) finaliserPiece(w http.ResponseWriter, r *http.Request) {
	id, _, err := a.checkToken(r, token.SalonPiece)
	if err != nil {
		failSalon(w, err)
		return
	}
	var b struct {
		FillFrom *int `json:"fill_from"`
		FillTo   *int `json:"fill_to"`
	}
	if err := readJSON(w, r, &b); err != nil || b.FillFrom == nil || b.FillTo == nil {
		failSalon(w, errBadRequest)
		return
	}
	if err := a.m.FinalizePiece(id, *b.FillFrom, *b.FillTo); err != nil {
		failSalon(w, err)
		return
	}
	a.lim.FinishUpload(id, ipOf(r))
	writeJSON(w, http.StatusOK, struct{}{})
}

// lireSegmentPiece : GET /api/salons/pieces/segments/{n} (X-Shh-Membre, X-Shh-Piece), en flux
// sous débit minimal, patron de getSegment ; HEAD et autres méthodes : 405. Budget de lecture épuisé : 429 budget. Pièce
// effacée ou jeton révoqué pendant la lecture : connexion coupée tout de suite.
func (a salonAPI) lireSegmentPiece(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet { // HEAD : 405 avant le budget de lecture
		methodNotAllowed(w, r)
		return
	}
	mb, jeton, err := a.membre(r)
	if err != nil {
		failSalon(w, err)
		return
	}
	id, err := pieceID(r)
	if err != nil {
		failSalon(w, err)
		return
	}
	n, err := segNum(r.PathValue("n"))
	if err != nil {
		failSalon(w, err)
		return
	}
	h := sha256.Sum256(jeton)
	release, ok := a.xferSlot(w, r, a.xfer.perOpen, "p:"+id+"|"+hex.EncodeToString(h[:]), a.xfer.dl)
	if !ok {
		return
	}
	defer release()
	l, err := a.m.OuvrirSegment(r.Context(), mb, id, n)
	if errors.Is(err, salon.ErrBudget) {
		writeRetry(w, http.StatusTooManyRequests, "budget", budgetRetry)
		return
	}
	if err != nil {
		failSalon(w, err)
		return
	}
	defer l.Close()
	rc := http.NewResponseController(w)
	p := newPacer(rc.SetWriteDeadline, a.xfer)
	stop := context.AfterFunc(l.Context(), func() {
		if errors.Is(context.Cause(l.Context()), share.ErrRevoked) {
			p.stop(time.Unix(1, 0))
		}
	})
	defer stop()
	if err := p.arm(); err != nil {
		failSalon(w, err)
		return
	}
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Length", strconv.FormatInt(l.Size(), 10))
	w.WriteHeader(http.StatusOK)
	buf := copyBufs.Get().(*[]byte)
	k, err := io.CopyBuffer(paceWriter{w, p}, l, *buf)
	copyBufs.Put(buf)
	if err != nil || k != l.Size() {
		panic(http.ErrAbortHandler) // réponse tronquée : connexion coupée
	}
}

// retirerPiece : POST /api/salons/pieces/retirer (X-Shh-Membre, X-Shh-Piece, corps {}) :
// auteur seulement (403 forbidden).
func (a salonAPI) retirerPiece(w http.ResponseWriter, r *http.Request) {
	var b struct{}
	if err := readJSON(w, r, &b); err != nil {
		failSalon(w, err)
		return
	}
	mb, _, err := a.membre(r)
	if err != nil {
		failSalon(w, err)
		return
	}
	id, err := pieceID(r)
	if err != nil {
		failSalon(w, err)
		return
	}
	if err := a.m.RetirerPiece(mb, id); err != nil {
		failSalon(w, err)
		return
	}
	writeJSON(w, http.StatusOK, struct{}{})
}
