// Package config lit la configuration du serveur depuis l'environnement.
package config

import (
	"crypto/sha256"
	"encoding/hex"
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
	// Salons (SHH_SALONS=1) : active les routes /api/salons/* et le WebSocket du salon.
	// Désactivé par défaut : activation publique seulement après le juriste (Q-SAL8).
	Salons bool
	// SalonsMax (SHH_SALONS_MAX, 1 à 10 000, défaut 200) : salons vivants au plus (spec §39.3.2).
	SalonsMax int
	// Origin (SHH_ORIGIN, obligatoire avec SHH_SALONS=1) : origine publique du site, comparée
	// à l'en-tête Origin du WebSocket et copiée dans la CSP (connect-src wss://hôte).
	Origin string
	// Capacity : places du serveur (capacity.go), réglables ou calculées d'après la machine.
	Capacity Capacity
	// AdminListen (SHH_ADMIN_LISTEN, hôte:port) : écouteur du tableau de bord d'administration,
	// distinct de SHH_LISTEN. Vide (défaut) : tableau de bord désactivé. Mêmes règles d'adresse
	// que SHH_LISTEN : boucle locale, sauf derrière un proxy déclaré (le conteneur de
	// production, où seuls la boucle locale et SHH_TRUSTED_PROXY sont servis, adminui).
	AdminListen string
	// AdminTokenHash : SHA-256 du jeton d'administration (obligatoire avec SHH_ADMIN_LISTEN) :
	// SHH_ADMIN_TOKEN_SHA256, ou, en développement local seulement, calculée depuis
	// SHH_ADMIN_TOKEN (adminFromEnv). Seule l'empreinte sert, à la comparaison en temps constant.
	AdminTokenHash [32]byte
	// Comptes (SHH_COMPTES=1, conception du compte §8.1) : compte par e-mail pour créer un
	// salon. Désactivé par défaut (aucune route, aucun fichier) ; exige SHH_SALONS=1.
	Comptes bool
	// ComptesCleFile (SHH_COMPTES_CLE_FILE) : fichier de K_serveur (32 octets, 0400 ou 0600),
	// chemin absolu hors de SHH_DATA_DIR. Obligatoire avec SHH_COMPTES=1.
	ComptesCleFile string
	// ComptesMax (SHH_COMPTES_MAX, 1 à 1 000 000, défaut 10 000) : comptes au plus.
	ComptesMax int
	// SMTP : envoi des codes par e-mail (obligatoire avec SHH_COMPTES=1).
	SMTP SMTP
}

// SMTP : fournisseur d'envoi (conception §8.1). Port 465 (TLS implicite, défaut) ou 587
// (STARTTLS) ; tout autre port (texte clair) seulement vers la boucle locale, pour les tests.
// Le mot de passe est dans un fichier (PasswordFile), jamais dans une variable.
type SMTP struct {
	Host         string // SHH_SMTP_HOST
	Port         int    // SHH_SMTP_PORT
	User         string // SHH_SMTP_USER
	PasswordFile string // SHH_SMTP_PASSWORD_FILE
	From         string // SHH_MAIL_FROM, par exemple « Shhgone <ne-pas-repondre@shhgone.com> »
}

