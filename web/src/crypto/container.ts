// Paquet chiffré (spécification §7.3) : en-tête en clair + morceaux AES-256-GCM façon STREAM.
import { concat, utf8 } from "./encoding";
import type { ContentKeys } from "./kdf";

export const CHUNK = 65536, TAG = 16, CHUNK_CT = 65552, HEADER = 48, SEG_CHUNKS = 64;
export const BUCKETS = [1, 16, 80, 160, 400, 800, 1600] as const;
const MANIFEST_MAX = 65536;
const MAX_ITEMS = 10;
const TEXT_MAX = 10_000;
const MAGIC = utf8("SHH1");
const VERSION = 1;

export type Item = { kind: "text" | "file"; name: string; mime: string; data: Uint8Array };
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

function header(engagement: Uint8Array): Uint8Array {
  if (engagement.length !== 32) throw new Error("engagement invalide");
  return concat(MAGIC, new Uint8Array([VERSION]), new Uint8Array(11), engagement);
}

// Nonce : indice big-endian sur 11 octets (octets 0..10) + drapeau « dernier morceau ».
function nonce(index: number, last: boolean): Uint8Array {
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

export async function seal(
  items: Item[],
  keys: ContentKeys,
): Promise<{ bucket: number; segments: Uint8Array[] }> {
  if (items.length === 0) throw new Error("vide");
  if (items.length > MAX_ITEMS) throw new Error("trop_d_elements");

  const entries: ManifestEntry[] = [];
  const data: Uint8Array[] = [];
  let offset = 0;
  for (const it of items) {
    if (it.kind === "text") {
      let text: string;
      try {
        text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(it.data);
      } catch {
        throw new Error("texte_invalide");
      }
      if (codePoints(text) > TEXT_MAX) throw new Error("texte_trop_long");
      entries.push({ kind: "text", name: it.name, mime: it.mime, size: 0, offset: 0, text });
    } else {
      entries.push({ kind: "file", name: it.name, mime: it.mime, size: it.data.length, offset });
      data.push(it.data);
      offset += it.data.length;
    }
  }
  const manifest = utf8(JSON.stringify({ v: 1, items: entries } satisfies Manifest));
  if (manifest.length > MANIFEST_MAX) throw new Error("manifeste_trop_gros");
  const len = new Uint8Array(4);
  new DataView(len.buffer).setUint32(0, manifest.length);
  const parts = [len, manifest, ...data];

  const bucket = bucketFor(4 + manifest.length + offset);
  const hdr = header(keys.engagement);
  const segments = Array.from({ length: segmentCount(bucket) }, (_, n) => new Uint8Array(segmentSize(bucket, n)));
  segments[0]!.set(hdr);

  // Remplit chaque morceau de 64 Kio à partir des parties, puis de zéros (bourrage).
  const chunk = new Uint8Array(CHUNK);
  let p = 0;
  let pOff = 0;
  for (let i = 0; i < bucket; i++) {
    chunk.fill(0);
    let filled = 0;
    while (filled < CHUNK && p < parts.length) {
      const part = parts[p]!;
      const n = Math.min(CHUNK - filled, part.length - pOff);
      chunk.set(part.subarray(pOff, pOff + n), filled);
      filled += n;
      pOff += n;
      if (pOff === part.length) {
        p++;
        pOff = 0;
      }
    }
    const ct = new Uint8Array(
      await crypto.subtle.encrypt(
        { name: "AES-GCM", iv: nonce(i, i === bucket - 1), additionalData: hdr, tagLength: 128 },
        keys.kContenu,
        chunk,
      ),
    );
    const seg = Math.floor(i / SEG_CHUNKS);
    segments[seg]!.set(ct, (seg === 0 ? HEADER : 0) + (i % SEG_CHUNKS) * CHUNK_CT);
  }
  chunk.fill(0);
  return { bucket, segments };
}

function corrupt(): Error {
  return new Error("paquet_corrompu");
}

const isNat = (x: unknown): x is number => Number.isSafeInteger(x) && (x as number) >= 0;

function parseManifest(raw: Uint8Array, dataLen: number): Manifest {
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

export async function open(
  segments: Uint8Array[],
  keys: ContentKeys,
): Promise<{ manifest: Manifest; item(i: number): Uint8Array }> {
  // 1. Tailles : le palier se déduit de la taille totale et doit être un palier connu.
  const total = segments.reduce((n, s) => n + s.length, 0);
  const bucket = (total - HEADER) / CHUNK_CT;
  if (!(BUCKETS as readonly number[]).includes(bucket) || segments.length !== segmentCount(bucket)) throw corrupt();
  segments.forEach((s, n) => {
    if (s.length !== segmentSize(bucket, n)) throw corrupt();
  });

  // 2. En-tête et engagement, avant tout déchiffrement.
  const hdr = segments[0]!.slice(0, HEADER);
  if (keys.engagement.length !== 32) throw corrupt();
  const expected = header(keys.engagement);
  let diff = 0;
  for (let i = 0; i < HEADER; i++) diff |= hdr[i]! ^ expected[i]!;
  if (diff !== 0) throw corrupt();

  // 3. Déchiffrement morceau par morceau.
  const plain = new Uint8Array(bucket * CHUNK);
  for (let i = 0; i < bucket; i++) {
    const seg = Math.floor(i / SEG_CHUNKS);
    const start = (seg === 0 ? HEADER : 0) + (i % SEG_CHUNKS) * CHUNK_CT;
    let pt: ArrayBuffer;
    try {
      pt = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: nonce(i, i === bucket - 1), additionalData: hdr, tagLength: 128 },
        keys.kContenu,
        segments[seg]!.subarray(start, start + CHUNK_CT),
      );
    } catch {
      plain.fill(0);
      throw corrupt();
    }
    plain.set(new Uint8Array(pt), i * CHUNK);
  }

  // 4. Manifeste.
  const mlen = new DataView(plain.buffer).getUint32(0);
  if (mlen > MANIFEST_MAX || 4 + mlen > plain.length) throw corrupt();
  const dataStart = 4 + mlen;
  const manifest = parseManifest(plain.subarray(4, dataStart), plain.length - dataStart);

  return {
    manifest,
    item(i: number): Uint8Array {
      const e = manifest.items[i];
      if (!Number.isInteger(i) || e === undefined) throw new Error("element_inexistant");
      if (e.kind === "text") return utf8(e.text!);
      return plain.slice(dataStart + e.offset, dataStart + e.offset + e.size);
    },
  };
}
