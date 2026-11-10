package share

import (
	"bytes"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/skoow/shhdrop/server/internal/blob"
	"github.com/skoow/shhdrop/server/internal/limits"
)

// hookErase remplace eraseBlob le temps du test.
func hookErase(t *testing.T, f func(b *blob.Store, id string, off, n int64) error) {
	t.Helper()
	orig := eraseBlob
	eraseBlob = f
	t.Cleanup(func() { eraseBlob = orig })
}

// twoUploads crée deux envois (paliers ba et bb) dont les verrous d'envoi diffèrent.
func twoUploads(t *testing.T, s *Service, ba, bb int) (a, b string) {
	t.Helper()
	a, _, err := s.Create(newKeys().req(ba, 1, 1))
	if err != nil {
		t.Fatal(err)
	}
	for range 100 {
		if b, _, err = s.Create(newKeys().req(bb, 1, 1)); err != nil {
			t.Fatal(err)
		}
		if s.uploadLock(a) != s.uploadLock(b) {
			return a, b
		}
	}
	t.Fatal("aucun id sous un autre verrou")
	return
}

// Revue du 10 novembre : le verrou des envois est par envoi. Un effacement lent (trou rendu
// au système de fichiers, fsync) de l'envoi A ne retient ni les segments ni la finalisation
// de l'envoi B ; il retient toujours les écritures de A lui-même.
func TestSlowEraseDoesNotBlockOtherUpload(t *testing.T) {
	s, _ := newSvc(t)
	a, b := twoUploads(t, s, 400, 1)
	for n := 0; n < 3; n++ {
		if err := s.PutSegment(a, n, segBody(400, n, byte(n+1))); err != nil {
			t.Fatal(err)
		}
	}
	entered, release := make(chan struct{}), make(chan struct{})
	hookErase(t, func(bl *blob.Store, id string, off, n int64) error {
		if id == a {
			close(entered)
			<-release
		}
		return bl.Erase(id, off, n)
	})
	erased := make(chan error, 1)
	go func() { erased <- s.Erase(a, 1, 3) }()
	<-entered

	other := make(chan error, 1)
	go func() {
		if err := s.PutSegment(b, 0, segBody(1, 0, 7)); err != nil {
			other <- err
			return
		}
		_, err := s.Finalize(b, fin(b))
		other <- err
	}()
	select {
	case err := <-other:
		if err != nil {
			t.Fatal("envoi B pendant l'effacement de A :", err)
		}
	case <-time.After(2 * time.Second):
		close(release)
		t.Fatal("segment ou finalisation de B retenus par l'effacement de A")
	}
	if stateOf(t, s, b) != "ready" {
		t.Fatal("B non finalisé")
	}

	// Même envoi : l'écriture du segment 1 de A attend la fin de son effacement.
	same := make(chan error, 1)
	go func() { same <- s.PutSegment(a, 1, segBody(400, 1, 9)) }()
	select {
	case err := <-same:
		t.Fatal("segment de A écrit pendant son effacement :", err)
	case <-time.After(50 * time.Millisecond):
	}
	close(release)
	if err := <-erased; err != nil {
		t.Fatal(err)
	}
	if err := <-same; err != nil {
		t.Fatal(err)
	}
	// Écrit après l'effacement : le segment 1 est entier, le segment 2 effacé.
	f := fileBytes(t, s, a)
	lo, mid, hi := segOffset(400, 1), segOffset(400, 2), segOffset(400, 3)
	if !bytes.Equal(f[lo:mid], segBody(400, 1, 9)) || !bytes.Equal(f[mid:hi], make([]byte, hi-mid)) {
		t.Fatal("écriture et effacement de A entremêlés")
	}
}

