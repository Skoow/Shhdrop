// Persistance du faux serveur de la démo GitHub Pages (UI §14.3), EXCEPTION DÉMO écrite à
// « aucun stockage navigateur » (source-rules.test.ts) : sans elle, recharger la page du
// destinataire mène à « Lien invalide », car le faux serveur vivait en mémoire de l'onglet.
// Ce qui est gardé est exactement ce que garde le vrai serveur : empreintes, sel, enveloppe,
// segments chiffrés, jetons et octrois (aucun lien, mot de passe, clé ni contenu en clair).
// - IndexedDB de l'origine de la démo, rangé par onglet (identifiant tiré au hasard, gardé en
//   sessionStorage) : un autre onglet ne voit pas ces partages, comme avant ; un rechargement
//   les retrouve.
// - Effacé à la visite suivante une fois périmé (aucune écriture depuis STALE_MS, plus que la
//   durée de vie maximale d'un partage et sa grâce) ; un partage retiré perd ses segments.
// - Toute erreur (stockage refusé, quota) : la démo continue en mémoire, comme avant.
// Jamais dans le build de production (garde demoGuard, check-dist).
import type { Snapshot } from "./fake-server";

export const MARK = "__SHH_DEMO__";

const DB = "shhdrop-demo";
const META = "meta";
const SEGS = "segs";
export const TAB_KEY = "shh.demo.tab";
/** 24 h (durée maximale) + 2 h de grâce + marge. */
export const STALE_MS = 27 * 3600_000;
const TAB = /^[A-Za-z0-9_-]{22}$/;

type MetaRow = { snap: Snapshot; at: number };

export type DemoStore = {
  /** État retrouvé (null : premier chargement de cet onglet). */
  readonly snap: Snapshot | null;
  segment(id: string, n: number): Uint8Array | undefined;
  /** Écritures regroupées ; la dernière gagne. */
  saveMeta(s: Snapshot): void;
  saveSegment(id: string, n: number, data: Uint8Array): void;
  /** Lâche les segments chargés (le faux serveur les garde désormais). */
  release(): void;
};

/** Identifiant de l'onglet : relu de sessionStorage, ou tiré et écrit ; null si refusé. */
export function tabId(store: Storage | null, rand: () => string): string | null {
  if (store === null) return null;
  try {
    const old = store.getItem(TAB_KEY);
    if (old !== null && TAB.test(old)) return old;
    const id = rand();
    if (!TAB.test(id)) return null;
    store.setItem(TAB_KEY, id);
    return id;
  } catch {
    return null;
  }
}

/** Identifiants de partage qui ne sont plus dans l'état : leurs segments sont à effacer. */
export function droppedIds(known: Iterable<string>, snap: Snapshot): string[] {
  const keep = new Set<string>([...snap.shares.map(([id]) => id), ...snap.dead.map(([id]) => id)]);
  return [...known].filter((id) => !keep.has(id));
}

