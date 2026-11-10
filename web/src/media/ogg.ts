// Ogg Opus et Ogg Vorbis (spec §35.2, Task 9c, technique 3). Le paquet de commentaires
// (OpusTags, « \x03vorbis ») est remplacé par un paquet vide : ni encodeur, ni commentaire, ni
// pochette (METADATA_BLOCK_PICTURE). Les pages d'en-tête sont refaites ; les pages audio sont
// reprises telles quelles, seuls leur numéro de séquence et leur CRC changent si le nombre de
// pages d'en-tête a changé. Flux multiplexés ou chaînés, autre codec, CRC faux → `Malformed`.
import { Malformed, concat, startsWith } from "./bytes";

/** Taille maximale traitée (toutes les pages sont relues pour vérifier leur CRC). */
export const OGG_MAX = 1024 * 1024 * 1024;

const TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i << 24;
    for (let k = 0; k < 8; k++) c = c & 0x80000000 ? (c << 1) ^ 0x04c11db7 : c << 1;
    t[i] = c >>> 0;
  }
  return t;
})();
/** CRC de page Ogg : polynôme 0x04C11DB7, non réfléchi, valeur initiale 0, champ CRC à zéro. */
export function oggCrc(page: Uint8Array): number {
  let c = 0;
  for (let i = 0; i < page.length; i++) {
    const v = i >= 22 && i < 26 ? 0 : page[i]!;
    c = ((c << 8) ^ TABLE[((c >>> 24) ^ v) & 0xff]!) >>> 0;
  }
  return c >>> 0;
}

type Page = { start: number; end: number; flags: number; serial: number; seq: number; granule: Uint8Array; lacing: Uint8Array; body: number };

/** Lecture par fenêtres de 4 Mio. */
class Reader {
  private at = -1;
  private buf = new Uint8Array(0);
  constructor(private blob: Blob) {}
  async bytes(o: number, n: number): Promise<Uint8Array> {
    if (o < 0 || o + n > this.blob.size) throw new Malformed("bornes");
    if (o >= this.at && o + n <= this.at + this.buf.length) return this.buf.subarray(o - this.at, o - this.at + n);
    this.at = o;
    this.buf = new Uint8Array(await this.blob.slice(o, Math.min(this.blob.size, o + Math.max(n, 4 << 20))).arrayBuffer());
    return this.buf.subarray(0, n);
  }
}

async function page(r: Reader, o: number, size: number): Promise<{ p: Page; bytes: Uint8Array }> {
  if (size - o < 27) throw new Malformed("page_courte");
  const h = await r.bytes(o, 27);
  if (!startsWith(h, 0, "OggS") || h[4] !== 0) throw new Malformed("page");
  const n = h[26]!;
  const lacing = (await r.bytes(o + 27, n)).slice();
  let len = 0;
  for (const l of lacing) len += l;
  const end = o + 27 + n + len;
  if (end > size) throw new Malformed("page_deborde");
  const bytes = await r.bytes(o, end - o);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (dv.getUint32(22, true) !== oggCrc(bytes)) throw new Malformed("crc");
  return {
    p: { start: o, end, flags: h[5]!, granule: bytes.slice(6, 14), serial: dv.getUint32(14, true), seq: dv.getUint32(18, true), lacing, body: o + 27 + n },
    bytes,
  };
}

function buildPage(flags: number, granule: Uint8Array, serial: number, seq: number, lacing: number[], data: Uint8Array): Uint8Array {
  const out = new Uint8Array(27 + lacing.length + data.length);
  out.set([0x4f, 0x67, 0x67, 0x53, 0, flags]);
  out.set(granule, 6);
  const dv = new DataView(out.buffer);
  dv.setUint32(14, serial, true);
  dv.setUint32(18, seq, true);
  out[26] = lacing.length;
  out.set(lacing, 27);
  out.set(data, 27 + lacing.length);
  dv.setUint32(22, oggCrc(out), true);
  return out;
}

