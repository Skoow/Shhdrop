// FLAC (spec §35.2, Task 9c, technique 3) : blocs de métadonnées VORBIS_COMMENT, PICTURE,
// APPLICATION, PADDING et ID3v2 de tête retirés ; STREAMINFO, SEEKTABLE, CUESHEET et les trames
// gardés octet pour octet, drapeau « dernier bloc » reposé. Bloc hors fichier → `Malformed`.
import { Malformed, concat, startsWith } from "./bytes";

const KEEP: ReadonlySet<number> = new Set([0, 3, 5]); // STREAMINFO, SEEKTABLE, CUESHEET
/** En-têtes de métadonnées gardés lus en mémoire au plus (une table de recherche reste petite). */
const KEPT_MAX = 16 << 20;

/** Fichier nettoyé, ou null s'il n'y a rien à retirer. */
export async function cleanFlac(file: Blob): Promise<Blob | null> {
  let start = 0;
  const h = new Uint8Array(await file.slice(0, 10).arrayBuffer());
  if (startsWith(h, 0, "ID3")) {
    for (let i = 6; i < 10; i++) if (h[i]! & 0x80) throw new Malformed("id3");
    start = 10 + ((h[6]! << 21) | (h[7]! << 14) | (h[8]! << 7) | h[9]!) + (h[5]! & 0x10 ? 10 : 0);
  }
  const magic = new Uint8Array(await file.slice(start, start + 4).arrayBuffer());
  if (!startsWith(magic, 0, "fLaC")) throw new Malformed("flac");
  let o = start + 4;
  const kept: Uint8Array[] = [];
  let keptBytes = 0;
  let dropped = start > 0;
  let lastSeen = false;
  let first = true;
  while (!lastSeen) {
    const bh = new Uint8Array(await file.slice(o, o + 4).arrayBuffer());
    if (bh.length < 4) throw new Malformed("bloc");
    lastSeen = (bh[0]! & 0x80) !== 0;
    const type = bh[0]! & 0x7f;
    const len = (bh[1]! << 16) | (bh[2]! << 8) | bh[3]!;
    if (type === 127 || o + 4 + len > file.size) throw new Malformed("bloc");
    if (first && type !== 0) throw new Malformed("streaminfo");
    first = false;
    if (KEEP.has(type)) {
      keptBytes += 4 + len;
      if (keptBytes > KEPT_MAX) throw new Malformed("bloc_trop_gros");
      kept.push(new Uint8Array(await file.slice(o, o + 4 + len).arrayBuffer()));
    } else dropped = true;
    o += 4 + len;
  }
  // Trames : synchronisation 0xFFF8 (ou 0xFFF9) juste après les métadonnées.
  const sync = new Uint8Array(await file.slice(o, o + 2).arrayBuffer());
  if (o < file.size && !(sync[0] === 0xff && (sync[1]! & 0xfe) === 0xf8)) throw new Malformed("trame");
  // Drapeau « dernier bloc » : seulement sur le dernier gardé.
  kept.forEach((b, i) => (b[0] = (b[0]! & 0x7f) | (i === kept.length - 1 ? 0x80 : 0)));
  if (!dropped) return null;
  return new Blob([new TextEncoder().encode("fLaC"), concat(kept), file.slice(o)], { type: file.type });
}
