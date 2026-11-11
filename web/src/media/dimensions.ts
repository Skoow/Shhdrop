// Dimensions d'une image lues dans son en-tête, sans la décoder (test d'intrusion du 11
// novembre : bombe de décompression). Le format est reconnu aux octets, pas au type annoncé :
// <img> reconnaît lui aussi le contenu. Format inconnu, en-tête tronqué ou dimensions
// introuvables : null, donc pas d'aperçu (le fichier reste enregistrable).
import { Malformed, startsWith, u16be, u16le, u32be, u32le, u8 } from "./bytes";
import { children, fullBox, topLevel } from "./isobmff";

/** Au-delà, l'aperçu est refusé (« pas d'aperçu ») : 50 mégapixels. */
export const PREVIEW_MAX_PIXELS = 50_000_000;
/** En-tête lu au plus pour GIF, PNG et WebP (les dimensions sont dans les premiers octets). */
const HEAD = 1024 * 1024;
/** Segments JPEG parcourus au plus avant le SOF. */
const JPEG_SEGMENTS = 4096;
/** Boîte `meta` lue au plus (HEIF, AVIF). */
const META_MAX = 8 * 1024 * 1024;

const u24le = (h: Uint8Array, o: number) => u16le(h, o) | (u8(h, o + 2) << 16);
const read = async (b: Blob, at: number, n: number) => new Uint8Array(await b.slice(at, at + n).arrayBuffer());

async function jpeg(b: Blob): Promise<number | null> {
  let o = 2;
  for (let k = 0; k < JPEG_SEGMENTS; k++) {
    const h = await read(b, o, 9);
    if (u8(h, 0) !== 0xff) return null;
    const m = u8(h, 1);
    if (m === 0xff) {
      o++; // remplissage
      continue;
    }
    if (m === 0x01 || (m >= 0xd0 && m <= 0xd7)) {
      o += 2;
      continue;
    }
    if (m === 0xd9 || m === 0xda) return null; // pas de SOF avant les données
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      const px = u16be(h, 5) * u16be(h, 7);
      return px > 0 ? px : null; // hauteur 0 : donnée par DNL plus loin, refusée
    }
    o += 2 + u16be(h, 2);
  }
  return null;
}

function gif(h: Uint8Array): number {
  const screen = u16le(h, 6) * u16le(h, 8);
  const packed = u8(h, 10);
  let o = 13 + (packed & 0x80 ? 3 << ((packed & 7) + 1) : 0);
  for (;;) {
    const t = u8(h, o);
    if (t === 0x2c) {
      // Chromium agrandit l'écran logique à la première image si elle le dépasse.
      const first = (u16le(h, o + 1) + u16le(h, o + 5)) * (u16le(h, o + 3) + u16le(h, o + 7));
      return Math.max(screen, first);
    }
    if (t !== 0x21) throw new Malformed("gif_bloc");
    o += 2;
    for (let n = u8(h, o); n !== 0; n = u8(h, o)) o += 1 + n;
    o++;
  }
}

function webp(h: Uint8Array): number | null {
  if (!startsWith(h, 8, "WEBP")) return null;
  if (startsWith(h, 12, "VP8X")) return (1 + u24le(h, 24)) * (1 + u24le(h, 27));
  if (startsWith(h, 12, "VP8L")) {
    if (u8(h, 20) !== 0x2f) return null;
    const v = u32le(h, 21);
    return (1 + (v & 0x3fff)) * (1 + ((v >>> 14) & 0x3fff));
  }
  if (startsWith(h, 12, "VP8 ")) {
    if (u8(h, 23) !== 0x9d || u8(h, 24) !== 0x01 || u8(h, 25) !== 0x2a) return null;
    return (u16le(h, 26) & 0x3fff) * (u16le(h, 28) & 0x3fff);
  }
  return null;
}

/** HEIF, AVIF : la plus grande propriété `ispe` (image principale, grille ou tuile). */
async function heif(b: Blob): Promise<number | null> {
  const meta = (await topLevel(b)).find((x) => x.type === "meta");
  if (!meta || meta.end - meta.start > META_MAX) return null;
  const m = await read(b, meta.start, meta.end - meta.start);
  const base = meta.start;
  let max = 0;
  for (const p of children(m, fullBox(m, meta, base).body, meta.end, base)) {
    if (p.type !== "iprp") continue;
    for (const c of children(m, p.start + p.head, p.end, base)) {
      if (c.type !== "ipco") continue;
      for (const e of children(m, c.start + c.head, c.end, base)) {
        if (e.type !== "ispe") continue;
        const o = fullBox(m, e, base).body - base;
        max = Math.max(max, u32be(m, o) * u32be(m, o + 4));
      }
    }
  }
  return max > 0 ? max : null;
}

/** Nombre de pixels annoncé par l'en-tête, ou null (format inconnu, en-tête illisible). */
export async function imagePixels(b: Blob): Promise<number | null> {
  try {
    const h = await read(b, 0, HEAD);
    if (startsWith(h, 0, "\xff\xd8")) return await jpeg(b);
    if (startsWith(h, 0, "\x89PNG\r\n\x1a\n")) {
      if (!startsWith(h, 12, "IHDR")) return null;
      return u32be(h, 16) * u32be(h, 20) || null;
    }
    if (startsWith(h, 0, "GIF87a") || startsWith(h, 0, "GIF89a")) return gif(h) || null;
    if (startsWith(h, 0, "RIFF")) return webp(h) || null;
    if (startsWith(h, 4, "ftyp")) return await heif(b);
    return null;
  } catch {
    return null; // Malformed : en-tête tronqué ou incohérent
  }
}

/** Aperçu permis : dimensions connues et au plus PREVIEW_MAX_PIXELS. */
export async function previewable(b: Blob): Promise<boolean> {
  const px = await imagePixels(b);
  return px !== null && px <= PREVIEW_MAX_PIXELS;
}
