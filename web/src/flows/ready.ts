// Textes calculés de « Lien prêt » (UI §9.5, benchmark M12) : heure d'effacement arrondie au
// quart d'heure le plus proche (« vers 9 h 45 ») et durée de vie choisie.
import type { Lang } from "../i18n/format";

const QUARTER = 15 * 60_000;

/** Instant arrondi au quart d'heure le plus proche. */
export function roundQuarter(ms: number): number {
  return Math.round(ms / QUARTER) * QUARTER;
}

/** Heure locale « 9 h 45 » (FR, espaces fines insécables) ou « 9:45 AM » (EN). */
export function clockText(ms: number, lang: Lang): string {
  const d = new Date(ms);
  if (lang === "fr") return `${d.getHours()} h ${String(d.getMinutes()).padStart(2, "0")}`;
  return new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit" }).format(d).replace(/\s/g, " ");
}
