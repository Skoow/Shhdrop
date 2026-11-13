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
	// SegmentsPerMin (SHH_SEGMENTS_PER_MIN) : requêtes de segments par minute et par connexion
	// (limite anti-abus par personne, réglable : 1 500 par défaut, limits.SegmentsPerMin).
	SegmentsPerMin int
	// SalonFrames (SHH_SALON_FRAMES_MAX) : trames non volatiles rangées au plus par salon
	// (audit D3 ; salon.TramesMaxDefaut).
	SalonFrames int
	// SalonFramesTotal (SHH_SALON_FRAMES_TOTAL) : trames non volatiles rangées au plus EN
	// MÉMOIRE, tous salons confondus (audit adverse du 13 novembre, front serveur). C'est le
	// vrai garde-fou de la mémoire : le plafond par salon (SalonFrames) × SHH_SALONS_MAX
	// dépasserait sinon GOMEMLIMIT (200 salons pleins ≈ 840 Mio d'index) et ferait tuer le
	// processus. Partagé par tous les salons (Manager.tramesGlob) ; au-delà, 0x0C.
	SalonFramesTotal int
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
	// defaultSegmentsPerMin : limits.SegmentsPerMin (≈ 840 Mbit/s par expéditeur).
	defaultSegmentsPerMin = 1500
	// defaultSalonFrames : salon.TramesMaxDefaut (≈ 417 Mo de disque par salon au plus).
	defaultSalonFrames = 100000
	// salonFrameMem : mémoire budgétée par trame rangée (index de 24 o, avec la marge de
	// croissance des tranches et le doublement du ramasse-miettes : 48 o).
	salonFrameMem = 48
	// defaultSalonFramesTotal : plafond global sans GOMEMLIMIT (aucune base de calcul) ; ≈
	// 48 Mio d'index au plus, tous salons confondus.
	defaultSalonFramesTotal = 1000000
	// capMax : plafond de toute valeur réglable (borne de bon sens, pas de capacité).
	capMax = 1 << 20
	// framesTotalMax : borne de bon sens du plafond global (≈ 134 M de trames, 3,2 Gio d'index) ;
	// le plafond global monte avec GOMEMLIMIT, donc sa borne dépasse capMax.
	framesTotalMax = 1 << 27
)

// memLimit : GOMEMLIMIT en octets ; math.MaxInt64 sans limite.
func memLimit() int64 { return debug.SetMemoryLimit(-1) }

// computeCapacity : valeurs par défaut pour une limite de mémoire mem (math.MaxInt64 : aucune)
// et nofile descripteurs (0 : inconnu).
//
// Budgets mémoire, tirés d'un seul GOMEMLIMIT et pensés pour ne pas se recouvrir (audit
// adverse du 13 novembre : avant, l'index des salons n'était soustrait d'aucun budget et 200
// salons pleins faisaient tuer le processus) :
//
//   - Envois : 30 % de GOMEMLIMIT, à 4 Mio par envoi. Le ramasse-miettes peut doubler le tas
//     vivant (GOGC=100) : 60 % au pire. 900 Mio → 67 places (64 avant).
//   - Lectures : 10 % de GOMEMLIMIT à 256 Kio par lecture (900 Mio → 360).
//   - Index des salons (SalonFramesTotal) : 10 % de GOMEMLIMIT à 48 o la trame, tous salons
//     confondus (900 Mio → ≈ 1,97 M de trames). C'est le plafond GLOBAL : le plafond PAR salon
//     (SalonFrames) reste un garde-fou secondaire.
//   - Le reste (≈ 50 %, doublement du ramasse-miettes compris) pour SQLite, les conversations
//     et la marge.
//   - Surveillances : autant que de lectures. WebSocket : 2 000.
//   - Descripteurs : chaque catégorie a au plus nofile / 8 places (lectures et envois : 2
//     descripteurs chacun), soit 3/4 de la limite au total, le reste pour la base, les
//     conversations et la marge.
func computeCapacity(mem int64, nofile uint64) Capacity {
	c := Capacity{Uploads: defaultUploads, Downloads: defaultDownloads, WebSockets: defaultWebSockets, DiskOps: defaultDiskOps,
		SegmentsPerMin: defaultSegmentsPerMin, SalonFrames: defaultSalonFrames, SalonFramesTotal: defaultSalonFramesTotal}
	if mem > 0 && mem < math.MaxInt64 {
		c.Uploads = clamp(mem*3/10/uploadCost, 8, capMax)
		c.Downloads = clamp(mem/10/downloadCost, 16, capMax)
		c.SalonFramesTotal = clamp(mem/10/salonFrameMem, 1000, framesTotalMax)
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
		hi    int // plafond propre (0 : capMax)
	}{
		{"SHH_UPLOADS_MAX", &c.Uploads, true, 0},
		{"SHH_DOWNLOADS_MAX", &c.Downloads, true, 0},
		{"SHH_WATCH_MAX", &c.Watches, true, 0},
		{"SHH_WS_MAX", &c.WebSockets, true, 0},
		{"SHH_DISK_OPS_MAX", &c.DiskOps, false, 0},
		{"SHH_SEGMENTS_PER_MIN", &c.SegmentsPerMin, false, 0},
		{"SHH_SALON_FRAMES_MAX", &c.SalonFrames, false, 0},
		{"SHH_SALON_FRAMES_TOTAL", &c.SalonFramesTotal, false, framesTotalMax},
	} {
		hi := capMax
		if v.hi > 0 {
			hi = v.hi
		}
		s := os.Getenv(v.name)
		if s == "" {
			continue
		}
		n, err := strconv.Atoi(s)
		if err != nil || !digits(s) || s[0] == '0' || n < 1 || n > hi {
			return Capacity{}, fmt.Errorf("%s invalide (entier de 1 à %d): %q", v.name, hi, s)
		}
		if v.fdCap && fd > 0 && n > fd {
			return Capacity{}, fmt.Errorf("%s=%d dépasse la limite de descripteurs (%d / 8 = %d) : relever ulimits.nofile",
				v.name, n, nofile, fd)
		}
		*v.dst = n
	}
	return c, nil
}
