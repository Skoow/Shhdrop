// Historique local des envois (spec §33, §33.1 ; UI §9.6). EXCEPTION ÉCRITE à « aucun
// stockage navigateur » (UI §12.1, source-rules.test.ts) : seul ce module touche IndexedDB et
// le secret de gestion stocké.
// - Chaque entrée est chiffrée AES-256-GCM (WebCrypto) avec une clé créée NON EXTRACTIBLE et
//   gardée dans IndexedDB ; nonce aléatoire de 96 bits à chaque écriture ; l'identifiant
//   (tiré au hasard, sans lien avec le partage) est la donnée associée authentifiée.
//   Honnêtement (spec §33) : la clé est sur le même appareil ; ce chiffrement ne protège que
//   d'une lecture naïve du stockage. La vraie protection est le verrouillage de l'appareil.
// - Une entrée ne contient que : le lien de gestion (S_gestion), l'heure locale de création,
//   la taille, le nombre d'éléments, l'échéance, le maximum d'ouvertures, les ouvertures
//   observées et l'état. JAMAIS K_lien, le lien de partage, le mot de passe, un nom ou un
//   contenu : tout champ inconnu est ignoré (`clean`).
// - Entrée terminée (détruite ou expirée) retirée 7 jours après sa fin.
// - Stockage absent ou refusé : openHistory rend null et le site marche sans historique.
// Aucune requête réseau ici (relectures : poll.ts).

export type HistoryState = "ready" | "draining" | "gone" | "expired";
export type Opening = { count: number; between: [number, number] };
export type HistoryEntry = {
  id: string;
  /** Lien de gestion « https://…/#m<S_gestion> », chiffré au repos. */
  manage: string;
  /** Heure locale exacte de la création (jamais envoyée). */
  createdAt: number;
  sizeBytes: number;
  itemsCount: number;
  /** Échéance (ms), d'après le serveur. */
  expiresAt: number;
  maxOpens: number;
  /** Dernier compteur d'ouvertures connu. */
  opensUsed: number;
  /** Changements du compteur observés entre deux relectures (spec §33). */
  opens: Opening[];
  state: HistoryState;
  /** Dernier état connu (création ou dernière relecture réussie). */
  lastSeenAt: number;
  /** Fin observée (détruit, expiré) ; 0 tant que le partage est actif. */
  endedAt: number;
  /** Détruit depuis cet appareil (sinon : constaté absent du serveur). */
  destroyedHere: boolean;
};
export type NewEntry = Pick<HistoryEntry, "manage" | "createdAt" | "sizeBytes" | "itemsCount" | "expiresAt" | "maxOpens">;
export type Patch = Partial<Omit<HistoryEntry, "id" | "manage" | "createdAt" | "sizeBytes" | "itemsCount">>;

export const HISTORY_KEEP_GONE_MS = 7 * 86_400_000;

/** Enregistrement chiffré tel qu'il est stocké. */
export type Rec = { iv: Uint8Array<ArrayBuffer>; ct: Uint8Array<ArrayBuffer> };

/** Accès au stockage (IndexedDB, ou mémoire pour la démo et les tests). */
export type Backend = {
  /** La base existe déjà (sans la créer : une simple visite n'écrit rien). */
  exists(): Promise<boolean>;
  /** Clé déjà gardée, sinon `fresh` est gardée (atomique) ; rend celle qui fait foi. */
  key(fresh: CryptoKey): Promise<CryptoKey>;
  all(): Promise<[string, Rec][]>;
  put(id: string, rec: Rec): Promise<void>;
  del(id: string): Promise<void>;
  clear(): Promise<void>;
  flag(name: string): Promise<unknown>;
  setFlag(name: string, v: unknown): Promise<void>;
  /** Supprime toute la base (clé comprise) ; une écriture suivante la recrée. */
  drop(): Promise<void>;
};

