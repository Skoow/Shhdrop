// EXIF minimal (spec §35.2) : lecture de l'orientation (0x0112) de l'IFD0 et écriture d'un
// TIFF qui ne contient qu'elle et, s'il y en avait une, la vignette de l'IFD1 (keptTiff,
// décision du propriétaire du 11 novembre), ou d'un TIFF vide.
//
// Pourquoi garder l'orientation plutôt que tourner l'image : tourner demande de réencoder
// (perte de qualité, nouveau code de compression) ; l'étiquette d'orientation ne dit rien de
// la personne (ni lieu, ni appareil, ni date) et garde l'affichage identique.
import { Malformed, u16be, u16le, u32be, u32le } from "./bytes";

export const ORIENTATION = 0x0112;

/** Orientation 1 à 8 de l'IFD0 d'un en-tête TIFF, ou null (absente ou hors norme). */
export function readOrientation(tiff: Uint8Array): number | null {
  const le = tiff[0] === 0x49 && tiff[1] === 0x49;
  if (!le && !(tiff[0] === 0x4d && tiff[1] === 0x4d)) throw new Malformed("tiff");
  const r16 = le ? u16le : u16be;
  const r32 = le ? u32le : u32be;
  if (r16(tiff, 2) !== 42) throw new Malformed("tiff");
  const ifd = r32(tiff, 4);
  const n = r16(tiff, ifd);
  for (let i = 0; i < n; i++) {
    const e = ifd + 2 + i * 12;
    if (r16(tiff, e) !== ORIENTATION) continue;
    if (r16(tiff, e + 2) !== 3 || r32(tiff, e + 4) !== 1) return null;
    const v = r16(tiff, e + 8);
    return v >= 1 && v <= 8 ? v : null;
  }
  return null;
}

/**
 * Orientation à garder pendant un nettoyage, ou null. Un EXIF illisible (abîmé, tronqué) est
 * retiré comme le reste : il ne fait pas échouer le nettoyage, sinon la photo partirait avec
 * toutes ses informations, position comprise (revue du 10 novembre).
 */
export function orientationToKeep(tiff: Uint8Array): number | null {
  try {
    return readOrientation(tiff);
  } catch {
    return null;
  }
}

/** Boutisme d'un en-tête TIFF (vrai : « II », petit-boutiste). */
export function isLittle(tiff: Uint8Array): boolean {
  return tiff[0] === 0x49;
}

function header(le: boolean, entries: number): { b: Uint8Array<ArrayBuffer>; v: DataView } {
  const b = new Uint8Array(8 + 2 + entries * 12 + 4);
  const v = new DataView(b.buffer);
  b[0] = b[1] = le ? 0x49 : 0x4d;
  v.setUint16(2, 42, le);
  v.setUint32(4, 8, le);
  v.setUint16(8, entries, le);
  return { b, v };
}

/** TIFF à une seule entrée : l'orientation (26 octets). */
export function orientationTiff(orientation: number, le: boolean): Uint8Array<ArrayBuffer> {
  const { b, v } = header(le, 1);
  v.setUint16(10, ORIENTATION, le);
  v.setUint16(12, 3, le);
  v.setUint32(14, 1, le);
  v.setUint16(18, orientation, le);
  return b; // IFD suivant : 0 (aucun IFD1)
}

/** TIFF valide sans aucune entrée (14 octets). */
export function emptyTiff(le = false): Uint8Array<ArrayBuffer> {
  return header(le, 0).b;
}

// ---------- Vignette EXIF (IFD1) : gardée intacte (décision du propriétaire, 11 novembre) ----------
// La vignette JPEG de l'IFD1 (celle des téléphones) est la seule chose gardée de l'EXIF avec
// l'orientation : un TIFF neuf ne porte que l'orientation (IFD0, si elle sert) et l'IFD1 réduit
// à ce qui décrit la vignette (Compression = 6, position, longueur), puis la vignette octet
// pour octet. Aucune autre étiquette (appareil, dates, position GPS, logiciel…) n'y survit.
// Une vignette qui porte elle-même des métadonnées (segment APP1 à APP15 ou commentaire) est
// retirée : elle ferait revenir ce que le nettoyage enlève.

export const COMPRESSION = 0x0103;
export const THUMB_OFFSET = 0x0201;
export const THUMB_LENGTH = 0x0202;

