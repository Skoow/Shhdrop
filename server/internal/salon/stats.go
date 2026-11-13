package salon

// Statistiques agrégées pour le tableau de bord d'administration (conception du 13 novembre,
// docs/superpowers/specs/2026-11-13-tableau-de-bord-admin-design.md, catégories C, D, F). Que
// des nombres : jamais un identifiant de salon, un siège désigné, un jeton ni une heure.

// Stats : état du salon à l'instant.
type Stats struct {
	// Vivants : salons créés par ce processus et pas encore finis (Manager.vivants) ; Max :
	// SHH_SALONS_MAX.
	Vivants int `json:"salons_vivants"`
	Max     int `json:"salons_max"`
	// Sieges : sièges occupés, tous salons confondus (sans dire où).
	Sieges int `json:"sieges_occupes"`
	// Connexions : WebSocket du salon servis en ce moment.
	Connexions int64 `json:"connexions"`
	// Trames, TramesMax : trames rangées en mémoire et plafond global (audit adverse, S1).
	Trames    int64 `json:"trames_en_memoire"`
	TramesMax int   `json:"trames_max"`
	// OctetsConversations : taille des fichiers de conversation ouverts.
	OctetsConversations int64 `json:"octets_conversations"`
	// Paniques : paniques récupérées dans l'entretien (Tick) depuis le démarrage.
	Paniques int64 `json:"paniques_entretien"`
}

// Stats lit l'état agrégé. Les sièges se comptent sous le verrou de chaque salon, pris un à un
// après avoir copié la liste sous Manager.mu (ordre des verrous : Manager.mu puis salon.mu,
// jamais l'inverse).
func (m *Manager) Stats() Stats {
	m.mu.Lock()
	vivants := len(m.vivants)
	salons := make([]*salon, 0, len(m.salons))
	for _, s := range m.salons {
		salons = append(salons, s)
	}
	m.mu.Unlock()
	sieges := 0
	for _, s := range salons {
		s.mu.Lock()
		if !s.fini {
			sieges += s.occupesLocked()
		}
		s.mu.Unlock()
	}
	return Stats{
		Vivants: vivants, Max: m.cfg.Max, Sieges: sieges, Connexions: m.servis.Load(),
		Trames: m.tramesGlob.Load(), TramesMax: m.tramesTotalMax(),
		OctetsConversations: m.octetsConv.Load(), Paniques: m.paniquesTick.Load(),
	}
}
