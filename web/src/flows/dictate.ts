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
    "&": "esperluette",
    "*": "astérisque",
    "/": "barre oblique",
    ":": "deux-points",
    ";": "point-virgule",
    "(": "parenthèse ouvrante",
    ")": "parenthèse fermante",
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
    "&": "ampersand",
    "*": "asterisk",
    "/": "slash",
    ":": "colon",
    ";": "semicolon",
    "(": "opening parenthesis",
    ")": "closing parenthesis",
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

// Alphabet radio (OTAN, le même en français et en anglais) : « K comme Kilo ».
const RADIO: Record<string, string> = {
  A: "Alfa", B: "Bravo", C: "Charlie", D: "Delta", E: "Echo", F: "Foxtrot", G: "Golf", H: "Hotel", I: "India",
  J: "Juliett", K: "Kilo", L: "Lima", M: "Mike", N: "November", O: "Oscar", P: "Papa", Q: "Quebec", R: "Romeo",
  S: "Sierra", T: "Tango", U: "Uniform", V: "Victor", W: "Whiskey", X: "X-ray", Y: "Yankee", Z: "Zulu",
};
const AS: Record<Lang, string> = { fr: "comme", en: "as in" };

/** Épeler un caractère (« B comme Bravo, majuscule », « 7, chiffre », « ! point d'exclamation »). */
export function dictateLabel(ch: string, lang: Lang): string {
  const w = WORDS[lang];
  const sym = SYMBOLS[lang][ch];
  if (sym) return ch === " " ? sym : `${ch} ${sym}`;
  if (/^[0-9]$/.test(ch)) return `${ch}, ${w.digit}`;
  const up = ch.toUpperCase();
  const low = ch.toLowerCase();
  const radio = RADIO[up];
  if (radio) return `${ch} ${AS[lang]} ${radio}, ${ch === up ? w.upper : w.lower}`;
  if (up !== low) return ch === up ? `${up} ${w.upper}` : `${low} ${w.lower}`;
  return `${ch} ${w.other}`;
}

/** Groupes de 4 pour lire le mot de passe (affichage seulement ; la copie reste d'un seul tenant). */
export function groups(password: string, size = 4): string[] {
  const chars = Array.from(password);
  const out: string[] = [];
  for (let i = 0; i < chars.length; i += size) out.push(chars.slice(i, i + size).join(""));
  return out;
}

export function dictate(password: string, lang: Lang): { ch: string; label: string }[] {
  return Array.from(password.normalize("NFC"), (ch) => ({ ch, label: dictateLabel(ch, lang) }));
}
