// EXIF minimal (spec §35.2) : lecture de l'orientation (0x0112) de l'IFD0 et écriture d'un
// TIFF qui ne contient qu'elle (aucun IFD1, donc aucune vignette), ou d'un TIFF vide.
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
