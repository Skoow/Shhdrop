package compte

import (
	"cmp"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"database/sql"
	"errors"
	"net/netip"
	"slices"
	"sync"
	"time"
)

// Sessions (conception §8.5) : jeton de 32 octets (crypto/rand) rendu une fois, envoyé dans
// X-Shh-Session ; la base n'en garde que SHA-256 (t_v), un sid aléatoire montré dans la liste,
// le mois d'ajout et le jour d'échéance. Aucune heure, aucune adresse IP, aucun nom d'appareil
// en clair (etiquette : chiffrée par le client).
//
//   - simple : 2 h sans usage (suivi en mémoire), et au plus jusqu'à la fin du jour UTC suivant
//     (expire_jour fixé à la création) ;
//   - « rester connecté » : 30 jours sans usage (expire_jour reculé au plus une fois par jour),
//     90 jours au plus. Écart assumé : la base ne garde que le mois d'ajout (cree_mois, §8.2) ;
//     le plafond est compté depuis ce mois (cree_mois + 90 jours), donc entre 59 et 90 jours
//     après la création, jamais plus. Un plafond exact demanderait le jour d'ajout (signalé).
//   - récente : moins de 5 min après la connexion ou un reauth juste (mémoire).
//
// Un redémarrage remet l'inactivité à zéro (depuis le démarrage) sans prolonger aucun plafond.
const (
	inactiviteSimple = 2 * time.Hour
	dureeRecente     = 5 * time.Minute
	joursSansUsage   = 30
	joursPlafond     = 90
	sessionsMax      = 20
)

// activite : dernier usage et fin de la « session récente », en mémoire.
type activite struct {
	vu, recente time.Time
}

// activites : t_v → activité (allowedMaps de stats_test.go), son propre verrou (appelé sous
// s.mu par InscriptionFin).
type activites struct {
	mu     sync.Mutex
	m      map[[32]byte]activite
	debut  time.Time // démarrage : dernier usage supposé d'une session absente de la table
	balaye time.Time
}

// lire : activité de tv (absente : aucun usage depuis le démarrage) ; balayage au plus une
// fois par minute des entrées qui ne servent plus (inactives depuis 2 h, plus récentes).
func (a *activites) lire(tv [32]byte, now time.Time) activite {
	a.mu.Lock()
	defer a.mu.Unlock()
	if now.Sub(a.balaye) >= time.Minute {
		a.balaye = now
		for k, v := range a.m {
			if now.Sub(v.vu) >= inactiviteSimple && !now.Before(v.recente) {
				delete(a.m, k)
			}
		}
	}
	if v, ok := a.m[tv]; ok {
		return v
	}
	return activite{vu: a.debut}
}

func (a *activites) ecrire(tv [32]byte, v activite) {
	a.mu.Lock()
	a.m[tv] = v
	a.mu.Unlock()
}

func (a *activites) oublier(tv [32]byte) {
	a.mu.Lock()
	delete(a.m, tv)
	a.mu.Unlock()
}

// Courante : la session de la requête.
type Courante struct {
	H       [16]byte
	Sid     [16]byte
	Recente bool
	tv      [32]byte
}

// SessionVue : une ligne de la liste des appareils (§8.5).
type SessionVue struct {
	Sid         [16]byte
	Ajoutee     string // « 2026-11 »
	Etiquette   []byte // 64 octets chiffrés par le client, ou nil
	Courante    bool
	Persistante bool
}

func plafond(creeMois int64) int64 { return creeMois + joursPlafond*jourS }

func echeance(persistante bool, creeMois int64, now time.Time) int64 {
	if !persistante {
		return jourDe(now) + 2*jourS
	}
	return min(jourDe(now)+joursSansUsage*jourS, plafond(creeMois))
}

