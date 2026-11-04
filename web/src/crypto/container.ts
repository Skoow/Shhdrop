// Paquet chiffré (spécification §7.3) : en-tête en clair + morceaux AES-256-GCM façon STREAM.
import { concat, utf8 } from "./encoding";
import type { ContentKeys } from "./kdf";

export const CHUNK = 65536, TAG = 16, CHUNK_CT = 65552, HEADER = 48, SEG_CHUNKS = 64;
/** Paliers en morceaux de 64 Kio : de 64 Kio à 1 Gio utile (spec §24). */
export const BUCKETS = [1, 16, 80, 160, 400, 800, 1600, 4000, 8000, 16384] as const;
/** Au-delà, pas d'aperçu sur le site : téléchargement en flux seulement (spec §24). */
export const PREVIEW_MAX = 200 * 1048576;
const MANIFEST_MAX = 65536;
const MAX_ITEMS = 10;
const TEXT_MAX = 10_000;
const TEXT_BYTES_MAX = 4 * TEXT_MAX; // un point de code UTF-8 fait au plus 4 octets
const MAGIC = utf8("SHH1");
const VERSION = 1;

/** Élément à chiffrer. Un fichier (File est un Blob) n'est jamais lu en entier en mémoire. */
export type Item = { kind: "text" | "file"; name: string; mime: string; data: Uint8Array<ArrayBuffer> | Blob };
export type ManifestEntry = {
  kind: "text" | "file";
  name: string;
  mime: string;
  size: number;
  offset: number;
  text?: string;
};
export type Manifest = { v: 1; items: ManifestEntry[] };

export function bucketFor(plainLen: number): number {
  if (!Number.isSafeInteger(plainLen) || plainLen < 0) throw new Error("taille_invalide");
  for (const b of BUCKETS) if (plainLen <= b * CHUNK) return b;
  throw new Error("trop_gros");
}

export function segmentCount(bucket: number): number {
  return Math.ceil(bucket / SEG_CHUNKS);
}

export function segmentSize(bucket: number, n: number): number {
  const chunks = Math.min(SEG_CHUNKS, bucket - n * SEG_CHUNKS);
  return (n === 0 ? HEADER : 0) + chunks * CHUNK_CT;
}

function header(engagement: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
  if (engagement.length !== 32) throw new Error("engagement invalide");
  return concat(MAGIC, new Uint8Array([VERSION]), new Uint8Array(11), engagement);
}

// Nonce : indice big-endian sur 11 octets (octets 0..10) + drapeau « dernier morceau ».
function nonce(index: number, last: boolean): Uint8Array<ArrayBuffer> {
  const iv = new Uint8Array(12);
  let x = index;
  for (let i = 10; i >= 0 && x > 0; i--) {
    iv[i] = x % 256;
    x = Math.floor(x / 256);
  }
  iv[11] = last ? 1 : 0;
  return iv;
}

const codePoints = (s: string) => [...s].length;

// Une K_contenu ne chiffre qu'un seul paquet : les nonces (numéros de morceau) repartent
// de zéro à chaque paquet, donc deux paquets sous la même clé réutiliseraient des nonces
// AES-GCM. La clé est marquée juste avant de rendre le scelleur (les refus de validation
// ne la consomment pas) ; segment(n) peut ensuite être rappelé : même clé, même nonce et
// même clair (les Uint8Array sont copiés dans un Blob, immuable), donc mêmes octets.
// Limite : la garde reconnaît l'objet CryptoKey, pas la matière de la clé ; une même clé
// importée deux fois donnerait deux objets distincts. Ce qui garantit vraiment l'unicité
// des nonces, c'est que createShare tire une K_lien et un sel neufs à chaque partage
// (donc une K_contenu neuve) ; cette garde n'est qu'un filet contre une erreur de code.
const usedKeys = new WeakSet<CryptoKey>();

export type Sealer = {
  bucket: number;
  segmentCount: number;
  /** Chiffre, à la demande, exactement les morceaux du segment n. */
  segment(n: number): Promise<Uint8Array<ArrayBuffer>>;
};

