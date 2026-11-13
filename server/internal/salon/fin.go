package salon

import (
	"context"
	"database/sql"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/skoow/shhdrop/server/internal/blob"
	"github.com/skoow/shhdrop/server/internal/share"
	"github.com/skoow/shhdrop/server/internal/store"
)

// Fin de vie d'un salon (plan C-2 Task 15) : échéance, destruction (créateur, membre si
// permis, 10 mots de passe faux, administrateur), purge au démarrage.
//
// Une fin se fait en deux temps :
//   - oublier, sous le verrou du salon : 0x05 (raison) décidé pour chaque connexion, en direct
//     ou en rattrapage, puis fermeture 1000 (connexion.arreter : l'écrivain écrit ce 0x05 en
//     dernier) ; pièces marquées effacées (flux coupés) ; état oublié (fini, jetons, révoqués,
//     journal, index) ; la tombe reste dans Manager.salons jusqu'à l'échéance + margeTombe et
//     tant que la fin n'est pas complète ;
//   - achever, hors de tout verrou : conversation détruite (clé mise à zéro, fichier
//     supprimé), ligne du salon rendue morte (failed_attempts = 10 : plus aucune requête ne la
//     voit, même si la suite échoue), pièces effacées (fichier puis ligne), ligne du salon
//     supprimée une fois ses pièces parties. Un échec laisse la fin « à faire » : Tick la
//     reprend à chaque passage (aucun salon ne reste à moitié détruit sans nouvel essai).

// État de la partie disque d'une fin (salon.etatFin, sous salon.mu).
const (
	finRien    uint8 = iota // aucune fin, ou fin complète
	finAFaire               // à reprendre par Tick
	finEnCours              // achever en cours (un seul à la fois)
)

// crochetOublier : tests seulement (appelé dans oublier, sous le verrou du salon, après le
// passage à « fini ») ; nil en production.
var crochetOublier func()

// crochetAchever : tests seulement (appelé au début d'achever, hors de tout verrou) ; nil en
// production.
var crochetAchever func(*salon)

// Detruire : POST /api/salons/detruire. sGestion (créateur) s'il est donné, sinon jeton (membre,
// seulement si members_can_destroy). S_gestion ou jeton inconnu, salon échu ou détruit :
// ErrNotFound ; jeton révoqué : ErrExcluded ; membre sans la permission, ni S_gestion ni
// jeton : ErrForbidden. Le salon est fini en raison 2 ; une erreur de la partie disque est
// reprise par Tick (pas rendue : le salon est déjà détruit pour tous).
func (m *Manager) Detruire(sGestion, jeton []byte) error {
	_, err := m.detruireDemande(sGestion, jeton, false)
	return err
}

// DetruireSignaler : « Détruire et signaler » ({reason: "report"}) : destruction comme
// Detruire ; premier vaut vrai seulement si cet appel a détruit le salon et que c'est le
// premier signalement du salon (salon.signale, partagé avec QuitterSignaler, posé sous le
// verrou du salon) : un salon ne compte qu'un signalement, et un second « détruire »
// simultané, qui trouve une tombe, ne compte pas (revue finale C-2, mineur d).
func (m *Manager) DetruireSignaler(sGestion, jeton []byte) (premier bool, err error) {
	return m.detruireDemande(sGestion, jeton, true)
}

func (m *Manager) detruireDemande(sGestion, jeton []byte, signaler bool) (bool, error) {
	now := m.cfg.Now().Unix()
	switch {
	case sGestion != nil:
		v := share.Verifier(sGestion)
		if v == nil {
			return false, ErrNotFound
		}
		var id string
		if err := m.cfg.DB.QueryRow(`SELECT id FROM salons WHERE manage_v=? AND expires_at>? AND failed_attempts<?`,
			v, now, maxEssais).Scan(&id); err != nil {
			return false, notFound(err)
		}
		premier, _ := m.detruireAvec(id, signaler) // partie disque ratée : reprise par Tick
		return premier, nil
	case jeton != nil:
		mb, err := m.Membre(jeton)
		if err != nil {
			return false, err
		}
		var mcd int
		if err := m.cfg.DB.QueryRow(`SELECT members_can_destroy FROM salons WHERE id=? AND expires_at>? AND failed_attempts<?`,
			mb.salon.id, now, maxEssais).Scan(&mcd); err != nil {
			return false, notFound(err)
		}
		if mcd != 1 {
			return false, ErrForbidden
		}
		premier, _ := m.finirAvec(mb.salon, RaisonDetruit, signaler) // partie disque ratée : reprise par Tick
		return premier, nil
	}
	return false, ErrForbidden
}