const MANAGE_LINK = /^https?:\/\/[^#\s]+#m[A-Za-z0-9_-]{43}$/;
const ID = /^[A-Za-z0-9_-]{22}$/;
const STATES: readonly HistoryState[] = ["ready", "draining", "gone", "expired"];
const AAD = "shhdrop/history/v1/";

// ---------- IndexedDB ----------

const DB = "shhdrop-history";
const META = "meta";
const ENTRIES = "entries";

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((ok, ko) => {
    r.onsuccess = () => ok(r.result);
    r.onerror = () => ko(r.error ?? new Error("idb"));
  });
}
function done(tx: IDBTransaction): Promise<void> {
  return new Promise((ok, ko) => {
    tx.oncomplete = () => ok();
    tx.onerror = () => ko(tx.error ?? new Error("idb"));
    tx.onabort = () => ko(tx.error ?? new Error("idb"));
  });
}

/** Base `name` (l'historique par défaut ; history/returns.ts a la sienne, même mécanisme). */
export function idbBackend(idb: IDBFactory, name = DB): Backend {
  let opened: Promise<IDBDatabase> | undefined;
  const db = () =>
    (opened ??= new Promise<IDBDatabase>((ok, ko) => {
      const r = idb.open(name, 1);
      r.onupgradeneeded = () => {
        const d = r.result;
        if (!d.objectStoreNames.contains(META)) d.createObjectStore(META);
        if (!d.objectStoreNames.contains(ENTRIES)) d.createObjectStore(ENTRIES);
      };
      r.onsuccess = () => ok(r.result);
      r.onerror = () => ko(r.error ?? new Error("idb"));
      r.onblocked = () => ko(new Error("idb_bloquee"));
    }));
  async function write(store: string, fn: (s: IDBObjectStore) => void): Promise<void> {
    const tx = (await db()).transaction(store, "readwrite");
    const end = done(tx);
    fn(tx.objectStore(store));
    await end;
  }
  return {
    async exists() {
      if (opened) return true;
      // Ouverture sans création : une base neuve voit sa création annulée (rien n'est écrit).
      const found = await new Promise<IDBDatabase | null>((ok, ko) => {
        const r = idb.open(name, 1);
        let fresh = false;
        r.onupgradeneeded = () => {
          fresh = true;
          r.transaction?.abort();
        };
        r.onsuccess = () => ok(r.result);
        r.onerror = () => (fresh ? ok(null) : ko(r.error ?? new Error("idb")));
        r.onblocked = () => ko(new Error("idb_bloquee"));
      });
      if (found === null) return false;
      opened = Promise.resolve(found);
      return true;
    },
    async key(fresh) {
      // Lecture et écriture dans la même transaction : deux onglets ouverts en même temps
      // gardent la même clé (sinon l'un ne relirait plus les entrées de l'autre).
      const tx = (await db()).transaction(META, "readwrite");
      const end = done(tx);
      const s = tx.objectStore(META);
      let k: CryptoKey = fresh;
      const g = s.get("key");
      g.onsuccess = () => {
        if (g.result instanceof CryptoKey) k = g.result;
        else s.put(fresh, "key");
      };
      await end;
      return k;
    },
    async all() {
      const tx = (await db()).transaction(ENTRIES, "readonly");
      const s = tx.objectStore(ENTRIES);
      const [keys, vals] = await Promise.all([req(s.getAllKeys()), req(s.getAll())]);
      return keys.map((k, i) => [String(k), vals[i] as Rec]);
    },
    put: (id, rec) => write(ENTRIES, (s) => s.put(rec, id)),
    del: (id) => write(ENTRIES, (s) => s.delete(id)),
    clear: () => write(ENTRIES, (s) => s.clear()),
    async flag(name) {
      const tx = (await db()).transaction(META, "readonly");
      return req(tx.objectStore(META).get("flag:" + name));
    },
    setFlag: (name, v) => write(META, (s) => (v === undefined ? s.delete("flag:" + name) : s.put(v, "flag:" + name))),
    async drop() {
      const was = opened;
      opened = undefined;
      (await was?.catch(() => null))?.close();
      await new Promise<void>((ok, ko) => {
        const r = idb.deleteDatabase(name);
        r.onsuccess = () => ok();
        r.onerror = () => ko(r.error ?? new Error("idb"));
        r.onblocked = () => ok(); // un autre onglet la tient : supprimée à sa fermeture
      });
    },
  };
}

