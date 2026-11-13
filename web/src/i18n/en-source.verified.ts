// Production : dictionnaire anglais dans assets/locale-en-EMPREINTE.js (du JSON, extension .js pour
// le cache immuable et la compression du serveur), lu par fetch avec `integrity` (empreinte
// SHA-384 inscrite dans ce script par le greffon shh-lang) : le navigateur refuse des octets
// différents. Lu seulement si la langue anglaise est demandée. Pas d'import() dynamique (§28.3).
import { integrity, src } from "virtual:shh-lang";

export const bundled: Record<string, string> | undefined = undefined;

export async function fetchEn(): Promise<unknown> {
  const res = await fetch(src, { integrity, credentials: "omit", redirect: "error" });
  if (!res.ok) throw new Error("reseau");
  return JSON.parse(await res.text()) as unknown;
}
