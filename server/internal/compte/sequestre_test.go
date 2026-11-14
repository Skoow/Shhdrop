package compte

import (
	"bytes"
	"crypto/aes"
	"crypto/cipher"
	"crypto/hkdf"
	"crypto/sha256"
	"encoding/json"
	"os"
	"reflect"
	"slices"
	"testing"
)

type vecteurCoffre struct {
	H       string `json:"h"`
	SProfil string `json:"s_profil"`
	KCompte string `json:"k_compte"`
	Cle     string `json:"cle"`
	Nonce   string `json:"nonce"`
	AD      string `json:"ad"`
	Blob    string `json:"blob"`
}

func lireCoffres(t *testing.T) (profil, prive []vecteurCoffre) {
	t.Helper()
	b, err := os.ReadFile("../../../engine/vectors/compte.json")
	if err != nil {
		t.Fatal(err)
	}
	var v struct {
		Profil []vecteurCoffre `json:"coffre_profil"`
		Prive  []vecteurCoffre `json:"coffre_prive"`
	}
	if err := json.Unmarshal(b, &v); err != nil || len(v.Profil) == 0 || len(v.Prive) == 0 {
		t.Fatal(err)
	}
	return v.Profil, v.Prive
}

// ouvrirCoffre : coffre « SHH-ACCT1 » ou « SHH-PROF1 » ouvert par la clé k (forme de §21.2.2).
func ouvrirCoffre(k, h, blob []byte) error {
	a, err := aes.NewCipher(k)
	if err != nil {
		return err
	}
	g, _ := cipher.NewGCM(a)
	ad := append(append([]byte{}, blob[:9]...), h...)
	ad = append(ad, blob[9:17]...)
	_, err = g.Open(nil, blob[17:29], blob[29:], ad)
	return err
}

// §21.17, revue point 1 : le séquestre ne rend que s_profil ; K_profil = HKDF(s_profil)
// ouvre le coffre de profil des vecteurs communs et jamais le coffre privé ; aucune donnée
// reçue ni rendue par le service ne contient K_compte ni de quoi ouvrir le coffre privé.
func TestSequestreSeulementProfil(t *testing.T) {
	profils, prives := lireCoffres(t)
	cles := clesTest(9)
	for _, p := range profils {
		h, s := [16]byte(unhex(t, p.H)), [32]byte(unhex(t, p.SProfil))
		scelle, err := sceller(&cles.Sequestre, h, s)
		if err != nil {
			t.Fatal(err)
		}
		ouvert, err := ouvrirSequestre(&cles.Sequestre, h, scelle)
		if err != nil || ouvert != s {
			t.Fatal("séquestre", err)
		}
		k, _ := hkdf.Key(sha256.New, ouvert[:], nil, "shhdrop/v2/compte/profil", 32)
		if !bytes.Equal(k, unhex(t, p.Cle)) {
			t.Fatal("K_profil ≠ vecteur")
		}
		if p.Blob == "" {
			continue // grands paliers : seulement l'empreinte du coffre dans les vecteurs
		}
		if err := ouvrirCoffre(k, h[:], unhex(t, p.Blob)); err != nil {
			t.Fatal("B_profil non ouvert :", err)
		}
		for _, v := range prives {
			if v.Blob == "" {
				continue
			}
			if err := ouvrirCoffre(k, unhex(t, v.H), unhex(t, v.Blob)); err == nil {
				t.Fatal("K_profil ouvre B_prive")
			}
		}
	}
	// Formes échangées : rien d'autre que ces champs (aucun K_compte, K_prive, KEK_mdp, M).
	champs := func(v any) []string {
		var out []string
		ty := reflect.TypeOf(v)
		for i := 0; i < ty.NumField(); i++ {
			out = append(out, ty.Field(i).Name)
		}
		return out
	}
	if got := champs(Donnees{}); !slices.Equal(got, []string{"AAuth", "EnvMdp", "SProfil", "PCanon", "BlobProfil", "BlobPrive"}) {
		t.Fatal("Donnees :", got)
	}
	if got := champs(Ouverture{}); !slices.Equal(got, []string{"Jeton", "H", "EnvMdp", "SProfil", "BlobProfil",
		"GenProfil", "BlobPrive", "GenPrive", "Etape"}) {
		t.Fatal("Ouverture :", got)
	}
	// Bout en bout : la connexion rend le s_profil donné, chiffré au repos.
	b := nouveauBanc(t)
	_, _, d := b.inscrire(t, ipA, "lea@exemple.fr", "lea")
	o, err := b.s.Connexion(ipA, "lea@exemple.fr", d.AAuth, OptionsSession{}, false)
	if err != nil || o.SProfil != d.SProfil {
		t.Fatal(err)
	}
}

// cle_profil = nonce ‖ AES-256-GCM(K_sequestre, nonce, s_profil, AD = « SHH-CSEQ1 » ‖ h) :
// différent de s_profil, ouvert par K_sequestre et l'AD exacte seulement.
func TestSequestreChiffre(t *testing.T) {
	b := nouveauBanc(t)
	h, _, d := b.inscrire(t, ipA, "lea@exemple.fr", "lea")
	var col []byte
	if err := b.db.QueryRow(`SELECT cle_profil FROM comptes`).Scan(&col); err != nil {
		t.Fatal(err)
	}
	if len(col) != 60 || bytes.Contains(col, d.SProfil[:]) || bytes.Contains(b.fichiers(t), d.SProfil[:]) {
		t.Fatal("s_profil en clair")
	}
	a, _ := aes.NewCipher(b.cles.Sequestre[:])
	g, _ := cipher.NewGCM(a)
	s, err := g.Open(nil, col[:12], col[12:], append([]byte("SHH-CSEQ1"), h[:]...))
	if err != nil || !bytes.Equal(s, d.SProfil[:]) {
		t.Fatal("ouverture par K_sequestre", err)
	}
	autre := h
	autre[0] ^= 1
	if _, err := g.Open(nil, col[:12], col[12:], append([]byte("SHH-CSEQ1"), autre[:]...)); err == nil {
		t.Fatal("AD sans h")
	}
	a2, _ := aes.NewCipher(b.cles.Email[:])
	g2, _ := cipher.NewGCM(a2)
	if _, err := g2.Open(nil, col[:12], col[12:], append([]byte("SHH-CSEQ1"), h[:]...)); err == nil {
		t.Fatal("autre sous-clé")
	}
	if _, err := ouvrirSequestre(&b.cles.Sequestre, autre, [60]byte(col)); err == nil {
		t.Fatal("ouvrir sans le bon h")
	}
}
