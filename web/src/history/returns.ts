// Retours sur un partage déjà ouvert (spec D42-22, §41.4) : chaque personne qui a ouvert un
// partage peut y revenir depuis le même navigateur jusqu'à l'échéance, sans consommer
// d'ouverture. Ce module garde pour cela l'octroi d'ouverture (rendu par unlock, valable
// jusqu'à l'échéance) au-delà de la fermeture de l'onglet. EXCEPTION ÉCRITE à « aucun
// stockage navigateur », sur le modèle de l'historique (history/store.ts, même mécanisme) :
// - IndexedDB (base à part, RETURNS_DB), chaque entrée chiffrée AES-256-GCM avec une clé
//   WebCrypto NON EXTRACTIBLE gardée dans la base ; nonce aléatoire de 96 bits ; identifiant
//   tiré au hasard (donnée associée authentifiée), sans lien avec le partage.
// - Une entrée ne contient que : l'étiquette du partage (SHA-256(K_accès) tronqué, comme entre
//   onglets, session/tabs.ts), l'octroi et l'échéance. JAMAIS K_lien, le lien, le mot de passe,
//   R ni un contenu. Sans le lien (à rouvrir depuis le message) ET le mot de passe (toujours
//   ressaisi), l'octroi n'ouvre rien.
// - Retirée à l'échéance (à chaque lecture), à la destruction, à la disparition du partage et
//   quand le serveur refuse l'octroi (grant_invalid, reopen_limit).
// - Une simple visite n'écrit rien (aucune base créée tant qu'aucun retour n'est gardé).
// - Stockage absent, refusé ou en panne : tout échoue en silence ; revenir comptera alors une
//   ouverture (ou sera impossible si toutes sont prises), ce que l'écran dit.
// Honnêtement : la clé est sur le même appareil ; le chiffrement ne protège que d'une lecture
// naïve du stockage. Démo : mémoire de l'onglet seulement (memoryBackend).
import { getDemo } from "../app/demo-hooks";
import { idbBackend, memoryBackend, type Backend, type Rec } from "./store";

export const RETURNS_DB = "shhdrop-returns";

/** Seuls champs gardés (source-rules.test.ts le vérifie). */
export type ReturnEntry = {
  tag: string;
  grant: string;
  expiresAt: number;
};

export type Returns = {
  /** Octroi gardé pour ce partage, ou null (absent, échu, illisible, stockage indisponible). */
  find(tag: string): Promise<string | null>;
  /** Garde (ou remplace) l'octroi de ce partage jusqu'à `expiresAt` (ms). */
  save(e: ReturnEntry): Promise<void>;
  /** Retire l'octroi de ce partage. */
  forget(tag: string): Promise<void>;
};

const TAG = /^[A-Za-z0-9_-]{22}$/;
const GRANT = /^[A-Za-z0-9_-]{54}$/;
const ID = /^[A-Za-z0-9_-]{22}$/;
const AAD = "shhdrop/returns/v1/";

const aad = (id: string) => new TextEncoder().encode(AAD + id);
function randomId(): string {
  const b = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function clean(x: unknown): ReturnEntry | null {
  if (typeof x !== "object" || x === null) return null;
  const o = x as Record<string, unknown>;
  if (typeof o.tag !== "string" || !TAG.test(o.tag) || typeof o.grant !== "string" || !GRANT.test(o.grant)) return null;
  if (!Number.isSafeInteger(o.expiresAt)) return null;
  return { tag: o.tag, grant: o.grant, expiresAt: o.expiresAt as number };
}

export function openReturns(deps: { backend: Backend | null; now?: () => number }): Returns {
  const now = deps.now ?? Date.now;
  const b = deps.backend;
  let keyP: Promise<CryptoKey> | undefined;
  const key = () =>
    (keyP ??= crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]).then((k) => b!.key(k)));

  async function open(id: string, r: Rec, k: CryptoKey): Promise<ReturnEntry | null> {
    try {
      if (!ID.test(id) || !(r?.iv instanceof Uint8Array) || !(r.ct instanceof Uint8Array)) return null;
      const pt = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: r.iv, additionalData: aad(id) }, k, r.ct));
      const v = JSON.parse(new TextDecoder().decode(pt)) as unknown;
      pt.fill(0);
      return clean(v);
    } catch {
      return null;
    }
  }
  /** Entrées lisibles et non échues ; les autres sont retirées. Base absente : aucune (rien créé). */
  async function all(): Promise<[string, ReturnEntry][]> {
    if (b === null || !(await b.exists())) return [];
    const k = await key();
    const t = now();
    const out: [string, ReturnEntry][] = [];
    for (const [id, r] of await b.all()) {
      const e = await open(id, r, k);
      if (e === null || e.expiresAt <= t) await b.del(id).catch(() => undefined);
      else out.push([id, e]);
    }
    return out;
  }
  const quiet = async <T>(f: () => Promise<T>, fallback: T): Promise<T> => {
    try {
      return await f();
    } catch {
      return fallback;
    }
  };

  return {
    find: (tag) => quiet(async () => (TAG.test(tag) ? ((await all()).find(([, e]) => e.tag === tag)?.[1].grant ?? null) : null), null),
    save: (e) =>
      quiet(async () => {
        const c = clean(e);
        if (b === null || c === null || c.expiresAt <= now()) return;
        const k = await key();
        for (const [id, x] of await all()) if (x.tag === c.tag) await b.del(id);
        const id = randomId();
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const pt = new TextEncoder().encode(JSON.stringify(c));
        const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad(id) }, k, pt));
        pt.fill(0);
        await b.put(id, { iv, ct });
      }, undefined),
    forget: (tag) =>
      quiet(async () => {
        for (const [id, x] of await all()) if (x.tag === tag) await b!.del(id);
      }, undefined),
  };
}

let shared: Returns | undefined;
/** Instance de la page : IndexedDB du site ; démo : mémoire de l'onglet ; indisponible : rien n'est gardé. */
export function pageReturns(): Returns {
  if (shared) return shared;
  let backend: Backend | null = null;
  if (getDemo()) backend = memoryBackend();
  else {
    try {
      const idb = globalThis.indexedDB;
      backend = idb ? idbBackend(idb, RETURNS_DB) : null;
    } catch {
      backend = null; // accès refusé (certains navigateurs en navigation privée, cadres)
    }
  }
  return (shared = openReturns({ backend }));
}