/**
 * Prépare le paquet : manifeste calculé d'après les tailles, palier, en-tête. Rien n'est
 * chiffré ni lu avant segment(n), qui lit les fichiers par tranches (Blob.slice) : un seul
 * segment chiffré et un morceau en clair à la fois en mémoire.
 * Si `data` est un File, il ne doit pas changer pendant l'envoi (le navigateur refuse
 * alors la lecture : NotReadableError).
 */
export async function sealStream(items: Item[], keys: ContentKeys): Promise<Sealer> {
  if (items.length === 0) throw new Error("vide");
  if (items.length > MAX_ITEMS) throw new Error("trop_d_elements");

  const entries: ManifestEntry[] = [];
  const files: { start: number; blob: Blob }[] = []; // start : position dans le clair, après le manifeste
  let offset = 0;
  for (const it of items) {
    if (it.kind === "text") {
      let raw: Uint8Array<ArrayBuffer>;
      if (it.data instanceof Uint8Array) raw = it.data;
      else if (it.data.size > TEXT_BYTES_MAX) throw new Error("texte_trop_long");
      else raw = new Uint8Array(await it.data.arrayBuffer());
      let text: string;
      try {
        text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(raw);
      } catch {
        throw new Error("texte_invalide");
      }
      if (codePoints(text) > TEXT_MAX) throw new Error("texte_trop_long");
      entries.push({ kind: "text", name: it.name, mime: it.mime, size: 0, offset: 0, text });
    } else {
      // Copie d'un Uint8Array dans un Blob : l'appelant ne peut plus le modifier entre deux segment(n).
      const blob = it.data instanceof Uint8Array ? new Blob([it.data]) : it.data;
      const size = blob.size;
      if (!Number.isSafeInteger(size) || size < 0) throw new Error("taille_invalide");
      entries.push({ kind: "file", name: it.name, mime: it.mime, size, offset });
      files.push({ start: offset, blob });
      offset += size;
    }
  }
  const manifest = utf8(JSON.stringify({ v: 1, items: entries } satisfies Manifest));
  if (manifest.length > MANIFEST_MAX) throw new Error("manifeste_trop_gros");
  const prefix = new Uint8Array(4 + manifest.length);
  new DataView(prefix.buffer).setUint32(0, manifest.length);
  prefix.set(manifest, 4);
  for (const f of files) f.start += prefix.length;

  const bucket = bucketFor(prefix.length + offset);
  const hdr = header(keys.engagement);
  if (usedKeys.has(keys.kContenu)) throw new Error("cle_deja_utilisee");
  usedKeys.add(keys.kContenu);
  const count = segmentCount(bucket);

  // Clair du morceau i : manifeste, puis fichiers, puis zéros (bourrage).
  async function fill(chunk: Uint8Array<ArrayBuffer>, i: number): Promise<void> {
    chunk.fill(0);
    const a = i * CHUNK, b = a + CHUNK;
    if (a < prefix.length) chunk.set(prefix.subarray(a, Math.min(b, prefix.length)));
    for (const f of files) {
      const lo = Math.max(a, f.start), hi = Math.min(b, f.start + f.blob.size);
      if (lo >= hi) continue;
      const part = new Uint8Array(await f.blob.slice(lo - f.start, hi - f.start).arrayBuffer());
      if (part.length !== hi - lo) throw new Error("lecture_incomplete");
      chunk.set(part, lo - a);
      part.fill(0);
    }
  }

  return {
    bucket,
    segmentCount: count,
    async segment(n: number): Promise<Uint8Array<ArrayBuffer>> {
      if (!Number.isInteger(n) || n < 0 || n >= count) throw new Error("segment_invalide");
      const out = new Uint8Array(segmentSize(bucket, n));
      if (n === 0) out.set(hdr);
      const chunk = new Uint8Array(CHUNK);
      try {
        const first = n * SEG_CHUNKS, end = Math.min(bucket, first + SEG_CHUNKS);
        for (let i = first; i < end; i++) {
          await fill(chunk, i);
          const ct = await crypto.subtle.encrypt(
            { name: "AES-GCM", iv: nonce(i, i === bucket - 1), additionalData: hdr, tagLength: 128 },
            keys.kContenu,
            chunk,
          );
          out.set(new Uint8Array(ct), (n === 0 ? HEADER : 0) + (i - first) * CHUNK_CT);
        }
      } finally {
        chunk.fill(0);
      }
      return out;
    },
  };
}

