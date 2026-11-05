// Formats d'affichage (UI §10). Arrondis toujours vers le haut pour les durées : jamais « 0 »
// avant l'échéance. Tailles en base 1024 (Ko, Mo, Go) : un « Mo » vaut 1 048 576 octets ici.
export type Lang = "fr" | "en";

// Espaces insécables produites par les formateurs eux-mêmes : les écrans n'ont pas à poser de CSS.
// FR : espace fine insécable U+202F ; EN : espace insécable U+00A0.
const sp = (lang: Lang) => (lang === "fr" ? "\u202f" : "\u00a0");

export function plural(lang: Lang, n: number): "one" | "other" {
  return new Intl.PluralRules(lang).select(n) === "one" ? "one" : "other";
}

export type DurationOpts = {
  /** Sous une minute : « moins d'une minute » au lieu des secondes (annonces, textes longs). */
  coarse?: boolean;
};

export function formatDuration(seconds: number, lang: Lang, opts: DurationOpts = {}): string {
  const less = lang === "fr" ? "moins d'une minute" : "less than a minute";
  if (!Number.isFinite(seconds) || seconds <= 0) return less;
  const sec = Math.ceil(seconds);
  if (sec < 60) return opts.coarse ? less : `${sec}${sp(lang)}s`;
  const totalMin = Math.ceil(sec / 60);
  if (totalMin < 60) return `${totalMin}${sp(lang)}min`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (lang === "fr") {
    const x = sp(lang);
    return m === 0 ? `${h}${x}h` : `${h}${x}h${x}${String(m).padStart(2, "0")}`;
  }
  return m === 0 ? `${h}h` : `${h}h${sp(lang)}${m}m`;
}

const UNITS: Record<Lang, readonly string[]> = {
  fr: ["Ko", "Mo", "Go"],
  en: ["KB", "MB", "GB"],
};

export function formatBytes(n: number, lang: Lang): string {
  if (!Number.isFinite(n) || n <= 0) return `0${sp(lang)}${lang === "fr" ? "octet" : "bytes"}`;
  if (n < 1024) {
    const k = Math.round(n);
    const word = lang === "fr" ? (k > 1 ? "octets" : "octet") : k === 1 ? "byte" : "bytes";
    return `${k}${sp(lang)}${word}`;
  }
  let i = 0;
  let v = n / 1024;
  while (v >= 1024 && i < 2) {
    v /= 1024;
    i++;
  }
  const digits = (x: number) => (x < 10 ? 1 : 0);
  const round = (x: number) => Number(x.toFixed(digits(x)));
  if (round(v) >= 1024 && i < 2) {
    v /= 1024;
    i++;
  }
  const num = new Intl.NumberFormat(lang, { maximumFractionDigits: digits(v), minimumFractionDigits: 0 });
  return `${num.format(round(v))}${sp(lang)}${UNITS[lang][i]}`;
}

export function formatRate(bytesPerS: number, lang: Lang): string {
  return `${formatBytes(bytesPerS, lang)}/s`;
}