// detruire : fin en raison 2 du salon id, avec ou sans état en mémoire (10ᵉ mot de passe faux,
// Detruire). Sans état, une tombe est créée d'abord : etat ne recrée ensuite ni état ni
// fichier. Sûre sans essaiLock. Rend l'erreur de la partie disque (reprise par Tick).
func (m *Manager) detruire(id string) error {
	_, err := m.detruireAvec(id, false)
	return err
}

// detruireAvec : detruire, avec le signalement de finirAvec.
func (m *Manager) detruireAvec(id string, signaler bool) (premier bool, err error) {
	m.mu.Lock()
	s := m.salons[id]
	if s == nil {
		// Échéance inconnue sans la ligne : la plus lointaine possible (24 h, arrondie).
		s = nouveauSalon(id, m.cfg.Now().Add(25*time.Hour), 0, nil, m.now)
		m.salons[id] = s
	}
	m.mu.Unlock()
	return m.finirAvec(s, RaisonDetruit, signaler)
}

// finir : fin commune (raison 1 expiration, 2 destruction) : place du bloc rendue, état
// mémoire oublié (oublier), puis partie disque (achever). Sans effet sur une tombe (salon
// déjà fini) : sa partie disque éventuellement restante est reprise par Tick.
func (m *Manager) finir(s *salon, raison uint8) error {
	_, err := m.finirAvec(s, raison, false)
	return err
}

// finirAvec : finir ; signaler (« Détruire et signaler ») : premier vaut vrai si cet appel a
// fini le salon et que personne ne l'avait encore signalé (salon.signale, sous son verrou).
func (m *Manager) finirAvec(s *salon, raison uint8, signaler bool) (premier bool, err error) {
	m.mu.Lock()
	m.finirLocked(s.id)
	m.mu.Unlock()
	fait, premier := m.oublier(s, raison, signaler)
	if !fait {
		return false, nil
	}
	if !s.prendreFin() {
		return premier, nil // déjà prise par une reprise de Tick
	}
	return premier, m.achever(s)
}

// oublier : partie mémoire d'une fin, sous le verrou du salon ; fait faux pour une tombe.
// premier : signaler et salon pas encore signalé (salon.signale posé).
func (m *Manager) oublier(s *salon, raison uint8, signaler bool) (fait, premier bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.fini {
		return false, false
	}
	// « fini » et fin « à faire » posés avant toute étape qui pourrait paniquer : une panique
	// (récupérée par Run) laisse une tombe dont Tick reprend la partie disque (reprendreFin) ;
	// finirAvec prend la fin (finEnCours) par le même test (relecture C-2, N2).
	s.fini = true
	s.etatFin = finAFaire
	if crochetOublier != nil {
		crochetOublier()
	}
	if signaler && !s.signale {
		s.signale, premier = true, true
	}
	// Connexions d'abord : 0x05 au rang courant, en direct comme en rattrapage (l'écrivain
	// l'écrit après son lot en cours), puis 1000 ; plus rien d'autre ne leur est remis.
	for _, c := range s.conns {
		if c != nil {
			c.arreter(CodeFin, EnrFin(s.seq, raison))
		}
	}
	m.indexer(func(index map[[32]byte]*salon) {
		for h := range s.jetons {
			delete(index, h)
		}
		for h := range s.revoques {
			delete(index, h)
		}
	})
	for h := range s.jetons {
		m.flux.Revoke(cleFluxMembre(h))
	}
	// Pièces : plus jamais servies, flux coupés ; fichier puis ligne effacés par achever.
	for _, p := range s.lesPieces {
		s.supprimerPieceLocked(p)
	}
	clear(s.jetons)
	clear(s.revoques)
	s.sieges = [nbSieges]*siege{}
	s.journal = nil
	s.index = nil
	s.pieces = nil
	s.echeances = nil
	return true, premier
}

