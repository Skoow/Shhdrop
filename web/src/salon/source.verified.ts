// Production : le module du salon est le fichier assets/salon-EMPREINTE.wasm, lu par fetch avec
// `integrity` (empreinte SHA-384 inscrite dans ce script par le greffon shh-salon) : le navigateur
// refuse des octets différents, et tout échec devient Error("reseau"), comme une coupure (aucun
// module partiel : engine.ts ne garde rien). Lu au premier besoin du salon seulement, jamais par
// les pages de partage. Pas d'import() dynamique (spec §28.3).
import { integrity, src } from "virtual:shh-salon";

export async function salonWasmBytes(): Promise<ArrayBuffer> {
  try {
    const res = await fetch(src, { integrity, credentials: "omit", redirect: "error" });
    if (!res.ok) throw new Error("reseau");
    return await res.arrayBuffer();
  } catch {
    throw new Error("reseau");
  }
}
