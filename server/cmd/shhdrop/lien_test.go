package main

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// accessKeyOf, salonAccessKeyOf : K_accès d'un lien de partage, ou de salon (tests de vecteurs).
func accessKeyOf(link string) ([]byte, bool) {
	k, salon, err := cleAccesDuLien([]byte(link))
	return k, err == nil && !salon
}

func salonAccessKeyOf(link string) ([]byte, bool) {
	k, salon, err := cleAccesDuLien([]byte(link))
	return k, err == nil && salon
}

// Audit adverse du 13 novembre, 3e campagne, stockage, F4 : le lien signalé est traité en
// octets de bout en bout. cleAccesDuLien ne garde aucune copie du lien : il travaille dans la
// tranche reçue (que l'appelant efface) et efface K_lien décodée. Vérifié ici sur ce qui est
// observable : la tranche n'est pas modifiée (l'appelant l'efface lui-même), les mêmes liens
// qu'avant sont acceptés ou refusés, et lireLien rend un seul tampon, borné.
func TestLienEnOctets(t *testing.T) {
	cle := strings.Repeat("A", 42) + "E"
	for nom, c := range map[string]struct {
		lien    string
		ok, sal bool
	}{
		"partage":                  {"https://shhgone.com/#" + cle, true, false},
		"clé seule":                {cle, true, false},
		"espaces et lignes vides":  {"\n  https://shhgone.com/#" + cle + " \r\n\n", true, false},
		"salon":                    {"https://shhgone.com/#c" + cle, true, true},
		"salon, clé seule":         {"c" + cle, true, true},
		"gestion":                  {"https://shhgone.com/#m" + cle, false, false},
		"vide":                     {"", false, false},
		"deux lignes":              {cle + "\n" + cle, false, false},
		"42 caractères":            {"#" + cle[:42], false, false},
		"caractère hors alphabet":  {"#" + cle[:42] + "+", false, false},
		"non canonique":            {"#" + strings.Repeat("A", 42) + "B", false, false},
		"retour chariot au milieu": {"#" + cle[:20] + "\r" + cle[20:42], false, false},
	} {
		lien := []byte(c.lien)
		avant := bytes.Clone(lien)
		k, sal, err := cleAccesDuLien(lien)
		if (err == nil) != c.ok || sal != c.sal || (c.ok && len(k) != 32) {
			t.Errorf("%s : clé %d o, salon %v, erreur %v", nom, len(k), sal, err)
		}
		if !bytes.Equal(lien, avant) {
			t.Errorf("%s : tranche du lien modifiée", nom)
		}
	}
	b, err := lireLien(strings.NewReader(cle + "\n"))
	if err != nil || string(b) != cle+"\n" || cap(b) != maxStdinLink+1 {
		t.Fatal("lireLien :", len(b), cap(b), err)
	}
	if _, err := lireLien(strings.NewReader(strings.Repeat("x", maxStdinLink+1))); err == nil {
		t.Fatal("entrée trop longue acceptée")
	}
	if b, err := lireLien(strings.NewReader(strings.Repeat("x", maxStdinLink))); err != nil || len(b) != maxStdinLink {
		t.Fatal("entrée à la borne :", len(b), err)
	}
}

// Audit adverse du 13 novembre, 3e campagne, stockage, F5 : le gel et le dégel ne laissent
// l'heure de l'action ni sur frozen ni sur le dossier de données (dates de contenu et d'accès à
// l'epoch tout de suite ; le ctime est ramené par le janitor).
func TestGelSansDate(t *testing.T) {
	dir := t.TempDir()
	frozen := filepath.Join(dir, "frozen")
	epoch := time.Unix(0, 0)
	if err := freeze(frozen); err != nil {
		t.Fatal(err)
	}
	for _, p := range []string{frozen, dir} {
		if fi, err := os.Stat(p); err != nil || !fi.ModTime().Equal(epoch) {
			t.Fatalf("après le gel, %s : %v %v", p, fi.ModTime(), err)
		}
	}
	if err := unfreeze(frozen); err != nil {
		t.Fatal(err)
	}
	if fi, err := os.Stat(dir); err != nil || !fi.ModTime().Equal(epoch) {
		t.Fatalf("après le dégel, dossier : %v %v", fi.ModTime(), err)
	}
}
