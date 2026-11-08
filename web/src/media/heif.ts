// HEIC / HEIF / AVIF (spec §35.2, Q-MD2) : nettoyage en place, à longueur constante (aucun
// octet ne bouge, donc `iloc` reste juste). Données de l'élément `Exif` : EXIF vide valide
// (18 octets) puis zéros ; élément XMP : paquet XMP vide puis espaces ; propriété `udes`
// (titre, description, mots-clés) et boîtes hors liste renommées `free` et mises à zéro ;
// contenu des `free`/`skip` mis à zéro. L'orientation de HEIF est dans `irot`/`imir` (gardés).
// `iloc` méthode 2, extent hors fichier ou partagé avec une image, `moov` (suites d'images,
// pas encore traitées), protection (`ipro`) : échec.
import { Malformed, ascii, concat, u16be, u32be, uNbe, u8 } from "./bytes";
import { emptyTiff } from "./exif";
import { children, fullBox, topLevel, type Box } from "./isobmff";
import type { Patch } from "./patch";

const TOP = new Set(["ftyp", "meta", "mdat", "free", "skip"]);
const META = new Set(["hdlr", "pitm", "iloc", "iinf", "iref", "iprp", "idat", "dinf", "grpl", "free", "skip"]);
/** `meta` lue en entier au plus (en pratique quelques Kio). */
const META_MAX = 8 * 1024 * 1024;
/** Octets d'EXIF, de XMP et de boîtes neutralisées au plus. */
const PATCH_MAX = 32 * 1024 * 1024;
const FREE = [0x66, 0x72, 0x65, 0x65];
export const EMPTY_XMP = '<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/"/><?xpacket end="w"?>';

type Extent = { at: number; len: number };
type Item = { id: number; type: string; contentType: string };

function cstring(b: Uint8Array, o: number, end: number): { s: string; next: number } {
  let i = o;
  while (i < end && b[i] !== 0) i++;
  if (i >= end) return { s: ascii(b, o, end - o), next: end }; // dernière chaîne sans zéro final : tolérée
  return { s: ascii(b, o, i - o), next: i + 1 };
}

function items(m: Uint8Array, iinf: Box, base: number): Item[] {
  const { version, body } = fullBox(m, iinf, base);
  const first = body - base + (version === 0 ? 2 : 4);
  const out: Item[] = [];
  for (const e of children(m, first + base, iinf.end, base)) {
    if (e.type !== "infe") continue;
    const f = fullBox(m, e, base);
    if (f.version < 2) throw new Malformed("infe_ancien");
    let o = f.body - base;
    const id = f.version === 2 ? u16be(m, o) : u32be(m, o);
    o += f.version === 2 ? 2 : 4;
    o += 2; // protection_index
    const type = ascii(m, o, 4);
    const name = cstring(m, o + 4, e.end - base);
    const contentType = type === "mime" ? cstring(m, name.next, e.end - base).s : "";
    out.push({ id, type, contentType });
  }
  return out;
}

function locations(m: Uint8Array, iloc: Box, base: number, idatAt: number | null): Map<number, { method: number; extents: Extent[] }> {
  const { version, body } = fullBox(m, iloc, base);
  if (version > 2) throw new Malformed("iloc_version");
  let o = body - base;
  const a = u8(m, o), c = u8(m, o + 1);
  const offSize = a >> 4, lenSize = a & 15, baseSize = c >> 4, idxSize = version > 0 ? c & 15 : 0;
  o += 2;
  const count = version < 2 ? u16be(m, o) : u32be(m, o);
  o += version < 2 ? 2 : 4;
  const out = new Map<number, { method: number; extents: Extent[] }>();
  for (let i = 0; i < count; i++) {
    const id = version < 2 ? u16be(m, o) : u32be(m, o);
    o += version < 2 ? 2 : 4;
    let method = 0;
    if (version > 0) {
      method = u16be(m, o) & 15;
      o += 2;
    }
    const dref = u16be(m, o);
    const baseOff = uNbe(m, o + 2, baseSize);
    o += 2 + baseSize;
    const n = u16be(m, o);
    o += 2;
    const extents: Extent[] = [];
    for (let k = 0; k < n; k++) {
      if (idxSize) {
        uNbe(m, o, idxSize); // extent_index : lu pour ses bornes, sans usage ici
        o += idxSize;
      }
      const off = uNbe(m, o, offSize);
      const len = uNbe(m, o + offSize, lenSize);
      o += offSize + lenSize;
      const origin = method === 1 ? idatAt : 0;
      extents.push({ at: origin === null ? -1 : origin + baseOff + off, len });
    }
    if (o > iloc.end - base) throw new Malformed("iloc");
    if (dref !== 0 && method === 0) method = -1; // données dans un autre fichier
    out.set(id, { method, extents });
  }
  return out;
}

function fill(len: number, prefix: Uint8Array, pad: number): Uint8Array {
  const b = new Uint8Array(len).fill(pad);
  if (prefix.length <= len) b.set(prefix);
  return b;
}

