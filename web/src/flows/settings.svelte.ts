// Réglages de l'onglet, en mémoire seulement (aucun stockage navigateur, source-rules.test.ts) :
// un rechargement remet les valeurs par défaut.
export const fileSettings = $state({
  /** « Nettoyer automatiquement les fichiers » (spec §35.2) : activé par défaut. */
  autoClean: true,
});
