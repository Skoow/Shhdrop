// Paramètres des textes qui citent les limites gratuites : jamais écrits en dur dans fr.ts / en.ts
// (spec §41.2, benchmark M5). Changer MAX_ITEMS ou CONTENT_MAX change tous les écrans.
import { CONTENT_MAX, MAX_ITEMS } from "../limits";
import { formatBytes, type Lang } from "./format";

export function limitParams(lang: Lang): { n: number; size: string } {
  return { n: MAX_ITEMS, size: formatBytes(CONTENT_MAX, lang) };
}