function corrupt(): Error {
  return new Error("paquet_corrompu");
}

const isNat = (x: unknown): x is number => Number.isSafeInteger(x) && (x as number) >= 0;

function parseManifest(raw: Uint8Array<ArrayBuffer>, dataLen: number): Manifest {
  let m: unknown;
  try {
    m = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw));
  } catch {
    throw corrupt();
  }
  if (typeof m !== "object" || m === null) throw corrupt();
  const { v, items } = m as { v?: unknown; items?: unknown };
  if (v !== 1 || !Array.isArray(items) || items.length === 0 || items.length > MAX_ITEMS) throw corrupt();
  const out: ManifestEntry[] = [];
  for (const e of items as unknown[]) {
    if (typeof e !== "object" || e === null) throw corrupt();
    const { kind, name, mime, size, offset, text } = e as Record<string, unknown>;
    if (typeof name !== "string" || typeof mime !== "string" || !isNat(size) || !isNat(offset)) throw corrupt();
    if (kind === "text") {
      if (typeof text !== "string" || size !== 0 || offset !== 0 || codePoints(text) > TEXT_MAX) throw corrupt();
      out.push({ kind, name, mime, size, offset, text });
    } else if (kind === "file") {
      if (text !== undefined || offset > dataLen || size > dataLen - offset) throw corrupt();
      out.push({ kind, name, mime, size, offset });
    } else {
      throw corrupt();
    }
  }
  return { v: 1, items: out };
}

export type ContainerReader = {
  manifest: Manifest;
  /** Copie de l'élément i, pour l'aperçu ; refusé au-delà de PREVIEW_MAX (« trop_gros_pour_apercu »). */
  item(i: number): Promise<Uint8Array<ArrayBuffer>>;
  /**
   * Déchiffre l'élément i morceau par morceau et passe chaque tranche à `sink`, dans l'ordre.
   * Chaque tranche est une copie que `sink` garde s'il veut ; en cas d'erreur (paquet_corrompu),
   * ce qui a déjà été livré doit être jeté par l'appelant.
   */
  streamItem(i: number, sink: (chunk: Uint8Array<ArrayBuffer>) => Promise<void> | void): Promise<void>;
  /** Met à zéro le segment en cache. */
  wipe(): void;
};

/**
 * Ouvre un paquet en flux. `bucket` vient du serveur (meta) : il est vérifié contre la
 * taille des segments, le drapeau « dernier morceau » et le manifeste authentifié (le
 * palier doit être celui que seal aurait choisi). L'en-tête et l'engagement sont vérifiés
 * sur le segment 0 avant tout déchiffrement. Un seul segment chiffré est gardé en cache.
 * Les morceaux jamais lus (bourrage) ne sont pas vérifiés : ils ne contiennent rien.
 */
