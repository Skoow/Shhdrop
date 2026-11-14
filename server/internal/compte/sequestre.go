package compte

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"errors"
)

// Séquestre du profil (conception §21.2.2, exception R-D1 validée par le propriétaire le
// 14 novembre) : cle_profil = nonce (12) ‖ AES-256-GCM(K_sequestre, nonce, s_profil,
// AD = « SHH-CSEQ1 » ‖ h) = 60 octets. s_profil n'ouvre que le coffre de profil (K_profil =
// HKDF(s_profil)) ; le coffre privé reste chiffré par K_compte, que le serveur ne reçoit
// jamais. Scellé à InscriptionFin, ouvert seulement pour rendre s_profil à une connexion (et,
// au lot 5, à la récupération) ; jamais journalisé.

const adSequestre = "SHH-CSEQ1"

func gcmSequestre(cle *[32]byte) (cipher.AEAD, error) {
	b, err := aes.NewCipher(cle[:])
	if err != nil {
		return nil, err
	}
	return cipher.NewGCM(b)
}

func sceller(cle *[32]byte, h [16]byte, sProfil [32]byte) ([60]byte, error) {
	var out [60]byte
	g, err := gcmSequestre(cle)
	if err != nil {
		return out, err
	}
	rand.Read(out[:12])
	g.Seal(out[12:12], out[:12], sProfil[:], append([]byte(adSequestre), h[:]...))
	return out, nil
}

var errSequestre = errors.New("séquestre illisible")

func ouvrirSequestre(cle *[32]byte, h [16]byte, c [60]byte) ([32]byte, error) {
	var s [32]byte
	g, err := gcmSequestre(cle)
	if err != nil {
		return s, err
	}
	p, err := g.Open(nil, c[:12], c[12:], append([]byte(adSequestre), h[:]...))
	if err != nil || len(p) != 32 {
		return s, errSequestre
	}
	copy(s[:], p)
	clear(p)
	return s, nil
}
