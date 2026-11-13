package salon

import (
	"encoding/base64"
	"encoding/binary"
	"errors"
	"time"
)

// Protocole du WebSocket du salon (plan C-2, « Protocole ») : messages binaires, entiers
// gros-boutistes.

const (
	// TailleAccueil : premier message du client, jeton (43 caractères base64url) ‖ depuis (8).
	TailleAccueil = 51
	// LimiteLecture : limite de lecture du WebSocket (SetReadLimit) ; la plus grande demande
	// (trame ‖ pièce) fait 4 157 octets.
	LimiteLecture = 4200
	// DepuisReprise : valeur de depuis qui demande une reprise (nouveau nonce_arrivée, aucun
	// rattrapage ; plan, point 5).
	DepuisReprise uint64 = 1<<64 - 1
)

// tailleJeton : jeton de membre en base64url sans bourrage (32 octets).
const tailleJeton = 43

// ErrProtocole : message du client hors de la table (taille inexacte, type inconnu, accueil
// invalide). Le WebSocket est alors fermé (CodeAccueil pour l'accueil, CodeInvalide ensuite).
var ErrProtocole = errors.New("salon: message invalide")

// Accueil : premier message du client.
type Accueil struct {
	Jeton   [32]byte
	Depuis  uint64
	Reprise bool // Depuis == DepuisReprise
}

var b64 = base64.RawURLEncoding.Strict()

// LireAccueil : exactement 51 octets, jeton en base64url canonique (alphabet vérifié avant
// décodage : le décodeur de Go ignore \r et \n même en mode Strict, comme share.DecodeB64).
func LireAccueil(b []byte) (Accueil, error) {
	if len(b) != TailleAccueil {
		return Accueil{}, ErrProtocole
	}
	for _, c := range b[:tailleJeton] {
		if !(c >= 'A' && c <= 'Z' || c >= 'a' && c <= 'z' || c >= '0' && c <= '9' || c == '-' || c == '_') {
			return Accueil{}, ErrProtocole
		}
	}
	var a Accueil
	if n, err := b64.Decode(a.Jeton[:], b[:tailleJeton]); err != nil || n != len(a.Jeton) {
		return Accueil{}, ErrProtocole
	}
	a.Depuis = binary.BigEndian.Uint64(b[tailleJeton:])
	a.Reprise = a.Depuis == DepuisReprise
	return a, nil
}

// Types des demandes du client (type (1) ‖ corps).
const (
	DemTrame   byte = 0x01 // trame (4 140), ou trame ‖ identifiant de pièce (16)
	DemRetirer byte = 0x02 // seq (8)
	DemQuitter byte = 0x03 // vide
	DemPing    byte = 0x04 // 8 octets, rendus dans un pong
	DemLu      byte = 0x05 // seq (8)
)

// Demande : message du client après l'accueil. Trame et Piece désignent des octets de la
// tranche lue (aucune copie) : la tranche ne doit pas être réutilisée tant qu'elles servent.
type Demande struct {
	Type  byte
	Trame []byte    // DemTrame
	Piece *[16]byte // DemTrame avec pièce liée, sinon nil
	Seq   uint64    // DemRetirer, DemLu
	Ping  [8]byte   // DemPing
}

// LireDemande : demande de la table « Client → serveur », taille exacte. Une trame à
// l'en-tête illisible donne ErrEnTete ; tout autre écart, ErrProtocole.
func LireDemande(b []byte) (Demande, error) {
	if len(b) == 0 {
		return Demande{}, ErrProtocole
	}
	d := Demande{Type: b[0]}
	corps := b[1:]
	switch d.Type {
	case DemTrame:
		switch len(corps) {
		case TailleTrame:
		case TailleTrame + 16:
			d.Piece = (*[16]byte)(corps[TailleTrame:])
		default:
			return Demande{}, ErrProtocole
		}
		d.Trame = corps[:TailleTrame:TailleTrame]
		if _, err := LireEnTete(d.Trame); err != nil {
			return Demande{}, err
		}
	case DemRetirer, DemLu:
		if len(corps) != 8 {
			return Demande{}, ErrProtocole
		}
		d.Seq = binary.BigEndian.Uint64(corps)
	case DemQuitter:
		if len(corps) != 0 {
			return Demande{}, ErrProtocole
		}
	case DemPing:
		if len(corps) != 8 {
			return Demande{}, ErrProtocole
		}
		d.Ping = [8]byte(corps)
	default:
		return Demande{}, ErrProtocole
	}
	return d, nil
}

// Raisons de fin (enregistrement 0x05). 3 (« budget de flux ») est réservé, jamais émis
// (plan, point 20).
const (
	RaisonExpire   uint8 = 1
	RaisonDetruit  uint8 = 2
	RaisonRemplace uint8 = 4
	RaisonExclu    uint8 = 5
	RaisonTropLent uint8 = 6
)

// Codes de fermeture du WebSocket (plan, point 19, et table « Codes de fermeture » du
// « Protocole ») ; 1011 : CodeInterne (connexion.go) ; 1009 : posé par la bibliothèque.
const (
	CodeFin      = 1000 // fin du salon, ou départ demandé (0x03)
	CodeArret    = 1001 // arrêt du serveur, ou silence de 45 s (même conduite du client : reconnexion)
	CodeAccueil  = 4001 // accueil absent ou invalide
	CodeRevoque  = 4002 // jeton révoqué (exclusion)
	CodeInvalide = 4003 // message invalide
	CodeInconnu  = 4004 // jeton inconnu (place libérée, salon fini, redémarrage)
	CodeRemplace = 4005 // remplacé par une autre connexion du même jeton
	CodeTropLent = 4006 // client trop lent
)

