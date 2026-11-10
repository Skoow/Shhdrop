// WebM et Matroska (MKV, MKA) : nettoyage EN PLACE, à longueur constante (spec §35.2, Task 9c).
// - Tags (titre, artiste, commentaire, date, encodeur…) : élément entier remplacé par un Void de
//   même taille totale ;
// - dans Info : Title, DateUTC, SegmentUUID, PrevUUID, NextUUID, SegmentFilename, PrevFilename,
//   NextFilename : Void de même taille ; MuxingApp et WritingApp (obligatoires) réécrits
//   « shhdrop » complété d'octets nuls (chaîne vide si la place manque) ; un CRC-32 de Info
//   devenu faux est lui aussi remplacé par un Void.
// Gardés : pistes, Cluster, Cues, chapitres, pièces jointes (polices de sous-titres). Aucune
// position ne bouge : SeekHead et Cues restent justes. Taille inconnue permise seulement pour
// Segment et Cluster ; tout le reste → `Malformed`.
import { Malformed } from "./bytes";
import type { Patch } from "./patch";

const EBML_HEADER = 0x1a45dfa3;
const SEGMENT = 0x18538067;
const CLUSTER = 0x1f43b675;
const INFO = 0x1549a966;
const TAGS = 0x1254c367;
const VOID = 0xec;
const CRC32 = 0xbf;
/** Enfants de Segment connus ; tout autre identifiant → `Malformed`. */
const SEGMENT_KIDS: ReadonlySet<number> = new Set([0x114d9b74, INFO, 0x1654ae6b, CLUSTER, 0x1c53bb6b, 0x1043a770, 0x1941a469, TAGS, VOID, CRC32]);
/** Info : remplacés par un Void. */
const INFO_VOID: ReadonlySet<number> = new Set([0x7ba9, 0x4461, 0x73a4, 0x3cb923, 0x3eb923, 0x7384, 0x3c83ab, 0x3e83bb]);
/** Info : réécrits « shhdrop ». */
const INFO_APP: ReadonlySet<number> = new Set([0x4d80, 0x5741]);
const SHHDROP = new TextEncoder().encode("shhdrop");
/** Info lu en mémoire au plus. */
const INFO_MAX = 1 << 20;

/** Lecture d'un Blob par fenêtres de 1 Mio (les en-têtes d'éléments se suivent). */
class Reader {
  private at = -1;
  private buf = new Uint8Array(0);
  constructor(readonly blob: Blob) {}
  async bytes(o: number, n: number): Promise<Uint8Array> {
    if (o < 0 || o + n > this.blob.size) throw new Malformed("bornes");
    if (o >= this.at && o + n <= this.at + this.buf.length) return this.buf.subarray(o - this.at, o - this.at + n);
    if (n > 1 << 20) return new Uint8Array(await this.blob.slice(o, o + n).arrayBuffer());
    this.at = o;
    this.buf = new Uint8Array(await this.blob.slice(o, Math.min(this.blob.size, o + (1 << 20))).arrayBuffer());
    return this.buf.subarray(0, n);
  }
}

type Vint = { value: number; len: number; unknown: boolean };
/** Entier EBML ; `raw` garde le marqueur de longueur (identifiants). */
export function vint(b: Uint8Array, o: number, raw: boolean): Vint {
  if (o >= b.length) throw new Malformed("vint");
  const first = b[o]!;
  let len = 1;
  let mask = 0x80;
  while (len <= 8 && !(first & mask)) {
    mask >>= 1;
    len++;
  }
  if (len > 8 || (raw && len > 4) || o + len > b.length) throw new Malformed("vint");
  let value = raw ? first : first & (mask - 1);
  let ones = (first & (mask - 1)) === mask - 1;
  for (let i = 1; i < len; i++) {
    value = value * 256 + b[o + i]!;
    if (b[o + i] !== 0xff) ones = false;
  }
  const unknown = !raw && ones;
  // Taille connue au-delà de 2^53 : aucun fichier réel, refusée.
  if (!unknown && !Number.isSafeInteger(value)) throw new Malformed("vint");
  return { value, len, unknown };
}

type El = { id: number; start: number; data: number; end: number; unknown: boolean };