// achever : partie disque d'une fin (voir l'en-tête), hors de tout verrou ; appelée par finir
// (etatFin = finEnCours, prendreFin) ou par Tick (reprendreFin). Rend la première erreur ; la fin reste
// alors à faire.
func (m *Manager) achever(s *salon) (err error) {
	complete := false // posé à la fin seulement : une panique laisse la fin « à faire »
	defer func() {
		s.mu.Lock()
		defer s.mu.Unlock()
		s.etatFin = finAFaire
		if complete {
			s.etatFin = finRien
		}
	}()
	if crochetAchever != nil {
		crochetAchever(s)
	}
	var errs []error
	if s.conv != nil { // jamais réaffecté après nouveauSalon
		errs = append(errs, s.conv.Detruire())
	}
	_, e := m.cfg.DB.Exec(`UPDATE salons SET failed_attempts=? WHERE id=? AND failed_attempts<?`, maxEssais, s.id, maxEssais)
	errs = append(errs, base(e))
	m.purger(s) // pièces connues en mémoire : fichier, ligne, index, quotas
	if s.resteAPurger() {
		errs = append(errs, ErrES)
	}
	errs = append(errs, m.effacerPiecesEnBase(s.id))
	// Ligne du salon : seulement sans pièce restante (sinon ON DELETE CASCADE effacerait la
	// ligne d'une pièce dont le fichier est encore là).
	_, e = m.cfg.DB.Exec(`DELETE FROM salons WHERE id=? AND NOT EXISTS (SELECT 1 FROM salon_pieces WHERE salon_id=?)`,
		s.id, s.id)
	errs = append(errs, base(e))
	var un int
	switch e := m.cfg.DB.QueryRow(`SELECT 1 FROM salons WHERE id=?`, s.id).Scan(&un); {
	case e == nil:
		errs = append(errs, ErrBase) // ligne encore là : à reprendre
	case !errors.Is(e, sql.ErrNoRows):
		errs = append(errs, base(e))
	}
	err = errors.Join(errs...)
	complete = err == nil
	return err
}

// effacerPiecesEnBase : pièces du salon id encore en base (inconnues en mémoire : création
// interrompue) : fichier puis ligne ; une pièce dont le fichier reste garde sa ligne.
func (m *Manager) effacerPiecesEnBase(id string) error {
	rows, err := m.cfg.DB.Query(`SELECT id FROM salon_pieces WHERE salon_id=?`, id)
	if err != nil {
		return base(err)
	}
	var ids []string
	for rows.Next() {
		var p string
		if rows.Scan(&p) == nil {
			ids = append(ids, p)
		}
	}
	errs := []error{base(errors.Join(rows.Err(), rows.Close()))}
	for _, p := range ids {
		if err := m.cfg.Pieces.Delete(p); err != nil {
			errs = append(errs, es(err))
			continue
		}
		_, err := m.cfg.DB.Exec(`DELETE FROM salon_pieces WHERE id=?`, p)
		errs = append(errs, base(err))
	}
	return errors.Join(errs...)
}

// reprendreFin : Tick reprend une fin restée à faire ; une seule reprise à la fois.
func (m *Manager) reprendreFin(s *salon) {
	if s.prendreFin() {
		_ = m.achever(s)
	}
}

// prendreFin : fin « à faire » prise (finEnCours) ; faux si aucune ou déjà prise. Un seul
// achever à la fois (finirAvec, reprendreFin).
func (s *salon) prendreFin() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.etatFin != finAFaire {
		return false
	}
	s.etatFin = finEnCours
	return true
}

