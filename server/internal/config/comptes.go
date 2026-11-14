package config

import (
	"errors"
	"fmt"
	"net/mail"
	"net/netip"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

// comptesFromEnv : SHH_COMPTES et ses variables (conception du compte §8.1, plan lot 2). Une
// valeur posée est vérifiée même compte désactivé (erreur visible au démarrage, comme
// SHH_SALONS_MAX) ; les variables obligatoires ne le sont qu'avec SHH_COMPTES=1. Aucun fichier
// n'est lu ici : la clé est lue par compte.LireCles, le mot de passe SMTP par l'envoyeur.
func comptesFromEnv(c *Config) error {
	switch v := os.Getenv("SHH_COMPTES"); v {
	case "", "0":
	case "1":
		c.Comptes = true
	default:
		return fmt.Errorf("SHH_COMPTES invalide (0 ou 1): %q", v)
	}
	if v := os.Getenv("SHH_COMPTES_MAX"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || !digits(v) || v[0] == '0' || n < 1 || n > 1000000 {
			return fmt.Errorf("SHH_COMPTES_MAX invalide (entier de 1 à 1000000): %q", v)
		}
		c.ComptesMax = n
	}
	var err error
	if c.ComptesCleFile, err = secretFile("SHH_COMPTES_CLE_FILE", c.DataDir); err != nil {
		return err
	}
	if c.SMTP.PasswordFile, err = secretFile("SHH_SMTP_PASSWORD_FILE", c.DataDir); err != nil {
		return err
	}
	if v := os.Getenv("SHH_SMTP_HOST"); v != "" {
		if !smtpHostOK(v) {
			return fmt.Errorf("SHH_SMTP_HOST invalide (nom d'hôte en minuscules ou adresse IP, sans port): %q", v)
		}
		c.SMTP.Host = v
	}
	if v := os.Getenv("SHH_SMTP_PORT"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || !digits(v) || v[0] == '0' || n < 1 || n > 65535 {
			return fmt.Errorf("SHH_SMTP_PORT invalide: %q", v)
		}
		c.SMTP.Port = n
	}
	if c.SMTP.Port != 0 && c.SMTP.Port != 465 && c.SMTP.Port != 587 && !loopbackHost(c.SMTP.Host) {
		return fmt.Errorf("SHH_SMTP_PORT=%d : seuls 465 (TLS) et 587 (STARTTLS) sont acceptés ; un autre port "+
			"(texte clair) seulement vers la boucle locale (tests)", c.SMTP.Port)
	}
	if v := os.Getenv("SHH_SMTP_USER"); v != "" {
		if !printable(v) {
			return errors.New("SHH_SMTP_USER invalide (caractère de contrôle ; valeur non affichée)")
		}
		c.SMTP.User = v
	}
	if v := os.Getenv("SHH_MAIL_FROM"); v != "" {
		if !fromOK(v) {
			return fmt.Errorf("SHH_MAIL_FROM invalide (une seule adresse, « Nom <adresse@domaine> » ou "+
				"« adresse@domaine », ASCII imprimable): %q", v)
		}
		c.SMTP.From = v
	}
	if !c.Comptes {
		return nil
	}
	if c.SMTP.Port == 0 {
		c.SMTP.Port = 465
	}
	switch {
	case !c.Salons:
		return errors.New("SHH_COMPTES=1 exige SHH_SALONS=1 (le compte ne sert qu'à créer des salons)")
	case c.ComptesCleFile == "":
		return errors.New("SHH_COMPTES=1 exige SHH_COMPTES_CLE_FILE (fichier de 32 octets aléatoires, 0400 ou 0600, hors de SHH_DATA_DIR)")
	case c.SMTP.Host == "", c.SMTP.User == "", c.SMTP.PasswordFile == "", c.SMTP.From == "":
		return errors.New("SHH_COMPTES=1 exige SHH_SMTP_HOST, SHH_SMTP_USER, SHH_SMTP_PASSWORD_FILE et SHH_MAIL_FROM")
	}
	return nil
}

// secretFile : chemin absolu d'un fichier secret, hors de SHH_DATA_DIR (comparaison sur les
// chemins nettoyés ; les liens symboliques ne sont pas suivis) : le dossier de données est
// sauvegardé et peut être copié, la clé doit rester à part (conception §5.2, §21.13).
func secretFile(name, dataDir string) (string, error) {
	p, err := absDir(name, os.Getenv(name))
	if err != nil || p == "" {
		return p, err
	}
	if rel, err := filepath.Rel(dataDir, p); err == nil && rel != ".." && !strings.HasPrefix(rel, "../") {
		return "", fmt.Errorf("%s doit être hors de SHH_DATA_DIR : %q", name, p)
	}
	return p, nil
}

// smtpHostOK : nom d'hôte en minuscules ([a-z0-9-], étiquettes non vides, sans tiret en bord)
// ou adresse IP, sans port.
func smtpHostOK(h string) bool {
	if a, err := netip.ParseAddr(h); err == nil {
		return a.Zone() == "" && a.String() == h
	}
	if len(h) > 253 {
		return false
	}
	for _, l := range strings.Split(h, ".") {
		if l == "" || len(l) > 63 || l[0] == '-' || l[len(l)-1] == '-' {
			return false
		}
		for i := 0; i < len(l); i++ {
			if b := l[i]; (b < 'a' || b > 'z') && (b < '0' || b > '9') && b != '-' {
				return false
			}
		}
	}
	return true
}

func loopbackHost(h string) bool {
	if h == "localhost" {
		return true
	}
	a, err := netip.ParseAddr(h)
	return err == nil && a.Unmap().IsLoopback()
}

// printable : ASCII imprimable (espace comprise), sans caractère de contrôle : aucune valeur ne
// peut ajouter une ligne d'en-tête ni de commande SMTP.
func printable(s string) bool {
	for i := 0; i < len(s); i++ {
		if s[i] < 0x20 || s[i] > 0x7e {
			return false
		}
	}
	return s != ""
}

// fromOK : une seule adresse (net/mail), ASCII imprimable.
func fromOK(v string) bool {
	if !printable(v) {
		return false
	}
	a, err := mail.ParseAddress(v)
	return err == nil && strings.Count(a.Address, "@") == 1
}
