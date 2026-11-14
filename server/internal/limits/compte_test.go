package limits

import (
	"encoding/hex"
	"fmt"
	"reflect"
	"strings"
	"testing"
	"time"
)

// Limites du compte (conception du compte §8.8, plan lot 3) : bornes exactes, oubli à la
// rotation, aucune adresse gardée.

func canonDe(s string) [32]byte {
	var c [32]byte
	copy(c[:], s)
	return c
}

func hDe(s string) [16]byte {
	var h [16]byte
	copy(h[:], s)
	return h
}

func TestAllowInscription(t *testing.T) {
	now := t0
	l := newLim(&now)
	for i := 0; i < InscriptionsPer64; i++ {
		if !l.AllowInscription(ip("2001:db8:1:1::1")) {
			t.Fatalf("inscription %d refusée", i+1)
		}
	}
	if l.AllowInscription(ip("2001:db8:1:1::2")) {
		t.Fatal("4e inscription du jour pour la même connexion acceptée")
	}
	// Le /48 : 10 au plus, toutes connexions confondues.
	n := InscriptionsPer64
	for i := 2; n < InscriptionsPer48; i++ {
		if !l.AllowInscription(ip(fmt.Sprintf("2001:db8:1:%x::1", i))) {
			t.Fatalf("inscription %d du /48 refusée", n+1)
		}
		n++
	}
	if l.AllowInscription(ip("2001:db8:1:ff::1")) {
		t.Fatal("11e inscription du /48 acceptée")
	}
	if !l.AllowInscription(ip("2001:db8:2::1")) {
		t.Fatal("autre /48 refusé")
	}
	now = t0.Add(24 * time.Hour)
	if !l.AllowInscription(ip("2001:db8:1:1::1")) {
		t.Fatal("quota d'inscriptions non remis à zéro à minuit")
	}
	if InscriptionsPer64 != 3 || InscriptionsPer48 != 10 {
		t.Fatal("bornes de la conception §8.8 : 3 par connexion, 10 par /48")
	}
}

func TestAllowCourrielParAdresse(t *testing.T) {
	now := t0
	l := newLim(&now)
	a := canonDe("lea@exemple.fr")
	for i := 0; i < CourrielsParAdresse; i++ {
		// Trois connexions différentes : la limite par adresse tient quand même.
		if !l.AllowCourriel(ip(fmt.Sprintf("192.0.2.%d", i+1)), a) {
			t.Fatalf("e-mail %d refusé", i+1)
		}
	}
	if l.AllowCourriel(ip("198.51.100.1"), a) {
		t.Fatal("4e e-mail du jour vers la même adresse accepté")
	}
	if !l.AllowCourriel(ip("198.51.100.1"), canonDe("autre@exemple.fr")) {
		t.Fatal("autre adresse refusée")
	}
	now = t0.Add(24 * time.Hour)
	if !l.AllowCourriel(ip("198.51.100.1"), a) {
		t.Fatal("limite par adresse non remise à zéro à minuit")
	}
	if CourrielsParAdresse != 3 {
		t.Fatal("borne de la conception §8.8 : 3 par jour et par adresse")
	}
}

func TestAllowCourrielParConnexion(t *testing.T) {
	now := t0
	l := newLim(&now)
	for i := 0; i < CourrielsPer64; i++ {
		if !l.AllowCourriel(ip("2001:db8:1:1::1"), canonDe(fmt.Sprint(i))) {
			t.Fatalf("e-mail %d refusé", i+1)
		}
	}
	if l.AllowCourriel(ip("2001:db8:1:1::9"), canonDe("x")) {
		t.Fatal("11e e-mail du jour pour la même connexion accepté")
	}
	// Un refus ne compte nulle part : l'adresse « x » n'a rien consommé.
	for i := 0; i < CourrielsParAdresse; i++ {
		if !l.AllowCourriel(ip(fmt.Sprintf("2001:db8:1:%x::1", 10+i)), canonDe("x")) {
			t.Fatal("un refus a été compté pour l'adresse")
		}
	}
	// Le /48 : CourrielsPer48 au plus.
	n := CourrielsPer64 + CourrielsParAdresse
	for i := 0; n < CourrielsPer48; i++ {
		if !l.AllowCourriel(ip(fmt.Sprintf("2001:db8:1:%x::1", 100+i)), canonDe(fmt.Sprint("y", i))) {
			t.Fatalf("e-mail %d du /48 refusé", n+1)
		}
		n++
	}
	if l.AllowCourriel(ip("2001:db8:1:fff::1"), canonDe("z")) {
		t.Fatal("e-mail au-delà du plafond du /48 accepté")
	}
	if CourrielsPer64 != 10 || CourrielsPer48 != 30 {
		t.Fatal("bornes : 10 par connexion (conception §8.8), 30 par /48 (ajout du lot 3)")
	}
}