// creerSessionTx : nouvelle session de h (récente) ; au-delà de 20, les plus anciennes sont
// fermées.
func (s *Service) creerSessionTx(tx *sql.Tx, h [16]byte, o OptionsSession, now time.Time) ([32]byte, error) {
	var jeton [32]byte
	var sid [16]byte
	rand.Read(jeton[:])
	rand.Read(sid[:])
	tv := sha256.Sum256(jeton[:])
	if err := s.fermerPlusAnciennesTx(tx, h, now); err != nil {
		return jeton, err
	}
	m := moisDe(now)
	var etiq any
	if o.Etiquette != nil {
		etiq = o.Etiquette
	}
	if _, err := tx.Exec(`INSERT INTO sessions(t_v, sid, h, etiquette, cree_mois, expire_jour, persistante)
		VALUES(?,?,?,?,?,?,?)`, tv[:], sid[:], h[:], etiq, m, echeance(o.Persistante, m, now),
		boolInt(o.Persistante)); err != nil {
		return jeton, err
	}
	s.act.ecrire(tv, activite{vu: now, recente: now.Add(dureeRecente)})
	return jeton, nil
}

// fermerPlusAnciennesTx : avant d'en ouvrir une, garde 19 sessions au plus : ferme les plus
// anciennes (mois d'ajout, puis dernier usage connu en mémoire : la base n'a pas d'heure).
func (s *Service) fermerPlusAnciennesTx(tx *sql.Tx, h [16]byte, now time.Time) error {
	rows, err := tx.Query(`SELECT t_v, cree_mois FROM sessions WHERE h=?`, h[:])
	if err != nil {
		return err
	}
	type ligne struct {
		tv   [32]byte
		mois int64
		vu   time.Time
	}
	var ls []ligne
	for rows.Next() {
		var l ligne
		var tv []byte
		if err := rows.Scan(&tv, &l.mois); err != nil || len(tv) != 32 {
			rows.Close()
			return errors.Join(err, errors.New("compte : t_v"))
		}
		l.tv = [32]byte(tv)
		l.vu = s.act.lire(l.tv, now).vu
		ls = append(ls, l)
	}
	rows.Close()
	if err := rows.Err(); err != nil || len(ls) < sessionsMax {
		return err
	}
	slices.SortFunc(ls, func(a, b ligne) int {
		if c := cmp.Compare(a.mois, b.mois); c != 0 {
			return c
		}
		return a.vu.Compare(b.vu)
	})
	for _, l := range ls[:len(ls)-(sessionsMax-1)] {
		if _, err := tx.Exec(`DELETE FROM sessions WHERE t_v=?`, l.tv[:]); err != nil {
			return err
		}
		s.act.oublier(l.tv)
	}
	return nil
}

// Session : la session du jeton, ou ErrSession (inconnue, échue : la ligne est alors effacée).
// Chaque usage compte : inactivité remise à zéro, échéance d'une session persistante reculée
// (au plus une fois par jour), vu_mois du compte (au plus une fois par mois).
func (s *Service) Session(jeton [32]byte) (Courante, error) {
	now := s.now()
	tv := sha256.Sum256(jeton[:])
	var c Courante
	var creeMois, expire, vuMois int64
	var pers int
	err := s.db.QueryRow(`SELECT s.h, s.sid, s.cree_mois, s.expire_jour, s.persistante, c.vu_mois
		FROM sessions s JOIN comptes c ON c.h = s.h WHERE s.t_v=?`, tv[:]).Scan(
		(*octets16)(&c.H), (*octets16)(&c.Sid), &creeMois, &expire, &pers, &vuMois)
	if errors.Is(err, sql.ErrNoRows) {
		return Courante{}, ErrSession
	}
	if err != nil {
		return Courante{}, err
	}
	a := s.act.lire(tv, now)
	if now.Unix() >= expire || (pers == 0 && now.Sub(a.vu) >= inactiviteSimple) {
		s.act.oublier(tv)
		if _, err := s.db.Exec(`DELETE FROM sessions WHERE t_v=?`, tv[:]); err != nil {
			return Courante{}, err
		}
		return Courante{}, ErrSession
	}
	a.vu = now
	s.act.ecrire(tv, a)
	if n := echeance(true, creeMois, now); pers == 1 && n > expire {
		if _, err := s.db.Exec(`UPDATE sessions SET expire_jour=? WHERE t_v=?`, n, tv[:]); err != nil {
			return Courante{}, err
		}
	}
	if m := moisDe(now); vuMois != m {
		if _, err := s.db.Exec(`UPDATE comptes SET vu_mois=? WHERE h=?`, m, c.H[:]); err != nil {
			return Courante{}, err
		}
	}
	c.Recente, c.tv = now.Before(a.recente), tv
	return c, nil
}

