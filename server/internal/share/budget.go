package share

import "sync"

// ReadBudget : octets qu'une ouverture (un jeton de téléchargement) peut lire au total.
// Paquet v2 (spec §29.3) : une ouverture complète lit le segment 0 (en-tête, avant
// l'enveloppe), le dernier segment (manifeste), puis les segments des éléments, dont à
// nouveau le segment 0 ; le bourrage n'est jamais lu. Budget = une ouverture complète
// (fichier + segment 0 + dernier segment) plus un nouvel essai de chaque segment
// (fichier), soit 2 × fichier chiffré + segment 0 + dernier segment.
// Audit de sécurité M1 : sans borne, un jeton relit le partage pendant 3 h.
func ReadBudget(bucket int) int64 {
	return 2*int64(totalSize(bucket)) + int64(SegmentSize(bucket, 0)) + int64(SegmentSize(bucket, SegmentCount(bucket)-1))
}

type openKey struct {
	id    string
	openN int
}

type budgetEntry struct {
	used  int64
	until int64 // secondes Unix : au-delà, le jeton est expiré et l'entrée oubliée
}

// readBudget compte les octets lus par ouverture, en mémoire seulement (perdu au
// redémarrage, comme la clé des jetons : aucun ancien jeton n'est alors valable).
// Aucune adresse n'y figure : la clé est (identifiant, n° d'ouverture).
type readBudget struct {
	mu        sync.Mutex
	m         map[openKey]budgetEntry
	lastSweep int64
}

// charge ajoute n octets au compteur de k si le total reste ≤ limit ; sinon ne compte
// rien et rend false. Une entrée vit purgeWindow (durée maximale d'un jeton de
// téléchargement) après sa première lecture, puis est oubliée.
func (b *readBudget) charge(k openKey, n, limit, now int64) bool {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.m == nil {
		b.m = map[openKey]budgetEntry{}
	}
	if now-b.lastSweep >= 60 {
		b.lastSweep = now
		for key, e := range b.m {
			if e.until <= now {
				delete(b.m, key)
			}
		}
	}
	e, ok := b.m[k]
	if !ok || e.until <= now {
		e = budgetEntry{until: now + purgeWindow}
	}
	if n > limit-e.used {
		return false
	}
	e.used += n
	b.m[k] = e
	return true
}
