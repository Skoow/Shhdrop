package compte

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha1"
	"crypto/subtle"
	"database/sql"
	"encoding/base32"
	"encoding/binary"
	"errors"
	"fmt"
	"time"
)

// Double authentification (conception §8.4, §21.2.4 ; plan lot 5). TOTP de la RFC 6238 :
// HOTP de la RFC 4226 (HMAC-SHA-1 de crypto/hmac et crypto/sha1, troncature dynamique) sur le
// pas de 30 s depuis l'époque Unix, 6 chiffres, tolérance d'un pas de chaque côté. Écart au
// plan (github.com/pquerna/otp) : décision du propriétaire du 14 novembre, aucune dépendance de
// plus ; c'est l'algorithme standard sur les primitives de la bibliothèque standard, prouvé par
// les vecteurs de la RFC 6238 (TestTOTPVecteursRFC6238), pas une construction nouvelle.
//
// Secret : 20 octets tirés par le serveur (crypto/rand), rendu une fois en base32 par
// TOTPDebut, gardé seulement scellé : totp = nonce (12) ‖ AES-256-GCM(K_totp, nonce, secret,
// AD = « SHH-TOTP1 » ‖ h) = 48 octets. Rejeu : le plus grand pas accepté par compte est gardé
// en mémoire tant qu'un code de ce pas peut encore passer (limite dite en §8.3 : un redémarrage
// l'oublie).
const (
	periodeTOTP = 30
	adTOTP      = "SHH-TOTP1"
	tailleTOTP  = 20
)

var (
	// ErrTOTPFaux : code de l'application faux (ou mal formé).
	ErrTOTPFaux = errors.New("totp_faux")
	// ErrTOTPRejoue : code juste mais déjà accepté (ou plus ancien qu'un code accepté) : « Ce
	// code a déjà servi. Attendez le suivant. »
	ErrTOTPRejoue = errors.New("totp_rejoue")
)

// pasTOTP : plus grand pas accepté pour un compte (mémoire ; allowedMaps de stats_test.go).
type pasTOTP struct{ pas uint64 }

func pasDe(t time.Time) uint64 { return uint64(t.Unix()) / periodeTOTP }

// hotp : RFC 4226 §5.3 (HMAC-SHA-1, troncature dynamique), chiffres décimaux (6 ; 8 pour les
// vecteurs de la RFC 6238).
func hotp(secret []byte, compteur uint64, chiffres int) string {
	var c [8]byte
	binary.BigEndian.PutUint64(c[:], compteur)
	m := hmac.New(sha1.New, secret)
	m.Write(c[:])
	s := m.Sum(nil)
	o := s[len(s)-1] & 0x0f
	v := binary.BigEndian.Uint32(s[o:o+4]) & 0x7fffffff
	mod := uint32(1)
	for range chiffres {
		mod *= 10
	}
	return fmt.Sprintf("%0*d", chiffres, v%mod)
}

func scellerTOTP(cle *[32]byte, h [16]byte, secret []byte) ([48]byte, error) {
	var out [48]byte
	g, err := gcmSequestre(cle)
	if err != nil {
		return out, err
	}
	rand.Read(out[:12])
	g.Seal(out[12:12], out[:12], secret, append([]byte(adTOTP), h[:]...))
	return out, nil
}

var errTOTPIllisible = errors.New("secret TOTP illisible")

func ouvrirTOTP(cle *[32]byte, h [16]byte, c []byte) ([]byte, error) {
	g, err := gcmSequestre(cle)
	if err != nil {
		return nil, err
	}
	if len(c) != 48 {
		return nil, errTOTPIllisible
	}
	p, err := g.Open(nil, c[:12], c[12:], append([]byte(adTOTP), h[:]...))
	if err != nil || len(p) != tailleTOTP {
		return nil, errTOTPIllisible
	}
	return p, nil
}

// verifierTOTPLocked : code de l'application pour le compte h (secret scellé), s.mu tenu.
// 10 échecs par heure par compte, puis ErrLimit (rien n'est alors vérifié ni compté). Les trois
// pas de la fenêtre sont toujours calculés et comparés en temps constant ; le plus grand pas
// juste est retenu ; s'il n'est pas plus grand que le dernier accepté : rejeu.
func (s *Service) verifierTOTPLocked(h [16]byte, scelle []byte, code string, now time.Time) error {
	if !s.lim.AllowTOTP(h) {
		return ErrLimit{heureSuivante(now)}
	}
	sec, err := ouvrirTOTP(&s.cles.TOTP, h, scelle)
	if err != nil {
		return err
	}
	defer clear(sec)
	p := pasDe(now)
	for k, v := range s.pas { // ce qui ne peut plus être rejoué
		if v.pas+1 < p {
			delete(s.pas, k)
		}
	}
	juste, pas := 0, uint64(0)
	for q := p - 1; q <= p+1; q++ {
		if subtle.ConstantTimeCompare([]byte(hotp(sec, q, 6)), []byte(code)) == 1 {
			juste, pas = 1, q
		}
	}
	if juste != 1 || !codeForme(code) {
		s.lim.NoterEchecTOTP(h)
		return ErrTOTPFaux
	}
	if v, ok := s.pas[h]; ok && pas <= v.pas {
		s.lim.NoterEchecTOTP(h)
		return ErrTOTPRejoue
	}
	s.pas[h] = pasTOTP{pas}
	return nil
}

// totpEchoue : un essai de moins sur l'étape pour un code d'application refusé ; au 5e, l'étape
// meurt. Une limite atteinte ne coûte pas d'essai.
func (s *Service) totpEchoue(jeton [32]byte, e *etape, err error) error {
	if errors.Is(err, ErrTOTPFaux) || errors.Is(err, ErrTOTPRejoue) {
		e.essaisTOTP--
		if e.essaisTOTP <= 0 {
			s.et.retirer(jeton)
		}
	}
	return err
}

