package main

import (
	"bytes"
	"database/sql"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net"
	"os"
	"path/filepath"
	"time"

	"github.com/skoow/shhdrop/server/internal/adminui"
	"github.com/skoow/shhdrop/server/internal/blob"
	"github.com/skoow/shhdrop/server/internal/config"
	"github.com/skoow/shhdrop/server/internal/salon"
	"github.com/skoow/shhdrop/server/internal/share"
	"github.com/skoow/shhdrop/server/internal/store"
)

// adminDeps : ce que le tableau de bord d'administration lit et commande dans le serveur
// en marche.
type adminDeps struct {
	svc   *share.Service
	sm    *salon.Manager // nil : salon désactivé
	db    *sql.DB
	gate  *blob.Gate
	alert func() bool // alerte des signalements (booléen de /healthz)
	start time.Time   // démarrage du processus, en mémoire seulement
}

// adminListen : ouverture de l'écouteur d'administration (variable pour les tests).
var adminListen = func(addr string) (net.Listener, error) { return net.Listen("tcp", addr) }

// startAdmin : écouteur d'administration (SHH_ADMIN_LISTEN), distinct de l'écouteur public.
// Désactivé sans SHH_ADMIN_LISTEN. Le tableau de bord est un plus, jamais une dépendance :
// si son écouteur ne s'ouvre pas, une ligne fixe le dit (« SHH_ADMIN_INDISPONIBLE », sans
// détail système) et le serveur public continue. Rend l'arrêt de l'écouteur.
func startAdmin(cfg config.Config, out io.Writer, d adminDeps) (stop func()) {
	if cfg.AdminListen == "" {
		return func() {}
	}
	ln, err := adminListen(cfg.AdminListen)
	if err != nil {
		fmt.Fprintln(out, "SHH_ADMIN_INDISPONIBLE")
		return func() {}
	}
	srv := adminui.Server(adminui.New(adminui.Config{
		TokenHash: cfg.AdminTokenHash, Peers: cfg.TrustedProxies,
		State:    func() (adminui.State, error) { return adminState(cfg, d) },
		Freeze:   func() error { return freeze(d.svc.FrozenFile) },
		Unfreeze: func() error { return unfreeze(d.svc.FrozenFile) },
		Destroy:  func(link []byte) (string, error) { return adminDestroy(cfg, d, link) },
	}))
	fmt.Fprintf(out, "SHH_ADMIN_LISTENING %s\n", ln.Addr())
	done := make(chan struct{})
	go func() { srv.Serve(ln); close(done) }()
	return func() { srv.Close(); <-done }
}

// unfreeze retire le fichier de gel ; idempotent.
func unfreeze(frozen string) error {
	if err := os.Remove(frozen); err != nil && !errors.Is(err, fs.ErrNotExist) {
		return err
	}
	return nil
}

// adminState : état agrégé, lu à l'instant (inventaire A à G de la conception, phase 1).
// Rien n'est gardé d'une lecture à l'autre.
func adminState(cfg config.Config, d adminDeps) (adminui.State, error) {
	var st adminui.State
	goVersion, rev := adminui.Build()
	st.Sante = adminui.Sante{DepuisS: int64(time.Since(d.start) / time.Second), Go: goVersion, Revision: rev,
		Gele: d.svc.Frozen(), SalonActif: d.sm != nil, Origine: cfg.Origin, AlerteSignalements: d.alert(),
		VidagesRates: d.svc.Vidage.Rates()}

	partages, err := d.svc.UsedShares()
	if err != nil {
		return adminui.State{}, err
	}
	var salonOctets int64
	if d.sm != nil {
		salonOctets = d.sm.UsedBytes()
		s := d.sm.Stats()
		st.Salon = &s
	}
	// Disque illisible (système non pris en charge) : 0, la page le montre tel quel.
	libre, _ := diskFree(cfg.DataDir)
	total, _ := statfsTotal(cfg.DataDir)
	utilise := partages + salonOctets
	st.Stockage = adminui.Stockage{DisqueLibre: libre, DisqueTotal: total, Plafond: cfg.StorageMaxBytes,
		Partages: partages, Salon: salonOctets, Utilise: utilise, Restant: max(0, cfg.StorageMaxBytes-utilise),
		Reserve: cfg.StorageMaxBytes / share.StorageReserve}

	st.Memoire = adminui.Runtime()

	c := capacityOf(cfg).WithDefaults()
	st.Capacite = adminui.Capacite{EnvoisMax: c.Uploads, LecturesMax: c.Downloads, SurveillancesMax: c.Watches,
		WebSocketMax: c.WebSockets, AppelsDisqueMax: d.gate.Cap(), Surveillances: d.svc.WatchCount(),
		Octrois: d.svc.GrantCount(), Budgets: d.svc.BudgetCount(), AppelsDisque: d.gate.InUse()}

	if st.Partages, err = d.svc.CountByState(); err != nil {
		return adminui.State{}, err
	}
	return st, nil
}

// adminDestroy : destruction d'un lien signalé depuis la page, comme « shhdrop admin
// destroy - » mais dans le serveur en marche : seule K_accès est tirée du lien, puis effacée.
// Partage : flux coupés tout de suite (DestroyAdmin). Salon : ligne, pièces et conversation
// supprimées ; les connexions se ferment au tick suivant (≤ 1 s).
func adminDestroy(cfg config.Config, d adminDeps, body []byte) (string, error) {
	link, err := readLink(bytes.NewReader(body))
	if err != nil {
		return "", adminui.ErrLienInvalide
	}
	if k, ok := salonAccessKeyOf(link); ok {
		defer clear(k)
		if err := store.RequireCurrent(d.db); err != nil {
			return "", err
		}
		err := salon.DetruireHorsLigne(d.db, &blob.Store{Dir: filepath.Join(cfg.DataDir, dirSalonPieces), Gate: d.gate},
			filepath.Join(cfg.DataDir, dirSalons), k)
		if errors.Is(err, salon.ErrNotFound) {
			return "", adminui.ErrIntrouvable
		}
		return "salon", err
	}
	k, ok := accessKeyOf(link)
	if !ok {
		return "", adminui.ErrLienInvalide
	}
	defer clear(k)
	if err := d.svc.DestroyAdmin(k); err != nil {
		if errors.Is(err, share.ErrNotFound) {
			return "", adminui.ErrIntrouvable
		}
		return "", err
	}
	return "partage", nil
}
