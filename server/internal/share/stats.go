package share

// Décomptes agrégés pour le tableau de bord d'administration (conception du 13 novembre,
// docs/superpowers/specs/2026-11-13-tableau-de-bord-admin-design.md, catégorie E). Aucun
// identifiant, aucune date, aucune taille : seulement combien de partages dans chaque état.

// ByState : nombre de partages par état (§29 : uploading, ready, draining).
type ByState struct {
	Uploading int `json:"envois_en_cours"`
	Ready     int `json:"prets"`
	Draining  int `json:"fin_de_lecture"`
}

// CountByState compte les lignes de shares par état. Une seule requête GROUP BY : la base ne
// rend que des nombres, jamais un identifiant.
func (s *Service) CountByState() (ByState, error) {
	var b ByState
	rows, err := s.DB.Query(`SELECT state, count(*) FROM shares GROUP BY state`)
	if err != nil {
		return ByState{}, err
	}
	defer rows.Close()
	for rows.Next() {
		var state string
		var n int
		if err := rows.Scan(&state, &n); err != nil {
			return ByState{}, err
		}
		switch state {
		case "uploading":
			b.Uploading = n
		case "ready":
			b.Ready = n
		case "draining":
			b.Draining = n
		}
	}
	return b, rows.Err()
}
