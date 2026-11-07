// Règles locales contre les mots de passe saisis faciles à deviner (audit M1 du 7 novembre).
// Aucune crypto ici : des règles de forme (répétitions, suites, rangées de clavier) et une
// recherche dans deux listes (mots de passe entiers, « cœurs » de dictionnaire).
// Fichier sans import ni syntaxe TypeScript non effaçable : scripts/gen-lists.mjs l'importe
// directement (Node retire les types) pour ne garder dans la liste que ce que les règles
// ne refusent pas déjà.

export type WeakReason = "repetition" | "suite" | "clavier" | "trop_courant";

export type WeakLists = {
  /** Mots de passe entiers de 10 caractères ou plus, passés par `normalizeForList`. */
  readonly block: ReadonlySet<string>;
  /** Cœurs de dictionnaire (lettres a à z seules, 4 au moins), passés par `cores`. */
  readonly cores: ReadonlySet<string>;
};

// Suites : alphabet, chiffres (9 suivi de 0, comme sur le clavier), chiffres de deux en deux.
const SEQUENCES = ["abcdefghijklmnopqrstuvwxyz", "01234567890"];
const STEP2 = ["02468", "13579"];
// Rangées et colonnes de clavier AZERTY, QWERTY et QWERTZ (sans la rangée des chiffres,
// comptée comme suite), en minuscules.
const KEYBOARD = [
  "azertyuiop^$",
  "qsdfghjklmù*",
  "<wxcvbn,;:!",
  "&é\"'(-è_çà)=",
  "qwertyuiop[]",
  "asdfghjkl;'",
  "zxcvbnm,./",
  "qwertzuiopü",
  "asdfghjklöä",
  "yxcvbnm,.-",
  "1qaz2wsx3edc4rfv5tgb6yhn7ujm8ik,9ol.0p;/",
  "1aqw2zsx3edc4rfv5tgb6yhn7uj,8ik;9ol:0pm!",
  "1q2w3e4r5t6y7u8i9o0p",
  "1a2z3e4r5t6y7u8i9o0p",
  "q1w2e3r4t5y6u7i8o9p0",
  "a1z2e3r4t5y6u7i8o9p0",
];
const withReverse = (rows: string[]): string[][] => rows.flatMap((r) => [[...r], [...r].reverse()]);
const SEQ_ROWS = withReverse(SEQUENCES);
const STEP2_ROWS = withReverse(STEP2);
const KEY_ROWS = withReverse(KEYBOARD);

/** Plus longue suite de `s` à partir de `i` qui est un morceau contigu d'une des rangées. */
function longestInRows(s: readonly string[], i: number, rows: readonly (readonly string[])[]): number {
  let best = 0;
  for (const r of rows) {
    for (let j = 0; j < r.length; j++) {
      let k = 0;
      while (i + k < s.length && j + k < r.length && s[i + k] === r[j + k]) k++;
      if (k > best) best = k;
    }
  }
  return best;
}

/** Plus longue répétition d'un motif de 1 à 4 caractères à partir de `i` (aaa, abab, abcabc). */
function longestRepeat(s: readonly string[], i: number): number {
  let best = 0;
  for (let p = 1; p <= 4; p++) {
    let l = p;
    while (i + l < s.length && s[i + l] === s[i + l - p]) l++;
    if (l >= 2 * p && l >= 3 && l > best) best = l;
  }
  return best;
}

/**
 * Raison de forme : moins de 5 caractères distincts, ou plus de la moitié des caractères
 * pris dans des répétitions (aaa, abab), des suites (abcd, 6789, 2468) ou des rangées de
 * clavier (azer, qwer, 1qaz) ; suites et rangées comptent à partir de 4 caractères, sans
 * distinction de casse ; les répétitions, casse comprise.
 */
