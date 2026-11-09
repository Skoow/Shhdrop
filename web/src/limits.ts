// Constantes uniques des chiffres affichés par les écrans (benchmark M5) : les textes (fr.ts,
// en.ts) n'écrivent jamais ces nombres en dur, ils les reçoivent d'ici. Les mêmes valeurs
// sont imposées par le serveur ; limits.test.ts les compare au code Go.
import { CONTENT_MAX, MAX_ITEMS, PREVIEW_MAX, TEXT_MAX } from "./crypto/container";

/** CONTENT_MAX : exactement 2 Gio de données (spec §29.3) ; TEXT_MAX en points de code. */
export { CONTENT_MAX, MAX_ITEMS, PREVIEW_MAX, TEXT_MAX };
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

/**
 * Formules payantes (spec §38.8.1, prix proposés de §38.8.2, TTC, en euros) : montrées dans le
 * composeur comme des choix verrouillés, avec « Bientôt disponible » (D41-16) ; rien n'est en
 * vente tant que les Tasks P1 à P3 ne sont pas faites. Le nombre d'éléments n'en fait pas
 * partie : MAX_ITEMS vaut pour toutes (D41-17). Aucune n'apporte de sécurité de plus (§38.9.0).
 */
export type PaidTier = "plus" | "pro";
export const PAID: Readonly<Record<PaidTier, { bytes: number; opens: number; ttlDays: readonly number[]; month: number; year: number }>> = {
  plus: { bytes: 10 * 1024 ** 3, opens: 50, ttlDays: [2, 3, 7], month: 7, year: 70 },
  pro: { bytes: 50 * 1024 ** 3, opens: 100, ttlDays: [2, 3, 7], month: 20, year: 200 },
};

/**
 * Durées maximales de capture dans l'interface (caméra et micro maison), en secondes, par
 * formule (décision du propriétaire du 8 novembre). Plafonds techniques : l'enregistrement vit
 * en mémoire jusqu'au chiffrement (vidéo à VIDEO_BPS : 5 min ≈ 94 Mo, 30 min ≈ 560 Mo).
 */
export type CaptureTier = "free" | PaidTier;
export const CAPTURE_MAX_S: Readonly<Record<CaptureTier, { video: number; voice: number }>> = {
  free: { video: 5 * 60, voice: 30 * 60 },
  plus: { video: 15 * 60, voice: 2 * 3600 },
  pro: { video: 30 * 60, voice: 2 * 3600 },
};
/** Formule en vigueur : aucune offre payante n'est active, seule la limite gratuite s'applique. */
export const CAPTURE_TIER: CaptureTier = "free";
