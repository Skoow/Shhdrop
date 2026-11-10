// MP3 (et AAC ADTS) : les étiquettes sont coupées, les trames audio gardées octet pour octet
// (spec §35.2, Task 9c, technique 3). Retirés : toutes les ID3v2 du début (pied de page compris),
// ID3v2.4 de fin (« 3DI »), ID3v1 (« TAG ») et son extension « TAG+ », APEv2 (« APETAGEX »),
// Lyrics3 v2. Gardée : la trame Xing/Info/LAME (lecture à débit variable), première trame audio.
import { Malformed, startsWith } from "./bytes";

/** Fenêtre lue en tête et en fin (les étiquettes de tête peuvent porter une pochette). */
const SYNC_WINDOW = 64 * 1024;
const TAIL = 64 * 1024;

const syncsafe = (b: Uint8Array, o: number) => {
  for (let i = 0; i < 4; i++) if (b[o + i]! & 0x80) throw new Malformed("id3_taille");
  return (b[o]! << 21) | (b[o + 1]! << 14) | (b[o + 2]! << 7) | b[o + 3]!;
};
const u32le = (b: Uint8Array, o: number) => (b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16) | (b[o + 3]! << 24)) >>> 0;
const isSync = (b: Uint8Array, o: number) => o + 1 < b.length && b[o] === 0xff && (b[o + 1]! & 0xe0) === 0xe0;

/** Plage audio [from, to) à garder ; toute la plage du fichier si rien n'est à retirer. */
export async function audioRange(file: Blob): Promise<{ from: number; to: number }> {
  let from = 0;
  // ID3v2 en tête, éventuellement plusieurs à la suite.
  for (let guard = 0; guard < 16; guard++) {
    const h = new Uint8Array(await file.slice(from, Math.min(file.size, from + 10)).arrayBuffer());
    if (h.length < 10 || !startsWith(h, 0, "ID3")) break;
    if (h[3]! < 2 || h[3]! > 4 || h[4] === 0xff) throw new Malformed("id3");
    from += 10 + syncsafe(h, 6) + (h[5]! & 0x10 ? 10 : 0);
    if (from > file.size) throw new Malformed("id3_deborde");
  }
  // Première trame : synchronisation dans les 64 Kio (certains encodeurs laissent du bourrage).
  const head = new Uint8Array(await file.slice(from, Math.min(file.size, from + SYNC_WINDOW)).arrayBuffer());
  let s = 0;
  while (s < head.length && !isSync(head, s)) {
    if (head[s] !== 0) throw new Malformed("pas_de_trame");
    s++;
  }
  if (s >= head.length) throw new Malformed("pas_de_trame");
  from += s;

  let to = file.size;
  const tailStart = Math.max(from, to - TAIL);
  const t = new Uint8Array(await file.slice(tailStart, to).arrayBuffer());
  let end = t.length; // fin courante, relative à tailStart
  for (let guard = 0; guard < 8; guard++) {
    if (end >= 128 && startsWith(t, end - 128, "TAG")) {
      end -= 128;
      if (end >= 227 && startsWith(t, end - 227, "TAG+")) end -= 227;
      continue;
    }
    if (end >= 32 && startsWith(t, end - 32, "APETAGEX")) {
      const size = u32le(t, end - 32 + 12); // pied compris, en-tête non compris
      const hasHeader = (u32le(t, end - 32 + 20) & 0x80000000) !== 0;
      const n = size + (hasHeader ? 32 : 0);
      if (n > end) throw new Malformed("ape");
      end -= n;
      continue;
    }
    if (end >= 15 && startsWith(t, end - 9, "LYRICS200")) {
      const n = Number(String.fromCharCode(...t.subarray(end - 15, end - 9)));
      if (!Number.isSafeInteger(n) || n + 15 > end || !startsWith(t, end - 15 - n, "LYRICSBEGIN")) throw new Malformed("lyrics3");
      end -= n + 15;
      continue;
    }
    if (end >= 10 && startsWith(t, end - 10, "3DI")) {
      const n = syncsafe(t, end - 10 + 6) + 20;
      if (n > end) throw new Malformed("id3_fin");
      end -= n;
      continue;
    }
    break;
  }
  to = tailStart + end;
  if (to <= from) throw new Malformed("vide");
  return { from, to };
}