/** Correctifs à appliquer pour nettoyer `blob` (vide : déjà propre). */
export async function cleanHeif(blob: Blob): Promise<Patch[]> {
  const top = await topLevel(blob);
  if (top[0]?.type !== "ftyp") throw new Malformed("heif_ftyp");
  const metas = top.filter((x) => x.type === "meta");
  if (metas.length !== 1) throw new Malformed("heif_meta");
  const patches: Patch[] = [];
  let budget = 0;
  const add = (p: Patch) => {
    budget += p.bytes.length;
    if (budget > PATCH_MAX) throw new Malformed("heif_trop_de_correctifs");
    patches.push(p);
  };
  /** Boîte rendue `free` (si besoin) et contenu mis à zéro (s'il ne l'est pas déjà). */
  const neutralize = async (x: Box, cur?: Uint8Array) => {
    if (x.end - x.start > PATCH_MAX) throw new Malformed("heif_boite_trop_grande");
    const all = cur ?? new Uint8Array(await blob.slice(x.start, x.end).arrayBuffer());
    // Taille gardée, type « free » ; l'identifiant d'une boîte `uuid` est mis à zéro avec le contenu.
    if (ascii(all, 4, 4) !== "free") add({ at: x.start + 4, bytes: new Uint8Array(FREE) });
    const h = x.head - (x.type === "uuid" ? 16 : 0);
    const content = all.subarray(h);
    if (content.some((v) => v !== 0)) add({ at: x.start + h, bytes: new Uint8Array(content.length) });
  };

  for (const x of top) {
    if (x.type === "moov") throw new Malformed("heif_moov");
    if (!TOP.has(x.type) || x.type === "free" || x.type === "skip") await neutralize(x);
  }
  const meta = metas[0]!;
  if (meta.end - meta.start > META_MAX) throw new Malformed("heif_meta_trop_grande");
  const m = new Uint8Array(await blob.slice(meta.start, meta.end).arrayBuffer());
  const base = meta.start;
  const mf = fullBox(m, meta, base);
  const kids = children(m, mf.body, meta.end, base);
  const hdlr = kids.find((k) => k.type === "hdlr");
  if (!hdlr || ascii(m, fullBox(m, hdlr, base).body - base + 4, 4) !== "pict") throw new Malformed("heif_hdlr");
  if (kids.some((k) => k.type === "ipro")) throw new Malformed("heif_protege");
  for (const k of kids) if (!META.has(k.type) || k.type === "free" || k.type === "skip") await neutralize(k, m.subarray(k.start - base, k.end - base));
  const iinf = kids.find((k) => k.type === "iinf");
  const iloc = kids.find((k) => k.type === "iloc");
  const idat = kids.find((k) => k.type === "idat");
  const list = iinf ? items(m, iinf, base) : [];
  const locs = iloc ? locations(m, iloc, base, idat ? idat.start + idat.head : null) : new Map();
  const targets = list.filter((i) => i.type === "Exif" || (i.type === "mime" && i.contentType.trim().toLowerCase() === "application/rdf+xml"));
  const others = [...locs.entries()].filter(([id]) => !targets.some((t) => t.id === id)).flatMap(([, l]) => l.extents);
  for (const t of targets) {
    const loc = locs.get(t.id);
    if (!loc) throw new Malformed("heif_sans_place");
    if (loc.method !== 0 && loc.method !== 1) throw new Malformed("heif_iloc_methode");
    let total = 0;
    for (const e of loc.extents) {
      if (e.at < 0 || e.len <= 0 || e.at + e.len > blob.size) throw new Malformed("heif_extent");
      if (loc.method === 1 && (e.at < idat!.start + idat!.head || e.at + e.len > idat!.end)) throw new Malformed("heif_idat");
      if (others.some((x) => x.at < e.at + e.len && e.at < x.at + (x.len || blob.size))) throw new Malformed("heif_partage");
      total += e.len;
    }
    const want = t.type === "Exif" ? fill(total, concat([new Uint8Array(4), emptyTiff()]), 0) : fill(total, new TextEncoder().encode(EMPTY_XMP), 0x20);
    let o = 0;
    for (const e of loc.extents) {
      const cur = new Uint8Array(await blob.slice(e.at, e.at + e.len).arrayBuffer());
      const next = want.subarray(o, o + e.len);
      if (cur.some((v, i) => v !== next[i])) add({ at: e.at, bytes: next });
      o += e.len;
    }
  }
  // Propriétés : `udes` (titre, description, mots-clés) neutralisée.
  const iprp = kids.find((k) => k.type === "iprp");
  if (iprp) {
    const ipco = children(m, iprp.start + iprp.head, iprp.end, base).find((k) => k.type === "ipco");
    if (ipco) for (const p of children(m, ipco.start + ipco.head, ipco.end, base)) if (p.type === "udes") await neutralize(p, m.subarray(p.start - base, p.end - base));
  }
  return patches.sort((a, b) => a.at - b.at);
}
