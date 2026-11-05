/** Contraste WCAG 2.1 (luminance relative). Sert aux tests des jetons, pas à l'exécution. */

export type Rgb = readonly [number, number, number];

function parse(c: string | Rgb): Rgb {
  if (typeof c !== "string") return c;
  const m = /^#([0-9a-f]{6})$/i.exec(c);
  if (!m) throw new Error(`couleur #RRGGBB attendue : ${c}`);
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function luminance(c: string | Rgb): number {
  const [r, g, b] = parse(c).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string | Rgb, b: string | Rgb): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Couleur `fg` d'opacité `alpha` posée sur `bg` (composition sRGB simple). */
export function composite(fg: Rgb, alpha: number, bg: Rgb): Rgb {
  return [0, 1, 2].map((i) => Math.round(fg[i]! * alpha + bg[i]! * (1 - alpha))) as unknown as Rgb;
}

/** Contraste WCAG entre deux luminances relatives (0 à 1), sans couleur : sert au plafond K5 (UI §20.2). */
export function contrastFromLuminance(a: number, b: number): number {
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
