package salon

import (
	"errors"
	"strconv"
	"time"
)

// Erreurs du gestionnaire : messages fixes, sans identifiant, chemin ni secret. La couche
// HTTP les traduit en réponses fixes (plan C-2 Task 7 ; spec §39.3.9).
var (
	// ErrNotFound : salon inconnu, échu, détruit, mauvaise K_accès_s ou S_gestion, jeton
	// inconnu (place libérée, remplacé, redémarrage) : même erreur partout (aucun oracle).
	ErrNotFound = errors.New("salon: introuvable")
	// ErrFull : plus de siège libre, ou plafond des arrivées atteint (409 full).
	ErrFull = errors.New("salon: complet")
	// ErrBusy : SHH_SALONS_MAX atteint, ou place disque insuffisante pour un nouveau salon.
	ErrBusy = errors.New("salon: service occupé")
	// ErrBadRequest : valeur hors des bornes de la spécification.
	ErrBadRequest = errors.New("salon: requête invalide")
	// ErrConflict : access_v ou manage_v déjà pris.
	ErrConflict = errors.New("salon: déjà présent")
	// ErrExcluded : jeton révoqué par une exclusion (4002).
	ErrExcluded = errors.New("salon: exclu")
	// ErrForbidden : action réservée (créateur, auteur d'une trame ou d'une pièce).
	ErrForbidden = errors.New("salon: action interdite")
	// ErrBudget : budget de pièces du salon (1 Gio) ou budget de lecture épuisé.
	ErrBudget = errors.New("salon: budget épuisé")
	// ErrStale : exclusion qui ne correspond plus à l'état (siège, nonce_arrivée).
	ErrStale = errors.New("salon: état dépassé")
	// ErrLimit : limite atteinte sans délai d'attente utile.
	ErrLimit = errors.New("salon: limite atteinte")
	// ErrPlein : disque plein, trame non rangée (0x0C).
	ErrPlein = errors.New("salon: disque plein")
	// ErrBase : erreur de la base (message fixe, sans requête ni chemin).
	ErrBase = errors.New("salon: erreur de la base")
)

// BadPassword : K_preuve_s fausse, avec les essais restants (le 10ᵉ détruit le salon et
// rend ErrNotFound). Champ attempts_left des réponses (plan, point 18).
type BadPassword struct{ AttemptsLeft int }

func (e *BadPassword) Error() string { return "salon: mot de passe incorrect" }

// Attente : limite atteinte ; réessayer après Retry.
type Attente struct{ Retry time.Duration }

func (e *Attente) Error() string {
	return "salon: limite atteinte, réessayer dans " + strconv.FormatInt(int64(e.Retry.Seconds()), 10) + " s"
}