/** Vignette JPEG de l'IFD1 (copie exacte), ou null : absente, illisible ou porteuse de métadonnées. */
export function readThumbnail(tiff: Uint8Array): Uint8Array | null {
  try {
    const le = tiff[0] === 0x49 && tiff[1] === 0x49;
    if (!le && !(tiff[0] === 0x4d && tiff[1] === 0x4d)) return null;
    const r16 = le ? u16le : u16be;
    const r32 = le ? u32le : u32be;
    if (r16(tiff, 2) !== 42) return null;
    const ifd0 = r32(tiff, 4);
    const ifd1 = r32(tiff, ifd0 + 2 + r16(tiff, ifd0) * 12);
    if (ifd1 === 0 || ifd1 === ifd0) return null;
    let off = -1;
    let len = -1;
    const n = r16(tiff, ifd1);
    for (let i = 0; i < n; i++) {
      const e = ifd1 + 2 + i * 12;
      const tag = r16(tiff, e);
      if (tag !== THUMB_OFFSET && tag !== THUMB_LENGTH) continue;
      const type = r16(tiff, e + 2);
      if (r32(tiff, e + 4) !== 1 || (type !== 4 && type !== 3)) return null;
      const v = type === 4 ? r32(tiff, e + 8) : r16(tiff, e + 8);
      if (tag === THUMB_OFFSET) off = v;
      else len = v;
    }
    if (off <= 0 || len < 4 || off + len > tiff.length) return null;
    const thumb = tiff.slice(off, off + len);
    if (thumb[0] !== 0xff || thumb[1] !== 0xd8 || carriesMetadata(thumb)) return null;
    return thumb;
  } catch {
    return null;
  }
}

/** Segments de tête d'un JPEG (jusqu'au premier SOS) : APP1 à APP15 ou COM présent. */
function carriesMetadata(j: Uint8Array): boolean {
  let o = 2;
  while (o + 4 <= j.length && j[o] === 0xff) {
    const m = j[o + 1]!;
    if (m === 0xda || m === 0xd9) return false;
    if ((m >= 0xe1 && m <= 0xef) || m === 0xfe) return true;
    o += 2 + ((j[o + 2]! << 8) | j[o + 3]!);
  }
  return false;
}

/**
 * TIFF gardé après nettoyage : orientation (si `orientation` n'est ni null ni 1) et vignette
 * IFD1 intacte (si l'EXIF d'origine en a une) ; null s'il n'y a rien à garder.
 * `maxBytes` : place permise (segment APP1 d'un JPEG) ; au-delà, la vignette est retirée.
 */
export function keptTiff(tiff: Uint8Array, orientation: number | null, maxBytes = Infinity): Uint8Array<ArrayBuffer> | null {
  const orient = orientation !== null && orientation !== 1 ? orientation : null;
  const le = isLittle(tiff);
  let thumb = readThumbnail(tiff);
  const n0 = orient === null ? 0 : 1;
  const ifd1 = 8 + 2 + n0 * 12 + 4;
  const at = ifd1 + 2 + 3 * 12 + 4;
  if (thumb && at + thumb.length > maxBytes) thumb = null;
  if (!thumb) return orient === null ? null : orientationTiff(orient, le);
  const b = new Uint8Array(at + thumb.length);
  const v = new DataView(b.buffer);
  b[0] = b[1] = le ? 0x49 : 0x4d;
  v.setUint16(2, 42, le);
  v.setUint32(4, 8, le);
  v.setUint16(8, n0, le);
  if (orient !== null) {
    v.setUint16(10, ORIENTATION, le);
    v.setUint16(12, 3, le);
    v.setUint32(14, 1, le);
    v.setUint16(18, orient, le);
  }
  v.setUint32(8 + 2 + n0 * 12, ifd1, le); // IFD0 → IFD1
  const entry = (k: number, tag: number, type: number, value: number) => {
    const e = ifd1 + 2 + k * 12;
    v.setUint16(e, tag, le);
    v.setUint16(e + 2, type, le);
    v.setUint32(e + 4, 1, le);
    if (type === 3) v.setUint16(e + 8, value, le);
    else v.setUint32(e + 8, value, le);
  };
  v.setUint16(ifd1, 3, le);
  entry(0, COMPRESSION, 3, 6); // vignette JPEG
  entry(1, THUMB_OFFSET, 4, at);
  entry(2, THUMB_LENGTH, 4, thumb.length);
  v.setUint32(ifd1 + 2 + 3 * 12, 0, le); // aucun IFD de plus
  b.set(thumb, at);
  return b;
}
