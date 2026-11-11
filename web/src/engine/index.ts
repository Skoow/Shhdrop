// Interface du moteur pour le site (spec moteur §6) : mêmes noms, signatures et erreurs que
// l'ancien moteur TypeScript (web/src/crypto/, web/src/transfer/link.ts, supprimés en Task 11).
// Changements de types inévitables (spec §6) : K_contenu, K_env, la graine R et la graine k d'un
// élément sont des poignées opaques du moteur, jamais des octets en JavaScript.
//
// - Ce que le site appelle de façon synchrone avant le chargement du moteur (constantes,
//   géométrie, base64url, origine, forme des liens, mot de passe généré) vit dans pure.ts, prouvé
//   égal au moteur sur les vecteurs communs (pure.test.ts).
// - Tout ce qui touche une clé passe par le moteur, chargé une fois au premier besoin
//   (loadEngine : fichier vérifié par son empreinte ; échec → Error("reseau")).
// - Panique du moteur (un bogue : aucune entrée ne doit en provoquer) : les opérations en cours
//   sont rejetées par Error("paquet_corrompu"), et une instance neuve est faite au prochain appel.
//   Les codes propres au moteur, inconnus de l'interface (aleatoire_indisponible,
//   chiffrement_echec, entree_invalide), deviennent paquet_corrompu à l'ouverture ; à l'envoi, ils
//   restent des erreurs inattendues (écran « erreur d'envoi » générique, flows/send.svelte.ts).
import { passwordKey as kdfOpen, passwordKeyForCreate as kdfCreate } from "./argon2";
import { loadEngine, resetEngine, type Engine } from "./load";
import type { JsAccessKeys, JsContentKeys, JsElementSealer, JsReader, JsSeed } from "./pkg/shhdrop_wasm.js";
import { type KAcces, type KdfParams, type KeepTtl, type KLien, type KMdp, type KPreuve, type Manifest, type ManifestClean, type Piece, type Rights, type SGestion, utf8 } from "./pure";

export * from "./pure";
export { loadEngine } from "./load";

// --- Chargement, panique ------------------------------------------------------------------------

const STALE = "Invalid stale object from previous Wasm instance";
/** Codes propres au moteur, que l'interface ne connaît pas : à l'ouverture, paquet_corrompu. */
const ENGINE_ONLY = new Set(["aleatoire_indisponible", "chiffrement_echec", "entree_invalide", "argon2_echec"]);

let broken = false;
let armed: Engine["wasm"] | undefined;
/** Rejets des opérations du moteur en cours, appelés sur une panique. */
const pending = new Set<(e: Error) => void>();

const corrupt = () => new Error("paquet_corrompu");

function onPanic(): void {
  broken = true;
  for (const r of [...pending]) r(corrupt());
  pending.clear();
}

/** Le moteur chargé ; après une panique, une instance neuve du même module (une fois). */
async function engine(): Promise<Engine> {
  const e = await loadEngine();
  if (broken) {
    broken = false;
    resetEngine(e);
    armed = undefined;
  }
  if (armed !== e.wasm) {
    e.wasm.setPanicHandler(onPanic);
    armed = e.wasm;
  }
  return e;
}

/** Panique (RuntimeError) ou objet d'une instance remplacée : paquet_corrompu. */
function fault(x: unknown): unknown {
  if (x instanceof WebAssembly.RuntimeError) {
    broken = true;
    return corrupt();
  }
  if (x instanceof Error && x.message === STALE) return corrupt();
  return x;
}

/** Erreur d'ouverture : en plus, les codes propres au moteur deviennent paquet_corrompu. */
function openFault(x: unknown): unknown {
  const e = fault(x);
  return e instanceof Error && ENGINE_ONLY.has(e.message) ? corrupt() : e;
}

/**
 * Appel du moteur (synchrone ou non), suivi : une panique (même survenue dans une autre opération
 * asynchrone) le rejette par paquet_corrompu.
 */
