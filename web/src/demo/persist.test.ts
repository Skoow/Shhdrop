// Persistance de la démo (exception démo) : identifiant d'onglet et ménage des segments.
// L'aller-retour complet par IndexedDB est vérifié dans le navigateur (ui-e2e/demo.spec.ts).
import { describe, expect, it } from "vitest";
import type { Snapshot } from "./fake-server";
import { droppedIds, openDemoStore, tabId, TAB_KEY } from "./persist";

function mem(): Storage {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
    key: () => null,
    get length() {
      return m.size;
    },
  } as Storage;
}
const ID = "AAAAAAAAAAAAAAAAAAAAAA";

describe("demo/persist", () => {
  it("tabId : tiré une fois puis relu ; forme vérifiée ; null sans stockage ou s'il refuse", () => {
    const s = mem();
    expect(tabId(s, () => ID)).toBe(ID);
    expect(s.getItem(TAB_KEY)).toBe(ID);
    expect(tabId(s, () => "BBBBBBBBBBBBBBBBBBBBBB")).toBe(ID);
    s.setItem(TAB_KEY, "../x");
    expect(tabId(s, () => "CCCCCCCCCCCCCCCCCCCCCC")).toBe("CCCCCCCCCCCCCCCCCCCCCC");
    expect(tabId(null, () => ID)).toBeNull();
    expect(tabId(mem(), () => "court")).toBeNull();
    const ko = { getItem: () => { throw new Error("refusé"); } } as unknown as Storage;
    expect(tabId(ko, () => ID)).toBeNull();
  });

  it("droppedIds : partages absents de l'état (ni vivants ni en grâce)", () => {
    const snap = { shares: [["a", {}]], dead: [["b", {}]] } as unknown as Snapshot;
    expect(droppedIds(["a", "b", "c"], snap)).toEqual(["c"]);
  });

  it("sans IndexedDB : null (la démo reste en mémoire)", async () => {
    const w = { sessionStorage: mem(), addEventListener() {} } as unknown as Window;
    expect(await openDemoStore(w)).toBeNull();
  });
});
