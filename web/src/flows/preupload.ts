// Envoi dès l'ajout (spec §41.14) : ce que le composeur montre de chaque ligne, et la liste
// des éléments (fichiers et notes, D41-36) confiée au brouillon (transfer/draft.ts).
import type { ElementStatus } from "../index";

export type RowStatus = { key: `compose.up.${ElementStatus["phase"]}`; percent: number };

/** Libellé et pourcentage d'une ligne ; null si l'élément n'est pas (encore) remis au brouillon. */
export function rowStatus(st: ElementStatus | undefined): RowStatus | null {
  if (!st) return null;
  const pct = st.phase === "pret" ? 100 : st.total > 0 ? Math.min(99, Math.floor((st.sent / st.total) * 100)) : 0;
  return { key: `compose.up.${st.phase}`, percent: st.phase === "envoi" ? pct : st.phase === "pret" ? 100 : 0 };
}

const blobs = new WeakMap<Uint8Array, Blob>();

/**
 * Éléments de la liste, fichiers et notes (D41-36 : une note part dès sa validation, comme un
 * fichier), en Blob stable (un même Uint8Array donne toujours le même Blob : pas de renvoi).
 */
export function toDraftList(items: readonly { id: string; kind: "file" | "text"; data: Blob | Uint8Array<ArrayBuffer> }[]): { id: string; data: Blob }[] {
  return items.map((i) => {
    if (i.data instanceof Blob) return { id: i.id, data: i.data };
    let b = blobs.get(i.data);
    if (!b) blobs.set(i.data, (b = new Blob([i.data])));
    return { id: i.id, data: b };
  });
}
