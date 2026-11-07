import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { INACTIVITY_MS, OPEN_GRANT_KEY, clearOpenGrant, loadOpenGrant, saveOpenGrant, startInactivityGuard } from "./open-grant";

// sessionStorage minimal (environnement node).
class MemStorage {
  m = new Map<string, string>();
  getItem(k: string) {
    return this.m.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, String(v));
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
  get length() {
    return this.m.size;
  }
  key(i: number) {
    return [...this.m.keys()][i] ?? null;
  }
  clear() {
    this.m.clear();
  }
}

const LINK = "A".repeat(43);
const GRANT = "G".repeat(54);
let ss: MemStorage;

beforeEach(() => {
  ss = new MemStorage();
  vi.stubGlobal("sessionStorage", ss);
});
afterEach(() => vi.unstubAllGlobals());

describe("open-grant (spec §41.4)", () => {
  it("écrit exactement { v, link, grant, last } sous shh.og, et le relit", () => {
    saveOpenGrant({ v: 1, link: LINK, grant: GRANT, last: 5, password: "secret" } as never);
    expect([...ss.m.keys()]).toEqual([OPEN_GRANT_KEY]);
    expect(JSON.parse(ss.getItem(OPEN_GRANT_KEY)!)).toEqual({ v: 1, link: LINK, grant: GRANT, last: 5 });
    expect(ss.getItem(OPEN_GRANT_KEY)).not.toContain("secret");
    expect(loadOpenGrant()).toEqual({ v: 1, link: LINK, grant: GRANT, last: 5 });
    clearOpenGrant();
    expect(loadOpenGrant()).toBeNull();
  });

  it("forme inattendue : rien d'écrit, ou entrée effacée à la lecture", () => {
    saveOpenGrant({ v: 1, link: LINK + "A", grant: GRANT, last: 5 });
    saveOpenGrant({ v: 1, link: LINK, grant: "x", last: 5 });
    expect(ss.length).toBe(0);
    for (const bad of ["{", "null", JSON.stringify({ v: 2, link: LINK, grant: GRANT, last: 1 }), JSON.stringify({ v: 1, link: LINK, grant: GRANT, last: 1, pw: "x" })]) {
      ss.setItem(OPEN_GRANT_KEY, bad);
      expect(loadOpenGrant(), bad).toBeNull();
      expect(ss.length).toBe(0);
    }
  });

  it("stockage refusé : aucune exception", () => {
    vi.stubGlobal("sessionStorage", {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
      removeItem: () => {
        throw new Error("SecurityError");
      },
    });
    expect(() => saveOpenGrant({ v: 1, link: LINK, grant: GRANT, last: 1 })).not.toThrow();
    expect(loadOpenGrant()).toBeNull();
    expect(() => clearOpenGrant()).not.toThrow();
  });

  it("garde d'inactivité : 30 min sans activité → effacée, une fois ; l'activité repousse", () => {
    let t = 0;
    let tick: () => void = () => undefined;
    const every = (_ms: number, f: () => void) => ((tick = f), () => void (tick = () => undefined));
    const expire = vi.fn();
    saveOpenGrant({ v: 1, link: LINK, grant: GRANT, last: 0 });
    const g = startInactivityGuard(() => t, expire, every);
    t = INACTIVITY_MS - 1;
    tick();
    g.touch();
    t += INACTIVITY_MS - 1;
    tick();
    expect(loadOpenGrant()).not.toBeNull();
    t += 1;
    tick();
    expect(loadOpenGrant()).toBeNull();
    expect(expire).toHaveBeenCalledTimes(1);
    expect(g.stopped).toBe(true);
    g.touch();
    expect(expire).toHaveBeenCalledTimes(1);
  });

  it("une activité après 30 min d'absence ne sauve pas l'entrée", () => {
    let t = 0;
    const expire = vi.fn();
    saveOpenGrant({ v: 1, link: LINK, grant: GRANT, last: 0 });
    const g = startInactivityGuard(() => t, expire, () => () => undefined);
    t = INACTIVITY_MS;
    g.touch();
    expect(loadOpenGrant()).toBeNull();
    expect(expire).toHaveBeenCalledTimes(1);
  });

  it("le type de l'entrée n'a ni mot de passe, ni R, ni clé de contenu (source)", () => {
    const src = readFileSync(new URL("./open-grant.ts", import.meta.url), "utf8");
    const type = /export type OpenGrantEntry = \{([^}]*)\}/.exec(src)![1]!;
    expect(type.replace(/\/\*.*?\*\//g, "").match(/\b\w+(?=\s*:)/g)).toEqual(["v", "link", "grant", "last"]);
    expect(src).not.toMatch(/password|kContenu|\bR\b\s*:/);
  });
});