// SansExclu : siège de l'enregistrement d'exclusion quand personne n'est exclu.
const SansExclu uint8 = 0xFF

// Annonce : siège occupé, son nonce_arrivée et la dernière connexion de son occupant
// (enregistrement 0x0D ; minutes Unix, 0 = inconnue ou en ligne, Task 9b).
type Annonce struct {
	Siege       uint8
	Nonce       [16]byte
	DerniereMin uint64
}

// enr : enregistrement type (1) ‖ seq (8) ‖ n octets de données, alloué une fois à sa taille.
func enr(ty byte, seq uint64, n int) []byte {
	b := make([]byte, 9, 9+n)
	b[0] = ty
	binary.BigEndian.PutUint64(b[1:], seq)
	return b
}

// EnrTrame : 0x01, siège ‖ reçue à (ms Unix) ‖ trame, 4 158 octets. La trame est copiée ;
// elle doit faire TailleTrame octets (sinon panique : erreur de programmation).
func EnrTrame(seq uint64, siege uint8, recuMs int64, trame []byte) []byte {
	if len(trame) != TailleTrame {
		panic("salon: EnrTrame, taille de trame")
	}
	b := append(enr(0x01, seq, 1+8+TailleTrame), siege)
	b = binary.BigEndian.AppendUint64(b, uint64(recuMs))
	return append(b, trame...)
}

// EnrArrivee : 0x02, siège ‖ nonce_arrivée.
func EnrArrivee(seq uint64, siege uint8, nonce [16]byte) []byte {
	return append(append(enr(0x02, seq, 17), siege), nonce[:]...)
}

// EnrDepart : 0x03, siège.
func EnrDepart(seq uint64, siege uint8) []byte { return append(enr(0x03, seq, 1), siege) }

// EnrFin : 0x05, raison (Raison*).
func EnrFin(seq uint64, raison uint8) []byte { return append(enr(0x05, seq, 1), raison) }

// EnrPresence : 0x07, siège ‖ 1 en ligne / 0 hors ligne ‖ dernière connexion (minutes Unix,
// 8 octets), 19 octets en tout (Task 9b, spec v3 §14.1). 0 = inconnue ou en ligne : en
// ligne, derniereMin est ignorée.
func EnrPresence(seq uint64, siege uint8, enLigne bool, derniereMin uint64) []byte {
	var v byte
	if enLigne {
		v, derniereMin = 1, 0
	}
	return binary.BigEndian.AppendUint64(append(enr(0x07, seq, 2+8), siege, v), derniereMin)
}

// EnrPong : 0x08, les 8 octets du ping.
func EnrPong(seq uint64, ping [8]byte) []byte { return append(enr(0x08, seq, 8), ping[:]...) }

// EnrExclusion : 0x09, siège (SansExclu sans exclu) ‖ nonce_arrivée ‖ r.
func EnrExclusion(seq uint64, siege uint8, nonce [16]byte, r uint32) []byte {
	b := append(append(enr(0x09, seq, 1+16+4), siege), nonce[:]...)
	return binary.BigEndian.AppendUint32(b, r)
}

// EnrReprise : 0x0A, siège ‖ nouveau nonce_arrivée.
func EnrReprise(seq uint64, siege uint8, nonce [16]byte) []byte {
	return append(append(enr(0x0A, seq, 17), siege), nonce[:]...)
}

// EnrLimite : 0x0B, secondes à attendre.
func EnrLimite(seq uint64, secondes uint32) []byte {
	return binary.BigEndian.AppendUint32(enr(0x0B, seq, 4), secondes)
}

// EnrPlein : 0x0C, trame non rangée (disque plein).
func EnrPlein(seq uint64) []byte { return enr(0x0C, seq, 0) }

// EnrListe : 0x0D, créateur ‖ n ‖ n × (siège ‖ nonce_arrivée ‖ dernière connexion (8)),
// 11 + 25n octets ; seq = rang où elle s'applique. Plus de 255 annonces : panique (erreur de
// programmation ; 10 sièges au plus).
func EnrListe(seq uint64, createur uint8, liste []Annonce) []byte {
	if len(liste) > 255 {
		panic("salon: EnrListe, trop d'annonces")
	}
	b := append(enr(0x0D, seq, 2+tailleAnnonce*len(liste)), createur, uint8(len(liste)))
	for _, a := range liste {
		b = binary.BigEndian.AppendUint64(append(append(b, a.Siege), a.Nonce[:]...), a.DerniereMin)
	}
	return b
}

// tailleAnnonce : siège (1) ‖ nonce_arrivée (16) ‖ dernière connexion (8).
const tailleAnnonce = 1 + 16 + 8

// minuteUnix : minutes Unix de t, arrondies à la minute inférieure (dernière connexion,
// Task 9b) ; 0 (inconnue) avant 1970.
func minuteUnix(t time.Time) uint64 {
	u := t.Unix()
	if u < 0 {
		return 0
	}
	return uint64(u / 60)
}

// EnrAcceptee : 0x0F, 9 octets ; seq = rang de la trame 0x01 acceptée (revue finale C-2, I1).
// Remis à l'expéditeur seul, en direct comme en rattrapage : il règle sa trame en vol même
// s'il n'en verra jamais l'écho (volatile, « instantané » effacée avant son rattrapage). Ne
// prend pas de rang ; en rattrapage, il peut précéder l'écho de sa trame.
func EnrAcceptee(seq uint64) []byte { return enr(0x0F, seq, 0) }

// EnrEfface : 0x0E, seq de la trame effacée.
func EnrEfface(seq, cible uint64) []byte {
	return binary.BigEndian.AppendUint64(enr(0x0E, seq, 8), cible)
}
