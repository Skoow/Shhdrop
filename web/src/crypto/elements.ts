// Envoi dès l'ajout (spec §41.14, D41-19) : chaque fichier est chiffré sous sa propre clé
// K_élément = HKDF(k, « shhdrop/v2/element ») et occupe des segments entiers à partir d'une
// frontière de segment ; au clic, le manifeste (clés des seuls éléments gardés) est chiffré
// sous K_contenu = HKDF(R) dans le dernier morceau du palier final, et l'en-tête « SHH2 » est
// produit. Mêmes morceaux, nonces et segments que le paquet v2 (§29.3) ; aucune construction
// nouvelle (HKDF-SHA-256, AES-256-GCM de WebCrypto).
import {
  BUCKETS,
  CHUNK,
  CHUNK_CT,
  ELEMENT_AD,
  HEADER,
  MANIFEST_MAX,
  SEG_CHUNKS,
  TEXT_MAX,
  bucketFor,
  elementKey,
  header,
  nonce,
  type KeepTtl,
  type ManifestEntry,
  type ManifestV2,
  type Rights,
} from "./container";
import { b64u, utf8 } from "./encoding";
import type { ContentKeys } from "./envelope";
import { randomBytes } from "./kdf";

/** Clair d'un segment de transport : 64 morceaux de 64 Kio (4 Mio). */
export const SEG_PLAIN = SEG_CHUNKS * CHUNK;
/** Segments de données au plus : 2 Gio (le plus grand palier garde un morceau pour le manifeste). */
export const DATA_SEGMENTS = Math.floor((BUCKETS[BUCKETS.length - 1] - 1) / SEG_CHUNKS);

/** Segments entiers occupés par un fichier de `size` octets (0 pour un fichier vide). */
export function segmentsFor(size: number): number {
  if (!Number.isSafeInteger(size) || size < 0) throw new Error("taille_invalide");
  return Math.ceil(size / SEG_PLAIN);
}

/**
 * Plus petit palier qui contient `used` segments de données pleins suivis du morceau du
 * manifeste : réservation d'un brouillon (segments 0 à used − 1 tous pleins).
 */
export function reservationFor(used: number): number {
  if (!Number.isSafeInteger(used) || used < 0 || used > DATA_SEGMENTS) throw new Error("trop_gros");
  for (const b of BUCKETS) if (b >= used * SEG_CHUNKS + 1) return b;
  throw new Error("trop_gros");
}

export type ElementSealer = {
  /** Graine de la clé (32 octets) : n'entre que dans le manifeste chiffré, si l'élément est gardé. */
  k: Uint8Array<ArrayBuffer>;
  segments: number;
  /**
   * Chiffre le j-ième segment de l'élément (segment first + j du paquet), une seule fois :
   * un nouvel essai d'envoi renvoie les octets gardés par l'appelant. 64 morceaux pleins
   * (zéros chiffrés après la fin du fichier) ; au segment 0, 48 octets nuls d'abord (en-tête
   * écrit par le serveur à la finalisation).
   */
  segment(j: number): Promise<Uint8Array<ArrayBuffer>>;
};

/**
 * Prépare l'élément `blob` placé au segment `first`. Clé neuve à chaque appel : un nouvel
 * essai (« Réessayer ») ou une nouvelle place ne réutilise jamais un nonce sous une clé.
 * Le Blob est lu par tranches (un morceau à la fois) ; un File modifié depuis l'ajout fait
 * échouer la lecture (NotReadableError).
 */
export async function elementSealer(blob: Blob, first: number): Promise<ElementSealer> {
  const segments = segmentsFor(blob.size);
  if (!Number.isSafeInteger(first) || first < 0 || first + segments > DATA_SEGMENTS) throw new Error("trop_gros");
  const k = randomBytes(32);
  const key = await elementKey(k);
  const produced = new Set<number>();
  return {
    k,
    segments,
    async segment(j: number): Promise<Uint8Array<ArrayBuffer>> {
      if (!Number.isInteger(j) || j < 0 || j >= segments) throw new Error("segment_invalide");
      if (produced.has(j)) throw new Error("segment_deja_produit");
      produced.add(j);
      const n = first + j;
      const pre = n === 0 ? HEADER : 0;
      const out = new Uint8Array(pre + SEG_CHUNKS * CHUNK_CT);
      const chunk = new Uint8Array(CHUNK);
      try {
        for (let c = 0; c < SEG_CHUNKS; c++) {
          chunk.fill(0);
          const lo = (j * SEG_CHUNKS + c) * CHUNK;
          if (lo < blob.size) {
            const part = new Uint8Array(await blob.slice(lo, Math.min(blob.size, lo + CHUNK)).arrayBuffer());
            if (part.length !== Math.min(CHUNK, blob.size - lo)) throw new Error("lecture_incomplete");
            chunk.set(part);
            part.fill(0);
          }
          const ct = await crypto.subtle.encrypt(
            { name: "AES-GCM", iv: nonce(n * SEG_CHUNKS + c, false), additionalData: ELEMENT_AD, tagLength: 128 },
            key,
            chunk,
          );
          out.set(new Uint8Array(ct), pre + c * CHUNK_CT);
        }
      } finally {
        chunk.fill(0);
      }
      return out;
    },
  };
}

