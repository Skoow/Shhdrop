// Sortie d'un nettoyage en place (spec §35.2, technique 2) : un Blob fait de tranches de
// l'original et de petits correctifs à longueur constante ; jamais de copie entière.
import { Malformed } from "./bytes";

export type Patch = { at: number; bytes: Uint8Array };

/**
 * Applique `patches` (sans chevauchement, à l'intérieur de `src`) et retire les plages `cut`
 * ([from, to), sans chevauchement ; un correctif ne peut pas toucher une plage retirée).
 */
export function patchedBlob(src: Blob, patches: readonly Patch[], cut: readonly { from: number; to: number }[] = [], type = src.type): Blob {
  type Ev = { at: number; end: number; bytes?: Uint8Array };
  const evs: Ev[] = [
    ...patches.map((p) => ({ at: p.at, end: p.at + p.bytes.length, bytes: p.bytes })),
    ...cut.map((c) => ({ at: c.from, end: c.to })),
  ].sort((a, b) => a.at - b.at);
  const parts: BlobPart[] = [];
  let o = 0;
  for (const e of evs) {
    if (!Number.isSafeInteger(e.at) || e.at < o || e.end > src.size || e.end < e.at) throw new Malformed("correctif");
    if (e.at > o) parts.push(src.slice(o, e.at));
    if (e.bytes) parts.push(e.bytes as Uint8Array<ArrayBuffer>);
    o = e.end;
  }
  if (o < src.size) parts.push(src.slice(o));
  return new Blob(parts, { type });
}