func TestEchecsConnexion(t *testing.T) {
	now := t0
	l := newLim(&now)
	c := canonDe("lea@exemple.fr")
	for i := 0; i < EchecsConnexionPer64; i++ {
		if !l.AllowEchecConnexion(ip("192.0.2.1")) {
			t.Fatalf("connexion refusée après %d échecs", i)
		}
		l.NoterEchecConnexion(ip("192.0.2.1"), canonDe(fmt.Sprint(i)))
	}
	if l.AllowEchecConnexion(ip("192.0.2.1")) {
		t.Fatal("connexion permise après 20 échecs dans l'heure")
	}
	if !l.AllowEchecConnexion(ip("192.0.2.2")) {
		t.Fatal("autre connexion refusée")
	}
	// Le /48 : 60 échecs, toutes connexions confondues.
	for i := 0; i < EchecsConnexionPer48; i++ {
		l.NoterEchecConnexion(ip(fmt.Sprintf("2001:db8:5:%x::1", i)), c)
	}
	if l.AllowEchecConnexion(ip("2001:db8:5:ffff::1")) {
		t.Fatal("connexion permise après 60 échecs du /48 dans l'heure")
	}
	now = t0.Add(time.Hour)
	if !l.AllowEchecConnexion(ip("192.0.2.1")) || !l.AllowEchecConnexion(ip("2001:db8:5:ffff::1")) {
		t.Fatal("échecs de connexion non oubliés à l'heure suivante")
	}
	if EchecsConnexionPer64 != 20 || EchecsConnexionPer48 != 60 {
		t.Fatal("bornes de la conception §8.8 : 20 par connexion, 60 par /48")
	}
}

func TestPreuveRequise(t *testing.T) {
	now := t0
	l := newLim(&now)
	c := canonDe("lea@exemple.fr")
	for i := 0; i < EchecsAvantPreuve; i++ {
		if l.PreuveRequise(c) {
			t.Fatalf("preuve exigée après %d échecs", i)
		}
		// Échecs venus de connexions différentes : comptés pour le compte.
		l.NoterEchecConnexion(ip(fmt.Sprintf("192.0.2.%d", i+1)), c)
	}
	if !l.PreuveRequise(c) {
		t.Fatal("preuve non exigée après 5 échecs dans l'heure")
	}
	if l.PreuveRequise(canonDe("autre@exemple.fr")) {
		t.Fatal("preuve exigée pour un autre compte")
	}
	// Jamais de verrouillage : la connexion à ce compte reste permise (avec preuve).
	if !l.AllowEchecConnexion(ip("198.51.100.7")) {
		t.Fatal("le compte a verrouillé une connexion neuve")
	}
	now = t0.Add(time.Hour)
	if l.PreuveRequise(c) {
		t.Fatal("échecs du compte non oubliés à l'heure suivante")
	}
	if EchecsAvantPreuve != 5 {
		t.Fatal("borne de la conception §8.8 : preuve après 5 échecs")
	}
}

