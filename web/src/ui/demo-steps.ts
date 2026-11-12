// Infographie de l'accueil (SecureDemo.svelte, refonte du 12 novembre) : rythme et étapes.
/** Durée d'une étape : 7 × 2 s = une boucle de 14 s. */
export const STEP_MS = 2000;
/** Étapes, dans l'ordre (textes demo.sN.t et demo.sN.d). */
export const STEPS = [1, 2, 3, 4, 5, 6, 7] as const;
