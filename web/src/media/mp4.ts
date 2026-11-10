// Vidéos et audio ISOBMFF : MP4, MOV, M4V, M4A (spec §35.2, Task 9c). Nettoyage EN PLACE, à
// longueur constante : aucune position (stco, co64, sidx, moof) n'est à recalculer.
// - boîtes de premier niveau hors liste blanche (prft, uuid, meta, udta, PICT…) : « free » + zéros ;
//   contenu des free/skip/wide existantes mis à zéro (anciens moov laissés par les éditeurs) ;
// - dans moov, trak et mdia : tout ce qui n'est pas dans la liste blanche (udta, meta, uuid,
//   ©xyz, gps…) devient « free » + zéros ;
// - dates de création et de modification de mvhd, tkhd, mdhd mises à 0 (versions 0 et 1) ;
// - pistes de métadonnées minutées (gestionnaire « meta », codecs mebx, gpmd, camm, rtmd) et
//   pistes timecode (tmcd, heure de la prise) : trak entière en « free » ET ses échantillons
//   mis à zéro dans mdat (positions lues dans stsc, stsz, stco/co64).
// - nom libre des gestionnaires (hdlr de mdia et de minf) et nom de l'encodeur vidéo (stsd,
//   « compressorname ») mis à zéro : ils nomment l'appareil ou le logiciel ;
// Gardés octet pour octet : flux audio et vidéo, matrice de tkhd (rotation), stsd, edts, mvex,
// moof, sidx. Seul moov est lu en mémoire ; mdat jamais.
import { Malformed, ascii, u32be, u64be } from "./bytes";
import { children, fullBox, topLevel, type Box } from "./isobmff";
import type { Patch } from "./patch";

/** moov lu en mémoire au plus (les moov de longues vidéos 4K font quelques dizaines de Mio). */
export const MOOV_MAX = 128 * 1024 * 1024;
/** Au-delà : `echec` (spec §35.2). */
export const PATCH_MAX = 100_000;

const TOP_KEEP: ReadonlySet<string> = new Set(["ftyp", "styp", "moov", "mdat", "moof", "mfra", "sidx", "ssix", "free", "skip", "wide"]);
const TOP_ZERO: ReadonlySet<string> = new Set(["free", "skip", "wide"]);
const MOOV_KEEP: ReadonlySet<string> = new Set(["mvhd", "trak", "mvex", "iods"]);
const TRAK_KEEP: ReadonlySet<string> = new Set(["tkhd", "mdia", "edts", "tref", "tapt"]);
const MDIA_KEEP: ReadonlySet<string> = new Set(["mdhd", "hdlr", "minf", "elng"]);
const DATED: ReadonlySet<string> = new Set(["mvhd", "tkhd", "mdhd"]);
/** Pistes qui ne portent que des métadonnées (position, capteurs, heure de prise). */
const META_HANDLERS: ReadonlySet<string> = new Set(["meta", "tmcd"]);
const META_CODECS: ReadonlySet<string> = new Set(["mebx", "gpmd", "camm", "rtmd", "tmcd"]);

const ZERO = new Uint8Array(1 << 20);
const FREE = [0x66, 0x72, 0x65, 0x65];

/** Zéros de [from, to) du fichier, par morceaux de 1 Mio au plus (un seul tampon partagé). */
function zeros(out: Patch[], from: number, to: number): void {
  for (let o = from; o < to; o += ZERO.length) out.push({ at: o, bytes: ZERO.subarray(0, Math.min(ZERO.length, to - o)) });
}

type Moov = { box: Box; bytes: Uint8Array };

/** Boîte « free » en place dans `m` (copie de moov) : type et contenu, uuid compris. */
function freeIn(m: Uint8Array, base: number, x: Box): void {
  const s = x.start - base;
  m.set(FREE, s + 4);
  // Contenu (et identifiant uuid) à zéro ; une taille 64 bits garde ses 8 octets de taille.
  const body = s + (u32be(m, s) === 1 ? 16 : 8);
  m.fill(0, body, x.end - base);
}

function wipeDates(m: Uint8Array, base: number, x: Box): void {
  const { version, body } = fullBox(m, x, base);
  const n = version === 1 ? 16 : version === 0 ? 8 : -1;
  if (n < 0 || body + n > x.end) throw new Malformed("date");
  m.fill(0, body - base, body - base + n);
}

/**
 * Nom libre du gestionnaire (« GoPro AVC », « Core Media Video », « VideoHandler ») à zéro :
 * il nomme l'appareil ou le logiciel. Le type (vide, soun…) est gardé ; un nom vide est valide
 * (chaîne terminée par zéro en MP4, chaîne Pascal de longueur 0 en MOV).
 */
