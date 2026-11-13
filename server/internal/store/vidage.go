package store

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"sync/atomic"
	"time"
)

// Vidage : vidages du WAL demandés après chaque suppression ou réécriture sensible (partages
// et salons), regroupés : au plus un par VidageIntervalle (audit adverse du 13 novembre,
// stockage, F1 : seules les destructions explicites vidaient le WAL ; une fin de
// téléchargement, 5 essais faux, toute fin de salon ou un renouvellement laissaient
// identifiants, vérificateurs, sel et échéance dans shares.db-wal et dans shares.db jusqu'au
// passage du janitor, 60 s au plus). Demander ne fait que lever un drapeau : ni la requête ni
// l'entretien n'attendent le vidage, fait par la goroutine de Run.
//
// Chaque vidage attend au plus vidageAttenteMs un lecteur ou un écrivain d'un AUTRE processus
// (F3 : avec les 5 s du reste des requêtes, un outil qui lisait la base figeait l'API à chaque
// destruction). Un vidage raté est compté (Rates, tableau de bord) et redemandé.
//
// Une valeur nil ne fait rien (tests, commandes hors du serveur).
type Vidage struct {
	db     *sql.DB
	reveil chan struct{}
	rates  atomic.Int64
}

// VidageIntervalle : délai minimal entre deux vidages de Run.
const VidageIntervalle = time.Second

// vidageAttenteMs : attente d'une base occupée par un autre processus, pour un vidage.
const vidageAttenteMs = "100"

// NewVidage : vidages de db.
func NewVidage(db *sql.DB) *Vidage { return &Vidage{db: db, reveil: make(chan struct{}, 1)} }

// Demander : un vidage est à faire (prochain passage de Run). Ne bloque jamais.
func (v *Vidage) Demander() {
	if v == nil {
		return
	}
	select {
	case v.reveil <- struct{}{}:
	default:
	}
}

// Maintenant : vidage tout de suite, dans l'appelant (destruction explicite, janitor), avec
// l'attente courte. Un échec (ErrCheckpointBusy, ou erreur de la base) est compté et un
// nouveau vidage demandé à Run.
func (v *Vidage) Maintenant() error {
	if v == nil {
		return nil
	}
	err := checkpointCourt(v.db)
	if err != nil {
		v.rates.Add(1)
		v.Demander()
	}
	return err
}

// Rates : vidages ratés depuis le démarrage (un entier en mémoire, sans rien d'autre). S'il
// monte sans cesse, un autre processus tient la base ouverte (outil de sauvegarde, sqlite3) :
// le WAL n'est plus vidé et garde l'historique des suppressions.
func (v *Vidage) Rates() int64 {
	if v == nil {
		return 0
	}
	return v.rates.Load()
}

// Run fait les vidages demandés, au plus un par VidageIntervalle, jusqu'à l'annulation de ctx.
// Une panique est récupérée sans aucune sortie et comptée comme un vidage raté.
func (v *Vidage) Run(ctx context.Context) {
	t := time.NewTimer(0)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-v.reveil:
		}
		func() {
			defer func() {
				if recover() != nil {
					v.rates.Add(1)
				}
			}()
			_ = v.Maintenant()
		}()
		if !t.Stop() {
			select {
			case <-t.C:
			default:
			}
		}
		t.Reset(VidageIntervalle)
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
	}
}

// checkpointCourt : Checkpoint qui n'attend une base occupée que vidageAttenteMs, sur la
// connexion du pool (une seule : SetMaxOpenConns(1)), dont l'attente habituelle est remise
// ensuite. Si elle ne peut pas l'être, la connexion est écartée : la suivante reprend les
// réglages du DSN (pragmas).
func checkpointCourt(db *sql.DB) error {
	ctx := context.Background()
	c, err := db.Conn(ctx)
	if err != nil {
		return err
	}
	defer c.Close()
	if _, err := c.ExecContext(ctx, "PRAGMA busy_timeout="+vidageAttenteMs); err != nil {
		return err
	}
	defer func() {
		if _, err := c.ExecContext(ctx, "PRAGMA busy_timeout="+busyTimeoutMs); err != nil {
			_ = c.Raw(func(any) error { return driver.ErrBadConn })
		}
	}()
	var busy, logFrames, done int
	if err := c.QueryRowContext(ctx, "PRAGMA wal_checkpoint(TRUNCATE)").Scan(&busy, &logFrames, &done); err != nil {
		return err
	}
	if busy != 0 {
		return ErrCheckpointBusy
	}
	return nil
}