func FromEnv() (Config, error) {
	c := Config{
		Listen:          "127.0.0.1:8080",
		StorageMaxBytes: 214748364800, // 200 Gio (spec §24, §41.2)
		SalonsMax:       200,          // spec §39.3.2
		ComptesMax:      10000,        // conception du compte §8.1
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
	proxied := c.BehindProxy && len(c.TrustedProxies) > 0
	if err := checkListen("SHH_LISTEN", c.Listen, proxied); err != nil {
		return Config{}, err
	}
	if c.AdminListen, c.AdminTokenHash, err = adminFromEnv(c.Listen, proxied, c.BehindProxy); err != nil {
		return Config{}, err
	}
	if c.StaticDir, err = absDir("SHH_STATIC_DIR", os.Getenv("SHH_STATIC_DIR")); err != nil {
		return Config{}, err
	}
	switch v := os.Getenv("SHH_SALONS"); v {
	case "", "0":
	case "1":
		c.Salons = true
	default:
		return Config{}, fmt.Errorf("SHH_SALONS invalide (0 ou 1): %q", v)
	}
	if v := os.Getenv("SHH_SALONS_MAX"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || !digits(v) || v[0] == '0' || n < 1 || n > 10000 {
			return Config{}, fmt.Errorf("SHH_SALONS_MAX invalide (entier de 1 à 10000): %q", v)
		}
		c.SalonsMax = n
	}
	// Vérifiée même salon désactivé : une valeur fausse se voit dès le démarrage.
	if v := os.Getenv("SHH_ORIGIN"); v != "" {
		if !originOK(v) {
			return Config{}, fmt.Errorf("SHH_ORIGIN invalide (https://hôte[:port] en minuscules, sans chemin, "+
				"requête, fragment, identifiant ni barre finale, port par défaut omis ; http:// seulement pour "+
				"localhost ou 127.0.0.0/8 ; IPv6 non pris en charge): %q", v)
		}
		c.Origin = v
	}
	if c.Salons && c.Origin == "" {
		return Config{}, errors.New("SHH_SALONS=1 exige SHH_ORIGIN (origine publique du site, ex. https://shhgone.com)")
	}
	if err := comptesFromEnv(&c); err != nil {
		return Config{}, err
	}
	if c.Capacity, err = capacityFromEnv(memLimit(), nofile()); err != nil {
		return Config{}, err
	}
	if err := checkThreads(c.Capacity, pidsMax(pidsFile)); err != nil {
		return Config{}, err
	}
	if c.Salons {
		if err := checkSalons(c.SalonsMax, c.Capacity, memLimit()); err != nil {
			return Config{}, err
		}
	}
	return c, nil
}

// originOK : origine sous la forme exacte que les navigateurs envoient dans l'en-tête Origin
// (schéma et hôte en minuscules, port par défaut omis), pour que la comparaison du WebSocket
// soit une simple égalité. L'hôte n'a que des caractères [a-z0-9.-] : il est copié dans la
// CSP, où « ; », une espace ou « * » changeraient la politique. IPv6 refusé : la syntaxe
// host-source de la CSP ne l'accepte pas.
func originOK(v string) bool {
	var hostport, defPort string
	var plain bool
	switch {
	case strings.HasPrefix(v, "https://"):
		hostport, defPort = v[len("https://"):], "443"
	case strings.HasPrefix(v, "http://"):
		hostport, defPort, plain = v[len("http://"):], "80", true
	default:
		return false
	}
	host := hostport
	if i := strings.LastIndexByte(hostport, ':'); i >= 0 {
		host = hostport[:i]
		port := hostport[i+1:]
		if !digits(port) || port[0] == '0' || len(port) > 5 || port == defPort {
			return false
		}
		if n, _ := strconv.Atoi(port); n > 65535 {
			return false
		}
	}
	if host == "" || len(host) > 253 {
		return false
	}
	labels := strings.Split(host, ".")
	for _, l := range labels {
		if l == "" || len(l) > 63 || l[0] == '-' || l[len(l)-1] == '-' {
			return false
		}
		for i := 0; i < len(l); i++ {
			if b := l[i]; (b < 'a' || b > 'z') && (b < '0' || b > '9') && b != '-' {
				return false
			}
		}
	}
	// Dernier label numérique : adresse IPv4, en forme canonique (sinon le navigateur la récrit).
	if digits(labels[len(labels)-1]) {
		a, err := netip.ParseAddr(host)
		if err != nil || !a.Is4() || a.String() != host {
			return false
		}
		return !plain || a.IsLoopback()
	}
	return !plain || host == "localhost"
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
func checkListen(name, l string, proxied bool) error {
	host, port, err := net.SplitHostPort(l)
	if err != nil || !digits(port) || len(port) > 5 {
		return fmt.Errorf("%s invalide (hôte:port): %q", name, l)
	}
	if n, _ := strconv.Atoi(port); n > 65535 {
		return fmt.Errorf("%s invalide (hôte:port): %q", name, l)
	}
	if host == "localhost" {
		return nil
	}
	if a, err := netip.ParseAddr(host); err == nil && a.Zone() == "" && a.Unmap().IsLoopback() {
		return nil
	}
	if !proxied {
		return fmt.Errorf("%s %q n'est pas une adresse de boucle locale : exige SHH_BEHIND_PROXY=1 et SHH_TRUSTED_PROXY", name, l)
	}
	return nil
}

// Jeton d'administration en clair (SHH_ADMIN_TOKEN, développement local) : au moins adminTokenMin caractères de l'alphabet base64url (43 =
// 32 octets aléatoires), dont adminTokenDistinct différents au moins (refuse « aaaa… »).
// 10 et non 16 (audit adverse 3, F1) : un jeton hexadécimal de 64 caractères tiré au hasard
// n'a que 16 symboles possibles et en omet un environ une fois sur quatre ; il était alors
// refusé et le serveur ne démarrait pas. Moins de 10 symboles distincts sur 64 tirages
// hexadécimaux : probabilité inférieure à 10^-9.
const adminTokenMin, adminTokenMax, adminTokenDistinct = 43, 512, 10

// emptyTokenHash : SHA-256 de la chaîne vide, ce que donne la commande documentée quand la
// variable du jeton n'est pas posée ; refusée (aucun jeton vide n'est jamais accepté).
const emptyTokenHash = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"

// adminFromEnv : SHH_ADMIN_LISTEN et le jeton du tableau de bord d'administration (conception
// du 13 novembre). Le serveur n'a besoin que de l'EMPREINTE du jeton (il ne compare que des
// empreintes) :
//
//   - SHH_ADMIN_TOKEN_SHA256 : SHA-256 du jeton, 64 chiffres hexadécimaux en minuscules
//     (printf %s "$JETON" | sha256sum). Le jeton lui-même reste chez l'exploitant : il n'est
//     plus ni dans deploy/.env, ni dans la configuration du conteneur, ni dans l'environnement
//     du processus (audit adverse du 13 novembre, 3e campagne : tableau de bord F5, stockage
//     F3). Contrepartie : la qualité du jeton ne peut plus être contrôlée ici (une empreinte ne
//     dit rien de ce qu'elle résume) ; c'est à la commande de tirage de la garantir
//     (openssl rand -hex 32).
//   - SHH_ADMIN_TOKEN : le jeton en clair, pour le développement local seulement. REFUSÉ avec
//     SHH_BEHIND_PROXY=1 (production), même sans tableau de bord.
//
// Les deux à la fois : refus. Sans SHH_ADMIN_LISTEN : désactivé, rien d'autre n'est lu (sauf
// le refus ci-dessus). Aucun message d'erreur ne reprend le jeton.
func adminFromEnv(listen string, proxied, behindProxy bool) (string, [32]byte, error) {
	var none [32]byte
	const calcul = `tirer le jeton sur son poste (openssl rand -hex 32), le garder hors du serveur, et ne donner ici que ` +
		`son empreinte : printf %s "$JETON" | sha256sum (les 64 premiers caractères)`
	t := os.Getenv("SHH_ADMIN_TOKEN")
	if t != "" && behindProxy {
		return "", none, errors.New("SHH_ADMIN_TOKEN (jeton en clair) est refusé avec SHH_BEHIND_PROXY=1 : le serveur ne doit " +
			"pas recevoir le jeton ; retirer cette variable et poser SHH_ADMIN_TOKEN_SHA256 : " + calcul)
	}
	l := os.Getenv("SHH_ADMIN_LISTEN")
	if l == "" {
		return "", none, nil
	}
	if err := checkListen("SHH_ADMIN_LISTEN", l, proxied); err != nil {
		return "", none, err
	}
	_, port, _ := net.SplitHostPort(l)
	if _, p, _ := net.SplitHostPort(listen); p == port {
		return "", none, errors.New("SHH_ADMIN_LISTEN doit avoir un autre port que SHH_LISTEN (écouteur distinct, jamais le port public)")
	}
	e := os.Getenv("SHH_ADMIN_TOKEN_SHA256")
	switch {
	case e != "" && t != "":
		return "", none, errors.New("SHH_ADMIN_TOKEN_SHA256 et SHH_ADMIN_TOKEN sont posées toutes les deux : n'en garder qu'une " +
			"(l'empreinte ; le jeton en clair ne sert qu'au développement local)")
	case e != "":
		h, ok := adminHashOK(e)
		if !ok {
			return "", none, errors.New("SHH_ADMIN_TOKEN_SHA256 invalide : attendu l'empreinte SHA-256 du jeton, 64 chiffres " +
				"hexadécimaux en minuscules, et pas celle d'un jeton vide ; " + calcul)
		}
		return l, h, nil
	case t == "":
		return "", none, errors.New("SHH_ADMIN_LISTEN exige SHH_ADMIN_TOKEN_SHA256 : " + calcul)
	case !adminTokenOK(t):
		return "", none, fmt.Errorf("SHH_ADMIN_TOKEN (développement local) : %d à %d caractères parmi A-Z a-z 0-9 - _ "+
			"tirés au hasard (exemple : openssl rand -hex 32) ; valeur refusée (non affichée)",
			adminTokenMin, adminTokenMax)
	}
	return l, sha256.Sum256([]byte(t)), nil
}

// adminHashOK : empreinte SHA-256 en hexadécimal, telle que sha256sum l'écrit (64 chiffres, en
// minuscules). Refusées : l'empreinte du jeton vide, et une valeur de moins de
// adminTokenDistinct symboles différents (« 000… » : pas une empreinte ; probabilité inférieure
// à 10^-9 pour une vraie).
func adminHashOK(e string) ([32]byte, bool) {
	var h [32]byte
	if len(e) != 64 || e == emptyTokenHash {
		return h, false
	}
	for i := 0; i < len(e); i++ {
		if c := e[i]; (c < '0' || c > '9') && (c < 'a' || c > 'f') {
			return h, false
		}
	}
	if _, err := hex.Decode(h[:], []byte(e)); err != nil || !adminTokenOK(e) {
		return [32]byte{}, false
	}
	return h, true
}

func adminTokenOK(t string) bool {
	if len(t) < adminTokenMin || len(t) > adminTokenMax {
		return false
	}
	var seen [256]bool
	distinct := 0
	for i := 0; i < len(t); i++ {
		b := t[i]
		if (b < 'a' || b > 'z') && (b < 'A' || b > 'Z') && (b < '0' || b > '9') && b != '-' && b != '_' {
			return false
		}
		if !seen[b] {
			seen[b] = true
			distinct++
		}
	}
	return distinct >= adminTokenDistinct
}