func TestAllowTOTP(t *testing.T) {
	now := t0
	l := newLim(&now)
	h := hDe("compte-a")
	for i := 0; i < EchecsTOTPParHeure; i++ {
		if !l.AllowTOTP(h) {
			t.Fatalf("TOTP refusé après %d échecs", i)
		}
		l.NoterEchecTOTP(h)
	}
	if l.AllowTOTP(h) {
		t.Fatal("TOTP permis après 10 échecs dans l'heure")
	}
	if !l.AllowTOTP(hDe("compte-b")) {
		t.Fatal("autre compte refusé")
	}
	now = t0.Add(time.Hour)
	if !l.AllowTOTP(h) {
		t.Fatal("échecs TOTP non oubliés à l'heure suivante")
	}
	if EchecsTOTPParHeure != 10 {
		t.Fatal("borne de la conception §8.8 : 10 échecs par heure")
	}
}

func TestAllowEcritureCoffre(t *testing.T) {
	now := t0
	l := newLim(&now)
	h := hDe("compte-a")
	for i := 0; i < EcrituresCoffreParHeure; i++ {
		if !l.AllowEcritureCoffre(h) {
			t.Fatalf("écriture %d refusée", i+1)
		}
	}
	if l.AllowEcritureCoffre(h) {
		t.Fatal("61e écriture de l'heure acceptée")
	}
	if !l.AllowEcritureCoffre(hDe("compte-b")) {
		t.Fatal("autre compte refusé")
	}
	now = t0.Add(time.Hour)
	if !l.AllowEcritureCoffre(h) {
		t.Fatal("écritures non oubliées à l'heure suivante")
	}
	if EcrituresCoffreParHeure != 60 {
		t.Fatal("borne : 60 écritures par heure (les deux coffres ensemble)")
	}
}

func TestAllowPseudoVerifier(t *testing.T) {
	now := t0
	l := newLim(&now)
	etape := make([]byte, 32)
	for i := 0; i < PseudoVerifierParHeure; i++ {
		if !l.AllowPseudoVerifier(etape) {
			t.Fatalf("vérification %d refusée", i+1)
		}
	}
	if l.AllowPseudoVerifier(etape) {
		t.Fatal("31e vérification de l'heure acceptée")
	}
	// Un h de 16 octets nuls n'est pas l'étape de 32 octets nuls.
	if !l.AllowPseudoVerifier(make([]byte, 16)) {
		t.Fatal("identifiants de longueurs différentes confondus")
	}
	now = t0.Add(time.Hour)
	if !l.AllowPseudoVerifier(etape) {
		t.Fatal("vérifications non oubliées à l'heure suivante")
	}
	if PseudoVerifierParHeure != 30 {
		t.Fatal("borne : 30 par heure")
	}
}

func TestAllowBannir(t *testing.T) {
	now := t0
	l := newLim(&now)
	for i := 0; i < BannissementsParHeure; i++ {
		if !l.AllowBannir() {
			t.Fatalf("bannissement %d refusé", i+1)
		}
	}
	if l.AllowBannir() {
		t.Fatal("21e bannissement de l'heure accepté")
	}
	now = t0.Add(time.Hour)
	if !l.AllowBannir() {
		t.Fatal("bannissements non oubliés à l'heure suivante")
	}
	if BannissementsParHeure != 20 {
		t.Fatal("borne de la conception §21.11 : 20 par heure")
	}
}

// compteMaps : les compteurs du compte, par nom de champ (réflexion : un champ ajouté au
// Limiter sans être listé ici fait échouer TestLimitesCompteOublieesALaRotation).
func compteMaps(l *Limiter) map[string]int {
	v := reflect.ValueOf(l).Elem()
	out := map[string]int{}
	for _, n := range []string{"insc64", "insc48", "mail64", "mail48", "mailAdr", "echec64", "echec48",
		"echecCpt", "totpCpt", "coffreCpt", "pseudoCpt"} {
		f := v.FieldByName(n)
		if !f.IsValid() {
			out[n] = -1
			continue
		}
		out[n] = f.Len()
	}
	return out
}

func remplir(l *Limiter) {
	c := canonDe("lea@exemple.fr")
	l.AllowInscription(ip("192.0.2.1"))
	l.AllowCourriel(ip("192.0.2.1"), c)
	l.NoterEchecConnexion(ip("192.0.2.1"), c)
	l.NoterEchecTOTP(hDe("a"))
	l.AllowEcritureCoffre(hDe("a"))
	l.AllowPseudoVerifier([]byte("etape"))
	l.AllowBannir()
}

