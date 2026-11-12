// IndexedDB simulé en mémoire, pour les tests seulement (aucune dépendance, `fake-indexeddb`
// refusé par le plan). Couvre le sous-ensemble utilisé par history/store.ts : open avec
// montée de version, objectStoreNames, transaction, objectStore, get, put, delete, clear,
// getAllKeys, getAll. Les valeurs ne sont pas clonées (une CryptoKey reste telle quelle) ;
// `raw()` rend tout ce qui est « sur disque », pour vérifier qu'aucun clair n'y est.

type Req = {
  result: unknown;
  error: DOMException | null;
  onsuccess: ((e: Event) => void) | null;
  onerror: ((e: Event) => void) | null;
  onupgradeneeded?: ((e: Event) => void) | null;
  onblocked?: ((e: Event) => void) | null;
};

function request(): Req {
  return { result: undefined, error: null, onsuccess: null, onerror: null };
}

export type FakeIdb = IDBFactory & { raw(): Map<string, Map<string, Map<IDBValidKey, unknown>>>; failOpen: boolean; failWrites: boolean };

export function fakeIndexedDB(): FakeIdb {
  const conns = new Map<string, Set<{ closed: boolean; onversionchange: ((e: Event) => void) | null }>>();
  const dbs = new Map<string, { version: number; stores: Map<string, Map<IDBValidKey, unknown>> }>();
  const f = {
    failOpen: false,
    failWrites: false,
    raw: () => new Map([...dbs].map(([n, d]) => [n, d.stores])),
    open(name: string, version = 1) {
      const req = request() as Req & { transaction: unknown };
      queueMicrotask(() => {
        if (f.failOpen) {
          req.error = new DOMException("refusé", "InvalidStateError");
          req.onerror?.({ target: req } as unknown as Event);
          return;
        }
        let d = dbs.get(name);
        const fresh = !d;
        if (!d) dbs.set(name, (d = { version: 0, stores: new Map() }));
        const db = makeDb(d);
        (conns.get(name) ?? conns.set(name, new Set()).get(name)!).add(db);
        req.result = db;
        if (fresh || d.version < version) {
          d.version = version;
          // Montée de version annulable : une base neuve annulée n'existe pas (comme IndexedDB).
          let aborted = false;
          (req as unknown as { transaction: unknown }).transaction = { abort: () => (aborted = true) };
          req.onupgradeneeded?.({ target: req } as unknown as Event);
          if (aborted) {
            if (fresh) dbs.delete(name);
            req.error = new DOMException("annulé", "AbortError");
            req.onerror?.({ target: req } as unknown as Event);
            return;
          }
        }
        req.onsuccess?.({ target: req } as unknown as Event);
      });
      return req;
    },
    deleteDatabase(name: string) {
      const req = request();
      // Comme IndexedDB : chaque connexion ouverte reçoit « versionchange » ; une connexion
      // qui ne se ferme pas bloque (onblocked), la suppression se fait quand même ici.
      const open = [...(conns.get(name) ?? [])];
      for (const c of open) c.onversionchange?.({} as Event);
      if (open.some((c) => !c.closed)) queueMicrotask(() => (req as Req).onblocked?.({ target: req } as unknown as Event));
      conns.delete(name);
      dbs.delete(name);
      queueMicrotask(() => req.onsuccess?.({ target: req } as unknown as Event));
      return req;
    },
  };

  function makeDb(d: { stores: Map<string, Map<IDBValidKey, unknown>> }) {
    const db = {
      closed: false,
      onversionchange: null as ((e: Event) => void) | null,
      get objectStoreNames() {
        return { contains: (n: string) => d.stores.has(n) };
      },
      createObjectStore(n: string) {
        d.stores.set(n, new Map());
      },
      close() {
        db.closed = true;
      },
      transaction(names: string | string[], mode: IDBTransactionMode = "readonly") {
        const tx = {
          oncomplete: null as ((e: Event) => void) | null,
          onerror: null as ((e: Event) => void) | null,
          onabort: null as ((e: Event) => void) | null,
          error: null as DOMException | null,
          pending: 0,
          done: false,
          objectStore(n: string) {
            const s = d.stores.get(n);
            if (!s || !(Array.isArray(names) ? names : [names]).includes(n)) throw new DOMException("absent", "NotFoundError");
            const op = (fn: () => unknown, write: boolean) => {
              const r = request();
              tx.pending++;
              queueMicrotask(() => {
                tx.pending--;
                if (write && (mode !== "readwrite" || f.failWrites)) {
                  r.error = tx.error = new DOMException("écriture refusée", "QuotaExceededError");
                  r.onerror?.({ target: r } as unknown as Event);
                  tx.onerror?.({ target: r } as unknown as Event);
                  tx.done = true;
                  tx.onabort?.({ target: tx } as unknown as Event);
                  return;
                }
                r.result = fn();
                r.onsuccess?.({ target: r } as unknown as Event);
                queueMicrotask(() => {
                  if (tx.pending === 0 && !tx.done) {
                    tx.done = true;
                    tx.oncomplete?.({ target: tx } as unknown as Event);
                  }
                });
              });
              return r;
            };
            return {
              get: (k: IDBValidKey) => op(() => s.get(k), false),
              getAll: () => op(() => [...s.values()], false),
              getAllKeys: () => op(() => [...s.keys()], false),
              put: (v: unknown, k: IDBValidKey) => op(() => (s.set(k, v), k), true),
              delete: (k: IDBValidKey) => op(() => void s.delete(k), true),
              clear: () => op(() => s.clear(), true),
            };
          },
        };
        return tx;
      },
    };
    return db;
  }
  return f as unknown as FakeIdb;
}