/** Démo (origine partagée de GitHub Pages : aucun IndexedDB) et tests : en mémoire seulement. */
export function memoryBackend(): Backend & { raw(): Map<string, Rec> } {
  let k: CryptoKey | undefined;
  const m = new Map<string, Rec>();
  const flags = new Map<string, unknown>();
  return {
    raw: () => m,
    exists: async () => k !== undefined,
    key: async (fresh) => (k ??= fresh),
    all: async () => [...m],
    put: async (id, rec) => void m.set(id, rec),
    del: async (id) => void m.delete(id),
    clear: async () => m.clear(),
    flag: async (n) => flags.get(n),
    setFlag: async (n, v) => void (v === undefined ? flags.delete(n) : flags.set(n, v)),
    drop: async () => {
      m.clear();
      flags.clear();
      k = undefined;
    },
  };
}

// ---------- Validation : seuls les champs connus, bien typés ----------

const int = (x: unknown, min = 0): x is number => Number.isSafeInteger(x) && (x as number) >= min;

function clean(x: unknown): HistoryEntry | null {
  if (typeof x !== "object" || x === null) return null;
  const o = x as Record<string, unknown>;
  if (typeof o.id !== "string" || !ID.test(o.id)) return null;
  if (typeof o.manage !== "string" || !MANAGE_LINK.test(o.manage)) return null;
  for (const k of ["createdAt", "sizeBytes", "itemsCount", "expiresAt", "opensUsed", "lastSeenAt", "endedAt"]) if (!int(o[k])) return null;
  if (!int(o.maxOpens, 1)) return null;
  if (!STATES.includes(o.state as HistoryState) || typeof o.destroyedHere !== "boolean" || !Array.isArray(o.opens)) return null;
  const opens: Opening[] = [];
  for (const p of o.opens.slice(-32)) {
    const q = p as Record<string, unknown> | null;
    const b = q?.between;
    if (!q || !int(q.count, 1) || !Array.isArray(b) || b.length !== 2 || !int(b[0]) || !int(b[1])) return null;
    opens.push({ count: q.count as number, between: [b[0] as number, b[1] as number] });
  }
  return {
    id: o.id,
    manage: o.manage,
    createdAt: o.createdAt as number,
    sizeBytes: o.sizeBytes as number,
    itemsCount: o.itemsCount as number,
    expiresAt: o.expiresAt as number,
    maxOpens: o.maxOpens as number,
    opensUsed: o.opensUsed as number,
    opens,
    state: o.state as HistoryState,
    lastSeenAt: o.lastSeenAt as number,
    endedAt: o.endedAt as number,
    destroyedHere: o.destroyedHere,
  };
}

// ---------- État affiché, tri ----------

/** État à afficher : un partage actif dont l'échéance est passée est expiré (sans requête). */
export function effectiveState(e: HistoryEntry, now: number): HistoryState {
  if ((e.state === "ready" || e.state === "draining") && now >= e.expiresAt) return "expired";
  return e.state;
}
export const isActive = (e: HistoryEntry, now: number) => {
  const s = effectiveState(e, now);
  return s === "ready" || s === "draining";
};
/** Fin de l'entrée (pour le tri et le retrait à 7 jours). */
export function endOf(e: HistoryEntry, now: number): number {
  if (e.state === "gone" || e.state === "expired") return e.endedAt || e.expiresAt;
  return effectiveState(e, now) === "expired" ? e.expiresAt : 0;
}

/** UI §9.6.2 : en cours d'effacement, puis actifs par échéance croissante, puis terminés (fin la plus récente d'abord). */
export function sortEntries(list: readonly HistoryEntry[], now: number): HistoryEntry[] {
  const rank = (e: HistoryEntry) => ({ draining: 0, ready: 1, gone: 2, expired: 2 })[effectiveState(e, now)];
  return [...list].sort((a, b) => {
    const r = rank(a) - rank(b);
    if (r !== 0) return r;
    if (rank(a) < 2) return a.expiresAt - b.expiresAt;
    return endOf(b, now) - endOf(a, now);
  });
}