// Reauth : mot de passe redemandé (A_auth), et code de l'application si la double
// authentification est active (totp vide : totp_requis), pour une session récente pendant
// 5 min. Échecs du mot de passe comptés comme ceux de la connexion (même limite par connexion,
// même preuve par compte) ; échecs du code comme ceux de la double authentification.
func (s *Service) Reauth(ip netip.Addr, c Courante, aAuth [32]byte, totp string) error {
	now := s.now()
	if !s.lim.AllowEchecConnexion(ip) {
		return ErrLimit{heureSuivante(now)}
	}
	var vm, ec, scelle []byte
	if err := s.db.QueryRow(`SELECT v_mdp, e_canon, totp FROM comptes WHERE h=?`, c.H[:]).Scan(&vm, &ec, &scelle); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return ErrSession
		}
		return err
	}
	v := hmacMdp(&s.cles.Poivre, &c.H, &aAuth)
	if subtle.ConstantTimeCompare(v[:], vm) != 1 {
		s.lim.NoterEchecConnexion(ip, [32]byte(ec))
		return ErrIdentifiants
	}
	if scelle != nil {
		if totp == "" {
			return ErrTOTPRequis
		}
		s.mu.Lock()
		err := s.verifierTOTPLocked(c.H, scelle, totp, now)
		s.mu.Unlock()
		if err != nil {
			return err
		}
		if err := annulerRetrait(s.db, c.H); err != nil {
			return err
		}
	}
	a := s.act.lire(c.tv, now)
	a.recente = now.Add(dureeRecente)
	s.act.ecrire(c.tv, a)
	return nil
}

// Deconnexion : la session courante est oubliée.
func (s *Service) Deconnexion(c Courante) error {
	s.act.oublier(c.tv)
	_, err := s.db.Exec(`DELETE FROM sessions WHERE t_v=?`, c.tv[:])
	return err
}

// Sessions : la liste des appareils du compte (§8.5).
func (s *Service) Sessions(c Courante) ([]SessionVue, error) {
	rows, err := s.db.Query(`SELECT sid, cree_mois, etiquette, persistante, t_v FROM sessions WHERE h=?
		ORDER BY cree_mois, sid`, c.H[:])
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []SessionVue
	for rows.Next() {
		var v SessionVue
		var m int64
		var pers int
		var tv []byte
		if err := rows.Scan((*octets16)(&v.Sid), &m, &v.Etiquette, &pers, &tv); err != nil {
			return nil, err
		}
		v.Ajoutee = time.Unix(m, 0).UTC().Format("2006-01")
		v.Persistante = pers == 1
		v.Courante = subtle.ConstantTimeCompare(tv, c.tv[:]) == 1
		out = append(out, v)
	}
	return out, rows.Err()
}

// FermerSession : ferme la session sid du même compte ; inconnue : ErrEtape (not_found).
func (s *Service) FermerSession(c Courante, sid [16]byte) error {
	r, err := s.db.Exec(`DELETE FROM sessions WHERE h=? AND sid=?`, c.H[:], sid[:])
	if err != nil {
		return err
	}
	if n, _ := r.RowsAffected(); n == 0 {
		return ErrEtape
	}
	return nil
}

// FermerAutres : toutes les sessions du compte sauf la courante.
func (s *Service) FermerAutres(c Courante) error {
	_, err := s.db.Exec(`DELETE FROM sessions WHERE h=? AND t_v<>?`, c.H[:], c.tv[:])
	return err
}
