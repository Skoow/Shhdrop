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

/**
 * Volet de texte chiffré décoratif de la capsule (benchmark M2) : 18 lignes de 34 caractères
 * tirées de la graine seule. Jamais un tampon réel : la signature ne prend qu'un nombre.
 */
export function cipherVeil(seed: number): string {
  return cipherText(seed, 34, 18);
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

// ---------- Écran « partage détruit » (UI §9.10.1) : document qui se défait en points ----------

/** Document de l'illustration (repère 120 × 128) : coin haut-gauche, taille, pas de la Trame. */
export const DOC = { x: 16, y: 8, w: 80, h: 112, step: 8 } as const;

/** Part du bord droit et bas qui se défait : cellules de 8 px dont la diagonale dépasse ce seuil. */
const CUT = 1.1;

/** Cellules (8 × 8) retirées du document, en bas à droite, en escalier. Déterministe. */
export function dissolveCells(): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (let y = DOC.y; y < DOC.y + DOC.h; y += DOC.step)
    for (let x = DOC.x; x < DOC.x + DOC.w; x += DOC.step) {
      const s = (x + DOC.step - DOC.x) / DOC.w + (y + DOC.step - DOC.y) / DOC.h;
      if (s > CUT) out.push({ x, y });
    }
  return out;
}

export type Dot = {
  /** Position de départ (centre d'une cellule retirée, carré de 4 px). */
  x: number;
  y: number;
  /** Dérive vers le haut et la droite (px). */
  dx: number;
  dy: number;
  /** Départ (ms) : colonne par colonne, de gauche à droite, en 900 ms au plus avec la durée. */
  delay: number;
  /** Opacité finale. */
  o: number;
  /** 22 % des points en couleur d'accent. */
  accent: boolean;
};

/** Durée de la dérive d'un point (ms) ; délai maximal + durée ≤ 900 ms. */
export const DOT_MS = 420;

/** `n` points de la Trame tirés de `seed` parmi les cellules retirées. Pur calcul, déterministe. */
export function dissolveDots(seed = 0x5d41, n = 48): Dot[] {
  const r = rng(seed);
  const cells = dissolveCells();
  // Mélange déterministe, puis les n premiers (cellules réutilisées s'il en manquait).
  for (let i = cells.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [cells[i], cells[j]] = [cells[j]!, cells[i]!];
  }
  const out: Dot[] = [];
  for (let k = 0; k < n; k++) {
    const c = cells[k % cells.length]!;
    const col = (c.x - DOC.x) / DOC.w;
    out.push({
      x: c.x + 2,
      y: c.y + 2,
      dx: Math.round(6 + r() * 30),
      dy: -Math.round(6 + r() * 34),
      delay: Math.round(col * (900 - DOT_MS)),
      o: Math.round((0.18 + r() * 0.6) * 100) / 100,
      accent: k % 9 === 1 || k % 9 === 5, // 2 sur 9 ≈ 22 %
    });
  }
  return out;
}
