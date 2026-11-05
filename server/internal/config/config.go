// Package config lit la configuration du serveur depuis l'environnement.
package config

import (
	"errors"
	"fmt"
	"net"
	"net/netip"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	DataDir         string // SHH_DATA_DIR : chemin absolu (audit F5)
	Listen          string // SHH_LISTEN : boucle locale, sauf derrière un proxy déclaré (audit M3)
	StorageMaxBytes int64
	// BehindProxy (SHH_BEHIND_PROXY=1) : une requête sans X-Shh-Client-IP valide, ou venue
	// d'un pair qui n'est pas un proxy de confiance, est refusée au lieu de partager les
	// limites de l'adresse locale. Active aussi le refus des fichiers creux (audit F6).
	BehindProxy bool
	// TrustedProxies (SHH_TRUSTED_PROXY, liste de CIDR séparés par des virgules) : pairs dont
	// X-Shh-Client-IP est cru, en plus de la boucle locale. Exige SHH_BEHIND_PROXY=1.
	TrustedProxies []netip.Prefix
	StaticDir      string // SHH_STATIC_DIR : fichiers du site (web/dist), chemin absolu ; vide = page d'attente
	Now            func() time.Time
}

func FromEnv() (Config, error) {
	c := Config{
		Listen:          "127.0.0.1:8080",
		StorageMaxBytes: 107374182400, // 100 Gio (spec §24)
		Now:             time.Now,
	}
	var err error
	if c.DataDir, err = absDir("SHH_DATA_DIR", os.Getenv("SHH_DATA_DIR")); err != nil {
		return Config{}, err
	}
	if c.DataDir == "" {
		return Config{}, errors.New("SHH_DATA_DIR est obligatoire")
	}
	if v := os.Getenv("SHH_STORAGE_MAX"); v != "" {
		n, err := strconv.ParseInt(v, 10, 64)
		if err != nil || n <= 0 || !digits(v) || v[0] == '0' {
			return Config{}, fmt.Errorf("SHH_STORAGE_MAX invalide: %q", v)
		}
		c.StorageMaxBytes = n
	}
	switch v := os.Getenv("SHH_BEHIND_PROXY"); v {
	case "", "0":
	case "1":
		c.BehindProxy = true
	default:
		return Config{}, fmt.Errorf("SHH_BEHIND_PROXY invalide (0 ou 1): %q", v)
	}
	if v := os.Getenv("SHH_TRUSTED_PROXY"); v != "" {
		if !c.BehindProxy {
			return Config{}, errors.New("SHH_TRUSTED_PROXY exige SHH_BEHIND_PROXY=1")
		}
		for _, s := range strings.Split(v, ",") {
			p, err := netip.ParsePrefix(strings.TrimSpace(s))
			// Forme canonique (adresse de réseau), jamais « tout Internet » (point M3).
			if err != nil || p != p.Masked() || !trustedPrefixOK(p) {
				return Config{}, fmt.Errorf("SHH_TRUSTED_PROXY invalide (liste de CIDR canoniques, réseau local "+
					"ou public d'au moins /24 en IPv4 et /48 en IPv6, sans notation IPv4-dans-IPv6): %q", v)
			}
			c.TrustedProxies = append(c.TrustedProxies, p)
		}
	}
	if v := os.Getenv("SHH_LISTEN"); v != "" {
		c.Listen = v
	}
	if err := checkListen(c.Listen, c.BehindProxy && len(c.TrustedProxies) > 0); err != nil {
		return Config{}, err
	}
	if c.StaticDir, err = absDir("SHH_STATIC_DIR", os.Getenv("SHH_STATIC_DIR")); err != nil {
		return Config{}, err
	}
	return c, nil
}

// localNets : réseaux acceptés à toute longueur de préfixe (sauf /0) : boucle locale,
// réseaux privés (RFC 1918, ULA IPv6) et lien local.
var localNets = []netip.Prefix{
	netip.MustParsePrefix("10.0.0.0/8"), netip.MustParsePrefix("172.16.0.0/12"),
	netip.MustParsePrefix("192.168.0.0/16"), netip.MustParsePrefix("127.0.0.0/8"),
	netip.MustParsePrefix("169.254.0.0/16"),
	netip.MustParsePrefix("fc00::/7"), netip.MustParsePrefix("::1/128"), netip.MustParsePrefix("fe80::/10"),
}

// nat64Nets : préfixes de traduction IPv6 vers IPv4 (RFC 6052, RFC 8215) : ils contiennent tout
// l'Internet IPv4, comme la notation ::ffff:a.b.c.d. Refusés, quelle que soit la taille.
var nat64Nets = []netip.Prefix{netip.MustParsePrefix("64:ff9b::/96"), netip.MustParsePrefix("64:ff9b:1::/48")}

// trustedPrefixOK : un proxy de confiance est un réseau restreint. Acceptés : un
// sous-réseau (jamais /0) d'un réseau local (localNets) ; sinon un réseau public d'au moins
// /24 (IPv4) ou /48 (IPv6). Refusée aussi : la notation IPv4-dans-IPv6 (::ffff:a.b.c.d/…),
// qui contournerait les contrôles de taille IPv4.
func trustedPrefixOK(p netip.Prefix) bool {
	a := p.Addr()
	if a.Is4In6() || a.Zone() != "" || p.Bits() == 0 {
		return false
	}
	for _, n := range nat64Nets {
		if n.Overlaps(p) {
			return false
		}
	}
	for _, n := range localNets {
		if n.Addr().Is4() == a.Is4() && p.Bits() >= n.Bits() && n.Contains(a) {
			return true
		}
	}
	if a.Is4() {
		return p.Bits() >= 24
	}
	return p.Bits() >= 48
}

// absDir : chemin absolu, nettoyé ; « ? », « # » et « % » refusés (ils changeraient le
// sens de l'URI SQLite file:…?mode=rw). Vide reste vide.
func absDir(name, v string) (string, error) {
	if v == "" {
		return "", nil
	}
	if !filepath.IsAbs(v) || strings.ContainsAny(v, "?#%") {
		return "", fmt.Errorf("%s doit être un chemin absolu, sans « ? », « # » ni « %% » : %q", name, v)
	}
	return filepath.Clean(v), nil
}

func digits(s string) bool {
	for i := 0; i < len(s); i++ {
		if s[i] < '0' || s[i] > '9' {
			return false
		}
	}
	return s != ""
}

// checkListen : hôte:port numérique. Sans proxy déclaré, l'hôte doit être la boucle locale
// (127.0.0.0/8, ::1 ou localhost) : sinon K_accès, K_preuve et S_gestion circuleraient
// en HTTP clair (audit M3).
func checkListen(l string, proxied bool) error {
	host, port, err := net.SplitHostPort(l)
	if err != nil || !digits(port) || len(port) > 5 {
		return fmt.Errorf("SHH_LISTEN invalide (hôte:port): %q", l)
	}
	if n, _ := strconv.Atoi(port); n > 65535 {
		return fmt.Errorf("SHH_LISTEN invalide (hôte:port): %q", l)
	}
	if host == "localhost" {
		return nil
	}
	if a, err := netip.ParseAddr(host); err == nil && a.Zone() == "" && a.Unmap().IsLoopback() {
		return nil
	}
	if !proxied {
		return fmt.Errorf("SHH_LISTEN %q n'est pas une adresse de boucle locale : exige SHH_BEHIND_PROXY=1 et SHH_TRUSTED_PROXY", l)
	}
	return nil
}