/** Paquets → pages (granule 0 si un paquet s'y termine, -1 sinon). */
function headerPages(packets: Uint8Array[], serial: number, firstSeq: number): Uint8Array[] {
  const segs: { len: number; data: Uint8Array; last: boolean }[] = [];
  for (const pk of packets) {
    let o = 0;
    for (;;) {
      const n = Math.min(255, pk.length - o);
      segs.push({ len: n, data: pk.subarray(o, o + n), last: n < 255 });
      o += n;
      if (n < 255) break;
    }
  }
  const pages: Uint8Array[] = [];
  let continued = false;
  for (let i = 0; i < segs.length; ) {
    const part = segs.slice(i, i + 255);
    i += part.length;
    const ends = part.some((s) => s.last);
    const granule = new Uint8Array(8).fill(ends ? 0 : 0xff);
    pages.push(buildPage(continued ? 1 : 0, granule, serial, firstSeq + pages.length, part.map((s) => s.len), concat(part.map((s) => s.data))));
    continued = !part[part.length - 1]!.last;
  }
  return pages;
}

const OPUS_TAGS = new Uint8Array([...new TextEncoder().encode("OpusTags"), 0, 0, 0, 0, 0, 0, 0, 0]);
const VORBIS_COMMENT = new Uint8Array([3, ...new TextEncoder().encode("vorbis"), 0, 0, 0, 0, 0, 0, 0, 0, 1]);
const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);

/** Fichier nettoyé, ou null s'il n'y a rien à changer (commentaires déjà vides). */
export async function cleanOgg(file: Blob): Promise<Blob | null> {
  if (file.size > OGG_MAX) throw new Malformed("trop_gros");
  const r = new Reader(file);
  // En-têtes : paquets du premier flux jusqu'au dernier paquet d'en-tête.
  const first = await page(r, 0, file.size);
  if (!(first.p.flags & 2)) throw new Malformed("bos");
  const serial = first.p.serial;
  const packets: Uint8Array[] = [];
  let cur: Uint8Array[] = [];
  let o = 0;
  let want = 0;
  let headerEnd = 0;
  let headerCount = 0;
  while (want === 0 || packets.length < want) {
    const { p, bytes } = o === 0 ? first : await page(r, o, file.size);
    if (p.serial !== serial || (o > 0 && p.flags & 2)) throw new Malformed("multiplexe");
    let at = p.body - p.start;
    for (const l of p.lacing) {
      cur.push(bytes.subarray(at, at + l));
      at += l;
      if (l < 255) {
        packets.push(concat(cur));
        cur = [];
        if (packets.length === 1) {
          if (startsWith(packets[0]!, 0, "OpusHead")) want = 2;
          else if (startsWith(packets[0]!, 0, "\x01vorbis")) want = 3;
          else throw new Malformed("codec");
        }
      }
    }
    headerCount++;
    o = p.end;
    if (want > 0 && packets.length > want) throw new Malformed("audio_dans_en_tete");
    if (packets.length >= want && want > 0) {
      if (cur.length > 0) throw new Malformed("en_tete_coupe");
      headerEnd = o;
    }
    if (headerCount > 1000) throw new Malformed("en_tete");
  }
  const opus = want === 2;
  const empty = opus ? OPUS_TAGS : VORBIS_COMMENT;
  if (!startsWith(packets[1]!, 0, opus ? "OpusTags" : "\x03vorbis")) throw new Malformed("commentaires");
  // Toutes les pages audio : même flux, aucun nouveau début (chaîné), CRC justes.
  const audio: Page[] = [];
  for (let q = headerEnd; q < file.size; ) {
    const { p } = await page(r, q, file.size);
    if (p.serial !== serial || p.flags & 2) throw new Malformed("chaine");
    audio.push(p);
    q = p.end;
  }
  if (same(packets[1]!, empty)) return null;

  // Le premier paquet doit être seul sur la première page (Opus et Vorbis l'exigent).
  const lac = first.p.lacing;
  if (lac.length === 0 || lac[lac.length - 1]! === 255 || lac.slice(0, -1).some((l) => l < 255)) throw new Malformed("premiere_page");
  const newHeaders = [new Uint8Array(await file.slice(0, first.p.end).arrayBuffer()), ...headerPages([empty, ...packets.slice(2)], serial, first.p.seq + 1)];
  const shift = newHeaders.length - headerCount;
  const parts: BlobPart[] = newHeaders as Uint8Array<ArrayBuffer>[];
  for (const p of audio) {
    if (shift === 0) {
      parts.push(file.slice(p.start, p.end));
      continue;
    }
    const b = new Uint8Array(await file.slice(p.start, p.end).arrayBuffer());
    const dv = new DataView(b.buffer);
    dv.setUint32(18, (p.seq + shift) >>> 0, true);
    dv.setUint32(22, oggCrc(b), true);
    parts.push(b);
  }
  return new Blob(parts, { type: file.type });
}
