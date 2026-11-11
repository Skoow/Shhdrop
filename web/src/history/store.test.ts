// Historique local des envois (spec §33, §33.1) : chiffré au repos, clé non extractible,
// jamais de K_lien, de mot de passe ni de nom d'élément, entrées terminées retirées après
// 7 jours, « Effacer l'historique », et tout échec de stockage → pas d'historique (null).
import { describe, expect, it } from "vitest";
import { fakeIndexedDB } from "./fake-idb.test-helper";
import {
  HISTORY_KEEP_GONE_MS,
  effectiveState,
  idbBackend,
  memoryBackend,
  openHistory,
  sortEntries,
  type HistoryEntry,
  type NewEntry,
} from "./store";

const MANAGE = "https://shhdrop.example/#m" + "A".repeat(43);
const MANAGE2 = "https://shhdrop.example/#m" + "B".repeat(43);
const T0 = Date.UTC(2026, 10, 5, 20, 14);

const fresh = (over: Partial<NewEntry> = {}): NewEntry => ({
  manage: MANAGE,
  createdAt: T0,
  sizeBytes: 148_897_792,
  itemsCount: 6,
  expiresAt: T0 + 12 * 3600_000,
  maxOpens: 3,
  ...over,
});

/** Tout ce qui est « sur disque », en texte, pour chercher un clair. */
function dump(v: unknown): string {
  const seen: string[] = [];
  const walk = (x: unknown) => {
    if (x instanceof Uint8Array) seen.push(new TextDecoder("latin1").decode(x), Buffer.from(x).toString("hex"));
    else if (x instanceof Map) for (const [k, y] of x) (seen.push(String(k)), walk(y));
    else if (Array.isArray(x)) x.forEach(walk);
    else if (x && typeof x === "object" && !(x instanceof CryptoKey)) for (const [k, y] of Object.entries(x)) (seen.push(k), walk(y));
    else seen.push(String(x));
  };
  walk(v);
  return seen.join("\n");
}

