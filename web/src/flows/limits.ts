// Limites affichées et appliquées par les écrans (UI §9.2.5, §9.3, spec §24, §31). Les chiffres
// des textes viennent d'ici, jamais de fr.ts / en.ts (benchmark M5).
// Provisoire : la Task K1 regroupe ces constantes dans un seul module exporté par index.ts
// (avec les tests Go qui en vérifient l'égalité côté serveur) ; ce fichier s'y alignera alors.

/** Plus grand palier (1 Gio) moins la place maximale du manifeste et de sa longueur (spec §29.3). */
export const CONTENT_MAX = 1073741824 - 65540;
export const MAX_ITEMS = 10;
/** Points de code d'un texte (UI §9.2.7). */
export const TEXT_MAX = 10_000;
/** Durées proposées, en heures (UI §9.3). */
export const TTL_HOURS = [1, 6, 12, 24] as const;
export type TtlHours = (typeof TTL_HOURS)[number];
export const TTL_DEFAULT: TtlHours = 12;
export const MAX_OPENS = 10;
export const OPENS_DEFAULT = 1;
/** Essais de mot de passe avant destruction (spec §5, constante serveur). */
export const PW_TRIES = 5;
/** Images plus grosses : non lues en mémoire pour le nettoyage (UI §9.2.6). */
export const STRIP_MAX = 50 * 1048576;
/** Au-delà, aucun aperçu chez le destinataire (spec §24 ; même valeur que PREVIEW_MAX de index.ts). */
export const PREVIEW_MAX = 200 * 1048576;
/** Longueur maximale d'un nom, en points de code (UI §9.2.4, même borne que cleanName). */
export const NAME_MAX = 120;
/** Longueur minimale d'un mot de passe saisi (spec §31 ; même valeur que PW_MIN_CHARS de index.ts). */
export const PW_MIN_CHARS = 12;