function wipeHandlerName(m: Uint8Array, base: number, x: Box): void {
  const { body } = fullBox(m, x, base);
  if (body + 20 > x.end) throw new Malformed("hdlr");
  m.fill(0, body + 20 - base, x.end - base);
}

/** Type du gestionnaire d'une piste (« vide », « soun »…), ou "" s'il manque. */
function handlerOf(m: Uint8Array, base: number, mdia: Box): string {
  const h = children(m, mdia.start + mdia.head, mdia.end, base).find((k) => k.type === "hdlr");
  if (!h) return "";
  const { body } = fullBox(m, h, base);
  return ascii(m, body + 4 - base, 4);
}

/**
 * Piste vidéo : les 32 octets « compressorname » de chaque entrée de stsd (« GoPro AVC
 * encoder », « Lavc… libx264 ») à zéro. Champ d'affichage seul, à place fixe (octet 50 de
 * l'entrée, MP4 et MOV) : le décodage n'en dépend pas.
 */
function wipeCompressorNames(m: Uint8Array, base: number, stbl: Box): void {
  const stsd = children(m, stbl.start + stbl.head, stbl.end, base).find((k) => k.type === "stsd");
  if (!stsd) throw new Malformed("stsd");
  const { body } = fullBox(m, stsd, base);
  for (const e of children(m, body + 4, stsd.end, base)) {
    if (e.start + 82 > e.end) throw new Malformed("stsd_entree");
    m.fill(0, e.start + 50 - base, e.start + 82 - base);
  }
}

/** Positions [début, fin) des échantillons d'une piste, regroupés par morceau (chunk). */
function sampleRanges(m: Uint8Array, base: number, stbl: Box): { from: number; to: number }[] {
  const kids = children(m, stbl.start + stbl.head, stbl.end, base);
  const get = (t: string) => kids.find((k) => k.type === t);
  const stsc = get("stsc");
  const stsz = get("stsz");
  const stco = get("stco") ?? get("co64");
  if (!stsc || !stco) throw new Malformed("stbl");
  if (!stsz) throw new Malformed(get("stz2") ? "stz2" : "stbl");
  const wide = stco.type === "co64";
  const co = fullBox(m, stco, base).body - base;
  const nChunks = u32be(m, co);
  const sc = fullBox(m, stsc, base).body - base;
  const nSc = u32be(m, sc);
  const sz = fullBox(m, stsz, base).body - base;
  const fixed = u32be(m, sz);
  const nSamples = u32be(m, sz + 4);
  if (nChunks > PATCH_MAX || nSamples > 10_000_000) throw new Malformed("trop_d_echantillons");
  const out: { from: number; to: number }[] = [];
  let sample = 0;
  for (let e = 0; e < nSc; e++) {
    const first = u32be(m, sc + 4 + e * 12);
    const per = u32be(m, sc + 8 + e * 12);
    const last = e + 1 < nSc ? u32be(m, sc + 4 + (e + 1) * 12) - 1 : nChunks;
    if (first < 1 || last > nChunks || last < first - 1) throw new Malformed("stsc");
    for (let c = first; c <= last; c++) {
      const at = wide ? u64be(m, co + 4 + (c - 1) * 8) : u32be(m, co + 4 + (c - 1) * 4);
      let len = 0;
      for (let i = 0; i < per; i++, sample++) {
        if (sample >= nSamples) throw new Malformed("stsz");
        len += fixed !== 0 ? fixed : u32be(m, sz + 8 + sample * 4);
      }
      if (len > 0) out.push({ from: at, to: at + len });
    }
  }
  if (sample !== nSamples) throw new Malformed("stsz");
  return out;
}

/** Piste de métadonnées ou de timecode (gestionnaire ou codec de la 1re description). */
function isMetaTrack(m: Uint8Array, base: number, mdia: Box): boolean {
  const kids = children(m, mdia.start + mdia.head, mdia.end, base);
  const hdlr = kids.find((k) => k.type === "hdlr");
  if (hdlr && META_HANDLERS.has(ascii(m, fullBox(m, hdlr, base).body - base + 4, 4))) return true;
  const minf = kids.find((k) => k.type === "minf");
  const stbl = minf && children(m, minf.start + minf.head, minf.end, base).find((k) => k.type === "stbl");
  const stsd = stbl && children(m, stbl.start + stbl.head, stbl.end, base).find((k) => k.type === "stsd");
  if (!stsd) return false;
  const b = fullBox(m, stsd, base).body - base;
  return u32be(m, b) > 0 && META_CODECS.has(ascii(m, b + 8, 4));
}

