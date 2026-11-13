package adminui

import (
	"bytes"
	"os"
	"runtime"
	"runtime/debug"
	"strconv"

	"github.com/skoow/shhdrop/server/internal/salon"
	"github.com/skoow/shhdrop/server/internal/share"
)

// State : tout ce que la page affiche (inventaire A à G de la conception, phase 1). Que des
// nombres, des booléens et trois chaînes de configuration (version de Go, empreinte de
// compilation, origine publique du site). Un test parcourt le JSON et refuse toute autre chaîne.
type State struct {
	Sante    Sante         `json:"sante"`
	Stockage Stockage      `json:"stockage"`
	Memoire  Memoire       `json:"memoire"`
	Capacite Capacite      `json:"capacite"`
	Partages share.ByState `json:"partages"`
	// Salon : nil si le salon est désactivé (SHH_SALONS).
	Salon *salon.Stats `json:"salon"`
}

// Sante : état général (A, G).
type Sante struct {
	// DepuisS : secondes depuis le démarrage du processus (heure gardée en mémoire seulement).
	DepuisS    int64  `json:"en_marche_depuis_s"`
	Go         string `json:"go"`
	Revision   string `json:"revision"`
	Gele       bool   `json:"creations_gelees"`
	SalonActif bool   `json:"salon_actif"`
	Origine    string `json:"origine"`
	// AlerteSignalements : au moins 5 signalements dans l'heure (le booléen de /healthz) ;
	// jamais le nombre (spec §15.2, §36 S21).
	AlerteSignalements bool `json:"alerte_signalements"`
	// VidagesRates : vidages du WAL ratés depuis le démarrage (store.Vidage.Rates) : base tenue
	// par un autre processus (outil de sauvegarde, sqlite3). Tant qu'il monte, le WAL garde les
	// lignes effacées (audit adverse du 13 novembre, stockage, F3). Un entier, rien d'autre.
	VidagesRates int64 `json:"vidages_wal_rates"`
}

// Stockage : disque et plafond (B), en octets.
type Stockage struct {
	DisqueLibre uint64 `json:"disque_libre"`
	DisqueTotal uint64 `json:"disque_total"`
	Plafond     int64  `json:"plafond"`
	Partages    int64  `json:"octets_partages"`
	Salon       int64  `json:"octets_salon"`
	Utilise     int64  `json:"utilise"`
	Restant     int64  `json:"restant"`
	// Reserve : dernier huitième du plafond, ouvert aux seuls nouveaux venus (share.StorageLimit).
	Reserve int64 `json:"reserve_nouveaux_venus"`
}

// Memoire : mémoire et moteur d'exécution (C).
type Memoire struct {
	// Utilisee : mémoire comptée par GOMEMLIMIT (prise au système, moins ce qui lui est rendu).
	Utilisee uint64 `json:"utilisee"`
	// Limite : GOMEMLIMIT en octets ; 0 = aucune.
	Limite     int64 `json:"limite"`
	Goroutines int   `json:"goroutines"`
	// Fils : fils du système du processus (à comparer à pids_limit) ; 0 si illisible.
	Fils            int    `json:"fils_systeme"`
	PassesGC        uint32 `json:"passes_gc"`
	DernierePauseNs uint64 `json:"derniere_pause_gc_ns"`
}

// Capacite : places et charge (D).
type Capacite struct {
	EnvoisMax        int   `json:"envois_max"`
	LecturesMax      int   `json:"lectures_max"`
	SurveillancesMax int   `json:"surveillances_max"`
	WebSocketMax     int   `json:"websocket_max"`
	AppelsDisqueMax  int   `json:"appels_disque_max"`
	Surveillances    int   `json:"surveillances"`
	Octrois          int   `json:"octrois_lecture"`
	Budgets          int   `json:"budgets_lecture"`
	AppelsDisque     int64 `json:"appels_disque"`
}

// Runtime lit la mémoire et le moteur d'exécution à l'instant.
func Runtime() Memoire {
	var ms runtime.MemStats
	runtime.ReadMemStats(&ms)
	m := Memoire{Utilisee: ms.Sys - ms.HeapReleased, Goroutines: runtime.NumGoroutine(), Fils: threads(),
		PassesGC: ms.NumGC}
	if ms.NumGC > 0 {
		m.DernierePauseNs = ms.PauseNs[(ms.NumGC+255)%256]
	}
	// SetMemoryLimit(-1) lit la limite sans la changer ; MaxInt64 = aucune.
	if l := debug.SetMemoryLimit(-1); l > 0 && l < 1<<62 {
		m.Limite = l
	}
	return m
}

// Build : version de Go et empreinte de compilation (vcs.revision, abrégée), si présente.
func Build() (goVersion, revision string) {
	goVersion = runtime.Version()
	if bi, ok := debug.ReadBuildInfo(); ok {
		for _, s := range bi.Settings {
			if s.Key == "vcs.revision" {
				revision = s.Value
				if len(revision) > 12 {
					revision = revision[:12]
				}
			}
		}
	}
	return goVersion, revision
}

// threads : ligne « Threads: » de /proc/self/status (Linux) ; 0 ailleurs ou si illisible.
func threads() int {
	b, err := os.ReadFile("/proc/self/status")
	if err != nil {
		return 0
	}
	for _, l := range bytes.Split(b, []byte{'\n'}) {
		if v, ok := bytes.CutPrefix(l, []byte("Threads:")); ok {
			n, _ := strconv.Atoi(string(bytes.TrimSpace(v)))
			return n
		}
	}
	return 0
}
