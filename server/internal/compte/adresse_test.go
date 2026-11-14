package compte

import (
	"bytes"
	"crypto/aes"
	"crypto/cipher"
	"crypto/hmac"
	"crypto/sha256"
	"errors"
	"testing"
)

// Conception §5.1 : même normalisation que le moteur Rust (partie locale « dot-atom » de la
// RFC 5322, lot 1), prouvée par la section normaliser de engine/vectors/compte.json.
func TestNormaliserVecteurs(t *testing.T) {
	v := lireVecteurs(t)
	if len(v.Normaliser) < 40 {
		t.Fatalf("%d cas seulement", len(v.Normaliser))
	}
	for _, c := range v.Normaliser {
		t.Run(c.Label, func(t *testing.T) {
			a, err := Normaliser(string(unhex(t, c.EntreeHex)))
			switch c.Error {
			case "":
				if err != nil || a.Canon != c.Canon || a.Exacte != c.Exacte {
					t.Fatalf("= %+v, %v ; attendu %q %q", a, err, c.Canon, c.Exacte)
				}
			case "adresse_invalide":
				if !errors.Is(err, ErrAdresseInvalide) {
					t.Fatalf("= %+v, %v ; attendu adresse_invalide", a, err)
				}
			case "adresse_non_ascii":
				if !errors.Is(err, ErrAdresseNonASCII) {
					t.Fatalf("= %+v, %v ; attendu adresse_non_ascii", a, err)
				}
			default:
				t.Fatalf("erreur inconnue %q", c.Error)
			}
		})
	}
	if ErrAdresseInvalide.Error() != "adresse_invalide" || ErrAdresseNonASCII.Error() != "adresse_non_ascii" {
		t.Fatal("codes d'erreur")
	}
}

// Deuxième implémentation indépendante de WebCrypto : crypto/aes de Go ouvre les enveloppes
// Env_mdp des vecteurs (nonce ‖ AES-256-GCM, AD = « SHH-CENV1 » ‖ h ‖ « mdp », 60 octets).
func TestEnveloppesVecteurs(t *testing.T) {
	v := lireVecteurs(t)
	if len(v.Enveloppes) == 0 {
		t.Fatal("aucun cas")
	}
	for _, c := range v.Enveloppes {
		env := unhex(t, c.EnvMdp)
		ad := append(append([]byte("SHH-CENV1"), unhex(t, c.H)...), "mdp"...)
		if len(env) != 60 || !bytes.Equal(ad, unhex(t, c.AD)) || !bytes.Equal(env[:12], unhex(t, c.Nonce)) {
			t.Fatalf("%s : forme de l'enveloppe", c.Label)
		}
		blk, err := aes.NewCipher(unhex(t, c.KEKMdp))
		if err != nil {
			t.Fatal(err)
		}
		g, _ := cipher.NewGCM(blk)
		k, err := g.Open(nil, env[:12], env[12:], ad)
		if err != nil || !bytes.Equal(k, unhex(t, c.KCompte)) {
			t.Fatalf("%s : %v", c.Label, err)
		}
		if _, err := g.Open(nil, env[:12], env[12:], append(ad[:len(ad)-3:len(ad)-3], "xxx"...)); err == nil {
			t.Fatalf("%s : AD ignorée", c.Label)
		}
	}
}

func clesTest(b byte) Cles {
	var c Cles
	for i := range c.Email {
		c.Email[i], c.Poivre[i], c.TOTP[i], c.Sequestre[i], c.Pseudo[i] = b, b+1, b+2, b+3, b+4
	}
	return c
}

// e_canon et e_envoi : HMAC-SHA-256 à clé (K_email) de « canon » ‖ 0 ‖ canon et
// « envoi » ‖ 0 ‖ exacte ; une variante a le même e_canon, pas le même e_envoi.
func TestEmpreintesDistinctes(t *testing.T) {
	c := clesTest(7)
	a, err := Normaliser("Lea.Dupont+x@GMAIL.com")
	if err != nil {
		t.Fatal(err)
	}
	canon, envoi := c.Empreintes(a)
	m := hmac.New(sha256.New, c.Email[:])
	m.Write([]byte("canon\x00leadupont@gmail.com"))
	if !bytes.Equal(canon[:], m.Sum(nil)) {
		t.Fatal("e_canon")
	}
	m = hmac.New(sha256.New, c.Email[:])
	m.Write([]byte("envoi\x00lea.dupont+x@gmail.com"))
	if !bytes.Equal(envoi[:], m.Sum(nil)) {
		t.Fatal("e_envoi")
	}
	if canon == envoi {
		t.Fatal("e_canon = e_envoi")
	}
	b, _ := Normaliser("leadupont@gmail.com")
	canon2, envoi2 := c.Empreintes(b)
	if canon2 != canon || envoi2 == envoi {
		t.Fatal("variante : même canon, autre envoi attendus")
	}
	canon3, envoi3 := clesTest(8).Empreintes(a)
	if canon3 == canon || envoi3 == envoi {
		t.Fatal("autre clé, mêmes empreintes")
	}
}

// Conception §5.3 : domaine de la liste ou sous-domaine d'un domaine de la liste.
func TestJetable(t *testing.T) {
	for d, want := range map[string]bool{
		"mailinator.com": true, "x.mailinator.com": true, "a.b.mailinator.com": true, "yopmail.com": true,
		"gmail.com": false, "ymailinator.com": false, "mailinator.com.fr": false, "com": false, "": false,
		"exemple.fr": false,
	} {
		if got := Jetable(d); got != want {
			t.Errorf("Jetable(%q) = %v", d, got)
		}
	}
	// La liste embarquée est lue (plus de 1 000 domaines), chaque ligne est un domaine en minuscules.
	if n := len(jetables); n < 1000 {
		t.Fatalf("%d domaines seulement", n)
	}
	// Lecture : commentaires et lignes vides ignorés ; les ajouts locaux comptent comme la liste.
	e, err := lireDomaines("# commentaire\n\nexemple-jetable.fr\n", "# ajouts\nautre-jetable.fr\n")
	if err != nil || len(e) != 2 {
		t.Fatalf("%v %v", e, err)
	}
	if _, ok := e["autre-jetable.fr"]; !ok {
		t.Fatal("ajout local absent")
	}
	for _, bad := range []string{"Exemple.fr\n", "a b.fr\n", " a.fr\n", "a.fr \n", "été.fr\n", "a.fr\r\n"} {
		if _, err := lireDomaines(bad); err == nil {
			t.Errorf("ligne %q acceptée", bad)
		}
	}
}
