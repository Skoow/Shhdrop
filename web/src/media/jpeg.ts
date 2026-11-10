// JPEG (spec §35.2) : reconstruction segment par segment. Gardés : SOI, APP0 JFIF, APP2 ICC
// (tous les morceaux, dans l'ordre), APP14 Adobe, tables, SOFn, SOS et données compressées
// octet pour octet, EOI. APP1 EXIF réécrit avec la seule orientation (boutisme d'origine, sans
// IFD1). Tout le reste est retiré, y compris ce qui suit le premier EOI (images secondaires
// MPF, cartes de gain et de profondeur, vidéo des photos animées).
import { Malformed, concat, slice, startsWith, u16be, u8 } from "./bytes";
import { isLittle, orientationTiff, orientationToKeep } from "./exif";

const EXIF_ID = "Exif\0\0";
/** Tables et trames gardées : DQT, DHT, DAC, DRI, DNL, SOF0 à SOF15 (sauf DHT, JPG, DAC). */
function keptTable(m: number): boolean {
  return m === 0xdb || m === 0xc4 || m === 0xcc || m === 0xdd || m === 0xdc || (m >= 0xc0 && m <= 0xcf && m !== 0xc8);
}

function segment(m: number, body: Uint8Array): Uint8Array {
  if (body.length + 2 > 0xffff) throw new Malformed("jpeg_segment");
  return concat([new Uint8Array([0xff, m, (body.length + 2) >> 8, (body.length + 2) & 0xff]), body]);
}

/** Fin des données compressées qui suivent un SOS : position du marqueur suivant. */
function scanEnd(b: Uint8Array, o: number): number {
  for (let i = o; i < b.length - 1; i++) {
    if (b[i] !== 0xff) continue;
    let j = i + 1;
    while (j < b.length && b[j] === 0xff) j++;
    if (j >= b.length) break;
    const n = b[j]!;
    if (n === 0x00 || (n >= 0xd0 && n <= 0xd7)) {
      i = j;
      continue;
    }
    return j - 1;
  }
  throw new Malformed("jpeg_sans_fin");
}

export function cleanJpeg(b: Uint8Array): Uint8Array<ArrayBuffer> {
  if (u8(b, 0) !== 0xff || u8(b, 1) !== 0xd8) throw new Malformed("jpeg_soi");
  const out: Uint8Array[] = [b.subarray(0, 2)];
  let o = 2;
  let sof = false;
  let sos = false;
  let exifDone = false;
  for (;;) {
    if (u8(b, o) !== 0xff) throw new Malformed("jpeg_marqueur");
    while (u8(b, o + 1) === 0xff) o++; // octets de remplissage
    const m = u8(b, o + 1);
    if (m === 0xd9) {
      if (!sos) throw new Malformed("jpeg_sans_sos");
      out.push(b.subarray(o, o + 2));
      break; // rien de ce qui suit le premier EOI
    }
    if (m === 0x01 || (m >= 0xd0 && m <= 0xd8) || m === 0x00) throw new Malformed("jpeg_marqueur_seul");
    const len = u16be(b, o + 2);
    if (len < 2) throw new Malformed("jpeg_longueur");
    const seg = slice(b, o, 2 + len);
    const body = seg.subarray(4);
    const next = o + 2 + len;
    if (m === 0xda) {
      if (!sof) throw new Malformed("jpeg_sos_sans_sof");
      sos = true;
      const end = scanEnd(b, next);
      out.push(b.subarray(o, end));
      o = end;
      continue;
    }
    if (m === 0xe0) {
      if (startsWith(body, 0, "JFIF\0")) out.push(seg); // JFXX (vignette) retiré
    } else if (m === 0xe1) {
      if (startsWith(body, 0, EXIF_ID) && !exifDone) {
        exifDone = true;
        const tiff = body.subarray(EXIF_ID.length);
        const orient = orientationToKeep(tiff);
        if (orient !== null && orient !== 1) out.push(segment(0xe1, concat([new TextEncoder().encode(EXIF_ID), orientationTiff(orient, isLittle(tiff))])));
      }
      // XMP, XMP étendu, second EXIF : retirés
    } else if (m === 0xe2) {
      if (startsWith(body, 0, "ICC_PROFILE\0")) out.push(seg); // MPF, FPXR : retirés
    } else if (m === 0xee) {
      if (startsWith(body, 0, "Adobe")) out.push(seg);
    } else if ((m >= 0xe3 && m <= 0xed) || m === 0xef || m === 0xfe) {
      // APP3 à APP13 (IPTC, Photoshop), APP15, COM : retirés
    } else if (keptTable(m)) {
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xcc) sof = true;
      out.push(seg);
    } else throw new Malformed("jpeg_marqueur_inconnu");
    o = next;
  }
  return concat(out);
}
