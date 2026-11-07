// Contour de temps (benchmark S3) : le contour de la capsule se raccourcit avec le temps
// restant. Avec pathLength="100", le décalage du tracé vaut 100 × restant / total.

/** Décalage de stroke-dashoffset (0 = contour plein, 100 = vide), borné à [0, 100]. */
export function rimOffset(remainingS: number, totalS: number): number {
  if (!(totalS > 0) || !Number.isFinite(remainingS)) return 100;
  const f = Math.min(1, Math.max(0, remainingS / totalS));
  return Math.round((100 - 100 * f) * 100) / 100;
}

/** Encoches des ouvertures restantes : positions (0–100) réparties sur le bord, au plus 10. */
export function notches(opensLeft: number | null): number[] {
  if (opensLeft === null || !(opensLeft > 0)) return [];
  const n = Math.min(10, Math.floor(opensLeft));
  return Array.from({ length: n }, (_, k) => Math.round(((k + 1) * 100) / (n + 1) * 100) / 100);
}
