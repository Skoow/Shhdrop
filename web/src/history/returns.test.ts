// Retours sur un partage déjà ouvert (spec D42-22) : l'octroi d'ouverture gardé chiffré dans
// le navigateur (AES-256-GCM, clé non extractible), jamais K_lien ni le mot de passe ; retiré
// à l'échéance, sur demande (destruction, grant_invalid) ; une simple visite n'écrit rien.
import { describe, expect, it } from "vitest";
import { fakeIndexedDB } from "./fake-idb.test-helper";
import { RETURNS_DB, openReturns } from "./returns";
import { idbBackend, memoryBackend } from "./store";

const T0 = Date.UTC(2026, 10, 12, 9, 0);
const TAG = "T".repeat(22);
const TAG2 = "U".repeat(22);
const GRANT = "G".repeat(54);
const GRANT2 = "H".repeat(54);

function dump(m: Map<string, Map<string, Map<IDBValidKey, unknown>>>): string {
  const out: string[] = [];
  const walk = (x: unknown) => {
    if (x instanceof Uint8Array) out.push(new TextDecoder("latin1").decode(x));
    else if (x instanceof Map) for (const [k, y] of x) (out.push(String(k)), walk(y));
    else if (x && typeof x === "object" && !(x instanceof CryptoKey)) for (const [k, y] of Object.entries(x)) (out.push(k), walk(y));
    else out.push(String(x));
  };
  walk(m);
  return out.join("\n");
}