function randomTab(): string {
  const b = crypto.getRandomValues(new Uint8Array(16));
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const req = <T>(r: IDBRequest<T>) =>
  new Promise<T>((ok, ko) => {
    r.onsuccess = () => ok(r.result);
    r.onerror = () => ko(r.error);
  });

function openDb(idb: IDBFactory): Promise<IDBDatabase> {
  const r = idb.open(DB, 1);
  r.onupgradeneeded = () => {
    r.result.createObjectStore(META);
    r.result.createObjectStore(SEGS);
  };
  return req(r);
}

const tabRange = (tab: string) => IDBKeyRange.bound([tab], [tab, []]);
const shareRange = (tab: string, id: string) => IDBKeyRange.bound([tab, id], [tab, id, []]);

/** Identifiant d'onglet déjà tiré, sans en créer (null sinon). */
function readTab(store: Storage | null): string | null {
  try {
    const v = store?.getItem(TAB_KEY) ?? null;
    return v !== null && TAB.test(v) ? v : null;
  } catch {
    return null;
  }
}

/**
 * Ouvre le stockage de la démo pour cet onglet ; null si IndexedDB ou sessionStorage manque.
 * Rien n'est écrit (ni identifiant d'onglet, ni base) avant le premier partage créé.
 */
export async function openDemoStore(w: Window, now: () => number = Date.now): Promise<DemoStore | null> {
  let ss: Storage | null = null;
  try {
    ss = w.sessionStorage;
  } catch {
    /* refusé */
  }
  const idb = (w as Window & { indexedDB?: IDBFactory }).indexedDB;
  if (ss === null || ss === undefined || idb === undefined) return null;
  let tab = readTab(ss);
  let snap: Snapshot | null = null;
  let segs = new Map<string, Uint8Array>();
  let dbp: Promise<IDBDatabase> | null = null;

  /** Base ouverte, onglets périmés effacés ; état de cet onglet chargé s'il existe. */
  async function load(): Promise<IDBDatabase> {
    const db = await openDb(idb!);
    const tx0 = db.transaction([META, SEGS], "readwrite");
    const metas = tx0.objectStore(META);
    const keys = (await req(metas.getAllKeys())) as string[];
    const rows = (await req(metas.getAll())) as MetaRow[];
    keys.forEach((k, i) => {
      if (k !== tab && !(now() - rows[i]!.at < STALE_MS)) {
        metas.delete(k);
        tx0.objectStore(SEGS).delete(tabRange(k));
      }
    });
    const mine = tab === null ? undefined : rows[keys.indexOf(tab)];
    if (tab !== null && mine !== undefined && now() - mine.at < STALE_MS && mine.snap?.v === 1) {
      snap = mine.snap;
      const st = tx0.objectStore(SEGS);
      const sk = (await req(st.getAllKeys(tabRange(tab)))) as [string, string, number][];
      const sv = (await req(st.getAll(tabRange(tab)))) as Uint8Array[];
      sk.forEach((k, i) => segs.set(`${k[1]}:${k[2]}`, sv[i]!));
    }
    return db;
  }

  if (tab !== null) {
    try {
      dbp = Promise.resolve(await load());
    } catch {
      return null;
    }
  }

  let off = false;
  /** Écriture différée ; l'onglet et la base sont créés à la première. */
  function withDb(fn: (db: IDBDatabase, tab: string) => void): void {
    if (off) return;
    if (dbp === null) {
      tab = tabId(ss, randomTab);
      if (tab === null) {
        off = true;
        return;
      }
      dbp = load();
    }
    dbp.then((db) => fn(db, tab!)).catch(() => (off = true)); // refus, quota : la démo continue en mémoire
  }

  const known = new Set<string>(snap ? [...(snap as Snapshot).shares.map(([id]) => id), ...(snap as Snapshot).dead.map(([id]) => id)] : []);
  let pending: Snapshot | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const flush = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    const s = pending;
    pending = null;
    if (s === null) return;
    // Rien à garder et rien de gardé : aucune écriture (pas de trace d'une simple visite).
    if (dbp === null && s.shares.length === 0 && s.dead.length === 0) return;
    withDb((db, t) => {
      const tx = db.transaction([META, SEGS], "readwrite");
      tx.objectStore(META).put({ snap: s, at: now() } satisfies MetaRow, t);
      for (const id of droppedIds(known, s)) {
        tx.objectStore(SEGS).delete(shareRange(t, id));
        known.delete(id);
      }
    });
  };
  w.addEventListener("pagehide", flush);

  return {
    get snap() {
      return snap;
    },
    segment: (id, n) => segs.get(`${id}:${n}`),
    saveMeta(s) {
      pending = s;
      timer ??= setTimeout(flush, 30);
    },
    saveSegment(id, n, data) {
      known.add(id);
      withDb((db, t) => db.transaction(SEGS, "readwrite").objectStore(SEGS).put(data, [t, id, n]));
    },
    release() {
      segs = new Map();
    },
  };
}
