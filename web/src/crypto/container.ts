// Paquet chiffré v2 (spec §29.3, §7.3) : en-tête en clair « SHH2 » + morceaux AES-256-GCM
// façon STREAM sous K_contenu = HKDF(R). Clair de B morceaux : données des éléments (à
// partir de l'octet 0, dans l'ordre d'ajout) ‖ zéros ‖ manifeste ‖ longueur du manifeste
// (4 octets, gros-boutiste) en toute fin.
import { concat, unb64u, utf8 } from "./encoding";
import { hkdf } from "./kdf";
import type { ContentKeys } from "./envelope";

export const CHUNK = 65536, TAG = 16, CHUNK_CT = 65552, HEADER = 48, SEG_CHUNKS = 64;
/**
 * Paliers gratuits en morceaux de 64 Kio (spec §24, §29.3, §41.2). Chaque palier garde son
 * dernier morceau pour le manifeste : le palier 1 sert aux partages de texte seul, et le plus
 * grand (32 769 morceaux) contient exactement 2 Gio de données plus le morceau du manifeste.
 */
export const BUCKETS = [1, 16, 80, 160, 400, 800, 1600, 4000, 8000, 16385, 32769] as const;
/** Au-delà, pas d'aperçu sur le site : téléchargement en flux seulement (spec §24). */
export const PREVIEW_MAX = 200 * 1048576;
/**
 * Taille maximale du manifeste : avec sa longueur (4 octets), il tient dans un morceau de
 * 64 Kio, réservé en fin de paquet quelle que soit sa taille réelle (spec §29.3).
 */
export const MANIFEST_MAX = 65532;
const TAIL = 4 + MANIFEST_MAX;
/** Octets de données au plus (fichiers ; les textes vont dans le manifeste) : exactement 2 Gio (2 147 483 648). */
export const CONTENT_MAX = BUCKETS[BUCKETS.length - 1] * CHUNK - TAIL;
/**
 * Éléments par partage au plus, pour toutes les formules (décision du 7 novembre, D41-17 :
 * le nombre d'éléments n'est plus un critère de formule, une archive .zip le contourne).
 * Borne technique d'un manifeste d'un morceau (MANIFEST_MAX = 65 532 octets) : une entrée de
 * fichier au nom ASCII de 120 caractères et au type de 40 caractères fait environ 220 octets,
 * soit environ 290 entrées ; 200 laisse de la marge. Des noms en écriture non latine (jusqu'à
 * 4 octets par caractère) ou de longs textes peuvent remplir le manifeste avant : le composeur
 * le mesure et bloque l'envoi avec sa raison (« manifeste »), jamais un échec au scellement.
 */
export const MAX_ITEMS = 200;
/** Points de code d'un texte au plus. */
export const TEXT_MAX = 10_000;
const TEXT_BYTES_MAX = 4 * TEXT_MAX; // un point de code UTF-8 fait au plus 4 octets
const MAGIC = utf8("SHH2");
const VERSION = 2;

/** Droits du destinataire (spec §34), dans le manifeste chiffré. */
export type Rights = "voir" | "enregistrer" | "coffre";
export type KeepTtl = 1 | 6 | 12 | 24;
const KEEP_TTLS: readonly number[] = [1, 6, 12, 24];

/** Élément à chiffrer. Un fichier (File est un Blob) n'est jamais lu en entier en mémoire. */
export type Item = { kind: "text" | "file"; name: string; mime: string; data: Uint8Array<ArrayBuffer> | Blob };
export type ManifestEntry = {
  kind: "text" | "file";
  name: string;
  mime: string;
  size: number;
  offset: number;
  text?: string;
  /** Graine de la clé de l'élément (spec §41.14), base64url de 32 octets ; absente : ancien format (K_contenu). */
  k?: string;
};

/** Données authentifiées des morceaux d'un élément (spec §41.14) ; distinctes de l'info HKDF de sa clé. */
export const ELEMENT_AD = utf8("shhdrop/v2/element-ad");

