// Nettoyage des PDF (spec §35.2, Task 9b), neutralisation en place à longueur constante :
// le dictionnaire /Info de chaque révision (chaîne des /Prev, tables xref classiques et flux
// xref), tout flux /Type /Metadata (XMP) et les miniatures /Thumb des pages deviennent
// « N G obj null … endobj » : aucun octet ne bouge, les tables xref restent justes. Refus :
// /Encrypt ou signature (/ByteRange) → protégé ; /Info dans un flux d'objets, xref illisible,
// objet qui ne commence pas là où la table l'annonce → `Malformed` (→ `echec`).
// Images intégrées : un flux /DCTDecode (octets JPEG tels quels dans le fichier) voit ses
// segments d'informations (EXIF et GPS, XMP, IPTC, COM, MPF…, vignette JFIF, et tout ce qui
// suit l'EOI) mis à zéro en place, même longueur ; les pixels ne changent pas. Une image
// compressée autrement (Flate puis DCT, JPX) n'est pas modifiable en place : vérifiée
// seulement, et si elle porte des informations → `Malformed` (→ `echec`, jamais « Nettoyé »).
// Lecture par fenêtres de 4 Mio ; les flux xref, d'objets et d'images Flate sont décompressés
// en lecture seule (`DecompressionStream('deflate')`), 50 Mio par flux et INFLATE_BUDGET en
// tout (fichier hostile : l'onglet ne doit pas se figer).
import { STRIP_MAX } from "../limits";
import { Malformed } from "./bytes";
import { keptTable, scanEnd } from "./jpeg";
import type { Patch } from "./patch";
import { inflate } from "./zip";

export type PdfResult = { state: "protege" } | { state: "ok"; patches: Patch[] };

type Ref = { ref: [number, number] };
type PdfVal = null | boolean | number | Ref | { name: string } | { str: true } | { kw: string } | PdfVal[] | Map<string, PdfVal>;

class Short extends Error {}
type Ctx = { b: Uint8Array; eof: boolean };

const WIN = 4 * 1048576;
const WS = new Set([0, 9, 10, 12, 13, 32]);
const DELIM = new Set([..."()<>[]{}/%"].map((c) => c.charCodeAt(0)));
const MAX_SECTIONS = 1000;
/** Décompression permise pour tout le fichier (flux xref, d'objets, images Flate). */
export const INFLATE_BUDGET = 200 * 1048576;
type Budget = { left: number };

class Src {
  private win = new Uint8Array(0);
  private at = 0;
  constructor(private readonly f: Blob) {}
  get size() {
    return this.f.size;
  }
  async bytes(pos: number, len: number): Promise<Uint8Array> {
    if (!Number.isSafeInteger(pos) || pos < 0 || pos > this.size) throw new Malformed("pdf_bornes");
    len = Math.min(len, this.size - pos);
    if (pos >= this.at && pos + len <= this.at + this.win.length) return this.win.subarray(pos - this.at, pos - this.at + len);
    const n = Math.min(this.size - pos, Math.max(len, WIN));
    this.win = new Uint8Array(await this.f.slice(pos, pos + n).arrayBuffer());
    this.at = pos;
    return this.win.subarray(0, len);
  }
}

/** Analyse `f` sur une fenêtre qui commence en `pos`, agrandie tant qu'elle est trop courte. */
async function within<T>(src: Src, pos: number, f: (c: Ctx) => T): Promise<T> {
  for (const n of [65536, 1 << 20, 16 << 20, 64 << 20]) {
    const len = Math.min(n, src.size - pos);
    const c = { b: await src.bytes(pos, len), eof: pos + len >= src.size };
    try {
      return f(c);
    } catch (e) {
      if (!(e instanceof Short)) throw e;
      if (c.eof) throw new Malformed("pdf_fin");
    }
  }
  throw new Malformed("pdf_trop_gros");
}

