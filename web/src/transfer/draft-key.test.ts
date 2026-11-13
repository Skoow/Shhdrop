// A5 (spec §29.1, §29.4.4) : K_mdp du mot de passe généré calculé pendant la composition,
// recalculé si le mot de passe change, réutilisé au clic, mis à zéro après l'enveloppe ou à
// l'abandon. Faux serveur de la démo (même contrat que le serveur Go).
import { describe, expect, it, vi } from "vitest";

const kdf = vi.hoisted(() => ({ calls: [] as { pw: string; salt: Uint8Array; key?: Uint8Array }[], hold: null as null | Promise<void> }));
vi.mock("../engine", async (orig) => {
  const m = await orig<typeof import("../engine")>();
  return {
    ...m,
    passwordKeyForCreate: async (pw: string, salt: Uint8Array<ArrayBuffer>) => {
      const c: (typeof kdf.calls)[number] = { pw, salt: new Uint8Array(salt) };
      kdf.calls.push(c);
      if (kdf.hold) await kdf.hold;
      const k = await m.passwordKeyForCreate(pw, salt);
      c.key = k;
      return k;
    },
  };
});

import { createFakeServer } from "../demo/fake-server";
import { generatePassword } from "../engine";
import { openShare, type CaptchaProof, type Item } from "../index";
import { createDraft } from "./draft";

const ORIGIN = "https://demo.test";
const solveCaptcha = async (): Promise<CaptchaProof> => ({ kind: "pow", payload: "demo" });
const net = () => {
  const fake = createFakeServer({ rateBytesPerS: 40 * 1048576 });
  return { fetch: ((u: RequestInfo | URL, i?: RequestInit) => fake.handle(new Request(u, i))) as typeof fetch, retryDelayMs: 1 };
};
const until = async (f: () => boolean, ms = 20_000) => {
  const end = Date.now() + ms;
  while (!f()) {
    if (Date.now() > end) throw new Error("délai dépassé");
    await new Promise((r) => setTimeout(r, 10));
  }
};
const zero = (b?: Uint8Array) => b !== undefined && b.every((x) => x === 0);
const blob = new Blob([new Uint8Array(1000).fill(7)]);
const item = (): Item => ({ kind: "file", name: "a.bin", mime: "application/octet-stream", data: blob });