/** K_élément = HKDF(k, « shhdrop/v2/element »), AES-256-GCM non extractible (spec §41.14). */
export async function elementKey(k: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  if (k.length !== 32) throw new Error("graine invalide");
  const raw = await hkdf(k, "shhdrop/v2/element");
  try {
    return await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
  } finally {
    raw.fill(0);
  }
}
export type ManifestV2 = { v: 2; rights: Rights; keep_ttl_h?: KeepTtl; items: ManifestEntry[] };
export type Manifest = ManifestV2;

/**
 * Droits lus dans un manifeste (spec §34). Absent, inconnu ou mal typé → "voir" (le plus
 * restrictif) ; "coffre" exige keep_ttl_h ∈ {1, 6, 12, 24}, sinon "voir".
 */
export function parseRights(m: unknown): { rights: Rights; keepTtlH: KeepTtl | null } {
  const o = typeof m === "object" && m !== null ? (m as Record<string, unknown>) : {};
  if (o.rights === "enregistrer") return { rights: "enregistrer", keepTtlH: null };
  if (o.rights === "coffre" && typeof o.keep_ttl_h === "number" && KEEP_TTLS.includes(o.keep_ttl_h)) {
    return { rights: "coffre", keepTtlH: o.keep_ttl_h as KeepTtl };
  }
  return { rights: "voir", keepTtlH: null };
}

/** Palier canonique v2 : le plus petit palier de capacité ≥ fin des données + 4 + MANIFEST_MAX. */
export function bucketFor(dataEnd: number): number {
  if (!Number.isSafeInteger(dataEnd) || dataEnd < 0) throw new Error("taille_invalide");
  for (const b of BUCKETS) if (dataEnd + TAIL <= b * CHUNK) return b;
  throw new Error("trop_gros");
}

export function segmentCount(bucket: number): number {
  return Math.ceil(bucket / SEG_CHUNKS);
}

export function segmentSize(bucket: number, n: number): number {
  const chunks = Math.min(SEG_CHUNKS, bucket - n * SEG_CHUNKS);
  return (n === 0 ? HEADER : 0) + chunks * CHUNK_CT;
}

export function header(engagement: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
  if (engagement.length !== 32) throw new Error("engagement invalide");
  return concat(MAGIC, new Uint8Array([VERSION]), new Uint8Array(11), engagement);
}

/**
 * Lit l'en-tête en clair du segment 0 : « SHH2 », version 2, 11 octets nuls, engagement.
 * Rien n'est authentifié ici : l'enveloppe (qui couvre l'en-tête) et l'engagement le sont ensuite.
 */
export function readHeader(seg0: Uint8Array): { header: Uint8Array<ArrayBuffer>; engagement: Uint8Array<ArrayBuffer> } {
  if (seg0.length < HEADER) throw corrupt();
  const h = new Uint8Array(seg0.subarray(0, HEADER));
  const engagement = h.slice(16, HEADER);
  const want = header(engagement);
  let diff = 0;
  for (let i = 0; i < 16; i++) diff |= h[i]! ^ want[i]!;
  if (diff !== 0) throw corrupt();
  return { header: h, engagement };
}

