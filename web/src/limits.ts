// Constantes uniques des chiffres affichés par les écrans (benchmark M5) : les textes (fr.ts,
// en.ts) n'écrivent jamais ces nombres en dur, ils les reçoivent d'ici. Les mêmes valeurs
// sont imposées par le serveur ; limits.test.ts les compare au code Go.
import { CONTENT_MAX, MAX_ITEMS, PREVIEW_MAX, TEXT_MAX } from "./crypto/container";
import { PW_MIN_CHARS } from "./crypto/passphrase";

/** CONTENT_MAX : exactement 2 Gio de données (spec §29.3) ; TEXT_MAX en points de code. */
export { CONTENT_MAX, MAX_ITEMS, PREVIEW_MAX, PW_MIN_CHARS, TEXT_MAX };
/** Durées proposées, en heures, comptées à partir de la fin de l'envoi (spec §4). */
export const TTL_HOURS = [1, 6, 12, 24] as const;
export type TtlHours = (typeof TTL_HOURS)[number];
export const TTL_MAX_HOURS = 24;
/** Valeurs par défaut des options (UI §9.3). */
export const TTL_DEFAULT: TtlHours = 12;
export const OPENS_DEFAULT = 1;
/** Ouvertures au choix, de 1 à MAX_OPENS (spec §4). */
export const MAX_OPENS = 10;
/** Mots de passe faux avant destruction (spec §4). */
export const PW_TRIES = 5;
/** Images plus grosses : non lues en mémoire pour le nettoyage des métadonnées (UI §9.2.6). */
export const STRIP_MAX = 50 * 1048576;
/** Longueur maximale d'un nom, en points de code (UI §9.2.4, même borne que cleanName). */
export const NAME_MAX = 120;
