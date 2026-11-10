// Lecture et réécriture de conteneurs ZIP (Office, ODF ; spec §35.2, technique 3) : le
// répertoire central est lu en entier et vérifié (bornes, doublons, chevauchements, en-têtes
// locaux) ; la réécriture recopie les entrées inchangées (données compressées et CRC
// identiques, sans décompression), écrit les parties remplacées sans compression, fixe les
// dates au 1ᵉʳ janvier 1980 et retire champs « extra », commentaires et attributs. Le
// résultat est un Blob fait de tranches de l'original. Refusés (`Malformed`) : ZIP64,
// plusieurs disques, entrée chiffrée, méthode autre que stockée ou Deflate, nom en double.
import { crc32 } from "../zip/crc32";
import { Malformed, u16le, u32le } from "./bytes";

export type ZipEntry = {
  readonly name: string;
  readonly rawName: Uint8Array;
  readonly flags: number;
  readonly method: 0 | 8;
  readonly crc: number;
  readonly csize: number;
  readonly usize: number;
  readonly version: number;
  readonly time: number;
  readonly date: number;
  readonly localOffset: number;
  readonly dataOffset: number;
  /** Champs « extra » (local ou central) ou commentaire d'entrée présents. */
  readonly hasExtra: boolean;
};
export type ZipFile = { readonly entries: readonly ZipEntry[]; readonly commentLength: number };

export const DOS_DATE = (1 << 5) | 1; // 1980-01-01
const EOCD = 0x06054b50;
const CEN = 0x02014b50;
const LOC = 0x04034b50;
const MAX_ENTRIES = 65535;
/** Répertoire central lu en mémoire au plus (celui d'un document Office fait quelques Kio). */
export const CD_MAX = 16 * 1024 * 1024;
const NAME_DEC = new TextDecoder("utf-8", { fatal: true });

const read = async (f: Blob, o: number, n: number) => new Uint8Array(await f.slice(o, o + n).arrayBuffer());

export async function readZip(file: Blob): Promise<ZipFile> {
  const size = file.size;
  if (size < 22 || size >= 0xffffffff) throw new Malformed("zip_taille");
  const tailLen = Math.min(size, 22 + 65535);
  const tail = await read(file, size - tailLen, tailLen);
  let e = -1;
  for (let k = tail.length - 22; k >= 0; k--) {
    if (u32le(tail, k) === EOCD && k + 22 + u16le(tail, k + 20) === tail.length) {
      e = k;
      break;
    }
  }
  if (e < 0) throw new Malformed("zip_fin");
  const eocdAt = size - tailLen + e;
  if (e >= 20 && u32le(tail, e - 20) === 0x07064b50) throw new Malformed("zip64");
  const disk = u16le(tail, e + 4);
  const cdDisk = u16le(tail, e + 6);
  const onDisk = u16le(tail, e + 8);
  const total = u16le(tail, e + 10);
  const cdSize = u32le(tail, e + 12);
  const cdAt = u32le(tail, e + 16);
  if (total === 0xffff || cdSize === 0xffffffff || cdAt === 0xffffffff) throw new Malformed("zip64");
  if (disk !== 0 || cdDisk !== 0 || onDisk !== total) throw new Malformed("zip_disques");
  if (cdAt + cdSize !== eocdAt) throw new Malformed("zip_repertoire");
  if (cdSize > CD_MAX) throw new Malformed("zip_repertoire_trop_grand");
  const cd = await read(file, cdAt, cdSize);
  const entries: ZipEntry[] = [];
  const names = new Set<string>();
  let o = 0;
  for (let k = 0; k < total; k++) {
    if (u32le(cd, o) !== CEN) throw new Malformed("zip_central");
    const version = u16le(cd, o + 6);
    const flags = u16le(cd, o + 8);
    const method = u16le(cd, o + 10);
    const time = u16le(cd, o + 12);
    const date = u16le(cd, o + 14);
    const crc = u32le(cd, o + 16);
    const csize = u32le(cd, o + 20);
    const usize = u32le(cd, o + 24);
    const nlen = u16le(cd, o + 28);
    const xlen = u16le(cd, o + 30);
    const clen = u16le(cd, o + 32);
    const diskStart = u16le(cd, o + 34);
    const localOffset = u32le(cd, o + 42);
    if (o + 46 + nlen + xlen + clen > cd.length) throw new Malformed("zip_central");
    const rawName = cd.slice(o + 46, o + 46 + nlen);
    for (let x = o + 46 + nlen; x + 4 <= o + 46 + nlen + xlen; x += 4 + u16le(cd, x + 2)) if (u16le(cd, x) === 0x0001) throw new Malformed("zip64");
    if (flags & 0x41) throw new Malformed("zip_chiffre");
    if (method !== 0 && method !== 8) throw new Malformed("zip_methode");
    if (csize === 0xffffffff || usize === 0xffffffff || localOffset === 0xffffffff) throw new Malformed("zip64");
    if (diskStart !== 0) throw new Malformed("zip_disques");
    if (method === 0 && csize !== usize) throw new Malformed("zip_tailles");
    let name: string;
    try {
      name = NAME_DEC.decode(rawName);
    } catch {
      throw new Malformed("zip_nom");
    }
    if (name === "" || names.has(name)) throw new Malformed("zip_doublon");
    names.add(name);
    entries.push({ name, rawName, flags, method, crc, csize, usize, version, time, date, localOffset, dataOffset: 0, hasExtra: xlen > 0 || clen > 0 });
    o += 46 + nlen + xlen + clen;
  }
  if (o !== cd.length) throw new Malformed("zip_central");
  if (total > MAX_ENTRIES) throw new Malformed("zip64");
  // En-têtes locaux : même nom, données dans le fichier, aucun chevauchement.
  const sorted = [...entries].sort((a, b) => a.localOffset - b.localOffset);
  const out = new Map<ZipEntry, ZipEntry>();
  let end = 0;
  for (const en of sorted) {
    if (en.localOffset < end) throw new Malformed("zip_chevauchement");
    const h = await read(file, en.localOffset, 30 + en.rawName.length);
    if (h.length < 30 || u32le(h, 0) !== LOC) throw new Malformed("zip_local");
    const nlen = u16le(h, 26);
    const xlen = u16le(h, 28);
    if (nlen !== en.rawName.length || h.subarray(30, 30 + nlen).some((b, i) => b !== en.rawName[i])) throw new Malformed("zip_local_nom");
    if (u16le(h, 8) !== en.method) throw new Malformed("zip_local");
    const dataOffset = en.localOffset + 30 + nlen + xlen;
    end = dataOffset + en.csize;
    if (end > cdAt) throw new Malformed("zip_bornes");
    out.set(en, { ...en, dataOffset, hasExtra: en.hasExtra || xlen > 0 });
  }
  return { entries: entries.map((en) => out.get(en)!), commentLength: u16le(tail, e + 20) };
}

