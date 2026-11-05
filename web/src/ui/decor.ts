// Texte « chiffré » décoratif (UI §20.2 S1) : tiré d'un générateur à graine fixe, jamais de
// crypto, d'un tampon de chiffrement, de la clé ni du lien. Ce module n'importe rien : un test
// relit sa source pour le garantir.

/** Générateur congruentiel (1664525, 1013904223), le même que da-v2/js/app.js. Valeurs dans [0, 1). */
export function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const GLYPHS = "abcdefghijkmnopqrstuvwxyz0123456789+/=";

/** `rows` lignes de `cols` caractères de l'alphabet base64, séparées par « \n ». Déterministe. */
export function cipherText(seed: number, cols: number, rows: number): string {
  const r = rng(seed);
  const lines: string[] = [];
  for (let y = 0; y < rows; y++) {
    let line = "";
    for (let x = 0; x < cols; x++) line += B64[(r() * 64) | 0];
    lines.push(line);
  }
  return lines.join("\n");
}

/**
 * Brouille la part `k` (0 à 1) du début de `text` en glyphes tirés de `seed` ; les espaces
 * restent des espaces. Même nombre de points de code que `text` (k = 0 : `text` inchangé).
 */
export function scramble(text: string, k: number, seed: number): string {
  const chars = Array.from(text);
  const n = Math.floor(Math.min(1, Math.max(0, k)) * chars.length);
  const r = rng(seed);
  for (let i = 0; i < n; i++) if (chars[i] !== " ") chars[i] = GLYPHS[(r() * GLYPHS.length) | 0]!;
  return chars.join("");
}