async function element(r: Reader, o: number, limit: number): Promise<El> {
  const h = await r.bytes(o, Math.min(12, limit - o));
  const id = vint(h, 0, true);
  const sz = vint(h, id.len, false);
  const data = o + id.len + sz.len;
  const end = sz.unknown ? limit : data + sz.value;
  if (end > limit || data > limit) throw new Malformed("debordement");
  return { id: id.value, start: o, data, end, unknown: sz.unknown };
}

/** Void de même taille totale que [start, end) : en-tête valide, contenu nul. */
export function voidBytes(total: number): Uint8Array {
  if (total < 2) throw new Malformed("void");
  const out = new Uint8Array(total);
  out[0] = VOID;
  if (total <= 9 && total - 2 < 127) out[1] = 0x80 | (total - 2);
  else {
    // Taille sur 8 octets (0x01 puis 7 octets) : n'importe quelle longueur tient.
    let n = total - 9;
    out[1] = 0x01;
    for (let i = 8; i >= 2; i--) {
      out[i] = n % 256;
      n = Math.floor(n / 256);
    }
  }
  return out;
}

/** Correctifs du nettoyage ; liste vide si rien n'est à changer. */
export async function cleanEbml(file: Blob): Promise<Patch[]> {
  const r = new Reader(file);
  const head = await element(r, 0, file.size);
  if (head.id !== EBML_HEADER || head.unknown) throw new Malformed("ebml");
  const seg = await element(r, head.end, file.size);
  if (seg.id !== SEGMENT) throw new Malformed("segment");
  if (!seg.unknown && seg.end !== file.size) {
    // Rien d'autre qu'un Void ne doit suivre (fichiers chaînés : non pris en charge).
    const after = await element(r, seg.end, file.size);
    if (after.id !== VOID || after.end !== file.size) throw new Malformed("segments_multiples");
  }
  const out: Patch[] = [];
  let infos = 0;
  for (let o = seg.data; o < seg.end; ) {
    const el = await element(r, o, seg.end);
    if (!SEGMENT_KIDS.has(el.id)) throw new Malformed("element_inconnu");
    if (el.unknown && el.id !== CLUSTER) throw new Malformed("taille_inconnue");
    if (el.id === TAGS) out.push({ at: el.start, bytes: voidBytes(el.end - el.start) });
    else if (el.id === INFO) {
      if (++infos > 1 || el.end - el.start > INFO_MAX) throw new Malformed("info");
      out.push(...(await cleanInfo(r, el)));
    }
    o = el.unknown ? await clusterEnd(r, el, seg.end) : el.end;
  }
  if (infos !== 1) throw new Malformed("info");
  return out;
}

/** Fin d'un Cluster de taille inconnue : premier élément de niveau Segment qui suit. */
async function clusterEnd(r: Reader, cl: El, limit: number): Promise<number> {
  let o = cl.data;
  while (o < limit) {
    const h = await r.bytes(o, Math.min(4, limit - o));
    const id = vint(h, 0, true).value;
    if (SEGMENT_KIDS.has(id) && id !== VOID && id !== CRC32) return o;
    const el = await element(r, o, limit);
    if (el.unknown) throw new Malformed("taille_inconnue");
    o = el.end;
  }
  return limit;
}

async function cleanInfo(r: Reader, info: El): Promise<Patch[]> {
  const b = await r.bytes(info.start, info.end - info.start);
  const out: Patch[] = [];
  let crc: { at: number; len: number } | null = null;
  for (let p = info.data - info.start; p < b.length; ) {
    const id = vint(b, p, true);
    const sz = vint(b, p + id.len, false);
    const data = p + id.len + sz.len;
    const end = data + sz.value;
    if (sz.unknown || end > b.length) throw new Malformed("info");
    if (INFO_VOID.has(id.value)) out.push({ at: info.start + p, bytes: voidBytes(end - p) });
    else if (INFO_APP.has(id.value)) {
      const want = new Uint8Array(end - data);
      if (want.length >= SHHDROP.length) want.set(SHHDROP);
      if (!same(b.subarray(data, end), want)) out.push({ at: info.start + data, bytes: want });
    } else if (id.value === CRC32) crc = { at: info.start + p, len: end - p };
    p = end;
  }
  // Un CRC-32 de Info ne serait plus juste : remplacé par un Void.
  if (crc && out.length > 0) out.push({ at: crc.at, bytes: voidBytes(crc.len) });
  return out;
}

function same(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