/** Décompression bornée (`DecompressionStream` natif) ; absent ou flux invalide : `Malformed`. */
export async function inflate(src: Blob, format: "deflate" | "deflate-raw", max: number): Promise<Uint8Array<ArrayBuffer>> {
  if (typeof DecompressionStream === "undefined") throw new Malformed("inflate_absent");
  const parts: Uint8Array[] = [];
  let n = 0;
  try {
    const reader = src.stream().pipeThrough(new DecompressionStream(format)).getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      n += value.length;
      if (n > max) {
        await reader.cancel().catch(() => undefined);
        throw new Malformed("inflate_trop_gros");
      }
      parts.push(value);
    }
  } catch (e) {
    throw e instanceof Malformed ? e : new Malformed("inflate");
  }
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** Contenu décompressé d'une entrée, CRC et taille vérifiés. */
export async function entryData(file: Blob, en: ZipEntry, max: number): Promise<Uint8Array<ArrayBuffer>> {
  if (en.usize > max) throw new Malformed("zip_trop_gros");
  const raw = file.slice(en.dataOffset, en.dataOffset + en.csize);
  const data = en.method === 0 ? new Uint8Array(await raw.arrayBuffer()) : await inflate(raw, "deflate-raw", max);
  if (data.length !== en.usize || crc32(data) !== en.crc) throw new Malformed("zip_crc");
  return data;
}

/** L'entrée est-elle déjà sous la forme que `writeZip` produit (dates, extra, indicateurs) ? */
export function isNormalized(en: ZipEntry): boolean {
  return en.time === 0 && en.date === DOS_DATE && !en.hasExtra && (en.flags & ~0x0806) === 0;
}

class W {
  private b: number[] = [];
  u16(v: number) {
    this.b.push(v & 255, (v >>> 8) & 255);
    return this;
  }
  u32(v: number) {
    this.b.push(v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255);
    return this;
  }
  bytes(x: Uint8Array) {
    for (const v of x) this.b.push(v);
    return this;
  }
  out() {
    return new Uint8Array(this.b);
  }
}

/**
 * Réécrit l'archive dans l'ordre de ses entrées : `replace` (nom → nouvelles données, écrites
 * sans compression ; null : entrée retirée) ; les autres recopiées sans décompression.
 */
export function writeZip(file: Blob, zip: ZipFile, replace: ReadonlyMap<string, Uint8Array | null>, type: string): Blob {
  const parts: BlobPart[] = [];
  const central = new W();
  let pos = 0;
  let count = 0;
  for (const en of zip.entries) {
    const r = replace.get(en.name);
    if (r === null) continue;
    const utf8 = en.flags & 0x0800;
    const flags = r ? utf8 : en.flags & 0x0806; // options Deflate et UTF-8 seulement ; sans descripteur
    const method = r ? 0 : en.method;
    const crc = r ? crc32(r) : en.crc;
    const csize = r ? r.length : en.csize;
    const usize = r ? r.length : en.usize;
    const version = r ? 20 : Math.min(en.version, 20);
    const head = new W().u32(LOC).u16(version).u16(flags).u16(method).u16(0).u16(DOS_DATE).u32(crc).u32(csize).u32(usize).u16(en.rawName.length).u16(0).bytes(en.rawName).out();
    central.u32(CEN).u16(20).u16(version).u16(flags).u16(method).u16(0).u16(DOS_DATE).u32(crc).u32(csize).u32(usize).u16(en.rawName.length).u16(0).u16(0).u16(0).u16(0).u32(0).u32(pos).bytes(en.rawName);
    parts.push(head, r ? (r as Uint8Array<ArrayBuffer>) : file.slice(en.dataOffset, en.dataOffset + en.csize));
    pos += head.length + csize;
    count++;
  }
  const cd = central.out();
  if (pos + cd.length + 22 >= 0xffffffff) throw new Malformed("zip64");
  parts.push(cd, new W().u32(EOCD).u16(0).u16(0).u16(count).u16(count).u32(cd.length).u32(pos).u16(0).out());
  return new Blob(parts, { type });
}