describe("K_mdp pendant la composition (A5)", { timeout: 60_000 }, () => {
  it("calculé dès que la composition a un élément ; au clic, aucun nouvel Argon2id ; mis à zéro après l'enveloppe", async () => {
    kdf.calls.length = 0;
    const n = net();
    const pw = generatePassword();
    const d = createDraft(ORIGIN, { ...n, solveCaptcha, auto: true });
    d.password(pw);
    await new Promise((r) => setTimeout(r, 30));
    expect(kdf.calls).toEqual([]); // composition vide : rien n'est calculé
    d.sync([{ id: "a", data: blob }]);
    await until(() => kdf.calls[0]?.key !== undefined);
    expect(kdf.calls.map((c) => c.pw)).toEqual([pw]);
    const r = await d.finalize([{ id: "a", item: item() }], { ttlHours: 1, maxOpens: 1, password: pw, solveCaptcha });
    expect(kdf.calls).toHaveLength(1); // réutilisé au clic
    expect(zero(kdf.calls[0]!.key)).toBe(true); // effacé après l'enveloppe
    const o = await openShare(r.link, pw, ORIGIN, undefined, n);
    expect(o.manifest.items[0]!.name).toBe("a.bin");
  });

  it("mot de passe changé : recalculé avec le même sel, l'ancien K_mdp effacé ; le partage s'ouvre avec le nouveau seulement", async () => {
    kdf.calls.length = 0;
    const n = net();
    const a = generatePassword();
    const b = generatePassword();
    const d = createDraft(ORIGIN, { ...n, solveCaptcha, auto: true });
    d.sync([{ id: "a", data: blob }]);
    d.password(a);
    await until(() => kdf.calls[0]?.key !== undefined);
    d.password(b);
    await until(() => kdf.calls[1]?.key !== undefined);
    expect(kdf.calls.map((c) => c.pw)).toEqual([a, b]);
    expect(zero(kdf.calls[0]!.key)).toBe(true);
    expect(kdf.calls[1]!.salt).toEqual(kdf.calls[0]!.salt);
    const r = await d.finalize([{ id: "a", item: item() }], { ttlHours: 1, maxOpens: 2, password: b, solveCaptcha });
    expect(kdf.calls).toHaveLength(2);
    await expect(openShare(r.link, a, ORIGIN, undefined, n)).rejects.toMatchObject({ name: "BadPasswordError" });
    expect((await openShare(r.link, b, ORIGIN, undefined, n)).manifest.items).toHaveLength(1);
  });

  it("changements rapides : un seul calcul à la fois, les résultats périmés effacés, seul le dernier gardé", async () => {
    kdf.calls.length = 0;
    let open: () => void = () => undefined;
    kdf.hold = new Promise((r) => (open = r));
    const n = net();
    const pws = [generatePassword(), generatePassword(), generatePassword()];
    const d = createDraft(ORIGIN, { ...n, solveCaptcha, auto: true });
    d.sync([{ id: "a", data: blob }]);
    for (const p of pws) d.password(p);
    await new Promise((r) => setTimeout(r, 30));
    expect(kdf.calls.map((c) => c.pw)).toEqual([pws[0]]); // le premier tourne, les autres attendent
    kdf.hold = null;
    open();
    await until(() => kdf.calls.length === 2 && kdf.calls[1]!.key !== undefined);
    expect(kdf.calls.map((c) => c.pw)).toEqual([pws[0], pws[2]]); // le deuxième n'est jamais calculé
    expect(zero(kdf.calls[0]!.key)).toBe(true);
    expect(zero(kdf.calls[1]!.key)).toBe(false);
    await d.abandon();
  });

  it("clic avant la fin du calcul : attendu (pas de second Argon2id) ; mot de passe du clic différent : recalculé", async () => {
    kdf.calls.length = 0;
    const n = net();
    const a = generatePassword();
    const d = createDraft(ORIGIN, { ...n, solveCaptcha, auto: true });
    d.sync([{ id: "a", data: blob }]);
    d.password(a);
    const r = await d.finalize([{ id: "a", item: item() }], { ttlHours: 1, maxOpens: 1, password: a, solveCaptcha });
    expect(kdf.calls.map((c) => c.pw)).toEqual([a]);
    expect(zero(kdf.calls[0]!.key)).toBe(true);
    expect(r.link).toContain("#");

    kdf.calls.length = 0;
    const d2 = createDraft(ORIGIN, { ...n, solveCaptcha, auto: true });
    const other = generatePassword();
    d2.sync([{ id: "a", data: blob }]);
    d2.password(a);
    const r2 = await d2.finalize([{ id: "a", item: item() }], { ttlHours: 1, maxOpens: 1, password: other, solveCaptcha });
    expect(kdf.calls.map((c) => c.pw)).toContain(other);
    for (const c of kdf.calls) expect(zero(c.key)).toBe(true);
    expect((await openShare(r2.link, other, ORIGIN, undefined, n)).manifest.items).toHaveLength(1);
  });

  it("abandon (page quittée) : K_mdp effacé, y compris un calcul en cours à son arrivée", async () => {
    kdf.calls.length = 0;
    const n = net();
    const d = createDraft(ORIGIN, { ...n, solveCaptcha, auto: true });
    d.sync([{ id: "a", data: blob }]);
    d.password(generatePassword());
    await until(() => kdf.calls[0]?.key !== undefined);
    await d.abandon();
    expect(zero(kdf.calls[0]!.key)).toBe(true);

    kdf.calls.length = 0;
    let open: () => void = () => undefined;
    kdf.hold = new Promise((r) => (open = r));
    const d2 = createDraft(ORIGIN, { ...n, solveCaptcha, auto: true });
    d2.sync([{ id: "a", data: blob }]);
    d2.password(generatePassword());
    await until(() => kdf.calls.length === 1);
    await d2.abandon();
    kdf.hold = null;
    open();
    await until(() => kdf.calls[0]!.key !== undefined);
    await new Promise((r) => setTimeout(r, 10));
    expect(zero(kdf.calls[0]!.key)).toBe(true);
    // Après l'abandon, plus aucun calcul.
    d2.password(generatePassword());
    await new Promise((r) => setTimeout(r, 30));
    expect(kdf.calls).toHaveLength(1);
  });

  it("page mise en cache (bfcache, password(\"\")) : K_mdp effacé, recalculé au retour", async () => {
    kdf.calls.length = 0;
    const d = createDraft(ORIGIN, { ...net(), solveCaptcha, auto: true });
    d.sync([{ id: "a", data: blob }]);
    const pw = generatePassword();
    d.password(pw);
    await until(() => kdf.calls[0]?.key !== undefined);
    d.password("");
    expect(zero(kdf.calls[0]!.key)).toBe(true);
    d.password(pw);
    await until(() => kdf.calls[1]?.key !== undefined);
    expect(kdf.calls.map((c) => c.pw)).toEqual([pw, pw]);
    await d.abandon();
    expect(zero(kdf.calls[1]!.key)).toBe(true);
  });

  it("mot de passe qui n'a pas la forme générée : jamais calculé d'avance", async () => {
    kdf.calls.length = 0;
    const d = createDraft(ORIGIN, { ...net(), solveCaptcha, auto: true });
    d.sync([{ id: "a", data: blob }]);
    d.password("pas-genere");
    await new Promise((r) => setTimeout(r, 30));
    expect(kdf.calls).toEqual([]);
    await d.abandon();
  });
});