// ---------- Ouverture ----------

export type History = {
  list(): Promise<HistoryEntry[]>;
  get(id: string): Promise<HistoryEntry | null>;
  add(e: NewEntry): Promise<HistoryEntry>;
  update(id: string, patch: Patch): Promise<HistoryEntry | null>;
  remove(id: string): Promise<void>;
  clear(): Promise<void>;
  enabled(): Promise<boolean>;
  setEnabled(v: boolean): Promise<void>;
};

function randomId(): string {
  const b = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
const aad = (id: string) => new TextEncoder().encode(AAD + id);

/**
 * Ouvre l'historique. `backend` null ou toute erreur (IndexedDB absent, refusé, écriture de la
 * clé impossible, WebCrypto absent) : null, le site marche sans historique.
 */
export async function openHistory(deps: { backend: Backend | null; now?: () => number }): Promise<History | null> {
  const now = deps.now ?? Date.now;
  const b = deps.backend;
  if (b === null) return null;
  let key: CryptoKey;
  try {
    const fresh = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    key = await b.key(fresh);
  } catch {
    return null;
  }

  async function seal(e: HistoryEntry): Promise<void> {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const { id, ...body } = e;
    const pt = new TextEncoder().encode(JSON.stringify(body));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad(id) }, key, pt));
    pt.fill(0);
    await b!.put(id, { iv, ct });
  }
  async function open(id: string, r: Rec): Promise<HistoryEntry | null> {
    try {
      if (!ID.test(id) || !(r?.iv instanceof Uint8Array) || !(r.ct instanceof Uint8Array)) return null;
      const pt = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: r.iv, additionalData: aad(id) }, key, r.ct));
      const v = JSON.parse(new TextDecoder().decode(pt)) as Record<string, unknown>;
      pt.fill(0);
      return clean({ ...v, id });
    } catch {
      return null;
    }
  }
  async function all(): Promise<HistoryEntry[]> {
    const t = now();
    const out: HistoryEntry[] = [];
    for (const [id, r] of await b!.all()) {
      const e = await open(id, r);
      const end = e ? endOf(e, t) : 0;
      // Illisible (clé perdue, enregistrement abîmé) ou terminé depuis 7 jours : retiré.
      if (e === null || (end > 0 && t - end >= HISTORY_KEEP_GONE_MS)) await b!.del(id).catch(() => undefined);
      else out.push(e);
    }
    return out;
  }

  const h: History = {
    list: async () => sortEntries(await all(), now()),
    async get(id) {
      return (await all()).find((e) => e.id === id) ?? null;
    },
    async add(n) {
      const t = now();
      const e = clean({
        id: randomId(),
        manage: n.manage,
        createdAt: n.createdAt,
        sizeBytes: n.sizeBytes,
        itemsCount: n.itemsCount,
        expiresAt: n.expiresAt,
        maxOpens: n.maxOpens,
        opensUsed: 0,
        opens: [],
        state: "ready",
        lastSeenAt: Math.min(t, n.createdAt),
        endedAt: 0,
        destroyedHere: false,
      });
      if (e === null) throw new Error("entree_invalide");
      const same = (await all()).find((x) => x.manage === e.manage);
      if (same) return same;
      await seal(e);
      return e;
    },
    async update(id, patch) {
      const old = await h.get(id);
      if (!old) return null;
      const e = clean({ ...old, ...patch, id: old.id, manage: old.manage });
      if (e === null) throw new Error("entree_invalide");
      await seal(e);
      return e;
    },
    remove: (id) => b.del(id),
    clear: () => b.clear(),
    enabled: async () => (await b.flag("off")) !== true,
    setEnabled: (v) => b.setFlag("off", v ? undefined : true),
  };
  // Écriture d'essai : un stockage en lecture seule ou plein se voit tout de suite.
  try {
    await b.setFlag("probe", undefined);
  } catch {
    return null;
  }
  return h;
}
