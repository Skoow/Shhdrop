// Envoi dès l'ajout (spec §41.14, D41-19) : chaque fichier est chiffré sous sa propre clé
// K_élément = HKDF(k, « shhdrop/v2/element ») ; un élément d'un segment ou plus part d'une
// frontière de segment, les petits sont empaquetés par morceaux dans des segments partagés (H-2) ; au clic, le manifeste (clés des seuls éléments gardés) est chiffré
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

/** Morceaux de données au plus (2 Gio). */
export const DATA_CHUNKS = DATA_SEGMENTS * SEG_CHUNKS;

/** Morceaux occupés par un fichier de `size` octets (0 pour un fichier vide). */
export function chunksFor(size: number): number {
  if (!Number.isSafeInteger(size) || size < 0) throw new Error("taille_invalide");
  return Math.ceil(size / CHUNK);
}

/**
 * Petit élément (audit H-2) : moins d'un segment ; empaqueté avec d'autres dans un segment
 * partagé, n'importe où sur une frontière de morceau, sans déborder de son segment. Un élément
 * d'un segment ou plus commence sur une frontière de segment et occupe ses segments seul.
 */
export function isSmall(size: number): boolean {
  return size > 0 && size < SEG_PLAIN;
}

/**
 * Emprise d'un élément, en morceaux (Q-H2-1, D41-20) : un petit élément est arrondi à une
 * puissance de deux de morceaux (1, 2, 4… 64), pour que la longueur de sa requête d'envoi ne
 * dise au serveur que sa classe de taille ; les morceaux en plus sont des zéros chiffrés sous
 * la clé de l'élément (comme la fin de son dernier morceau), indiscernables de l'aléa. Un
 * élément d'un segment ou plus : ses morceaux, sans arrondi.
 */
export function footprintFor(size: number): number {
  const n = chunksFor(size);
  if (!isSmall(size)) return n;
  let p = 1;
  while (p < n) p *= 2;
  return Math.min(p, SEG_CHUNKS);
}

/**
 * Segments d'une liste de fichiers, empaquetage compris (estimation de la place : les petits
 * éléments, à 64 Kio près, se partagent des segments) ; borne « trop gros » de l'interface.
 */
export function segmentsNeeded(sizes: readonly number[]): number {
  let big = 0, small = 0;
  for (const n of sizes) {
    if (isSmall(n)) small += footprintFor(n);
    else big += segmentsFor(n);
  }
  return big + Math.ceil(small / SEG_CHUNKS);
}

/** Plage de morceaux d'un même segment, envoyée en une requête. */
export type Piece = { seg: number; from: number; chunks: number };

export type ElementSealer = {
  /** Graine de la clé (32 octets) : n'entre que dans le manifeste chiffré, si l'élément est gardé. */
  k: Uint8Array<ArrayBuffer>;
  /** Plages à envoyer, dans l'ordre (une par segment touché). */
  pieces: Piece[];
  /**
   * Chiffre la j-ième plage, une seule fois : un nouvel essai d'envoi renvoie les octets
   * gardés par l'appelant. Les morceaux de l'emprise (`footprintFor`) : zéros chiffrés après la
   * fin du fichier, jusqu'à la puissance de deux d'un petit élément. Plage qui commence au morceau 0 du
   * paquet : 48 octets nuls d'abord (en-tête écrit par le serveur à la finalisation).
   */
  piece(j: number): Promise<Uint8Array<ArrayBuffer>>;
};

/**
 * Prépare l'élément `blob` placé au morceau `first` du paquet (frontière de segment pour un
 * élément d'un segment ou plus ; dans un seul segment pour un petit). Clé neuve à chaque
 * appel : un nouvel essai (« Réessayer ») ou une nouvelle place ne réutilise jamais un nonce
 * sous une clé. Le Blob est lu par tranches (un morceau à la fois) ; un File modifié depuis
 * l'ajout fait échouer la lecture (NotReadableError).
 */
export async function elementSealer(blob: Blob, first: number): Promise<ElementSealer> {
  const n = footprintFor(blob.size);
  if (!Number.isSafeInteger(first) || first < 0 || first + n > DATA_CHUNKS) throw new Error("trop_gros");
  if (isSmall(blob.size) ? Math.floor(first / SEG_CHUNKS) !== Math.floor((first + n - 1) / SEG_CHUNKS) : first % SEG_CHUNKS !== 0) {
    throw new Error("place_invalide");
  }
  const pieces: Piece[] = [];
  for (let a = first; a < first + n; ) {
    const seg = Math.floor(a / SEG_CHUNKS);
    const z = Math.min(first + n, (seg + 1) * SEG_CHUNKS);
    pieces.push({ seg, from: a - seg * SEG_CHUNKS, chunks: z - a });
    a = z;
  }
  const k = randomBytes(32);
  const key = await elementKey(k);
  const produced = new Set<number>();
  return {
    k,
    pieces,
    async piece(j: number): Promise<Uint8Array<ArrayBuffer>> {
      const p = pieces[j];
      if (!Number.isInteger(j) || p === undefined) throw new Error("segment_invalide");
      if (produced.has(j)) throw new Error("segment_deja_produit");
      produced.add(j);
      const g0 = p.seg * SEG_CHUNKS + p.from; // premier morceau, numéro dans le paquet
      const pre = g0 === 0 ? HEADER : 0;
      const out = new Uint8Array(pre + p.chunks * CHUNK_CT);
      const chunk = new Uint8Array(CHUNK);
      try {
        for (let c = 0; c < p.chunks; c++) {
          chunk.fill(0);
          const lo = (g0 + c - first) * CHUNK;
          if (lo < blob.size) {
            // Au-delà de la fin (emprise arrondie, Q-H2-1) : morceau de zéros chiffrés.
            const part = new Uint8Array(await blob.slice(lo, Math.min(blob.size, lo + CHUNK)).arrayBuffer());
            if (part.length !== Math.min(CHUNK, blob.size - lo)) throw new Error("lecture_incomplete");
            chunk.set(part);
            part.fill(0);
          }
          const ct = await crypto.subtle.encrypt(
            { name: "AES-GCM", iv: nonce(g0 + c, false), additionalData: ELEMENT_AD, tagLength: 128 },
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
  | { kind: "file"; name: string; mime: string; size: number; /** premier morceau */ first: number; k: Uint8Array<ArrayBuffer> };

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
    const n = chunksFor(e.size);
    if (!Number.isSafeInteger(e.first) || e.first < 0 || e.first + n > DATA_CHUNKS) throw new Error("trop_gros");
    for (let c = e.first; c < e.first + n; c++) {
      if (taken.has(c)) throw new Error("chevauchement");
      taken.add(c);
    }
    const offset = e.first * CHUNK;
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