export type FinalEntry =
  | { kind: "text"; name: string; mime: string; text: string }
  | { kind: "file"; name: string; mime: string; size: number; firstSeg: number; k: Uint8Array<ArrayBuffer> };

// Une K_contenu ne chiffre qu'un manifeste : une nouvelle finalisation tire une R neuve.
const usedKeys = new WeakSet<CryptoKey>();

/**
 * Manifeste des éléments gardés, dans l'ordre donné (ordre d'affichage), palier final
 * canonique, en-tête et morceau chiffré du manifeste (dernier morceau du palier, sous
 * K_contenu, drapeau « dernier »). Refus : « vide », « manifeste_trop_gros »,
 * « texte_trop_long », « trop_gros », « chevauchement ».
 */
export async function sealFinal(
  entries: FinalEntry[],
  keys: ContentKeys,
  opts: { rights?: Rights; keepTtlH?: KeepTtl },
): Promise<{ bucket: number; header: Uint8Array<ArrayBuffer>; tail: Uint8Array<ArrayBuffer> }> {
  if (entries.length === 0) throw new Error("vide");
  const rights = opts.rights ?? "enregistrer";
  if ((rights === "coffre") !== (opts.keepTtlH !== undefined)) throw new Error("droits_invalides");
  const items: ManifestEntry[] = [];
  const taken = new Set<number>();
  let dataEnd = 0;
  for (const e of entries) {
    if (e.kind === "text") {
      if ([...e.text].length > TEXT_MAX) throw new Error("texte_trop_long");
      items.push({ kind: "text", name: e.name, mime: e.mime, size: 0, offset: 0, text: e.text });
      continue;
    }
    const segs = Math.ceil(e.size / (SEG_CHUNKS * CHUNK));
    if (!Number.isSafeInteger(e.firstSeg) || e.firstSeg < 0 || e.firstSeg + segs > DATA_SEGMENTS) throw new Error("trop_gros");
    for (let n = e.firstSeg; n < e.firstSeg + segs; n++) {
      if (taken.has(n)) throw new Error("chevauchement");
      taken.add(n);
    }
    const offset = e.firstSeg * SEG_CHUNKS * CHUNK;
    items.push({ kind: "file", name: e.name, mime: e.mime, size: e.size, offset: e.size === 0 ? 0 : offset, k: b64u(e.k) });
    if (e.size > 0) dataEnd = Math.max(dataEnd, offset + e.size);
  }
  const m: ManifestV2 =
    rights === "coffre" ? { v: 2, rights, keep_ttl_h: opts.keepTtlH!, items } : { v: 2, rights: rights as Exclude<Rights, "coffre">, items };
  const manifest = utf8(JSON.stringify(m));
  if (manifest.length > MANIFEST_MAX) throw new Error("manifeste_trop_gros");
  const bucket = bucketFor(dataEnd);
  const plain = new Uint8Array(CHUNK);
  plain.set(manifest, CHUNK - 4 - manifest.length);
  new DataView(plain.buffer).setUint32(CHUNK - 4, manifest.length);
  if (usedKeys.has(keys.kContenu)) throw new Error("cle_deja_utilisee");
  usedKeys.add(keys.kContenu);
  const hdr = header(keys.engagement);
  try {
    const tail = new Uint8Array(
      await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce(bucket - 1, true), additionalData: hdr, tagLength: 128 }, keys.kContenu, plain),
    );
    return { bucket, header: hdr, tail };
  } finally {
    plain.fill(0);
    manifest.fill(0);
  }
}