export async function openStream(
  fetchSegment: (n: number) => Promise<Uint8Array>,
  bucket: number,
  keys: ContentKeys,
): Promise<ContainerReader> {
  if (!(BUCKETS as readonly number[]).includes(bucket) || keys.engagement.length !== 32) throw corrupt();
  const hdr = header(keys.engagement);

  let cache: { n: number; data: Uint8Array<ArrayBuffer> } | null = null;
  const wipe = () => {
    cache?.data.fill(0);
    cache = null;
  };
  async function seg(n: number): Promise<Uint8Array<ArrayBuffer>> {
    if (cache?.n === n) return cache.data;
    wipe();
    const raw = await fetchSegment(n);
    const data = raw.buffer instanceof ArrayBuffer ? (raw as Uint8Array<ArrayBuffer>) : new Uint8Array(raw);
    if (data.length !== segmentSize(bucket, n)) throw corrupt();
    cache = { n, data };
    return data;
  }
  async function chunk(i: number): Promise<Uint8Array<ArrayBuffer>> {
    const n = Math.floor(i / SEG_CHUNKS);
    const s = await seg(n);
    const start = (n === 0 ? HEADER : 0) + (i % SEG_CHUNKS) * CHUNK_CT;
    try {
      // decrypt copie ses entrées dès l'appel : le cache peut changer ensuite.
      return new Uint8Array(
        await crypto.subtle.decrypt(
          { name: "AES-GCM", iv: nonce(i, i === bucket - 1), additionalData: hdr, tagLength: 128 },
          keys.kContenu,
          s.subarray(start, start + CHUNK_CT),
        ),
      );
    } catch {
      throw corrupt();
    }
  }

  try {
    return await reader();
  } catch (e) {
    wipe();
    throw e;
  }

  async function reader(): Promise<ContainerReader> {
    // 1. En-tête et engagement, avant tout déchiffrement.
    const s0 = await seg(0);
    let diff = 0;
    for (let i = 0; i < HEADER; i++) diff |= s0[i]! ^ hdr[i]!;
    if (diff !== 0) throw corrupt();

    // 2. Manifeste (morceaux 0 et, s'il déborde, 1).
    const c0 = await chunk(0);
    const mlen = new DataView(c0.buffer).getUint32(0);
    const dataStart = 4 + mlen;
    if (mlen > MANIFEST_MAX || dataStart > bucket * CHUNK) {
      c0.fill(0);
      throw corrupt();
    }
    const c1 = dataStart > CHUNK ? await chunk(1) : new Uint8Array(0);
    const head = concat(c0, c1);
    c0.fill(0);
    c1.fill(0);
    let manifest: Manifest;
    try {
      manifest = parseManifest(head.subarray(4, dataStart), bucket * CHUNK - dataStart);
    } finally {
      head.fill(0);
    }
    // 3. Palier canonique : un serveur ne peut pas annoncer un autre palier que celui du paquet.
    const dataEnd = Math.max(0, ...manifest.items.map((e) => e.offset + e.size));
    if (bucketFor(dataStart + dataEnd) !== bucket) throw corrupt();

    function entry(i: number): ManifestEntry {
      const e = manifest.items[i];
      if (!Number.isInteger(i) || e === undefined) throw new Error("element_inexistant");
      return e;
    }
    // Passe à `out` les tranches du clair [a, a + len), morceau par morceau.
    async function range(a: number, len: number, out: (part: Uint8Array<ArrayBuffer>, pos: number) => Promise<void> | void) {
      for (let pos = 0; pos < len; ) {
        const i = Math.floor((a + pos) / CHUNK);
        const pt = await chunk(i);
        const lo = a + pos - i * CHUNK;
        const n = Math.min(CHUNK - lo, len - pos);
        const part = pt.slice(lo, lo + n);
        pt.fill(0);
        await out(part, pos);
        pos += n;
      }
    }

    return {
      manifest,
      async item(i) {
        const e = entry(i);
        if (e.kind === "text") return utf8(e.text!);
        if (e.size > PREVIEW_MAX) throw new Error("trop_gros_pour_apercu");
        const res = new Uint8Array(e.size);
        try {
          await range(dataStart + e.offset, e.size, (part, pos) => {
            res.set(part, pos);
            part.fill(0);
          });
        } catch (err) {
          res.fill(0);
          throw err;
        }
        return res;
      },
      async streamItem(i, sink) {
        const e = entry(i);
        if (e.kind === "text") {
          const t = utf8(e.text!);
          if (t.length > 0) await sink(t);
          return;
        }
        await range(dataStart + e.offset, e.size, (part) => sink(part));
      },
      wipe,
    };
  }
}
