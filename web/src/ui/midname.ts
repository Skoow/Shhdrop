// Noms longs (fichiers, notes) : l'ellipse tombe au milieu. La tête se coupe (CSS, text-overflow),
// la queue (dernier mot court ou 6 derniers caractères) et l'extension restent visibles :
// « Coucher de soleil sur la… 2026.jpg ». Le nom complet reste lisible (title, lecteurs d'écran).
const SHORT = 12;
const TAIL = 6;
const MAX_WORD = 8;

export function midSplit(base: string): { head: string; tail: string } {
  const chars = [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(base)].map((s) => s.segment);
  if (chars.length <= SHORT) return { head: base, tail: "" };
  const last = chars.slice(-(MAX_WORD + 1)).join("");
  const sep = Math.max(last.lastIndexOf(" "), last.lastIndexOf("-"), last.lastIndexOf("_"));
  if (sep >= 0 && last.length - sep - 1 >= 3) {
    const tail = last.slice(sep);
    return { head: base.slice(0, base.length - tail.length), tail };
  }
  const tail = chars.slice(-TAIL).join("");
  return { head: base.slice(0, base.length - tail.length), tail };
}

/** Nom complet avec extension : la queue garde aussi l'extension (« .jpg »). */
export function midSplitName(name: string): { head: string; tail: string } {
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 && name.length - dot <= 8 ? name.slice(dot) : "";
  const r = midSplit(ext ? name.slice(0, dot) : name);
  return { head: r.head, tail: r.tail + ext };
}
