// Temps estimés (liste du destinataire). Retours UI4 : seulement sur un débit MESURÉ dans cette
// session (downloads.svelte.ts, après les premières secondes), jamais sur un débit supposé.
// Toujours présentés comme des estimations.

/** Surcoût du chiffrement : 16 octets d'étiquette par morceau de 64 Kio. */
const TAG_RATIO = 16 / 65536;

/** Secondes pour transférer `bytes` de clair à `bytesPerS` (débit mesuré). */
export function transferSeconds(bytes: number, bytesPerS: number): number {
  if (!(bytes > 0) || !(bytesPerS > 0)) return 0;
  return (bytes * (1 + TAG_RATIO)) / bytesPerS;
}