function stblOf(m: Uint8Array, base: number, mdia: Box): Box {
  const minf = children(m, mdia.start + mdia.head, mdia.end, base).find((k) => k.type === "minf");
  const stbl = minf && children(m, minf.start + minf.head, minf.end, base).find((k) => k.type === "stbl");
  if (!stbl) throw new Malformed("stbl");
  return stbl;
}

/** Nettoie la copie de moov ; rend les plages d'échantillons à mettre à zéro dans le fichier. */
function cleanMoov({ box, bytes: m }: Moov, fragmented: boolean): { from: number; to: number }[] {
  const base = box.start;
  const wipe: { from: number; to: number }[] = [];
  const inner = (x: Box) => children(m, x.start + x.head, x.end, base);
  for (const k of inner(box)) {
    if (!MOOV_KEEP.has(k.type)) freeIn(m, base, k);
    else if (k.type === "mvhd") wipeDates(m, base, k);
    else if (k.type === "trak") {
      const tk = inner(k);
      const mdia = tk.find((x) => x.type === "mdia");
      if (!mdia) throw new Malformed("mdia");
      if (isMetaTrack(m, base, mdia)) {
        // Les échantillons d'une piste fragmentée sont dans les moof : non pris en charge.
        if (fragmented) throw new Malformed("piste_meta_fragmentee");
        wipe.push(...sampleRanges(m, base, stblOf(m, base, mdia)));
        freeIn(m, base, k);
        continue;
      }
      for (const t of tk) {
        if (!TRAK_KEEP.has(t.type)) freeIn(m, base, t);
        else if (t.type === "tkhd") wipeDates(m, base, t);
        else if (t.type === "mdia")
          for (const d of inner(t)) {
            if (!MDIA_KEEP.has(d.type)) freeIn(m, base, d);
            else if (DATED.has(d.type)) wipeDates(m, base, d);
            else if (d.type === "hdlr") wipeHandlerName(m, base, d);
            else if (d.type === "minf") {
              for (const h of inner(d)) if (h.type === "hdlr") wipeHandlerName(m, base, h);
              if (handlerOf(m, base, t) === "vide") wipeCompressorNames(m, base, stblOf(m, base, t));
            }
          }
      }
    }
  }
  return wipe;
}

/**
 * Correctifs à longueur constante qui nettoient un fichier ISOBMFF (vidéo ou audio). Liste vide :
 * rien à changer (fichier déjà propre). `Malformed` sur toute structure inattendue.
 */
export async function cleanMp4(file: Blob): Promise<Patch[]> {
  const top = await topLevel(file);
  if (top[0]?.type !== "ftyp") throw new Malformed("ftyp");
  const moovs = top.filter((x) => x.type === "moov");
  if (moovs.length !== 1) throw new Malformed("moov");
  const box = moovs[0]!;
  if (box.end - box.start > MOOV_MAX) throw new Malformed("moov_trop_gros");
  const before = new Uint8Array(await file.slice(box.start, box.end).arrayBuffer());
  const moov: Moov = { box, bytes: before.slice() };
  const wipe = cleanMoov(moov, top.some((x) => x.type === "moof"));

  const out: Patch[] = [];
  for (const x of top) {
    if (x.type === "moov") continue;
    if (!TOP_KEEP.has(x.type)) {
      out.push({ at: x.start + 4, bytes: new Uint8Array(FREE) });
      // Taille (4 ou 4 + 8 octets) gardée ; identifiant uuid et contenu à zéro.
      zeros(out, x.start + x.head - (x.type === "uuid" ? 16 : 0), x.end);
    } else if (TOP_ZERO.has(x.type) && x.end > x.start + x.head) {
      // Ancien contenu d'une free : à zéro seulement s'il n'est pas déjà nul (lecture bornée).
      if (!(await allZero(file, x.start + x.head, x.end))) zeros(out, x.start + x.head, x.end);
    }
  }
  // moov : un seul correctif, seulement s'il a changé.
  if (!sameBytes(before, moov.bytes)) out.push({ at: box.start, bytes: moov.bytes });
  for (const r of wipe) {
    if (r.to > file.size || r.from >= r.to) throw new Malformed("echantillon_hors_fichier");
    if (!(await allZero(file, r.from, r.to))) zeros(out, r.from, r.to);
  }
  if (out.length > PATCH_MAX) throw new Malformed("trop_de_correctifs");
  return out;
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return a.length === b.length;
}

/** Vrai si [from, to) du fichier n'a que des zéros (lecture par tranches de 4 Mio). */
async function allZero(file: Blob, from: number, to: number): Promise<boolean> {
  for (let o = from; o < to; o += 4 << 20) {
    const b = new Uint8Array(await file.slice(o, Math.min(to, o + (4 << 20))).arrayBuffer());
    for (let i = 0; i < b.length; i++) if (b[i] !== 0) return false;
  }
  return true;
}