func TestLimitesCompteOublieesALaRotation(t *testing.T) {
	now := t0
	l := newLim(&now)
	remplir(l)
	for n, v := range compteMaps(l) {
		if v != 1 {
			t.Fatalf("%s : %d entrées après remplissage (champ absent : -1)", n, v)
		}
	}
	// À l'heure suivante : les compteurs de l'heure sont vides, ceux du jour restent.
	now = t0.Add(time.Hour)
	l.AllowBannir() // déclenche la rotation
	horaires := map[string]bool{"echec64": true, "echec48": true, "echecCpt": true, "totpCpt": true,
		"coffreCpt": true, "pseudoCpt": true}
	for n, v := range compteMaps(l) {
		if horaires[n] && v != 0 {
			t.Errorf("%s non vidé à l'heure suivante (%d)", n, v)
		}
		if !horaires[n] && v != 1 {
			t.Errorf("%s vidé avant minuit (%d)", n, v)
		}
	}
	if l.bannirHeure != 1 {
		t.Errorf("bannissements de l'heure : %d, attendu 1 (remis à zéro puis compté)", l.bannirHeure)
	}
	// À minuit UTC : tout est vide.
	remplir(l)
	now = time.Date(2026, 11, 5, 0, 0, 0, 0, time.UTC)
	l.Key(ip("192.0.2.1"))
	for n, v := range compteMaps(l) {
		if v != 0 {
			t.Errorf("%s non vidé à minuit (%d)", n, v)
		}
	}
	if l.bannirHeure != 0 {
		t.Error("bannissements non remis à zéro")
	}
}

// TestAucuneAdresseGardee : aucune clé de map du compte ne contient l'empreinte d'adresse,
// le h, l'adresse IP ou son préfixe, en clair ou en hexadécimal ; les clés sont des HMAC sous
// le secret du jour (qui tourne à minuit).
func TestAucuneAdresseGardee(t *testing.T) {
	now := t0
	l := newLim(&now)
	c := canonDe("lea@exemple.fr-empreinte-32-oct")
	h := hDe("h-du-compte-16oc")
	a := ip("2001:db8:1:2::1")
	l.AllowInscription(a)
	l.AllowCourriel(a, c)
	l.NoterEchecConnexion(a, c)
	l.NoterEchecTOTP(h)
	l.AllowEcritureCoffre(h)
	l.AllowPseudoVerifier(h[:])
	reperes := []string{string(c[:]), hex.EncodeToString(c[:]), string(h[:]), hex.EncodeToString(h[:]),
		"2001:db8:1:2", "2001:db8:1::", "lea@exemple.fr"}
	v := reflect.ValueOf(l).Elem()
	for _, n := range []string{"insc64", "insc48", "mail64", "mail48", "mailAdr", "echec64", "echec48",
		"echecCpt", "totpCpt", "coffreCpt", "pseudoCpt"} {
		it := v.FieldByName(n).MapRange()
		for it.Next() {
			k := it.Key().String()
			if len(k) != 64 {
				t.Errorf("%s : clé de %d caractères, attendu un HMAC-SHA-256 en hexadécimal", n, len(k))
			}
			for _, r := range reperes {
				if strings.Contains(k, r) {
					t.Errorf("%s : clé %q contient un repère", n, k)
				}
			}
		}
	}
	// Mêmes valeurs le lendemain : clés différentes (secret du jour).
	before := map[string]bool{}
	it := v.FieldByName("mailAdr").MapRange()
	for it.Next() {
		before[it.Key().String()] = true
	}
	now = t0.Add(24 * time.Hour)
	l.AllowCourriel(a, c)
	it = v.FieldByName("mailAdr").MapRange()
	for it.Next() {
		if before[it.Key().String()] {
			t.Fatal("clé de l'adresse identique d'un jour à l'autre")
		}
	}
}
