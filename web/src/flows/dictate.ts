// Mode dictée du mot de passe (benchmark S5) : chaque caractère avec un mot d'aide, pour le
// lire à quelqu'un sans ambiguïté. Tout est local : aucune synthèse vocale, aucune requête.
import type { Lang } from "../i18n/format";

const SYMBOLS: Record<Lang, Record<string, string>> = {
  fr: {
    "!": "point d'exclamation",
    "#": "dièse",
    $: "dollar",
    "%": "pour cent",
    "+": "plus",
    "=": "égal",
    "?": "point d'interrogation",
    "@": "arobase",
    "-": "tiret",
    _: "tiret bas",
    ".": "point",
    ",": "virgule",
    " ": "espace",
  },
  en: {
    "!": "exclamation mark",
    "#": "hash",
    $: "dollar",
    "%": "percent",
    "+": "plus",
    "=": "equals",
    "?": "question mark",
    "@": "at sign",
    "-": "hyphen",
    _: "underscore",
    ".": "period",
    ",": "comma",
    " ": "space",
  },
};
const WORDS: Record<Lang, { lower: string; upper: string; digit: string; other: string }> = {
  fr: { lower: "minuscule", upper: "majuscule", digit: "chiffre", other: "caractère" },
  en: { lower: "lowercase", upper: "uppercase", digit: "digit", other: "character" },
};

/** Mot d'aide d'un caractère (« B majuscule », « 7 chiffre », « ! point d'exclamation »). */
export function dictateLabel(ch: string, lang: Lang): string {
  const w = WORDS[lang];
  const sym = SYMBOLS[lang][ch];
  if (sym) return ch === " " ? sym : `${ch} ${sym}`;
  if (/^[0-9]$/.test(ch)) return `${ch} ${w.digit}`;
  const up = ch.toUpperCase();
  const low = ch.toLowerCase();
  if (up !== low) return ch === up ? `${up} ${w.upper}` : `${low} ${w.lower}`;
  return `${ch} ${w.other}`;
}

export function dictate(password: string, lang: Lang): { ch: string; label: string }[] {
  return Array.from(password.normalize("NFC"), (ch) => ({ ch, label: dictateLabel(ch, lang) }));
}
