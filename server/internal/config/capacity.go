package config

import (
	"fmt"
	"math"
	"os"
	"runtime/debug"
	"strconv"
	"strings"
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
	// WebSockets (SHH_WS_MAX) : WebSocket du salon ouverts. Chacun peut tenir un lot de
	// rattrapage en mémoire tant que son client ne lit pas (wsCost).
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
	// ConvDiskOps : appels système simultanés au plus sur les fichiers de conversation du
	// salon, pour les écritures d'une part et les lectures de l'autre (deux bornes de cette
	// taille, séparées de DiskOps : audit adverse du 13 novembre, front serveur, F1 et F2).
	// Jamais réglé à part : le quart de DiskOps (au moins 1). Fils du système au pire, tous
	// appels de fichiers confondus : DiskThreads.
	ConvDiskOps int
}

const (
	mib = 1 << 20
	// uploadCost : mémoire d'un PUT en cours (corps de 4 Mio, share.Header compris).
	uploadCost = 4 * mib
	// downloadCost : tampon d'un GET en flux.
	downloadCost = 256 << 10
	// wsCost : mémoire budgétée par WebSocket du salon (salon.MemoireParConnexion, un test les
	// compare) : un lot de rattrapage tenu par un client qui ne lit plus, et la marge de la
	// connexion (audit adverse du 13 novembre, 3e campagne, front serveur, D : aucun budget ne
	// comptait les WebSocket ; 2 000 connexions tenaient ≈ 600 Mio pour GOMEMLIMIT = 900 Mio).
	wsCost = WebSocketMem
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

// DiskThreads : fils du système que les appels de fichiers peuvent tenir en même temps, au
// pire (disque qui ne répond plus) : partages et pièces (DiskOps), écritures et lectures des
// conversations (2 × ConvDiskOps). Plus aucun appel de fichier ne dépend du nombre de
// connexions (SHH_WS_MAX) : les lectures du rattrapage passent par leur borne (F2).
func (c Capacity) DiskThreads() int { return c.DiskOps + 2*c.ConvDiskOps }

// pidsFile : limite de processus et de fils du conteneur (cgroup v2 ; pids_limit de
// compose.yaml), vue de l'intérieur.
const pidsFile = "/sys/fs/cgroup/pids.max"

// pidsMax : limite lue dans le fichier f ; 0 si elle est inconnue ou absente (« max », hors
// conteneur, cgroup v1, autre système) : aucun contrôle alors.
func pidsMax(f string) int {
	b, err := os.ReadFile(f)
	if err != nil {
		return 0
	}
	s := strings.TrimSpace(string(b))
	n, err := strconv.Atoi(s)
	if err != nil || !digits(s) || n < 1 {
		return 0
	}
	return n
}

// checkThreads refuse une configuration où les appels de fichiers pourraient, à eux seuls,
// tenir plus de la moitié des fils permis au conteneur (pids, 0 : inconnu) : sous un disque
// lent, le runtime Go s'arrêterait net (« failed to create new OS thread »), partages et
// salons avec lui (audit du 13 novembre, D4 ; audit adverse, F2). L'autre moitié reste au
// runtime Go, au réseau et à SQLite.
func checkThreads(c Capacity, pids int) error {
	if n := c.DiskThreads(); pids > 0 && n > pids/2 {
		return fmt.Errorf("SHH_DISK_OPS_MAX=%d : jusqu'à %d fils du système bloqués sur le disque (partages et pièces %d, "+
			"conversations 2 × %d), plus de la moitié de pids_limit (%d) : baisser SHH_DISK_OPS_MAX ou relever pids_limit "+
			"(compose.yaml)", c.DiskOps, n, c.DiskOps, c.ConvDiskOps, pids)
	}
	return nil
}

// WebSocketMem : wsCost, exportée pour le test qui la compare à salon.MemoireParConnexion.
const WebSocketMem = 64 << 10

const (
	// SalonJournalMem : mémoire budgétée pour le journal des annonces d'un salon, hors de
	// SalonFramesTotal : 4 096 annonces au plus (salon.journalMax) à 64 o (rang, tranche,
	// enregistrement de 26 o au plus). Un test compare avec salon.MemoireJournalMax.
	SalonJournalMem = 4096 * 64
	// salonPartMin : trames en mémoire garanties au moins à chaque salon (SalonFramesShare) ;
	// en dessous, le plafond global ne protège plus un salon de ses voisins (F3).
	salonPartMin = 1000
)

// SalonFramesShare : part de trames en mémoire réservée à chaque salon : la moitié du plafond
// global, à parts égales entre les max salons possibles, jamais plus que le plafond par salon
// (même calcul que salon.PartTrames ; un test les compare).
func SalonFramesShare(total, max, perSalon int) int {
	if total <= 0 || max <= 0 {
		return 0
	}
	return min(total/2/max, perSalon)
}

// checkSalons refuse un SHH_SALONS_MAX que la mémoire ne porte pas (audit adverse du
// 13 novembre, front serveur : aucun garde-fou de démarrage ne croisait SHH_SALONS_MAX et la
// mémoire) :
//   - journaux des annonces (hors du plafond global des trames) : SHH_SALONS_MAX ×
//     SalonJournalMem tient dans 10 % de GOMEMLIMIT (mem ; sans limite connue : pas de
//     contrôle) ;
//   - part de trames garantie à chaque salon : au moins salonPartMin.
func checkSalons(salonsMax int, c Capacity, mem int64) error {
	if mem > 0 && mem < math.MaxInt64 && int64(salonsMax)*SalonJournalMem > mem/10 {
		return fmt.Errorf("SHH_SALONS_MAX=%d : les journaux des salons pourraient prendre %d Mio, plus de 10 %% de GOMEMLIMIT "+
			"(%d Mio) : au plus %d salons avec cette mémoire ; baisser SHH_SALONS_MAX ou relever mem_limit et GOMEMLIMIT",
			salonsMax, int64(salonsMax)*SalonJournalMem/mib, mem/mib, mem/10/SalonJournalMem)
	}
	if part := SalonFramesShare(c.SalonFramesTotal, salonsMax, c.SalonFrames); part < min(salonPartMin, c.SalonFrames) {
		return fmt.Errorf("SHH_SALONS_MAX=%d : avec SHH_SALON_FRAMES_TOTAL=%d, chaque salon n'aurait que %d trames garanties "+
			"(au moins %d) : baisser SHH_SALONS_MAX, ou relever GOMEMLIMIT (ou SHH_SALON_FRAMES_TOTAL, au moins %d)",
			salonsMax, c.SalonFramesTotal, part, salonPartMin, 2*salonPartMin*salonsMax)
	}
	return nil
}

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
//   - WebSocket du salon : 10 % de GOMEMLIMIT à 64 Kio par connexion (wsCost), 2 000 au plus
//     (900 Mio → 1 440).
//   - Journaux des salons : 10 % au plus (checkSalons).
//   - Le reste (≈ 30 %) pour SQLite, les conversations et la marge. Avec GOMEMLIMIT, le
//     ramasse-miettes passe plus souvent quand le tas vivant approche de la limite, au lieu de
//     le laisser doubler.
//   - Surveillances : autant que de lectures.
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
		c.WebSockets = clamp(mem/10/wsCost, 16, defaultWebSockets)
	}
	c.Watches = c.Downloads
	if fd := fdShare(nofile); fd > 0 {
		c.Uploads = min(c.Uploads, max(fd, 1))
		c.Downloads = min(c.Downloads, max(fd, 1))
		c.Watches = min(c.Watches, max(fd, 1))
		c.WebSockets = min(c.WebSockets, max(fd, 1))
	}
	c.ConvDiskOps = max(1, c.DiskOps/4)
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
	c.ConvDiskOps = max(1, c.DiskOps/4)
	if err := checkWebSockets(c, mem); err != nil {
		return Capacity{}, err
	}
	return c, nil
}

