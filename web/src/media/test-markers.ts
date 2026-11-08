// Repères des fichiers d'essai (tests seulement) : ASCII, UTF-16 BE et LE.
export function indexOf(h: Uint8Array, n: Uint8Array, from = 0): number {
  outer: for (let i = from; i + n.length <= h.length; i++) {
    for (let j = 0; j < n.length; j++) if (h[i + j] !== n[j]) continue outer;
    return i;
  }
  return -1;
}
/** Repères de `markers` présents dans `b` (ASCII, UTF-16 BE ou LE). */
export function found(b: Uint8Array, markers: readonly string[]): string[] {
  return markers.filter((m) => {
    const a = [...m].map((c) => c.charCodeAt(0));
    return [a, a.flatMap((c) => [0, c]), a.flatMap((c) => [c, 0])].some((n) => indexOf(b, new Uint8Array(n)) >= 0);
  });
}