// Revue du 10 novembre : le fichier d'un partage retiré est supprimé du dossier hors de
// gone.mu (pris par chaque lecture de segment). Pendant la suppression, le partage passe déjà
// pour disparu (aucune lecture, aucune surveillance, aucun second retrait) ; l'ordre « fichier
// puis ligne » est gardé, pour qu'une suppression en échec soit réessayée.
func TestRetireUnlinksOutsideGoneLock(t *testing.T) {
	s, _ := newSvc(t)
	k := newKeys()
	id := ready(t, s, k, 80, 1, 2)
	o1, _, _ := s.Unlock(id, k.acces, k.preuve)
	orig := deleteBlob
	t.Cleanup(func() { deleteBlob = orig })
	calls, held, rows := 0, false, -1
	var readErr, watchErr, againErr error
	var again bool
	deleteBlob = func(b *blob.Store, got string) error {
		calls++
		if s.gone.mu.TryLock() {
			s.gone.mu.Unlock()
		} else {
			held = true
			return b.Delete(got)
		}
		rows = rowCount(t, s, got)
		_, readErr = readSegment(s, got, 0, o1)
		_, watchErr = s.Watch(got, o1)
		again, againErr = s.retire(got, false, s.now())
		return b.Delete(got)
	}
	if err := s.DestroyManaged(k.gestion); err != nil {
		t.Fatal(err)
	}
	if calls != 1 || held || rows != 1 {
		t.Fatalf("suppressions %d, gone.mu tenu %v, lignes pendant la suppression %d", calls, held, rows)
	}
	if !errors.Is(readErr, ErrGone) || !errors.Is(watchErr, ErrGone) || again || againErr != nil {
		t.Fatal("partage en cours de retrait encore servi :", readErr, watchErr, again, againErr)
	}
	gone(t, s, id)
	if len(s.gone.retiring) != 0 {
		t.Fatal("retrait non oublié", s.gone.retiring)
	}

	// Suppression en échec : ligne gardée (Sweep réessaiera), retrait oublié.
	k2 := newKeys()
	id2 := ready(t, s, k2, 80, 1, 1)
	boom := errors.New("disque")
	deleteBlob = func(*blob.Store, string) error { return boom }
	if err := s.DestroyManaged(k2.gestion); !errors.Is(err, boom) {
		t.Fatal(err)
	}
	if rowCount(t, s, id2) != 1 || len(s.gone.retiring) != 0 {
		t.Fatal("ligne effacée alors que le fichier reste, ou retrait non oublié")
	}
	deleteBlob = orig
	if err := s.DestroyManaged(k2.gestion); err != nil {
		t.Fatal(err)
	}
	gone(t, s, id2)
}

// Revue du 10 novembre : le descripteur détaché (jusqu'à 2 Gio rendus au système de fichiers
// à sa fermeture) est fermé hors de gone.mu, et sa place reste comptée jusque-là.
func TestDetachedClosedOutsideGoneLock(t *testing.T) {
	s, c := newSvc(t)
	k := newKeys()
	id := ready(t, s, k, gb, 1, 2)
	o1, _, _ := s.Unlock(id, k.acces, k.preuve)
	mustRead(t, s, id, 0, o1)
	if err := s.DestroyManaged(k.gestion); err != nil { // ouverture active : descripteur détaché
		t.Fatal(err)
	}
	if s.detachedBytes() != totalSize(gb) {
		t.Fatal("descripteur détaché non compté")
	}
	orig := closeDetached
	t.Cleanup(func() { closeDetached = orig })
	calls, held, counted := 0, false, int64(-1)
	closeDetached = func(f *os.File) error {
		calls++
		if s.gone.mu.TryLock() {
			s.gone.mu.Unlock()
			counted = s.detachedBytes()
		} else {
			held = true
		}
		return f.Close()
	}
	c.Add(3 * time.Minute) // 120 s sans segment : plus aucun droit
	if _, err := s.Sweep(); err != nil {
		t.Fatal(err)
	}
	if calls != 1 || held || counted != totalSize(gb) {
		t.Fatalf("fermetures %d, gone.mu tenu %v, place comptée pendant la fermeture %d", calls, held, counted)
	}
	if s.detachedBytes() != 0 || heldFDs(t, s, id) > 0 {
		t.Fatal("descripteur encore compté ou ouvert après sa fermeture")
	}
}

// Revue du 10 novembre : un brouillon détruit pendant sa finalisation, juste avant d'être
// ramené au palier final, est « introuvable » (404), pas une erreur du serveur (500).
func TestFinalizeDraftGoneBeforeResizeIsNotFound(t *testing.T) {
	s, _ := newSvc(t)
	id, _, err := s.Create(newKeys().req(160, 1, 1))
	if err != nil {
		t.Fatal(err)
	}
	if err := s.PutSegment(id, 0, segBody(160, 0, 1)); err != nil {
		t.Fatal(err)
	}
	orig := resizeBlob
	t.Cleanup(func() { resizeBlob = orig })
	resizeBlob = func(b *blob.Store, got string, size int64) error {
		if err := b.Delete(got); err != nil { // détruit par l'expéditeur à cet instant
			t.Error(err)
		}
		return b.Resize(got, size)
	}
	if _, err := s.Finalize(id, draftFin(id, 80)); !errors.Is(err, ErrNotFound) {
		t.Fatal("fichier disparu avant la taille finale :", err)
	}
}

// limits.UploadLife (report des envois en cours à minuit UTC) couvre la vie maximale d'un
// envoi ici : uploadWindow, arrondie au quart d'heure supérieur. Garde-fou : si la fenêtre
// d'envoi change (24 h au-delà de 2 Gio, spec §41.2), UploadLife doit suivre.
func TestUploadLifeCoversUploadWindow(t *testing.T) {
	var longest int64
	for now := int64(1_800_000_000); now < 1_800_000_000+900; now++ {
		longest = max(longest, ceil15(now+uploadWindow)-now)
	}
	if life := int64(limits.UploadLife / time.Second); longest > life || life-longest > 1 {
		t.Fatalf("vie maximale d'un envoi %d s, limits.UploadLife %d s", longest, life)
	}
}
