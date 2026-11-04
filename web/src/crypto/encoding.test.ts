import { describe, expect, it } from "vitest";
import { b64u, concat, unb64u, utf8 } from "./encoding";

describe("base64url", () => {
  it("aller-retour sur vide, [0] et 32 octets aléatoires", () => {
    const cas = [new Uint8Array([]), new Uint8Array([0]), crypto.getRandomValues(new Uint8Array(32))];
    for (const c of cas) expect(unb64u(b64u(c))).toEqual(c);
  });
  it("ne contient jamais + / =", () => {
    for (let i = 0; i < 200; i++) {
      const s = b64u(crypto.getRandomValues(new Uint8Array(1 + (i % 40))));
      expect(s).not.toMatch(/[+/=]/);
    }
    expect(b64u(new Uint8Array([0xfb, 0xff, 0xfe]))).toBe("-__-");
  });
  it("rejette une entrée invalide", () => {
    expect(() => unb64u("a+b")).toThrow("base64url invalide");
    expect(() => unb64u("a")).toThrow("base64url invalide");
    expect(() => unb64u("ab=")).toThrow("base64url invalide");
  });
});

describe("utf8 / concat", () => {
  it("encode en UTF-8", () => {
    expect(utf8("é")).toEqual(new Uint8Array([0xc3, 0xa9]));
  });
  it("concatène", () => {
    expect(concat(new Uint8Array([1]), new Uint8Array([]), new Uint8Array([2, 3]))).toEqual(new Uint8Array([1, 2, 3]));
    expect(concat()).toEqual(new Uint8Array([]));
  });
});
