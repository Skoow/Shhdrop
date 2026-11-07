import { createHash, webcrypto } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseChallenge, payload, search } from "./search";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const SALT = "0123456789abcdef01234567.0011223344556677.0?expires=1999999999&";

describe("preuve de travail (UI §9.4.2)", () => {
  it("trouve le nombre (SHA-256 du navigateur), rend la charge utile ALTCHA", async () => {
    const c = parseChallenge({ algorithm: "SHA-256", challenge: sha(SALT + 1234), maxNumber: 5000, salt: SALT, signature: "sig" });
    const seen: number[] = [];
    expect(await search(c, webcrypto.subtle as SubtleCrypto, (n) => seen.push(n))).toBe(1234);
    expect(seen.length).toBeGreaterThan(0);
    expect(JSON.parse(atob(payload(c, 1234, 7)))).toEqual({ algorithm: "SHA-256", challenge: c.challenge, number: 1234, salt: SALT, signature: "sig", took: 7 });
  });

  it("aucun nombre jusqu'à maxNumber → null ; arrêt demandé → null", async () => {
    const c = { challenge: sha("autre"), maxNumber: 300, salt: SALT };
    expect(await search(c, webcrypto.subtle as SubtleCrypto)).toBeNull();
    expect(await search({ ...c, maxNumber: 1e6 }, webcrypto.subtle as SubtleCrypto, undefined, () => true)).toBeNull();
  });

  it("défi mal formé ou démesuré refusé", () => {
    const ok = { algorithm: "SHA-256", challenge: sha("x"), maxNumber: 10, salt: SALT, signature: "s" };
    expect(() => parseChallenge(ok)).not.toThrow();
    for (const bad of [null, { ...ok, algorithm: "SHA-1" }, { ...ok, maxNumber: 1e9 }, { ...ok, challenge: "zz" }, { ...ok, salt: 3 }])
      expect(() => parseChallenge(bad)).toThrow("defi_invalide");
  });
});
