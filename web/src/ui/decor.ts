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

const r2 = (v: number) => Math.round(v * 100) / 100;

/**
 * Guilloché d'impression de sécurité (accueil v3) : `n` sinusoïdes déphasées sur une boîte
 * `w` × `h`, un point tous les `step` px. Pur calcul, déterministe ; dessin seulement.
 */
export function guilloche(w: number, h: number, n: number, step = 8): string[] {
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const ph = (i / n) * Math.PI * 2;
    let d = "";
    for (let x = 0; x <= w; x += step) {
      const y = h / 2 + Math.sin(x / 38 + ph) * (h * 0.3) * Math.cos(x / 210 + ph / 3) + Math.sin(x / 11 + ph * 2) * 3;
      d += `${x ? "L" : "M"}${x} ${r2(y)}`;
    }
    out.push(d);
  }
  return out;
}

/**
 * Rosace de sceau : épitrochoïde (rayon fixe `R`, roulant `r`, bras `d`), centrée en (`c`, `c`),
 * échelle `s`, `pts` points. Courbe fermée (« Z »). Pur calcul, déterministe.
 */
export function rosette(R: number, r: number, d: number, c: number, s = 1, pts = 360): string {
  let p = "";
  for (let i = 0; i <= pts; i++) {
    const t = (i / pts) * Math.PI * 2;
    const x = (R + r) * Math.cos(t) - d * Math.cos(((R + r) / r) * t);
    const y = (R + r) * Math.sin(t) - d * Math.sin(((R + r) / r) * t);
    p += `${i ? "L" : "M"}${r2(c + x * s)} ${r2(c + y * s)}`;
  }
  return p + "Z";
}