function call<T>(f: () => T | Promise<T>, map: (x: unknown) => unknown = fault): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    // Instance arrêtée par une panique : plus aucun appel dedans (engine() en refait une).
    if (broken) {
      reject(corrupt());
      return;
    }
    const r = (e: Error) => reject(e);
    pending.add(r);
    let p: Promise<T>;
    try {
      p = Promise.resolve(f());
    } catch (x) {
      pending.delete(r);
      reject(map(x));
      return;
    }
    p.then(
      (v) => {
        pending.delete(r);
        resolve(v);
      },
      (x: unknown) => {
        pending.delete(r);
        reject(map(x));
      },
    );
  });
}

/** Le moteur chargé, puis `f` suivi par `call`. */
async function run<T>(f: (e: Engine) => T | Promise<T>, map: (x: unknown) => unknown = fault): Promise<T> {
  const e = await engine();
  return call(() => f(e), map);
}

const forgotten = new WeakSet<object>();

/**
 * Oublie un objet du moteur (graine R, clés de contenu ou d'accès, lecteur) : ses clés sont
 * oubliées chez le fournisseur et ses secrets effacés dans le moteur. Sans effet la seconde fois,
 * ou pour un objet d'une instance remplacée.
 */
export function forget(x: { free(): void } | null | undefined): void {
  if (!x || forgotten.has(x)) return;
  forgotten.add(x);
  try {
    x.free();
  } catch {
    // instance remplacée après une panique : rien à oublier
  }
}

// --- Dérivations (spec §29.2) -----------------------------------------------------------------

export type AccessKeysV = { kAcces: KAcces; vAcces: Uint8Array<ArrayBuffer> };

/** K_accès = HKDF(K_lien, « shhdrop/v2/acces »), V_accès = SHA-256(K_accès). */
export function deriveAccess(kLien: KLien): Promise<AccessKeysV> {
  return run((e) => {
    const r = e.wasm.deriveAccess(kLien);
    return { kAcces: r.kAcces as KAcces, vAcces: r.vAcces as Uint8Array<ArrayBuffer> };
  });
}

/** id du partage = HKDF(K_lien, « shhdrop/v2/id »), 16 octets. */
export function shareId(kLien: KLien): Promise<Uint8Array<ArrayBuffer>> {
  return run((e) => e.wasm.shareId(kLien) as Uint8Array<ArrayBuffer>);
}

/** K_mdp pour OUVRIR (paramètres lus sur le serveur), dans un Worker neuf ; l'appelant l'efface. */
export function passwordKey(password: string, salt: Uint8Array<ArrayBuffer>, params: KdfParams): Promise<KMdp> {
  return run(async (e) => (await kdfOpen(e, password, salt, params)) as KMdp);
}

/** K_mdp pour CRÉER : mot de passe de la forme générée (sinon mot_de_passe_non_genere), KDF_CREATE. */
export function passwordKeyForCreate(password: string, salt: Uint8Array<ArrayBuffer>): Promise<KMdp> {
  return run(async (e) => (await kdfCreate(e, password, salt)) as KMdp);
}

// --- Graine, clés, enveloppe ---------------------------------------------------------------------

/** Graine de contenu R : opaque (jamais en clair en JavaScript) ; `free()` l'efface. */
export type Seed = JsSeed;
/** Clés de contenu : K_contenu chez le fournisseur (poignée opaque) et engagement (public). */
export type ContentKeys = JsContentKeys;
/** K_env (poignée opaque), K_preuve et V_preuve (copies que l'appelant efface). */
export type AccessKeys = { kEnv: JsAccessKeys; kPreuve: KPreuve; vPreuve: Uint8Array<ArrayBuffer> };

/** Nouvelle graine R (aléa de crypto.getRandomValues, par le fournisseur). */
export function newSeed(): Promise<Seed> {
  return run((e) => e.wasm.newSeed(e.provider));
}

/** K_contenu et engagement d'une R neuve, une seule fois par R (cle_deja_utilisee ensuite). */
export function contentKeys(r: Seed): Promise<ContentKeys> {
  return run((e) => e.wasm.contentKeys(r));
}

/** Clés d'ouverture : engagement de l'en-tête vérifié contre R, sinon paquet_corrompu. */
export function contentKeysChecked(r: Seed, engagement: Uint8Array): Promise<ContentKeys> {
  return run((e) => e.wasm.contentKeysChecked(r, engagement), openFault);
}

