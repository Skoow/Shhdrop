// Réglages de l'onglet, en mémoire seulement (aucun stockage navigateur, source-rules.test.ts) :
// un rechargement remet les valeurs par défaut.
export const fileSettings = $state({
  /** « Nettoyer automatiquement les fichiers » (spec §35.2) : DÉSACTIVÉ par défaut (décision du
   *  propriétaire du 10 novembre, retours CLEAN4) ; la personne l'active dans Réglages. */
  autoClean: false,
});
