// WebP (spec §35.2) : reconstruction des blocs RIFF. Gardés : VP8, VP8L, VP8X, ALPH, ICCP,
// ANIM, ANMF. EXIF réécrit avec la seule orientation si elle ≠ 1 ; XMP et blocs inconnus
// retirés ; drapeaux de VP8X et taille RIFF corrigés. Taille RIFF incohérente : échec.
import { Malformed, ascii, concat, slice, startsWith, u32le } from "./bytes";
import { isLittle, orientationTiff, readOrientation } from "./exif";

const KEPT = new Set(["VP8 ", "VP8L", "VP8X", "ALPH", "ICCP", "ANIM", "ANMF"]);
const F_EXIF = 0x08;
const F_XMP = 0x04;

function chunk(type: string, data: Uint8Array): Uint8Array {
  const head = new Uint8Array(8);
  for (let i = 0; i < 4; i++) head[i] = type.charCodeAt(i);
  new DataView(head.buffer).setUint32(4, data.length, true);
  return concat([head, data, data.length % 2 ? new Uint8Array(1) : new Uint8Array(0)]);
}

export function cleanWebp(b: Uint8Array): Uint8Array<ArrayBuffer> {
  if (!startsWith(b, 0, "RIFF") || !startsWith(b, 8, "WEBP")) throw new Malformed("webp_entete");
  const riff = u32le(b, 4);
  if (riff + 8 > b.length || riff < 4 || riff % 2) throw new Malformed("webp_riff");
  const end = 8 + riff; // ce qui suit la fin du RIFF est retiré
  const parts: Uint8Array[] = [];
  let vp8x = -1;
  let exif = false;
  let image = false;
  for (let o = 12; o < end; ) {
    const type = ascii(b, o, 4);
    const len = u32le(b, o + 4);
    const padded = len + (len % 2);
    if (o + 8 + padded > end) throw new Malformed("webp_bloc");
    const all = slice(b, o, 8 + padded);
    if (KEPT.has(type)) {
      if (type === "VP8X") {
        if (vp8x >= 0 || parts.length > 0 || len < 10) throw new Malformed("webp_vp8x");
        vp8x = parts.length;
        parts.push(all.slice()); // copie : drapeaux corrigés plus bas
      } else parts.push(all);
      if (type === "VP8 " || type === "VP8L" || type === "ANMF") image = true;
    } else if (type === "EXIF" && !exif) {
      let tiff = all.subarray(8, 8 + len);
      if (startsWith(tiff, 0, "Exif\0\0")) tiff = tiff.subarray(6);
      const orient = readOrientation(tiff);
      if (orient !== null && orient !== 1) {
        parts.push(chunk("EXIF", orientationTiff(orient, isLittle(tiff))));
        exif = true;
      }
    }
    o += 8 + padded;
  }
  if (!image) throw new Malformed("webp_sans_image");
  if (vp8x < 0 && parts.length !== 1) throw new Malformed("webp_simple"); // format simple : un seul bloc image
  if (vp8x >= 0) {
    const x = parts[vp8x]!;
    x[8] = (x[8]! & ~(F_EXIF | F_XMP)) | (exif ? F_EXIF : 0);
  }
  const body = concat(parts);
  const head = new Uint8Array(12);
  head.set([0x52, 0x49, 0x46, 0x46]);
  new DataView(head.buffer).setUint32(4, body.length + 4, true);
  head.set([0x57, 0x45, 0x42, 0x50], 8);
  return concat([head, body]);
}
