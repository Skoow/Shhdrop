// Temps estimés (listes du composeur et du destinataire). Débits supposés prudents tant que
// rien n'est mesuré ; ensuite, le débit mesuré. Toujours présentés comme des estimations.

/** Envoi supposé : réseau mobile moyen, environ 8 Mbit/s (borne haute de l'estimation d'Options). */
export const ASSUMED_UP_BPS = 1_000_000;
/** Réception supposée : environ 20 Mbit/s, avant toute mesure. */
export const ASSUMED_DOWN_BPS = 2_500_000;
/** Surcoût du chiffrement : 16 octets d'étiquette par morceau de 64 Kio. */
const TAG_RATIO = 16 / 65536;

/** Secondes pour transférer `bytes` de clair à `bytesPerS` (débit mesuré, sinon supposé). */
export function transferSeconds(bytes: number, bytesPerS: number): number {
  if (!(bytes > 0) || !(bytesPerS > 0)) return 0;
  return (bytes * (1 + TAG_RATIO)) / bytesPerS;
}