// annulerRetrait : un code d'application juste annule la demande de retrait (R3).
func annulerRetrait(q interface {
	Exec(string, ...any) (sql.Result, error)
}, h [16]byte) error {
	_, err := q.Exec(`UPDATE comptes SET totp_retrait_jour=NULL WHERE h=? AND totp_retrait_jour IS NOT NULL`, h[:])
	return err
}

// lireTOTP : secret scellé du compte (nil : double authentification inactive).
func (s *Service) lireTOTP(h [16]byte) ([]byte, error) {
	var v []byte
	err := s.db.QueryRow(`SELECT totp FROM comptes WHERE h=?`, h[:]).Scan(&v)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrSession
	}
	return v, err
}

// TOTPDebut (session récente) : tire un secret, gardé scellé dans une étape de 15 min ; rendu
// une fois en base32 (32 caractères). Déjà active : bad_request.
func (s *Service) TOTPDebut(c Courante) ([32]byte, string, error) {
	if !c.Recente {
		return [32]byte{}, "", ErrRecent
	}
	v, err := s.lireTOTP(c.H)
	if err != nil {
		return [32]byte{}, "", err
	}
	if v != nil {
		return [32]byte{}, "", ErrRequete
	}
	sec := make([]byte, tailleTOTP)
	defer clear(sec)
	rand.Read(sec)
	scelle, err := scellerTOTP(&s.cles.TOTP, c.H, sec)
	if err != nil {
		return [32]byte{}, "", err
	}
	e := &etape{sorte: etapeTOTPActivation, h: c.H, secret: scelle, essaisTOTP: essaisCode}
	now := s.now()
	s.mu.Lock()
	jeton, err := s.nouvelleEtapeLocked(e, now)
	s.mu.Unlock()
	if err != nil {
		return [32]byte{}, "", err
	}
	return jeton, base32.StdEncoding.EncodeToString(sec), nil
}

// TOTPFin (session récente, même compte) : un premier code juste écrit le secret scellé ;
// 5 essais par étape.
func (s *Service) TOTPFin(c Courante, jeton [32]byte, code string) error {
	if !c.Recente {
		return ErrRecent
	}
	now := s.now()
	s.mu.Lock()
	defer s.mu.Unlock()
	e := s.et.trouver(jeton, etapeTOTPActivation, now)
	if e == nil || subtle.ConstantTimeCompare(e.h[:], c.H[:]) != 1 {
		return ErrEtape
	}
	if err := s.verifierTOTPLocked(c.H, e.secret[:], code, now); err != nil {
		return s.totpEchoue(jeton, e, err)
	}
	s.et.retirer(jeton)
	_, err := s.db.Exec(`UPDATE comptes SET totp=?, totp_retrait_jour=NULL WHERE h=? AND totp IS NULL`, e.secret[:], c.H[:])
	return err
}

// TOTPRetirer (session récente : avec la double authentification active, le reauth a exigé
// un code de l'application) : secret effacé, demande de retrait aussi.
func (s *Service) TOTPRetirer(c Courante) error {
	if !c.Recente {
		return ErrRecent
	}
	_, err := s.db.Exec(`UPDATE comptes SET totp=NULL, totp_retrait_jour=NULL WHERE h=?`, c.H[:])
	return err
}

// TOTPAnnulerRetrait (session, même non récente) : « Ce n'est pas vous ? Annuler » (§21.2.4).
func (s *Service) TOTPAnnulerRetrait(c Courante) error {
	return annulerRetrait(s.db, c.H)
}

// ConnexionTOTP : étape d'une connexion (5 min) et code de l'application ; la session n'est
// créée qu'ici. 5 essais par étape. Le code juste annule une demande de retrait (R3).
func (s *Service) ConnexionTOTP(jeton [32]byte, code string) (Ouverture, error) {
	now := s.now()
	s.mu.Lock()
	defer s.mu.Unlock()
	e := s.et.trouver(jeton, etapeConnexionTOTP, now)
	if e == nil {
		return Ouverture{}, ErrEtape
	}
	l, scelle, err := s.ligne(e.h)
	if err != nil || scelle == nil {
		s.et.retirer(jeton)
		return Ouverture{}, ErrEtape
	}
	if err := s.verifierTOTPLocked(e.h, scelle, code, now); err != nil {
		return Ouverture{}, s.totpEchoue(jeton, e, err)
	}
	s.et.retirer(jeton)
	if err := annulerRetrait(s.db, e.h); err != nil {
		return Ouverture{}, err
	}
	return s.ouvrir(l, e.options, now)
}

// ligne : ce que la connexion lit d'un compte, par h, avec le secret TOTP scellé (ou nil).
func (s *Service) ligne(h [16]byte) (ligneConnexion, []byte, error) {
	var l ligneConnexion
	var vm, em, cp, totp []byte
	err := s.db.QueryRow(`SELECT h, v_mdp, env_mdp, cle_profil, blob_profil, gen_profil, blob_prive, gen_prive,
		totp, vu_mois FROM comptes WHERE h=?`, h[:]).Scan(
		(*octets16)(&l.h), &vm, &em, &cp, &l.blobProfil, &l.genProfil, &l.blobPrive, &l.genPrive, &totp, &l.vuMois)
	if err != nil {
		return l, nil, err
	}
	copy(l.vMdp[:], vm)
	copy(l.envMdp[:], em)
	copy(l.cleProfil[:], cp)
	l.totp = totp != nil
	return l, totp, nil
}