// finIncomplete : la partie disque de la fin n'est pas complète (à faire ou en cours).
func (s *salon) finIncomplete() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.etatFin != finRien
}

// lotLignes : identifiants par requête IN (bien sous la limite de variables de SQLite).
const lotLignes = 500

// lignes : passe de Tick sur la base. Lignes à 10 essais supprimées s'il y en a (sans pièce restante :
// celles d'une fin en cours sont effacées par achever d'abord) ; lignes échues sans état en
// mémoire supprimées (echuesSansEtat) ; salons vivants de ce
// processus (état en mémoire non fini, ou place de bloc comptée) dont la ligne vivante a
// disparu (admin destroy, wipe, 10 essais) : fin en raison 2, place du bloc rendue. Les
// tombes n'y sont pas. Sous createMu : une création en cours a déjà sa ligne ou n'est pas
// encore comptée.
func (m *Manager) lignes(now time.Time) {
	// Lecture d'abord (cas rare) : aucune écriture en base à chaque seconde.
	var un int
	if m.cfg.DB.QueryRow(`SELECT 1 FROM salons WHERE failed_attempts>=? LIMIT 1`, maxEssais).Scan(&un) == nil {
		_, _ = m.cfg.DB.Exec(`DELETE FROM salons WHERE failed_attempts>=? AND NOT EXISTS
			(SELECT 1 FROM salon_pieces WHERE salon_pieces.salon_id=salons.id)`, maxEssais)
	}
	m.echuesSansEtat(now.Unix())
	partis := m.disparus()
	for _, s := range partis {
		_ = m.finir(s, RaisonDetruit)
	}
	if len(partis) > 0 {
		// Fichiers de pièces supprimés par un autre processus : usage relu (blob.Store).
		_ = m.cfg.Pieces.Resync()
	}
}

