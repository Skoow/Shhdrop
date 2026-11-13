// Package salon : état et protocole du salon chiffré (spécification v3, plan C-2). Le serveur
// ne déchiffre rien : il ne lit que l'octet drapeaux de chaque trame.
package salon

import "errors"

// TailleTrame : taille fixe d'une trame (v3 §3.2.1) : "SHC3" (4) ‖ drapeaux (1) ‖ nonce (24) ‖
// chiffré XChaCha20-Poly1305 (4 095 + 16).
const TailleTrame = 4140

// marque : 4 premiers octets de toute trame.
const marque = "SHC3"

// Regle : règle d'effacement portée par les bits 1–2 de drapeaux.
type Regle uint8

// Effacement « vu par tous + délai » (décision du propriétaire du 13 novembre, effacement.go) :
// les règles 1 à 3 attendent que tous les sièges présents à l'envoi (expéditeur exclu) aient lu
// la trame (0x05), ou soient partis, puis l'effacent après leur délai ; la règle 0 garde la
// trame jusqu'à la fin du salon ou son renouvellement (trames de protocole, messages de
// fichier). Avant le 13 novembre : 1 « instantané » (effacée à la dernière lecture), 2 et 3
// comptées depuis la réception (10 min, 1 h).
const (
	Desactive   Regle = 0 // jamais effacée avant la fin ou le renouvellement du salon (sauf retrait)
	UneMinute   Regle = 1 // 60 000 ms après la dernière lecture attendue
	CinqMinutes Regle = 2 // 300 000 ms après la dernière lecture attendue
	UneHeure    Regle = 3 // 3 600 000 ms après la dernière lecture attendue
)

// EnTete : ce que le serveur lit d'une trame, sans clé.
type EnTete struct {
	Volatile bool // bit 0 : jamais rangée sur disque, jamais servie au rattrapage
	Regle    Regle
}

// ErrEnTete : taille différente de TailleTrame, marque fausse ou bit réservé (3 à 7) non nul
// (« en_tete_invalide » du moteur, lire_en_tete).
var ErrEnTete = errors.New("salon: en-tête de trame invalide")

// LireEnTete : copie Go de lire_en_tete du moteur (engine/salon), vérifiée contre
// engine/vectors/salon-v3.json (trames.seal, trames.reject).
func LireEnTete(trame []byte) (EnTete, error) {
	if len(trame) != TailleTrame || string(trame[:len(marque)]) != marque {
		return EnTete{}, ErrEnTete
	}
	d := trame[len(marque)]
	if d&^0b111 != 0 {
		return EnTete{}, ErrEnTete
	}
	return EnTete{Volatile: d&1 == 1, Regle: Regle(d >> 1)}, nil
}