describe("retours chiffrés (IndexedDB simulé)", () => {
  it("save puis find : l'octroi revient ; rien en clair sur disque (ni étiquette, ni octroi, ni échéance)", async () => {
    const idb = fakeIndexedDB();
    let now = T0;
    const r = openReturns({ backend: idbBackend(idb, RETURNS_DB), now: () => now });
    await r.save({ tag: TAG, grant: GRANT, expiresAt: T0 + 3600_000 });
    expect(await r.find(TAG)).toBe(GRANT);
    expect(await r.find(TAG2)).toBeNull();
    const raw = dump(idb.raw());
    expect(raw).not.toContain(TAG);
    expect(raw).not.toContain(GRANT);
    expect(raw).not.toContain(String(T0 + 3600_000));
    expect(raw).not.toMatch(/grant|tag|expiresAt/);
    expect([...idb.raw().keys()]).toEqual([RETURNS_DB]);
    // Clé non extractible.
    const key = [...idb.raw().get(RETURNS_DB)!.get("meta")!.values()].find((v) => v instanceof CryptoKey) as CryptoKey;
    expect(key.extractable).toBe(false);
    expect(key.algorithm).toMatchObject({ name: "AES-GCM", length: 256 });
    // Relu par une autre ouverture du module (rechargement, autre onglet).
    const r2 = openReturns({ backend: idbBackend(idb, RETURNS_DB), now: () => now });
    expect(await r2.find(TAG)).toBe(GRANT);
    // Échéance : retiré.
    now = T0 + 3600_000;
    expect(await r2.find(TAG)).toBeNull();
    expect(idb.raw().has(RETURNS_DB)).toBe(false); // vide : base supprimée
  });

  it("une visite sans retour gardé n'écrit rien (aucune base créée)", async () => {
    const idb = fakeIndexedDB();
    const r = openReturns({ backend: idbBackend(idb, RETURNS_DB), now: () => T0 });
    expect(await r.find(TAG)).toBeNull();
    await r.forget(TAG);
    expect(idb.raw().size).toBe(0);
  });

  it("même partage : une seule entrée, la dernière ; forget retire ; forme invalide refusée", async () => {
    const idb = fakeIndexedDB();
    const r = openReturns({ backend: idbBackend(idb, RETURNS_DB), now: () => T0 });
    await r.save({ tag: TAG, grant: GRANT, expiresAt: T0 + 60_000 });
    await r.save({ tag: TAG, grant: GRANT2, expiresAt: T0 + 60_000 });
    await r.save({ tag: TAG2, grant: GRANT, expiresAt: T0 + 60_000 });
    expect(await r.find(TAG)).toBe(GRANT2);
    expect(idb.raw().get(RETURNS_DB)!.get("entries")!.size).toBe(2);
    await r.forget(TAG);
    expect(await r.find(TAG)).toBeNull();
    expect(await r.find(TAG2)).toBe(GRANT);
    // Étiquette, octroi ou échéance mal formés, ou déjà échus : rien n'est écrit.
    await r.save({ tag: "court", grant: GRANT, expiresAt: T0 + 60_000 });
    await r.save({ tag: TAG, grant: "x", expiresAt: T0 + 60_000 });
    await r.save({ tag: TAG, grant: GRANT, expiresAt: T0 });
    expect(idb.raw().get(RETURNS_DB)!.get("entries")!.size).toBe(1);
  });

  it("enregistrement abîmé ou chiffré sous une autre clé : ignoré et retiré", async () => {
    const idb = fakeIndexedDB();
    const r = openReturns({ backend: idbBackend(idb, RETURNS_DB), now: () => T0 });
    await r.save({ tag: TAG, grant: GRANT, expiresAt: T0 + 60_000 });
    const entries = idb.raw().get(RETURNS_DB)!.get("entries")!;
    for (const v of entries.values()) (v as { ct: Uint8Array }).ct[0]! ^= 1;
    expect(await r.find(TAG)).toBeNull();
    expect(entries.size).toBe(0);
  });

  it("stockage absent, refusé ou en panne : find rend null, save et forget ne lèvent pas", async () => {
    const none = openReturns({ backend: null, now: () => T0 });
    expect(await none.find(TAG)).toBeNull();
    await none.save({ tag: TAG, grant: GRANT, expiresAt: T0 + 60_000 });
    const idb = fakeIndexedDB();
    idb.failOpen = true;
    const broken = openReturns({ backend: idbBackend(idb, RETURNS_DB), now: () => T0 });
    await broken.save({ tag: TAG, grant: GRANT, expiresAt: T0 + 60_000 });
    expect(await broken.find(TAG)).toBeNull();
    await broken.forget(TAG);
  });

  it("démo : mémoire seulement", async () => {
    const m = memoryBackend();
    const r = openReturns({ backend: m, now: () => T0 });
    await r.save({ tag: TAG, grant: GRANT, expiresAt: T0 + 60_000 });
    expect(await r.find(TAG)).toBe(GRANT);
    expect(m.raw().size).toBe(1);
  });

  it("revue D42-22 : base supprimée quand elle est vide (oubli, échéance) ; balayage au démarrage sans rien créer ; clear efface tout", async () => {
    const idb = fakeIndexedDB();
    let now = T0;
    const r = openReturns({ backend: idbBackend(idb, RETURNS_DB), now: () => now });
    await r.sweep();
    expect(idb.raw().size).toBe(0); // rien créé
    await r.save({ tag: TAG, grant: GRANT, expiresAt: T0 + 60_000 });
    await r.forget(TAG);
    expect(idb.raw().has(RETURNS_DB)).toBe(false);
    await r.save({ tag: TAG, grant: GRANT, expiresAt: T0 + 60_000 });
    await r.save({ tag: TAG2, grant: GRANT, expiresAt: T0 + 120_000 });
    now = T0 + 60_000;
    const r2 = openReturns({ backend: idbBackend(idb, RETURNS_DB), now: () => now });
    await r2.sweep();
    expect(idb.raw().get(RETURNS_DB)!.get("entries")!.size).toBe(1);
    now = T0 + 120_000;
    await r2.sweep();
    expect(idb.raw().has(RETURNS_DB)).toBe(false);
    await r2.save({ tag: TAG, grant: GRANT, expiresAt: now + 60_000 });
    await r2.clear();
    expect(idb.raw().has(RETURNS_DB)).toBe(false);
    expect(await r2.find(TAG)).toBeNull();
    // Après suppression, une nouvelle écriture recrée la base (nouvelle clé).
    await r2.save({ tag: TAG, grant: GRANT2, expiresAt: now + 60_000 });
    expect(await r2.find(TAG)).toBe(GRANT2);
  });
});