// disparus : salons vivants de ce processus dont la ligne vivante a disparu (lignes), place
// du bloc rendue ; rend ceux qui ont un état, à finir hors des verrous. Chaque verrou est
// rendu par defer : une panique récupérée par Run ne laisse ni createMu ni Manager.mu pris.
func (m *Manager) disparus() []*salon {
	m.createMu.Lock()
	defer m.createMu.Unlock()
	var ids []string
	etats := map[string]*salon{}
	func() {
		m.mu.Lock()
		defer m.mu.Unlock()
		ids = make([]string, 0, len(m.salons)+len(m.vivants))
		for id, s := range m.salons {
			if !s.estFini() {
				ids = append(ids, id)
				etats[id] = s
			}
		}
		for id := range m.vivants {
			if etats[id] == nil {
				ids = append(ids, id)
			}
		}
	}()
	presents := map[string]bool{}
	for i := 0; i < len(ids); i += lotLignes {
		lot := ids[i:min(i+lotLignes, len(ids))]
		args := make([]any, 0, len(lot)+1)
		for _, id := range lot {
			args = append(args, id)
		}
		args = append(args, maxEssais)
		rows, err := m.cfg.DB.Query(`SELECT id FROM salons WHERE id IN (?`+strings.Repeat(",?", len(lot)-1)+
			`) AND failed_attempts<?`, args...)
		if err != nil {
			return nil
		}
		for rows.Next() {
			var id string
			if rows.Scan(&id) == nil {
				presents[id] = true
			}
		}
		if errors.Join(rows.Err(), rows.Close()) != nil {
			return nil
		}
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	var partis []*salon
	for _, id := range ids {
		if presents[id] {
			continue
		}
		m.finirLocked(id)
		if s := etats[id]; s != nil {
			partis = append(partis, s)
		}
	}
	return partis
}

// echuesSansEtat (revue finale C-2, I2) : lignes échues à now (expires_at<=now) d'un salon
// sans état en mémoire (personne n'y est entré, ou personne depuis un redémarrage) : pièces en
// base effacées (fichier puis ligne), puis ligne du salon, comme par achever. Un salon qui a un
// état (vivant ou tombe) n'y est pas : Tick le finit (entretenir) et achever efface sa ligne.
// Lecture d'abord, lotLignes au plus par passe : aucune écriture en base sans ligne échue. Sans
// état, aucun Rejoindre ne peut en recréer un (la ligne est échue). Erreurs ignorées : la
// ligne reste, reprise à un tick suivant.
func (m *Manager) echuesSansEtat(now int64) {
	// Curseur d'un tick à l'autre (relecture C-2, N6) : lotLignes lignes échues par passe,
	// après la dernière vue, dans l'ordre des id ; des tombes en mémoire en tête n'affament
	// jamais les lignes qui suivent. Revenu au début quand un lot n'est pas plein.
	m.mu.Lock()
	apres := m.curseurEchues
	m.mu.Unlock()
	rows, err := m.cfg.DB.Query(`SELECT id FROM salons WHERE expires_at<=? AND id>? ORDER BY id LIMIT ?`,
		now, apres, lotLignes)
	if err != nil {
		return
	}
	var ids []string
	for rows.Next() {
		var id string
		if rows.Scan(&id) == nil {
			ids = append(ids, id)
		}
	}
	if errors.Join(rows.Err(), rows.Close()) != nil {
		return
	}
	suivant := ""
	if len(ids) == lotLignes {
		suivant = ids[len(ids)-1]
	}
	m.mu.Lock()
	m.curseurEchues = suivant
	m.mu.Unlock()
	for _, id := range ids {
		m.mu.Lock()
		_, enMemoire := m.salons[id]
		m.mu.Unlock()
		if enMemoire || m.effacerPiecesEnBase(id) != nil {
			continue
		}
		_, _ = m.cfg.DB.Exec(`DELETE FROM salons WHERE id=? AND expires_at<=? AND NOT EXISTS
			(SELECT 1 FROM salon_pieces WHERE salon_id=?)`, id, now, id)
	}
}

// Run : Tick chaque seconde jusqu'à l'annulation de ctx. Une panique dans un Tick est
// récupérée sans aucune sortie (ni journal ni stderr : le message pourrait citer un
// identifiant) et le tick suivant repart (revue finale C-2, mineur f) : une panique de
// l'entretien n'arrête pas tout le serveur, partages compris. Tous les verrous pris par Tick
// sont rendus par defer ; une fin interrompue reste « à faire » (achever) et est reprise.
func (m *Manager) Run(ctx context.Context) {
	t := time.NewTicker(time.Second)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
		m.tickSur()
	}
}

// tickSur : Tick, panique récupérée et comptée (paniquesTick), sans rien écrire.
func (m *Manager) tickSur() {
	defer func() {
		if recover() != nil {
			m.paniquesTick.Add(1)
		}
	}()
	m.Tick()
}

// PaniquesTick : paniques récupérées dans Tick depuis le démarrage (relecture C-2, N7) : un
// entier, sans identifiant ni message, en mémoire seulement. Lu par les tests ; shhdrop admin
// tourne hors du serveur et ne le voit pas (deploy/README.md §10).
func (m *Manager) PaniquesTick() int64 { return m.paniquesTick.Load() }

// PurgerAuDemarrage (plan, point 11) : à appeler une fois, avant toute autre méthode et avant
// l'écoute. Les clés des conversations, les jetons et les planchers des pièces étaient en
// mémoire : tout fichier de conversation et toute pièce sont effacés (fichiers d'abord, puis
// toutes les lignes salon_pieces, pieces_bytes = 0) ; les lignes des salons vivants restent
// (lien et mot de passe valables) ; salons échus et lignes à 10 essais supprimés. Dossiers
// ramenés à 0700 (MkdirAll ne resserre pas un dossier existant), puis vidage du WAL.
func (m *Manager) PurgerAuDemarrage() error {
	for _, d := range []string{m.cfg.DossierConversations, m.cfg.Pieces.Dir} {
		if err := viderDossier(d); err != nil {
			return err
		}
	}
	if err := m.cfg.Pieces.Resync(); err != nil {
		return es(err)
	}
	tx, err := m.cfg.DB.Begin()
	if err != nil {
		return base(err)
	}
	defer tx.Rollback()
	for _, q := range []string{
		`DELETE FROM salon_pieces`,
		`UPDATE salons SET pieces_bytes=0`,
		`DELETE FROM salons WHERE expires_at<=? OR failed_attempts>=?`,
	} {
		args := []any{}
		if strings.Contains(q, "?") {
			args = []any{m.cfg.Now().Unix(), maxEssais}
		}
		if _, err := tx.Exec(q, args...); err != nil {
			return base(err)
		}
	}
	if err := tx.Commit(); err != nil {
		return base(err)
	}
	return base(store.Checkpoint(m.cfg.DB))
}