/** K_env, K_preuve, V_preuve tirés de K_lien et K_mdp (ni l'une ni l'autre n'est modifiée). */
export function accessKeys(kLien: KLien, kMdp: KMdp): Promise<AccessKeys> {
  return run(async (e) => {
    const kEnv = await e.wasm.accessKeys(e.provider, kLien, kMdp);
    return { kEnv, kPreuve: kEnv.kPreuve as KPreuve, vPreuve: kEnv.vPreuve as Uint8Array<ArrayBuffer> };
  });
}

/** Enveloppe E (60 octets) de R sous K_env ; données authentifiées : id et en-tête. */
export function seal(kEnv: JsAccessKeys, r: Seed, id: Uint8Array, header: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
  return run(async (e) => (await e.wasm.seal(kEnv, r, id, header)) as Uint8Array<ArrayBuffer>);
}

/** Déballe R ; tout défaut (taille, id, en-tête, E, K_env) : paquet_corrompu. */
export function open(kEnv: JsAccessKeys, env: Uint8Array, id: Uint8Array, header: Uint8Array): Promise<Seed> {
  return run((e) => e.wasm.open(kEnv, env, id, header), openFault);
}

/** En-tête en clair du segment 0 et engagement (non authentifiés ici) ; sinon paquet_corrompu. */
export function readHeader(seg0: Uint8Array): Promise<{ header: Uint8Array<ArrayBuffer>; engagement: Uint8Array<ArrayBuffer> }> {
  return run((e) => e.wasm.readHeader(seg0) as { header: Uint8Array<ArrayBuffer>; engagement: Uint8Array<ArrayBuffer> }, openFault);
}

// --- Ouverture en flux ---------------------------------------------------------------------------

export type ContainerReader = {
  manifest: Manifest;
  /** Copie de l'élément i, pour l'aperçu ; refusé au-delà de PREVIEW_MAX (« trop_gros_pour_apercu »). */
  item(i: number): Promise<Uint8Array<ArrayBuffer>>;
  /** Déchiffre l'élément i tranche par tranche vers `sink` (copies), dans l'ordre. */
  streamItem(i: number, sink: (chunk: Uint8Array<ArrayBuffer>) => Promise<void> | void): Promise<void>;
  /** Met à zéro le segment chiffré en cache (le manifeste reste : chaînes JavaScript). */
  wipe(): void;
};

/**
 * Ouvre un paquet en flux (`keys` : contentKeysChecked) : en-tête, engagement, palier et
 * manifeste vérifiés par le moteur. Les rejets de `fetchSegment` et de `sink` sont rendus tels
 * quels ; un défaut du paquet est paquet_corrompu.
 */
export async function openStream(fetchSegment: (n: number) => Promise<Uint8Array>, bucket: number, keys: ContentKeys): Promise<ContainerReader> {
  const rd: JsReader = await run((e) => e.wasm.openReader(keys, fetchSegment, bucket), openFault);
  const manifest = rd.manifest() as Manifest;
  return {
    manifest,
    item: (i) => call(() => rd.item(i) as Promise<Uint8Array<ArrayBuffer>>, openFault),
    streamItem: (i, sink) => call(() => rd.streamItem(i, sink as (c: Uint8Array) => Promise<void> | void), openFault),
    wipe: () => {
      try {
        rd.wipe();
      } catch {
        // instance remplacée après une panique : plus rien en cache
      }
    },
  };
}

// --- Envoi : éléments et manifeste final ----------------------------------------------------------

export type ElementSealer = {
  /** Plages à envoyer, dans l'ordre (une par segment touché). */
  pieces: Piece[];
  /** Chiffre la j-ième plage, une seule fois (segment_deja_produit ensuite). */
  piece(j: number): Promise<Uint8Array<ArrayBuffer>>;
  /** Oublie la clé et sa graine (l'élément ne peut plus entrer dans un manifeste). */
  forget(): void;
  /** Numéro du scelleur dans le moteur : sealFinal en reprend la graine, tant qu'il n'est pas oublié. */
  readonly id: number;
};

