// Réordonnancement au pointeur (UI §9.2.4) : calculs purs, testés à part du composant.

/**
 * Rang visé quand la ligne glissée a son centre à `y`, d'après les centres des lignes de la
 * catégorie (dans l'ordre, ligne glissée comprise, positions de départ).
 */
export function targetIndex(y: number, centers: readonly number[], from: number): number {
  let to = from;
  for (let i = 0; i < centers.length; i++) {
    if (i < from && y < centers[i]!) return i;
    if (i > from && y > centers[i]!) to = i;
  }
  return to;
}

/** Vitesse de défilement automatique (px par image) près des bords de la fenêtre. */
export function edgeScroll(y: number, viewportH: number, edge = 64, max = 14): number {
  if (y < edge) return -Math.ceil(((edge - Math.max(0, y)) / edge) * max);
  if (y > viewportH - edge) return Math.ceil(((Math.min(viewportH, y) - (viewportH - edge)) / edge) * max);
  return 0;
}

/** Décalage visuel d'une ligne voisine pendant le glisser (les autres s'écartent). */
export function shiftFor(i: number, from: number, to: number, rowH: number): number {
  if (from < to && i > from && i <= to) return -rowH;
  if (from > to && i >= to && i < from) return rowH;
  return 0;
}
