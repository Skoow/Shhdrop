package config

import (
	"fmt"
	"math"
	"os"
	"runtime/debug"
	"strconv"
)

// Capacité du serveur (demande du propriétaire du 13 novembre : aucune limite de capacité
// fixée en dur). Chaque valeur est réglable par une variable SHH_* ; sans elle, elle est
// calculée au démarrage d'après la machine : GOMEMLIMIT pour la mémoire, la limite de
// descripteurs de fichiers (RLIMIT_NOFILE, que Go relève à son plafond au démarrage) pour les
// connexions. Les limites anti-abus PAR PERSONNE (limits.go) ne sont pas ici.
type Capacity struct {
	// Uploads (SHH_UPLOADS_MAX) : PUT de segments simultanés (partages et pièces du salon).
	// Chacun garde son corps entier en mémoire (4 Mio) jusqu'à l'écriture.
	Uploads int
	// Downloads (SHH_DOWNLOADS_MAX) : GET de segments simultanés, servis en flux (tampon de
	// 256 Kio), 2 descripteurs chacun (connexion et fichier).
	Downloads int
	// Watches (SHH_WATCH_MAX) : surveillances tenues (GET /api/shares/watch, 25 s).
	Watches int
	// WebSockets (SHH_WS_MAX) : WebSocket du salon ouverts.
	WebSockets int
	// DiskOps (SHH_DISK_OPS_MAX) : appels système de fichiers simultanés dans les dossiers des
	// partages et des pièces (blob.Gate) : chacun tient un fil du système (audit D4).
	DiskOps int
}

const (
	mib = 1 << 20
	// uploadCost : mémoire d'un PUT en cours (corps de 4 Mio, share.Header compris).
	uploadCost = 4 * mib
	// downloadCost : tampon d'un GET en flux.
	downloadCost = 256 << 10
	// Valeurs sans GOMEMLIMIT (aucune base de calcul : celles d'avant le 13 novembre).
	defaultUploads, defaultDownloads = 64, 256
	defaultWebSockets                = 2000
	// defaultDiskOps : 64 fils au plus bloqués dans des appels de fichiers, quel que soit le
	// disque : bien sous pids_limit (1 024, compose.yaml), qui compte aussi les fils de Go.
	defaultDiskOps = 64
	// capMax : plafond de toute valeur réglable (borne de bon sens, pas de capacité).
	capMax = 1 << 20
)

// memLimit : GOMEMLIMIT en octets ; math.MaxInt64 sans limite.
func memLimit() int64 { return debug.SetMemoryLimit(-1) }

// computeCapacity : valeurs par défaut pour une limite de mémoire mem (math.MaxInt64 : aucune)
// et nofile descripteurs (0 : inconnu).
//
//   - Envois : 30 % de GOMEMLIMIT, à 4 Mio par envoi. Le ramasse-miettes peut doubler le tas
//     vivant (GOGC=100) : 60 % au pire, le reste pour les lectures, SQLite et le salon.
//     900 Mio → 67 places (64 avant).
//   - Lectures : 10 % de GOMEMLIMIT à 256 Kio par lecture (900 Mio → 360).
//   - Surveillances : autant que de lectures. WebSocket : 2 000.
//   - Descripteurs : chaque catégorie a au plus nofile / 8 places (lectures et envois : 2
//     descripteurs chacun), soit 3/4 de la limite au total, le reste pour la base, les
//     conversations et la marge.
func computeCapacity(mem int64, nofile uint64) Capacity {
	c := Capacity{Uploads: defaultUploads, Downloads: defaultDownloads, WebSockets: defaultWebSockets, DiskOps: defaultDiskOps}
	if mem > 0 && mem < math.MaxInt64 {
		c.Uploads = clamp(mem*3/10/uploadCost, 8, capMax)
		c.Downloads = clamp(mem/10/downloadCost, 16, capMax)
	}
	c.Watches = c.Downloads
	if fd := fdShare(nofile); fd > 0 {
		c.Uploads = min(c.Uploads, max(fd, 1))
		c.Downloads = min(c.Downloads, max(fd, 1))
		c.Watches = min(c.Watches, max(fd, 1))
		c.WebSockets = min(c.WebSockets, max(fd, 1))
	}
	return c
}

// fdShare : places d'une catégorie permises par nofile (nofile / 8) ; 0 : sans borne connue.
func fdShare(nofile uint64) int {
	if nofile == 0 || nofile >= capMax*8 {
		return 0
	}
	return int(nofile / 8)
}

func clamp(v, lo, hi int64) int { return int(max(lo, min(v, hi))) }

// capacityFromEnv : valeurs calculées, puis remplacées par les variables posées. Une valeur
// donnée doit tenir dans les descripteurs (nofile / 8) : sinon le serveur refuse de démarrer
// au lieu de tomber sous la charge (accept: too many open files).
func capacityFromEnv(mem int64, nofile uint64) (Capacity, error) {
	c := computeCapacity(mem, nofile)
	fd := fdShare(nofile)
	for _, v := range []struct {
		name  string
		dst   *int
		fdCap bool
	}{
		{"SHH_UPLOADS_MAX", &c.Uploads, true},
		{"SHH_DOWNLOADS_MAX", &c.Downloads, true},
		{"SHH_WATCH_MAX", &c.Watches, true},
		{"SHH_WS_MAX", &c.WebSockets, true},
		{"SHH_DISK_OPS_MAX", &c.DiskOps, false},
	} {
		s := os.Getenv(v.name)
		if s == "" {
			continue
		}
		n, err := strconv.Atoi(s)
		if err != nil || !digits(s) || s[0] == '0' || n < 1 || n > capMax {
			return Capacity{}, fmt.Errorf("%s invalide (entier de 1 à %d): %q", v.name, capMax, s)
		}
		if v.fdCap && fd > 0 && n > fd {
			return Capacity{}, fmt.Errorf("%s=%d dépasse la limite de descripteurs (%d / 8 = %d) : relever ulimits.nofile",
				v.name, n, nofile, fd)
		}
		*v.dst = n
	}
	return c, nil
}
