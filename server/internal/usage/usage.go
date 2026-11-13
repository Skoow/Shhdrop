// Package usage : compteurs d'usage du service, pour le tableau de bord d'administration
// (décision du propriétaire du 13 novembre : lever « aucune statistique » de §35.1 pour des
// agrégats d'exploitation ; spec §9.5 amendée).
//
// Règles, vérifiées par les tests :
//   - un entier par compteur, sans aucune clé : rien par personne, par adresse, par partage
//     ni par salon ; aucune table (map), aucune liste, aucune date ;
//   - en mémoire seulement : rien n'est écrit sur disque, tout repart de zéro au démarrage ;
//   - lus seulement par l'écouteur d'administration, jamais par une route publique ;
//   - les signalements ne sont pas comptés à part (spec §15.2, §36 S21 : un booléen
//     seulement) : ils entrent dans « destructions demandées » avec les autres.
package usage

import "sync/atomic"

// Counters : compteurs depuis le démarrage du processus. La valeur zéro est prête à servir.
type Counters struct {
	partagesCrees, envoisTermines, deverrouillages, destructions atomic.Int64
	refusDebit, octetsRecus, octetsServis                        atomic.Int64
	salonsCrees, entreesSalon                                    atomic.Int64
}

// Snapshot : lecture des compteurs à un instant (JSON de la page d'administration).
type Snapshot struct {
	// PartagesCrees : créations de partage acceptées (lien réservé, envoi commencé).
	PartagesCrees int64 `json:"partages_crees"`
	// EnvoisTermines : partages finalisés (lien prêt à être ouvert).
	EnvoisTermines int64 `json:"envois_termines"`
	// Deverrouillages : mots de passe justes (ouvertures et reprises d'une ouverture).
	Deverrouillages int64 `json:"deverrouillages"`
	// Destructions : destructions demandées par une personne (destinataire, expéditeur,
	// signalement), confondues.
	Destructions int64 `json:"destructions_demandees"`
	// RefusDebit : requêtes refusées par la limite de débit (429), sans dire de qui.
	RefusDebit int64 `json:"refus_debit"`
	// OctetsRecus, OctetsServis : volume chiffré reçu (segments envoyés) et servi (segments lus
	// en entier), partages seulement.
	OctetsRecus  int64 `json:"octets_recus"`
	OctetsServis int64 `json:"octets_servis"`
	// SalonsCrees, EntreesSalon : salons créés et entrées réussies dans un salon.
	SalonsCrees  int64 `json:"salons_crees"`
	EntreesSalon int64 `json:"entrees_salon"`
}

func (c *Counters) PartageCree()       { c.partagesCrees.Add(1) }
func (c *Counters) EnvoiTermine()      { c.envoisTermines.Add(1) }
func (c *Counters) Deverrouillage()    { c.deverrouillages.Add(1) }
func (c *Counters) Destruction()       { c.destructions.Add(1) }
func (c *Counters) RefusDebit()        { c.refusDebit.Add(1) }
func (c *Counters) Recu(octets int64)  { c.octetsRecus.Add(octets) }
func (c *Counters) Servi(octets int64) { c.octetsServis.Add(octets) }
func (c *Counters) SalonCree()         { c.salonsCrees.Add(1) }
func (c *Counters) EntreeSalon()       { c.entreesSalon.Add(1) }

// Snapshot lit tous les compteurs.
func (c *Counters) Snapshot() Snapshot {
	return Snapshot{
		PartagesCrees: c.partagesCrees.Load(), EnvoisTermines: c.envoisTermines.Load(),
		Deverrouillages: c.deverrouillages.Load(), Destructions: c.destructions.Load(),
		RefusDebit: c.refusDebit.Load(), OctetsRecus: c.octetsRecus.Load(), OctetsServis: c.octetsServis.Load(),
		SalonsCrees: c.salonsCrees.Load(), EntreesSalon: c.entreesSalon.Load(),
	}
}