// viderDossier : dossier d créé s'il manque, ramené à 0700, vidé, dates à l'epoch.
func viderDossier(d string) error {
	if err := os.MkdirAll(d, 0o700); err != nil {
		return es(err)
	}
	if err := os.Chmod(d, 0o700); err != nil {
		return es(err)
	}
	es0, err := os.ReadDir(d)
	if err != nil {
		return es(err)
	}
	for _, e := range es0 {
		if err := os.RemoveAll(filepath.Join(d, e.Name())); err != nil {
			return es(err)
		}
	}
	return sansDate(d)
}

// DetruireHorsLigne : commande d'administration (shhdrop admin destroy - d'un lien #c…),
// hors du serveur : le salon dont access_v = SHA-256(kAcces), vivant ou non, est supprimé :
// pièces (fichier puis ligne), fichier de conversation, ligne du salon ; puis vidage du WAL.
// Salon inconnu : ErrNotFound. Le serveur en marche voit la ligne disparue au tick suivant
// (Tick, lignes) : connexions fermées en raison 2, état oublié, place du bloc rendue.
func DetruireHorsLigne(db *sql.DB, pieces *blob.Store, dossierConv string, kAcces []byte) error {
	v := share.Verifier(kAcces)
	if v == nil {
		return ErrNotFound
	}
	var id string
	if err := db.QueryRow(`SELECT id FROM salons WHERE access_v=?`, v).Scan(&id); err != nil {
		return notFound(err)
	}
	if !idValide(id) {
		return ErrBase
	}
	m := &Manager{cfg: Config{DB: db, Pieces: pieces}}
	if err := m.effacerPiecesEnBase(id); err != nil {
		return err
	}
	if err := os.Remove(filepath.Join(dossierConv, id)); err != nil && !errors.Is(err, fs.ErrNotExist) {
		return es(err)
	}
	if _, err := db.Exec(`DELETE FROM salons WHERE id=? AND NOT EXISTS (SELECT 1 FROM salon_pieces WHERE salon_id=?)`,
		id, id); err != nil {
		return base(err)
	}
	return base(store.Checkpoint(db))
}

// EffacerTout : commande d'administration (shhdrop admin wipe --yes) : fichiers de pièces et
// de conversations effacés (fichiers d'abord ; les dossiers absents ne sont pas créés), puis
// toutes les lignes salon_pieces et salons ; rend le nombre de salons supprimés.
func EffacerTout(db *sql.DB, dossierPieces, dossierConv string) (int64, error) {
	for _, d := range []string{dossierPieces, dossierConv} {
		es0, err := os.ReadDir(d)
		if errors.Is(err, fs.ErrNotExist) {
			continue
		}
		if err != nil {
			return 0, es(err)
		}
		for _, e := range es0 {
			if err := os.RemoveAll(filepath.Join(d, e.Name())); err != nil {
				return 0, es(err)
			}
		}
	}
	tx, err := db.Begin()
	if err != nil {
		return 0, base(err)
	}
	defer tx.Rollback()
	if _, err := tx.Exec(`DELETE FROM salon_pieces`); err != nil {
		return 0, base(err)
	}
	res, err := tx.Exec(`DELETE FROM salons`)
	if err != nil {
		return 0, base(err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return 0, base(err)
	}
	if err := tx.Commit(); err != nil {
		return 0, base(err)
	}
	return n, base(store.Checkpoint(db))
}