// ---------- Lexique ----------
function skipWs(c: Ctx, i: number): number {
  for (;;) {
    if (i >= c.b.length) {
      if (c.eof) return i;
      throw new Short();
    }
    const x = c.b[i]!;
    if (WS.has(x)) i++;
    else if (x === 0x25) {
      while (i < c.b.length && c.b[i] !== 10 && c.b[i] !== 13) i++;
    } else return i;
  }
}
function regular(c: Ctx, i: number): [string, number] {
  let j = i;
  while (j < c.b.length && !WS.has(c.b[j]!) && !DELIM.has(c.b[j]!)) j++;
  if (j >= c.b.length && !c.eof) throw new Short();
  return [String.fromCharCode(...c.b.subarray(i, j)), j];
}
const NUM = /^[+-]?(\d+\.?\d*|\.\d+)$/u;
const INT = /^\d+$/u;

function value(c: Ctx, i: number, depth = 0): [PdfVal, number] {
  if (depth > 100) throw new Malformed("pdf_profondeur");
  i = skipWs(c, i);
  if (i >= c.b.length) throw new Malformed("pdf_fin");
  const b = c.b;
  const x = b[i]!;
  if (x === 0x2f) {
    const [tok, j] = regular(c, i + 1);
    return [{ name: tok.replace(/#([0-9a-fA-F]{2})/gu, (_, h: string) => String.fromCharCode(parseInt(h, 16))) }, j];
  }
  if (x === 0x28) {
    let d = 0;
    for (let j = i; ; j++) {
      if (j >= b.length) throw c.eof ? new Malformed("pdf_chaine") : new Short();
      if (b[j] === 0x5c) j++;
      else if (b[j] === 0x28) d++;
      else if (b[j] === 0x29 && --d === 0) return [{ str: true }, j + 1];
    }
  }
  if (x === 0x3c) {
    if (i + 1 >= b.length) throw c.eof ? new Malformed("pdf_fin") : new Short();
    if (b[i + 1] === 0x3c) {
      const d = new Map<string, PdfVal>();
      let j = i + 2;
      for (;;) {
        j = skipWs(c, j);
        if (j + 1 >= b.length) throw c.eof ? new Malformed("pdf_dict") : new Short();
        if (b[j] === 0x3e && b[j + 1] === 0x3e) return [d, j + 2];
        const [k, j2] = value(c, j, depth + 1);
        if (!k || typeof k !== "object" || !("name" in k)) throw new Malformed("pdf_cle");
        const [v, j3] = value(c, j2, depth + 1);
        d.set(k.name, v);
        j = j3;
      }
    }
    for (let j = i + 1; ; j++) {
      if (j >= b.length) throw c.eof ? new Malformed("pdf_hex") : new Short();
      if (b[j] === 0x3e) return [{ str: true }, j + 1];
      if (!WS.has(b[j]!) && !/[0-9a-fA-F]/u.test(String.fromCharCode(b[j]!))) throw new Malformed("pdf_hex");
    }
  }
  if (x === 0x5b) {
    const a: PdfVal[] = [];
    let j = i + 1;
    for (;;) {
      j = skipWs(c, j);
      if (j >= b.length) throw c.eof ? new Malformed("pdf_tableau") : new Short();
      if (b[j] === 0x5d) return [a, j + 1];
      const [v, j2] = value(c, j, depth + 1);
      a.push(v);
      j = j2;
    }
  }
  if (DELIM.has(x)) throw new Malformed("pdf_delimiteur");
  const [tok, j] = regular(c, i);
  if (NUM.test(tok)) {
    if (INT.test(tok)) {
      // « n g R » : référence indirecte.
      const k = skipWs(c, j);
      if (k < b.length) {
        const [t2, k2] = regular(c, k);
        if (INT.test(t2)) {
          const m = skipWs(c, k2);
          if (m < b.length) {
            const [t3, m2] = regular(c, m);
            if (t3 === "R") return [{ ref: [Number(tok), Number(t2)] }, m2];
          }
        }
      }
    }
    return [Number(tok), j];
  }
  if (tok === "true" || tok === "false") return [tok === "true", j];
  if (tok === "null") return [null, j];
  if (tok === "") throw new Malformed("pdf_jeton");
  return [{ kw: tok }, j];
}

const isDict = (v: PdfVal): v is Map<string, PdfVal> => v instanceof Map;
const isRef = (v: PdfVal | undefined): v is Ref => !!v && typeof v === "object" && "ref" in v;
const nameOf = (v: PdfVal | undefined) => (v && typeof v === "object" && "name" in v ? v.name : null);
const kw = (v: PdfVal, k: string) => !!v && typeof v === "object" && "kw" in v && v.kw === k;
const int = (v: PdfVal | undefined): number => {
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 0) throw new Malformed("pdf_entier");
  return v;
};

// ---------- Objets ----------
type Obj = { n: number; g: number; value: PdfVal; headerEnd: number; stream?: { dataStart: number; length: PdfVal } };

async function objectAt(src: Src, off: number): Promise<Obj> {
  return within(src, off, (c) => {
    const [n, i1] = value(c, 0);
    const [g, i2] = value(c, i1);
    const [o, i3] = value(c, i2);
    if (!kw(o, "obj")) throw new Malformed("pdf_objet");
    const [v, i4] = value(c, i3);
    const i5 = skipWs(c, i4);
    const [t, i6] = regular(c, i5);
    const obj: Obj = { n: int(n), g: int(g), value: v, headerEnd: off + i3 };
    if (t === "stream") {
      if (!isDict(v)) throw new Malformed("pdf_flux");
      if (i6 + 2 > c.b.length && !c.eof) throw new Short();
      const eol = c.b[i6] === 13 && c.b[i6 + 1] === 10 ? 2 : c.b[i6] === 10 ? 1 : -1;
      if (eol < 0) throw new Malformed("pdf_flux");
      obj.stream = { dataStart: off + i6 + eol, length: v.get("Length") ?? null };
    } else if (t !== "endobj") throw new Malformed("pdf_endobj");
    return obj;
  });
}

// ---------- Tables xref ----------
type Ent = { t: 0 } | { t: 1; off: number; gen: number } | { t: 2; stm: number; idx: number };
type Section = { entries: Map<number, Ent>; trailer: Map<string, PdfVal> };

/** Données décompressées de `raw` (zlib), sous le plafond par flux et le budget du fichier. */
async function inflateBudget(raw: Uint8Array<ArrayBuffer>, budget: Budget): Promise<Uint8Array<ArrayBuffer>> {
  const cap = Math.min(STRIP_MAX, budget.left);
  try {
    const data = await inflate(new Blob([raw]), "deflate", cap);
    budget.left -= data.length;
    return data;
  } catch (e) {
    if (e instanceof Malformed && e.message === "malformed:inflate_trop_gros" && cap < STRIP_MAX) throw new Malformed("pdf_budget");
    throw e;
  }
}

async function streamBytes(src: Src, obj: Obj, length: number, budget: Budget): Promise<Uint8Array<ArrayBuffer>> {
  const d = obj.value as Map<string, PdfVal>;
  if (length > STRIP_MAX) throw new Malformed("pdf_flux_trop_gros");
  const raw = new Uint8Array(await src.bytes(obj.stream!.dataStart, length));
  if (raw.length !== length) throw new Malformed("pdf_flux");
  const one = (v: PdfVal | undefined): PdfVal | undefined => {
    if (!Array.isArray(v)) return v;
    if (v.length !== 1) throw new Malformed("pdf_filtres");
    return v[0];
  };
  const filter = nameOf(one(d.get("Filter")));
  if (d.has("Filter") && filter !== "FlateDecode") throw new Malformed("pdf_filtre");
  let data = filter ? await inflateBudget(raw, budget) : raw;
  const parms = one(d.get("DecodeParms"));
  if (parms && isDict(parms)) {
    const pred = parms.has("Predictor") ? int(parms.get("Predictor")) : 1;
    if (pred >= 10) {
      if ((parms.has("Colors") && parms.get("Colors") !== 1) || (parms.has("BitsPerComponent") && parms.get("BitsPerComponent") !== 8)) throw new Malformed("pdf_predicteur");
      data = unpredictPng(data, parms.has("Columns") ? int(parms.get("Columns")) : 1);
    } else if (pred !== 1) throw new Malformed("pdf_predicteur");
  }
  return data;
}

function unpredictPng(d: Uint8Array, cols: number): Uint8Array<ArrayBuffer> {
  const row = cols + 1;
  if (cols < 1 || d.length % row !== 0) throw new Malformed("pdf_predicteur");
  const out = new Uint8Array((d.length / row) * cols);
  for (let r = 0; r * row < d.length; r++) {
    const f = d[r * row]!;
    for (let k = 0; k < cols; k++) {
      const x = d[r * row + 1 + k]!;
      const a = k > 0 ? out[r * cols + k - 1]! : 0;
      const up = r > 0 ? out[(r - 1) * cols + k]! : 0;
      const ul = r > 0 && k > 0 ? out[(r - 1) * cols + k - 1]! : 0;
      let p: number;
      if (f === 0) p = 0;
      else if (f === 1) p = a;
      else if (f === 2) p = up;
      else if (f === 3) p = (a + up) >> 1;
      else if (f === 4) {
        const e = a + up - ul;
        const pa = Math.abs(e - a), pb = Math.abs(e - up), pc = Math.abs(e - ul);
        p = pa <= pb && pa <= pc ? a : pb <= pc ? up : ul;
      } else throw new Malformed("pdf_predicteur");
      out[r * cols + k] = (x + p) & 255;
    }
  }
  return out;
}

async function xrefStream(src: Src, off: number, budget: Budget): Promise<Section> {
  const obj = await objectAt(src, off);
  const d = obj.value;
  if (!isDict(d) || nameOf(d.get("Type")) !== "XRef" || !obj.stream) throw new Malformed("pdf_xref");
  const data = await streamBytes(src, obj, int(d.get("Length")), budget);
  const w = d.get("W");
  if (!Array.isArray(w) || w.length !== 3) throw new Malformed("pdf_xref_w");
  const [w0, w1, w2] = w.map(int) as [number, number, number];
  if (w1 > 6 || w0 > 4 || w2 > 4) throw new Malformed("pdf_xref_w");
  const size = int(d.get("Size"));
  const index = d.get("Index") ?? [0, size];
  if (!Array.isArray(index) || index.length % 2) throw new Malformed("pdf_xref_index");
  const field = (o: number, n: number, dflt: number) => {
    if (n === 0) return dflt;
    let v = 0;
    for (let k = 0; k < n; k++) v = v * 256 + data[o + k]!;
    return v;
  };
  const entries = new Map<number, Ent>();
  const rec = w0 + w1 + w2;
  // Entrée de largeur nulle : la boucle tournerait /Index fois sans lire un octet (fichier
  // hostile, revue du 10 novembre). Le nombre d'entrées est aussi borné par les octets du flux.
  if (rec === 0) throw new Malformed("pdf_xref_w");
  let o = 0;
  for (let s = 0; s < index.length; s += 2) {
    const first = int(index[s]);
    const count = int(index[s + 1]);
    if (count > (data.length - o) / rec) throw new Malformed("pdf_xref_court");
    for (let k = 0; k < count; k++, o += rec) {
      if (o + rec > data.length) throw new Malformed("pdf_xref_court");
      const t = field(o, w0, 1);
      const a = field(o + w0, w1, 0);
      const b = field(o + w0 + w1, w2, 0);
      const num = first + k;
      if (entries.has(num)) continue;
      if (t === 0) entries.set(num, { t: 0 });
      else if (t === 1) entries.set(num, { t: 1, off: a, gen: b });
      else if (t === 2) entries.set(num, { t: 2, stm: a, idx: b });
    }
  }
  return { entries, trailer: d };
}

async function xrefClassic(src: Src, off: number): Promise<Section> {
  return within(src, off, (c) => {
    let [v, i] = value(c, 0);
    if (!kw(v, "xref")) throw new Malformed("pdf_xref");
    const entries = new Map<number, Ent>();
    for (;;) {
      [v, i] = value(c, i);
      if (kw(v, "trailer")) break;
      const first = int(v);
      let count: PdfVal;
      [count, i] = value(c, i);
      for (let k = 0; k < int(count); k++) {
        let a: PdfVal, g: PdfVal, t: PdfVal;
        [a, i] = value(c, i);
        [g, i] = value(c, i);
        [t, i] = value(c, i);
        const num = first + k;
        if (entries.has(num)) continue;
        if (kw(t, "n")) entries.set(num, { t: 1, off: int(a), gen: int(g) });
        else if (kw(t, "f")) entries.set(num, { t: 0 });
        else throw new Malformed("pdf_xref_entree");
      }
    }
    const [trailer] = value(c, i);
    if (!isDict(trailer)) throw new Malformed("pdf_trailer");
    return { entries, trailer };
  });
}

async function sections(src: Src, budget: Budget): Promise<{ list: Section[] }> {
  const tailLen = Math.min(src.size, 1024);
  const tail = new TextDecoder("latin1").decode(await src.bytes(src.size - tailLen, tailLen));
  const at = tail.lastIndexOf("startxref");
  const m = at < 0 ? null : /^startxref\s+(\d+)/u.exec(tail.slice(at));
  if (!m) throw new Malformed("pdf_startxref");
  const list: Section[] = [];
  const seen = new Set<number>();
  let off: number | null = Number(m[1]);
  while (off !== null) {
    if (seen.has(off) || list.length >= MAX_SECTIONS || off >= src.size) throw new Malformed("pdf_prev");
    seen.add(off);
    const head = new TextDecoder("latin1").decode(await src.bytes(off, 4));
    let sec: Section;
    if (head === "xref") {
      sec = await xrefClassic(src, off);
      // Fichier hybride : flux xref complémentaire (/XRefStm), même révision.
      const xs = sec.trailer.get("XRefStm");
      if (xs !== undefined) {
        const extra = await xrefStream(src, int(xs), budget);
        for (const [k, e] of extra.entries) if (!sec.entries.has(k)) sec.entries.set(k, e);
      }
    } else sec = await xrefStream(src, off, budget);
    list.push(sec);
    const prev = sec.trailer.get("Prev");
    off = prev === undefined ? null : int(prev);
  }
  return { list };
}

// ---------- Analyse ----------
type Target = { off: number; n: number; g: number; k: number };

async function analyse(file: Blob): Promise<PdfResult> {
  const src = new Src(file);
  const budget: Budget = { left: INFLATE_BUDGET };
  const { list } = await sections(src, budget);
  const lookup = (n: number, g: number, k: number): Exclude<Ent, { t: 0 }> | null => {
    for (let i = k; i < list.length; i++) {
      const e = list[i]!.entries.get(n);
      if (!e) continue;
      if (e.t === 1 && e.gen !== g) return null;
      if (e.t === 2 && g !== 0) return null;
      return e.t === 0 ? null : (e as Exclude<Ent, { t: 0 }>);
    }
    return null;
  };
  const targets = new Map<number, Target>();
  const add = (r: Ref, k: number, what: string) => {
    const e = lookup(r.ref[0], r.ref[1], k);
    if (!e) return;
    if (e.t === 2) throw new Malformed(`pdf_${what}_objstm`);
    if (!targets.has(e.off)) targets.set(e.off, { off: e.off, n: r.ref[0], g: r.ref[1], k });
  };
  // Signature (/ByteRange) n'importe où dans un objet : protégé.
  const signed = (v: PdfVal, depth = 0): boolean => {
    if (depth > 100) throw new Malformed("pdf_profondeur");
    if (isDict(v)) return v.has("ByteRange") || [...v.values()].some((x) => signed(x, depth + 1));
    return Array.isArray(v) && v.some((x) => signed(x, depth + 1));
  };
  const visit = (v: PdfVal, k: number): boolean => {
    if (signed(v)) return true;
    if (isDict(v) && nameOf(v.get("Type")) === "Page" && isRef(v.get("Thumb"))) add(v.get("Thumb") as Ref, k, "thumb");
    return false;
  };
  for (const [k, s] of list.entries()) {
    if (s.trailer.has("Encrypt")) return { state: "protege" };
    const info = s.trailer.get("Info");
    if (info === undefined || info === null) continue;
    if (!isRef(info)) throw new Malformed("pdf_info_direct");
    add(info, k, "info");
  }
  // Tous les objets annoncés (toutes révisions), une fois chacun, dans l'ordre du fichier.
  const objs = new Map<number, { n: number; g: number; k: number }>();
  for (const [k, s] of list.entries()) for (const [n, e] of s.entries) if (e.t === 1 && !objs.has(e.off)) objs.set(e.off, { n, g: e.gen, k });
  const lengthOf = async (o: Obj, k: number): Promise<number> => {
    const L = o.stream!.length;
    if (!isRef(L)) return int(L ?? undefined);
    const e = lookup(L.ref[0], L.ref[1], k);
    if (!e || e.t !== 1) throw new Malformed("pdf_longueur");
    return int((await objectAt(src, e.off)).value ?? undefined);
  };
  const images: { off: number; o: Obj; chain: string[]; len: number }[] = [];
  for (const off of [...objs.keys()].sort((a, b) => a - b)) {
    const { n, g, k } = objs.get(off)!;
    const o = await objectAt(src, off);
    if (o.n !== n || o.g !== g) throw new Malformed("pdf_xref_decalee");
    if (visit(o.value, k)) return { state: "protege" };
    if (!isDict(o.value)) continue;
    const type = nameOf(o.value.get("Type"));
    if (type === "Metadata") targets.set(off, { off, n, g, k });
    if (o.stream) {
      const chain = filters(o.value);
      if (chain.includes("DCTDecode") || chain.includes("JPXDecode")) images.push({ off, o, chain, len: await lengthOf(o, k) });
    }
    if (type === "ObjStm" && o.stream) {
      const data = await streamBytes(src, o, await lengthOf(o, k), budget);
      const c: Ctx = { b: data, eof: true };
      const first = int(o.value.get("First"));
      const count = int(o.value.get("N"));
      let i = 0;
      const pos: number[] = [];
      for (let x = 0; x < count; x++) {
        let a: PdfVal;
        [, i] = value(c, i);
        [a, i] = value(c, i);
        pos.push(int(a));
      }
      for (const p of pos) {
        if (first + p >= data.length) throw new Malformed("pdf_objstm");
        const [v] = value(c, first + p);
        if (visit(v, k)) return { state: "protege" };
      }
    }
  }
  // Correctifs : « N G obj » gardé, corps → « null » + espaces, « endobj » gardé.
  const patches: Patch[] = [];
  for (const t of [...targets.values()].sort((a, b) => a.off - b.off)) {
    const o = await objectAt(src, t.off);
    if (o.n !== t.n || o.g !== t.g) throw new Malformed("pdf_xref_decalee");
    if (o.value === null && !o.stream) continue;
    let endAt: number;
    if (o.stream) {
      const after = o.stream.dataStart + (await lengthOf(o, t.k));
      endAt = await within(src, after, (c) => {
        const [es, i] = value(c, 0);
        if (!kw(es, "endstream")) throw new Malformed("pdf_endstream");
        const j = skipWs(c, i);
        const [eo] = value(c, j);
        if (!kw(eo, "endobj")) throw new Malformed("pdf_endobj");
        return after + j;
      });
    } else {
      endAt = await within(src, t.off, (c) => {
        let [, i] = value(c, 0);
        [, i] = value(c, i);
        [, i] = value(c, i);
        [, i] = value(c, i);
        return t.off + skipWs(c, i);
      });
    }
    const gap = endAt - o.headerEnd;
    if (gap < 6) throw new Malformed("pdf_place");
    const bytes = new Uint8Array(gap).fill(0x20);
    bytes.set([0x6e, 0x75, 0x6c, 0x6c], 1); // « null »
    patches.push({ at: o.headerEnd, bytes });
  }
  // Images : après les miniatures (une miniature est elle-même une image, déjà neutralisée).
  for (const im of images) if (!targets.has(im.off)) patches.push(...(await imagePatches(src, im.o, im.chain, im.len, budget)));
  patches.sort((a, b) => a.at - b.at);
  await leftovers(src, patches);
  return { state: "ok", patches };
}

// ---------- Images intégrées ----------
/** Filtres d'un flux, dans l'ordre ; nom attendu. */
function filters(d: Map<string, PdfVal>): string[] {
  const f = d.get("Filter");
  if (f === undefined || f === null) return [];
  const list = Array.isArray(f) ? f : [f];
  return list.map((x) => nameOf(x) ?? (() => { throw new Malformed("pdf_filtre"); })());
}

const allZero = (b: Uint8Array) => b.every((x) => x === 0);

/**
 * Correctifs (positions dans `b`) qui mettent à zéro les informations d'un JPEG sans rien
 * déplacer : segment d'informations → COM de même longueur rempli de zéros (ignoré par tout
 * décodeur) ; vignette d'un APP0 JFIF → zéros ; octets après l'EOI → zéros. Gardés : APP0
 * JFIF, APP2 ICC, APP14 Adobe (couleurs), tables, trames, balayages. Mêmes règles que jpeg.ts.
 */
export function jpegInPlace(b: Uint8Array): Patch[] {
  const bad = () => new Malformed("pdf_jpeg");
  if (b[0] !== 0xff || b[1] !== 0xd8) throw bad();
  const out: Patch[] = [];
  const has = (body: Uint8Array, id: string) => body.length >= id.length && [...id].every((c, i) => body[i] === c.charCodeAt(0));
  let o = 2;
  let sos = false;
  for (;;) {
    if (o + 1 >= b.length || b[o] !== 0xff) throw bad();
    while (o + 2 < b.length && b[o + 1] === 0xff) o++;
    const m = b[o + 1]!;
    if (m === 0xd9) {
      if (!sos) throw bad();
      if (!allZero(b.subarray(o + 2))) out.push({ at: o + 2, bytes: new Uint8Array(b.length - o - 2) });
      return out;
    }
    if (m === 0x01 || m === 0x00 || (m >= 0xd0 && m <= 0xd8) || o + 4 > b.length) throw bad();
    const len = (b[o + 2]! << 8) | b[o + 3]!;
    if (len < 2 || o + 2 + len > b.length) throw bad();
    const body = b.subarray(o + 4, o + 2 + len);
    if (m === 0xda) {
      sos = true;
      try {
        o = scanEnd(b, o + 2 + len);
      } catch {
        throw bad();
      }
      continue;
    }
    const jfif = m === 0xe0 && has(body, "JFIF\0");
    const kept = jfif || (m === 0xe2 && has(body, "ICC_PROFILE\0")) || (m === 0xee && has(body, "Adobe"));
    if (kept) {
      if (jfif && body.length > 14 && !allZero(body.subarray(14))) out.push({ at: o + 4 + 14, bytes: new Uint8Array(body.length - 14) });
    } else if ((m >= 0xe0 && m <= 0xef) || m === 0xfe) {
      if (m !== 0xfe || !allZero(body)) {
        const p = new Uint8Array(len + 1);
        p.set([0xfe, b[o + 2]!, b[o + 3]!]);
        out.push({ at: o + 1, bytes: p });
      }
    } else if (!keptTable(m)) throw bad();
    o += 2 + len;
  }
}

/** JPEG 2000 (JP2/JPX) : boîte d'informations (XML, XMP en « uuid », adresse, propriété intellectuelle). */
function jpxHasMeta(b: Uint8Array): boolean {
  if (b[0] === 0xff && b[1] === 0x4f) return false; // flux de code seul : aucune boîte
  for (let o = 0; o < b.length; ) {
    if (o + 8 > b.length) throw new Malformed("pdf_jpx");
    let len = ((b[o]! << 24) | (b[o + 1]! << 16) | (b[o + 2]! << 8) | b[o + 3]!) >>> 0;
    const type = String.fromCharCode(...b.subarray(o + 4, o + 8));
    let head = 8;
    if (len === 1) {
      if (o + 16 > b.length) throw new Malformed("pdf_jpx");
      len = Number(new DataView(b.buffer, b.byteOffset + o + 8, 8).getBigUint64(0));
      head = 16;
    } else if (len === 0) len = b.length - o;
    if (len < head || o + len > b.length) throw new Malformed("pdf_jpx");
    if (type === "xml " || type === "uuid" || type === "uinf" || type === "jp2i") return true;
    o += len;
  }
  return false;
}

async function imagePatches(src: Src, o: Obj, chain: string[], len: number, budget: Budget): Promise<Patch[]> {
  if (len > STRIP_MAX) throw new Malformed("pdf_image_trop_grosse");
  const start = o.stream!.dataStart;
  const raw = new Uint8Array(await src.bytes(start, len));
  if (raw.length !== len) throw new Malformed("pdf_flux");
  const key = chain.join(" ");
  if (key === "DCTDecode") return jpegInPlace(raw).map((p) => ({ at: start + p.at, bytes: p.bytes }));
  let meta: boolean;
  if (key === "FlateDecode DCTDecode") {
    const parms = (o.value as Map<string, PdfVal>).get("DecodeParms");
    if (parms !== undefined && parms !== null && !(Array.isArray(parms) && parms.every((x) => x === null))) throw new Malformed("pdf_image_filtre");
    meta = jpegInPlace(await inflateBudget(raw, budget)).length > 0;
  } else if (key === "JPXDecode") meta = jpxHasMeta(raw);
  else throw new Malformed("pdf_image_filtre");
  if (meta) throw new Malformed("pdf_image_meta");
  return [];
}

/**
 * Dernier filet : une clé propre à /Info (/Author, /Producer) restée en clair hors des objets
 * neutralisés (révision détachée de la chaîne des /Prev, objet orphelin) → `Malformed` :
 * jamais « Nettoyé » sur un PDF qui garde son auteur lisible.
 */
async function leftovers(src: Src, patches: readonly Patch[]): Promise<void> {
  const keys = ["/Author", "/Producer"].map((k) => [...k].map((c) => c.charCodeAt(0)));
  const covered = (i: number) => patches.some((p) => i >= p.at && i < p.at + p.bytes.length);
  const OVER = 16;
  for (let pos = 0; pos < src.size; pos += WIN - OVER) {
    const b = await src.bytes(pos, WIN);
    for (let i = 0; i < b.length; i++) {
      if (b[i] !== 0x2f) continue;
      for (const k of keys) {
        if (i + k.length > b.length) continue;
        let ok = true;
        for (let j = 1; j < k.length && ok; j++) ok = b[i + j] === k[j];
        const next = b[i + k.length];
        if (ok && (next === undefined || WS.has(next) || DELIM.has(next)) && !covered(pos + i)) throw new Malformed("pdf_info_orpheline");
      }
    }
    if (pos + b.length >= src.size) break;
  }
}

/** Correctifs à appliquer (vide : rien à retirer) ou refus ; `Malformed` sinon. */
export async function cleanPdf(file: Blob): Promise<PdfResult> {
  return analyse(file);
}