describe("historique chiffré (IndexedDB simulé)", () => {
  it("add puis lecture brute : aucun octet de S_gestion, de la taille, du nombre ni de la date en clair", async () => {
    const idb = fakeIndexedDB();
    const h = (await openHistory({ backend: idbBackend(idb), now: () => T0 }))!;
    expect(h).not.toBeNull();
    const e = await h.add(fresh());
    const raw = dump(idb.raw());
    expect(raw).not.toContain("A".repeat(43));
    expect(raw).not.toContain("shhdrop.example");
    // « #m » seul peut apparaître par hasard dans un chiffré : on cherche le lien de gestion lui-même.
    expect(raw).not.toContain("#mAAAA");
    expect(raw).not.toContain("148897792");
    expect(raw).not.toContain(String(T0));
    expect(raw).not.toMatch(/sizeBytes|itemsCount|createdAt|manage"/);
    // Relue par une nouvelle ouverture (même base) : identique.
    const h2 = (await openHistory({ backend: idbBackend(idb), now: () => T0 }))!;
    expect(await h2.list()).toEqual([e]);
  });

  it("la clé enregistrée est AES-GCM 256, non extractible, et la même au second chargement", async () => {
    const idb = fakeIndexedDB();
    await openHistory({ backend: idbBackend(idb) });
    const meta = idb.raw().get("shhdrop-history")!.get("meta")!;
    const key = meta.get("key") as CryptoKey;
    expect(key).toBeInstanceOf(CryptoKey);
    expect(key.extractable).toBe(false);
    expect(key.algorithm).toMatchObject({ name: "AES-GCM", length: 256 });
    await openHistory({ backend: idbBackend(idb) });
    expect(idb.raw().get("shhdrop-history")!.get("meta")!.get("key")).toBe(key);
  });

  it("nonce aléatoire à chaque écriture (même contenu → deux chiffrés différents)", async () => {
    const b = memoryBackend();
    const h = (await openHistory({ backend: b }))!;
    const e = await h.add(fresh());
    const first = [...b.raw().values()][0]!;
    await h.update(e.id, { opensUsed: 0 });
    const second = [...b.raw().values()][0]!;
    expect(Buffer.from(first.iv).equals(Buffer.from(second.iv))).toBe(false);
    expect(Buffer.from(first.ct).equals(Buffer.from(second.ct))).toBe(false);
  });

  it("une entrée déplacée sous un autre identifiant ne se déchiffre pas (identifiant authentifié) et est écartée", async () => {
    const b = memoryBackend();
    const h = (await openHistory({ backend: b, now: () => T0 }))!;
    const e = await h.add(fresh());
    const rec = b.raw().get(e.id)!;
    await b.put("Z".repeat(22), rec);
    const list = await h.list();
    expect(list.map((x) => x.id)).toEqual([e.id]);
    expect(b.raw().has("Z".repeat(22))).toBe(false);
  });

  it("jamais de K_lien, de mot de passe ni de nom d'élément : les champs inconnus sont ignorés", async () => {
    const h = (await openHistory({ backend: memoryBackend(), now: () => T0 }))!;
    const e = await h.add({ ...fresh(), link: "https://x/#" + "k".repeat(43), password: "secret", names: ["photo.jpg"] } as unknown as NewEntry);
    const keys = Object.keys(e).sort();
    expect(keys).toEqual(
      ["createdAt", "destroyedHere", "endedAt", "expiresAt", "id", "itemsCount", "lastSeenAt", "manage", "maxOpens", "opens", "opensUsed", "sizeBytes", "state"].sort(),
    );
    expect(JSON.stringify(await h.list())).not.toMatch(/photo\.jpg|secret|k{43}/);
  });

  it("refuse un lien qui n'est pas un lien de gestion (un lien de partage ne passe pas)", async () => {
    const h = (await openHistory({ backend: memoryBackend() }))!;
    await expect(h.add(fresh({ manage: "https://shhdrop.example/#" + "k".repeat(43) }))).rejects.toThrow();
    await expect(h.add(fresh({ sizeBytes: -1 }))).rejects.toThrow();
  });

  it("le même lien de gestion n'est gardé qu'une fois", async () => {
    const h = (await openHistory({ backend: memoryBackend(), now: () => T0 }))!;
    const a = await h.add(fresh());
    const b = await h.add(fresh());
    expect(b.id).toBe(a.id);
    expect(await h.list()).toHaveLength(1);
  });

  it("entrée neuve : état prêt, 0 ouverture, connue à la création", async () => {
    const h = (await openHistory({ backend: memoryBackend(), now: () => T0 }))!;
    const e = await h.add(fresh());
    expect(e).toMatchObject({ state: "ready", opensUsed: 0, opens: [], lastSeenAt: T0, endedAt: 0, destroyedHere: false });
    expect(e.id).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });

  it("remove, update, get, clear", async () => {
    const h = (await openHistory({ backend: memoryBackend(), now: () => T0 }))!;
    const a = await h.add(fresh());
    const b = await h.add(fresh({ manage: MANAGE2 }));
    expect((await h.update(a.id, { opensUsed: 1 }))?.opensUsed).toBe(1);
    expect((await h.get(a.id))?.opensUsed).toBe(1);
    expect(await h.update("x".repeat(22), { opensUsed: 1 })).toBeNull();
    await h.remove(b.id);
    expect((await h.list()).map((x) => x.id)).toEqual([a.id]);
    await h.clear();
    expect(await h.list()).toEqual([]);
  });

  it("entrée détruite ou expirée retirée 7 jours après sa fin ; une entrée active dont l'échéance est passée depuis 7 jours aussi", async () => {
    let now = T0;
    const b = memoryBackend();
    const h = (await openHistory({ backend: b, now: () => now }))!;
    const a = await h.add(fresh());
    const c = await h.add(fresh({ manage: MANAGE2 }));
    await h.update(a.id, { state: "gone", endedAt: T0 + 1000 });
    now = T0 + 1000 + HISTORY_KEEP_GONE_MS - 1;
    expect((await h.list()).map((x) => x.id).sort()).toEqual([a.id, c.id].sort());
    now = T0 + 1000 + HISTORY_KEEP_GONE_MS;
    expect((await h.list()).map((x) => x.id)).toEqual([c.id]);
    expect(b.raw().has(a.id)).toBe(false);
    now = c.expiresAt + HISTORY_KEEP_GONE_MS;
    expect(await h.list()).toEqual([]);
  });

  it("préférence « Garder dans mon historique » : activée par défaut (Q-H2), gardée", async () => {
    const idb = fakeIndexedDB();
    const h = (await openHistory({ backend: idbBackend(idb) }))!;
    expect(await h.enabled()).toBe(true);
    await h.setEnabled(false);
    expect(await (await openHistory({ backend: idbBackend(idb) }))!.enabled()).toBe(false);
    await h.setEnabled(true);
    expect(await h.enabled()).toBe(true);
  });

  it("exists : faux tant que rien n'est gardé, et la vérification ne crée aucune base", async () => {
    const idb = fakeIndexedDB();
    expect(await idbBackend(idb).exists()).toBe(false);
    expect(idb.raw().has("shhdrop-history")).toBe(false);
    await openHistory({ backend: idbBackend(idb) });
    expect(await idbBackend(idb).exists()).toBe(true);
  });

  it("stockage indisponible (navigation privée stricte, IndexedDB absent ou refusé) → null, sans exception", async () => {
    expect(await openHistory({ backend: null })).toBeNull();
    const idb = fakeIndexedDB();
    idb.failOpen = true;
    expect(await openHistory({ backend: idbBackend(idb) })).toBeNull();
    const ro = fakeIndexedDB();
    ro.failWrites = true;
    expect(await openHistory({ backend: idbBackend(ro) })).toBeNull();
  });

  it("une écriture refusée plus tard (quota) rejette l'ajout, sans rien casser", async () => {
    const idb = fakeIndexedDB();
    const h = (await openHistory({ backend: idbBackend(idb) }))!;
    idb.failWrites = true;
    await expect(h.add(fresh())).rejects.toBeTruthy();
    idb.failWrites = false;
    expect(await h.list()).toEqual([]);
  });
});

describe("état affiché et tri (UI §9.6.2)", () => {
  const base: HistoryEntry = {
    id: "a".repeat(22),
    manage: MANAGE,
    createdAt: T0,
    sizeBytes: 1,
    itemsCount: 1,
    expiresAt: T0 + 3600_000,
    maxOpens: 1,
    opensUsed: 0,
    opens: [],
    state: "ready",
    lastSeenAt: T0,
    endedAt: 0,
    destroyedHere: false,
  };
  it("échéance passée → expiré, sans requête", () => {
    expect(effectiveState(base, T0)).toBe("ready");
    expect(effectiveState(base, base.expiresAt)).toBe("expired");
    expect(effectiveState({ ...base, state: "draining" }, base.expiresAt + 1)).toBe("expired");
    expect(effectiveState({ ...base, state: "gone" }, base.expiresAt + 1)).toBe("gone");
  });
  it("en cours d'effacement, puis actifs par échéance croissante, puis terminés par fin la plus récente", () => {
    const e = (id: string, o: Partial<HistoryEntry>) => ({ ...base, id: id.repeat(22), ...o });
    const list = [
      e("1", { expiresAt: T0 + 9e6 }),
      e("2", { state: "gone", endedAt: T0 + 10 }),
      e("3", { state: "draining", expiresAt: T0 + 9e7 }),
      e("4", { expiresAt: T0 + 5e6 }),
      e("5", { state: "gone", endedAt: T0 + 20 }),
    ];
    expect(sortEntries(list, T0).map((x) => x.id[0])).toEqual(["3", "4", "1", "5", "2"]);
  });
});