// checkWebSockets refuse un SHH_WS_MAX que la mémoire ne porte pas : SHH_WS_MAX × wsCost doit
// tenir dans 10 % de GOMEMLIMIT (mem ; sans limite connue : pas de contrôle), comme la valeur
// calculée (audit adverse du 13 novembre, 3e campagne, front serveur, D). Sinon des connexions
// en rattrapage qui ne lisent plus, ou une reconnexion de tous les membres après une coupure,
// feraient tuer le processus faute de mémoire, et tous les salons avec lui.
func checkWebSockets(c Capacity, mem int64) error {
	if mem > 0 && mem < math.MaxInt64 && int64(c.WebSockets)*wsCost > max(mem/10, 16*wsCost) {
		return fmt.Errorf("SHH_WS_MAX=%d : les WebSocket du salon pourraient tenir %d Mio (%d Kio chacun), plus de 10 %% de "+
			"GOMEMLIMIT (%d Mio) : au plus %d avec cette mémoire ; baisser SHH_WS_MAX (ou le laisser vide : il est alors "+
			"calculé) ou relever mem_limit et GOMEMLIMIT", c.WebSockets, int64(c.WebSockets)*wsCost/mib, wsCost>>10, mem/mib,
			max(mem/10/wsCost, 16))
	}
	return nil
}