// Nonce : indice big-endian sur 11 octets (octets 0..10) + drapeau « dernier morceau ».
export function nonce(index: number, last: boolean): Uint8Array<ArrayBuffer> {
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
// ne la consomment pas). Ce qui garantit vraiment l'unicité, c'est qu'une R neuve est tirée
// à chaque partage (donc une K_contenu neuve) ; cette garde n'est qu'un filet.
const usedKeys = new WeakSet<CryptoKey>();

/** Segments de bourrage [from, to) : remplis d'aléa par le serveur, jamais envoyés ni lus. Vide : from = to = 0. */
export type Fill = { from: number; to: number };

export type SealOpts = { rights?: Rights; keepTtlH?: KeepTtl };

export type Sealer = {
  bucket: number;
  segmentCount: number;
  /** En-tête en clair de 48 octets (données authentifiées de l'enveloppe E). */
  header: Uint8Array<ArrayBuffer>;
  fill: Fill;
  /** Segments à envoyer, dans l'ordre : tous sauf ceux du bourrage. */
  toSend: number[];
  /**
   * Chiffre exactement les morceaux du segment n, UNE seule fois par segment (spec §29.3 :
   * chaque numéro de morceau n'est chiffré qu'une fois par R) ; un second appel lève
   * « segment_deja_produit ». Un nouvel essai d'envoi renvoie les octets gardés par
   * l'appelant. Un segment du bourrage ou hors palier lève « segment_invalide ».
   */
  segment(n: number): Promise<Uint8Array<ArrayBuffer>>;
};

function checkRights(o: SealOpts): { rights: Rights; keep_ttl_h?: KeepTtl } {
  const rights = o.rights ?? "enregistrer";
  if (rights === "coffre") {
    if (o.keepTtlH === undefined || !KEEP_TTLS.includes(o.keepTtlH)) throw new Error("droits_invalides");
    return { rights, keep_ttl_h: o.keepTtlH };
  }
  if ((rights !== "voir" && rights !== "enregistrer") || o.keepTtlH !== undefined) throw new Error("droits_invalides");
  return { rights };
}

/**
 * Prépare le paquet : manifeste calculé d'après les tailles, palier, en-tête, bourrage.
 * Rien n'est chiffré ni lu avant segment(n), qui lit les fichiers par tranches
 * (Blob.slice) : un seul segment chiffré et un morceau en clair à la fois en mémoire.
 * Si `data` est un File, il ne doit pas changer pendant l'envoi (le navigateur refuse
 * alors la lecture : NotReadableError).
 */
export async function sealStream(items: Item[], keys: ContentKeys, opts: SealOpts = {}): Promise<Sealer> {
  if (items.length === 0) throw new Error("vide");
  if (items.length > MAX_ITEMS) throw new Error("trop_d_elements");
  const rights = checkRights(opts);

  const entries: ManifestEntry[] = [];
  const files: { start: number; blob: Blob }[] = []; // start : position dans le clair
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
      // Copie d'un Uint8Array dans un Blob : l'appelant ne peut plus le modifier ensuite.
      const blob = it.data instanceof Uint8Array ? new Blob([it.data]) : it.data;
      const size = blob.size;
      if (!Number.isSafeInteger(size) || size < 0) throw new Error("taille_invalide");
      entries.push({ kind: "file", name: it.name, mime: it.mime, size, offset });
      files.push({ start: offset, blob });
      offset += size;
    }
  }
  const manifest = utf8(JSON.stringify({ v: 2, ...rights, items: entries } satisfies ManifestV2));
  if (manifest.length > MANIFEST_MAX) throw new Error("manifeste_trop_gros");
  const bucket = bucketFor(offset);
  const cap = bucket * CHUNK;
  const end = new Uint8Array(manifest.length + 4); // manifeste ‖ longueur, en fin de clair
  end.set(manifest);
  new DataView(end.buffer).setUint32(manifest.length, manifest.length);
  const endStart = cap - end.length;

  const count = segmentCount(bucket);
  const segPlain = SEG_CHUNKS * CHUNK;
  // Bourrage : segments sans aucun octet de données ni de fin ; le segment 0 (en-tête) est toujours envoyé.
  const from = Math.max(1, Math.ceil(offset / segPlain));
  const to = Math.floor(endStart / segPlain);
  const fill: Fill = from < to ? { from, to } : { from: 0, to: 0 };
  const toSend = [...Array(count).keys()].filter((n) => n < fill.from || n >= fill.to);

  const hdr = header(keys.engagement);
  if (usedKeys.has(keys.kContenu)) throw new Error("cle_deja_utilisee");
  usedKeys.add(keys.kContenu);
  const produced = new Set<number>();

  // Clair du morceau i : fichiers, zéros, puis manifeste et sa longueur.
  async function plain(chunk: Uint8Array<ArrayBuffer>, i: number): Promise<void> {
    chunk.fill(0);
    const a = i * CHUNK, b = a + CHUNK;
    for (const f of files) {
      const lo = Math.max(a, f.start), hi = Math.min(b, f.start + f.blob.size);
      if (lo >= hi) continue;
      const part = new Uint8Array(await f.blob.slice(lo - f.start, hi - f.start).arrayBuffer());
      if (part.length !== hi - lo) throw new Error("lecture_incomplete");
      chunk.set(part, lo - a);
      part.fill(0);
    }
    if (b > endStart) chunk.set(end.subarray(Math.max(0, a - endStart), b - endStart), Math.max(0, endStart - a));
  }

  return {
    bucket,
    segmentCount: count,
    header: new Uint8Array(hdr),
    fill,
    toSend,
    async segment(n: number): Promise<Uint8Array<ArrayBuffer>> {
      if (!Number.isInteger(n) || n < 0 || n >= count || (n >= fill.from && n < fill.to)) throw new Error("segment_invalide");
      if (produced.has(n)) throw new Error("segment_deja_produit");
      produced.add(n);
      const out = new Uint8Array(segmentSize(bucket, n));
      if (n === 0) out.set(hdr);
      const chunk = new Uint8Array(CHUNK);
      try {
        const first = n * SEG_CHUNKS, last = Math.min(bucket, first + SEG_CHUNKS);
        for (let i = first; i < last; i++) {
          await plain(chunk, i);
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
  if (v !== 2 || !Array.isArray(items) || items.length === 0 || items.length > MAX_ITEMS) throw corrupt();
  const out: ManifestEntry[] = [];
  for (const e of items as unknown[]) {
    if (typeof e !== "object" || e === null) throw corrupt();
    const { kind, name, mime, size, offset, text, k } = e as Record<string, unknown>;
    if (typeof name !== "string" || typeof mime !== "string" || !isNat(size) || !isNat(offset)) throw corrupt();
    if (kind === "text") {
      if (typeof text !== "string" || size !== 0 || offset !== 0 || k !== undefined || codePoints(text) > TEXT_MAX) throw corrupt();
      out.push({ kind, name, mime, size, offset, text });
    } else if (kind === "file") {
      if (text !== undefined || offset > dataLen || size > dataLen - offset) throw corrupt();
      if (k === undefined) out.push({ kind, name, mime, size, offset });
      else if (typeof k === "string" && k.length === 43) out.push({ kind, name, mime, size, offset, k });
      else throw corrupt();
    } else {
      throw corrupt();
    }
  }
  const { rights, keepTtlH } = parseRights(m);
  return keepTtlH === null ? { v: 2, rights, items: out } : { v: 2, rights, keep_ttl_h: keepTtlH, items: out };
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
  /**
   * Met à zéro le segment chiffré en cache. Limite : le manifeste (noms, types, textes) reste
   * en mémoire sous forme de chaînes JavaScript, impossibles à effacer ; elles disparaissent
   * quand le lecteur n'est plus référencé (ramasse-miettes). Une lecture en cours n'échoue
   * pas : elle recharge le segment.
   */
  wipe(): void;
};

/**
 * Ouvre un paquet en flux. `bucket` vient du serveur (meta) : il est vérifié contre la
 * taille des segments, le drapeau « dernier morceau » et le manifeste authentifié (le
 * palier doit être celui que seal aurait choisi). L'en-tête et l'engagement sont vérifiés
 * sur le segment 0 avant tout déchiffrement ; le manifeste est lu dans le dernier segment.
 * `keys` vient de contentKeysChecked (engagement déjà vérifié contre R). Un seul segment
 * chiffré est gardé en cache.
 * Les opérations (item, streamItem) sont sérialisées : appelées en même temps, elles
 * s'exécutent l'une après l'autre (elles partagent le cache).
 * Les morceaux jamais lus (bourrage, rempli d'aléa par le serveur) ne sont pas vérifiés :
 * ils ne contiennent rien.
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
  async function chunk(i: number, key: CryptoKey = keys.kContenu, ad: Uint8Array<ArrayBuffer> = hdr): Promise<Uint8Array<ArrayBuffer>> {
    const n = Math.floor(i / SEG_CHUNKS);
    let s = await seg(n);
    // wipe() a pu vider le cache pendant l'attente : recharger plutôt que lire des zéros.
    while (cache?.data !== s) s = await seg(n);
    const start = (n === 0 ? HEADER : 0) + (i % SEG_CHUNKS) * CHUNK_CT;
    try {
      // decrypt copie ses entrées dès l'appel : le cache peut changer ensuite.
      return new Uint8Array(
        await crypto.subtle.decrypt(
          { name: "AES-GCM", iv: nonce(i, i === bucket - 1), additionalData: ad, tagLength: 128 },
          key,
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

    // Passe à `out` les tranches du clair [a, a + len), morceau par morceau.
    async function range(
      a: number,
      len: number,
      out: (part: Uint8Array<ArrayBuffer>, pos: number) => Promise<void> | void,
      key?: { k: CryptoKey; ad: Uint8Array<ArrayBuffer> },
    ) {
      for (let pos = 0; pos < len; ) {
        const i = Math.floor((a + pos) / CHUNK);
        const pt = await chunk(i, key?.k, key?.ad);
        const lo = a + pos - i * CHUNK;
        const n = Math.min(CHUNK - lo, len - pos);
        const part = pt.slice(lo, lo + n);
        pt.fill(0);
        await out(part, pos);
        pos += n;
      }
    }

    // 2. Longueur du manifeste (4 derniers octets du dernier morceau), puis le manifeste.
    const cap = bucket * CHUNK;
    const cl = await chunk(bucket - 1);
    const mlen = new DataView(cl.buffer).getUint32(CHUNK - 4);
    cl.fill(0);
    const mStart = cap - 4 - mlen;
    if (mlen > MANIFEST_MAX || mStart < 0) throw corrupt();
    const raw = new Uint8Array(mlen);
    let manifest: Manifest;
    try {
      await range(mStart, mlen, (part, pos) => {
        raw.set(part, pos);
        part.fill(0);
      });
      manifest = parseManifest(raw, mStart);
    } finally {
      raw.fill(0);
    }
    // 3. Palier canonique : un serveur ne peut pas annoncer un autre palier que celui du paquet.
    const dataEnd = Math.max(0, ...manifest.items.map((e) => e.offset + e.size));
    let canonical: number;
    try {
      canonical = bucketFor(dataEnd);
    } catch {
      throw corrupt();
    }
    if (canonical !== bucket) throw corrupt();
    // Clés des éléments (spec §41.14) : une par entrée de fichier qui porte `k`.
    const elKeys = new Map<number, { k: CryptoKey; ad: Uint8Array<ArrayBuffer> }>();
    for (const [i, e] of manifest.items.entries()) {
      if (e.k === undefined) continue;
      let seed: Uint8Array<ArrayBuffer>;
      try {
        seed = unb64u(e.k);
      } catch {
        throw corrupt();
      }
      if (seed.length !== 32) throw corrupt();
      try {
        elKeys.set(i, { k: await elementKey(seed), ad: ELEMENT_AD });
      } finally {
        seed.fill(0);
      }
    }

    function entry(i: number): ManifestEntry {
      const e = manifest.items[i];
      if (!Number.isInteger(i) || e === undefined) throw new Error("element_inexistant");
      return e;
    }
    // File d'attente : une opération à la fois sur le cache.
    let tail: Promise<unknown> = Promise.resolve();
    const serial = <T>(f: () => Promise<T>): Promise<T> => {
      const p = tail.then(f);
      tail = p.catch(() => undefined);
      return p;
    };

    return {
      manifest,
      item: (i) => serial(async () => {
        const e = entry(i);
        if (e.kind === "text") return utf8(e.text!);
        if (e.size > PREVIEW_MAX) throw new Error("trop_gros_pour_apercu");
        const res = new Uint8Array(e.size);
        try {
          await range(
            e.offset,
            e.size,
            (part, pos) => {
              res.set(part, pos);
              part.fill(0);
            },
            elKeys.get(i),
          );
        } catch (err) {
          res.fill(0);
          throw err;
        }
        return res;
      }),
      streamItem: (i, sink) => serial(async () => {
        const e = entry(i);
        if (e.kind === "text") {
          const t = utf8(e.text!);
          if (t.length > 0) await sink(t);
          return;
        }
        await range(e.offset, e.size, (part) => sink(part), elKeys.get(i));
      }),
      wipe,
    };
  }
}