export function patternReason(pw: string): Exclude<WeakReason, "trop_courant"> | null {
  const raw = [...pw.normalize("NFC")];
  const s = raw.map((c) => c.toLowerCase());
  if (new Set(s).size < 5) return "repetition";
  const covered = { repetition: 0, suite: 0, clavier: 0 };
  for (let i = 0; i < s.length; ) {
    const rep = longestRepeat(raw, i); // casse comprise : « TtT » n'est pas une répétition
    const seqRaw = longestInRows(s, i, SEQ_ROWS);
    const step2Raw = longestInRows(s, i, STEP2_ROWS);
    const seq = Math.max(seqRaw, step2Raw) >= 4 ? Math.max(seqRaw, step2Raw) : 0;
    const keyRaw = longestInRows(s, i, KEY_ROWS);
    const key = keyRaw >= 4 ? keyRaw : 0;
    const len = Math.max(rep, seq, key);
    if (len === 0) {
      i++;
      continue;
    }
    if (rep === len) covered.repetition += len;
    else if (seq === len) covered.suite += len;
    else covered.clavier += len;
    i += len;
  }
  const total = covered.repetition + covered.suite + covered.clavier;
  if (total * 2 <= s.length) return null;
  const order = ["repetition", "suite", "clavier"] as const;
  return order.reduce((a, b) => (covered[b] > covered[a] ? b : a));
}

/** Minuscules, sans accents (NFD puis retrait des marques), en NFC : forme de la liste. */
export function normalizeForList(pw: string): string {
  return pw.normalize("NFD").replace(/\p{M}/gu, "").normalize("NFC").toLowerCase();
}

const LEET: Readonly<Record<string, string>> = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "8": "b", "9": "g", "@": "a", $: "s", "!": "i" };

/**
 * Cœurs de dictionnaire d'un mot de passe : séparateurs (espace, -, _, .) retirés, chiffres et
 * symboles du début et de la fin retirés, puis chiffres et symboles du milieu lus comme des
 * lettres (p@ssw0rd → password ; 1 lu i ou l). Vide si le cœur n'est pas fait de lettres a à z.
 */
export function cores(pw: string): string[] {
  const n = normalizeForList(pw).replace(/[\s\-_.]+/gu, "");
  const m = /^[^a-z]*(.*?)[^a-z]*$/su.exec(n);
  const mid = m ? m[1]! : "";
  if (mid.length < 4) return [];
  const out = new Set<string>();
  for (const one of ["i", "l"]) {
    const c = [...mid].map((ch) => (ch === "1" ? one : (LEET[ch] ?? ch))).join("");
    if (/^[a-z]{4,}$/.test(c)) out.add(c);
  }
  return [...out];
}

/** Raison de refus d'un mot de passe saisi (déjà assez long), ou null s'il passe les règles. */
export function weakReason(pw: string, lists: WeakLists): WeakReason | null {
  const p = patternReason(pw);
  if (p !== null) return p;
  if (lists.block.has(normalizeForList(pw))) return "trop_courant";
  if (cores(pw).some((c) => lists.cores.has(c))) return "trop_courant";
  return null;
}

// Codage compact des cœurs (lettres a à z seules), triés : chaque entrée est un chiffre k
// (0 à 9, longueur du préfixe commun avec la précédente) suivi du reste de l'entrée.
export function encodeCores(sorted: readonly string[]): string {
  let prev = "";
  let out = "";
  for (const x of sorted) {
    if (!/^[a-z]+$/.test(x) || x <= prev) throw new Error(`cœur invalide ou non trié : ${x}`);
    let k = 0;
    while (k < 9 && k < prev.length && k < x.length && prev[k] === x[k]) k++;
    out += String(k) + x.slice(k);
    prev = x;
  }
  return out;
}

export function decodeCores(s: string): Set<string> {
  const out = new Set<string>();
  let prev = "";
  for (const m of s.matchAll(/(\d)([a-z]*)/g)) {
    const x = prev.slice(0, Number(m[1])) + m[2]!;
    out.add(x);
    prev = x;
  }
  return out;
}