/**
 * Prépare l'élément `blob` placé au morceau `first` (clé neuve à chaque appel). Le Blob est lu
 * par plages (4 Mio au plus) ; un File modifié depuis l'ajout fait échouer la lecture.
 */
export async function elementSealer(blob: Blob, first: number): Promise<ElementSealer> {
  const el: JsElementSealer = await run((e) => e.wasm.elementSealer(e.provider, blob.size, first));
  const pieces = el.pieces() as Piece[];
  let gone = false;
  return {
    pieces,
    id: el.id,
    async piece(j: number): Promise<Uint8Array<ArrayBuffer>> {
      if (gone) throw new Error("cle_oubliee");
      const [lo, hi] = await call(() => el.range(j));
      const part = new Uint8Array(await blob.slice(lo, hi).arrayBuffer());
      try {
        if (part.length !== hi - lo) throw new Error("lecture_incomplete");
        return (await call(() => el.piece(j, part))) as Uint8Array<ArrayBuffer>;
      } finally {
        part.fill(0);
      }
    },
    forget() {
      if (gone) return;
      gone = true;
      try {
        el.free();
      } catch {
        // instance remplacée : rien à oublier
      }
    },
  };
}

/**
 * Élément gardé, déjà envoyé sous sa clé (spec §41.14) : `sealer` est le scelleur qui l'a
 * chiffré, dont le moteur reprend la graine k (jamais lue par JavaScript).
 */
export type FinalEntry =
  | { kind: "text"; name: string; mime: string; size: number; /** premier morceau */ first: number; sealer: ElementSealer }
  | { kind: "file"; name: string; mime: string; size: number; /** premier morceau */ first: number; sealer: ElementSealer; clean?: ManifestClean };

/**
 * Manifeste des éléments gardés, dans l'ordre donné, palier final, en-tête et morceau chiffré du
 * manifeste. Refus : « vide », « droits_invalides », « manifeste_trop_gros », « texte_trop_long »,
 * « trop_gros », « chevauchement », « cle_deja_utilisee ».
 */
export function sealFinal(
  entries: FinalEntry[],
  keys: ContentKeys,
  opts: { rights?: Rights; keepTtlH?: KeepTtl },
): Promise<{ bucket: number; header: Uint8Array<ArrayBuffer>; tail: Uint8Array<ArrayBuffer> }> {
  return run(async (e) => {
    const list = entries.map(({ sealer, ...x }) => ({ ...x, sealer: sealer.id }));
    const fin = await e.wasm.sealFinal(list, keys, opts.rights, opts.keepTtlH);
    return fin as { bucket: number; header: Uint8Array<ArrayBuffer>; tail: Uint8Array<ArrayBuffer> };
  });
}

// --- Liens (spec §32) : clé lue et écrite par le moteur ------------------------------------------

/** Lien analysé : K_lien pour un lien de partage, S_gestion pour un lien de gestion. */
export type ParsedLink = { kind: "s"; origin: string; kLien: KLien } | { kind: "m"; origin: string; sGestion: SGestion };

/** Analyse un lien (forme de linkForm), clé décodée par le moteur ; sinon lien_invalide. */
export function parseLink(url: string, base = "/"): Promise<ParsedLink> {
  return run((e) => {
    const bytes = utf8(url);
    try {
      const p = e.wasm.parseLink(bytes, base);
      return p.kind === "s" ? { kind: "s", origin: p.origin, kLien: p.kLien as KLien } : { kind: "m", origin: p.origin, sGestion: p.sGestion as SGestion };
    } finally {
      bytes.fill(0);
    }
  });
}

/** `${origin}${base}#<K_lien>`. */
export function shareLink(origin: string, kLien: KLien, base = "/"): Promise<string> {
  return run((e) => String(e.wasm.shareLink(origin, kLien, base)));
}

/** `${origin}${base}#m<S_gestion>`. */
export function manageLink(origin: string, sGestion: SGestion, base = "/"): Promise<string> {
  return run((e) => String(e.wasm.manageLink(origin, sGestion, base)));
}

