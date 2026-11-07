import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { cipherText, cipherVeil, rng, scramble } from "./decor";

describe("decor (UI §20.2 S1)", () => {
  it("rng : déterministe, dans [0, 1)", () => {
    const a = rng(77);
    const b = rng(77);
    for (let i = 0; i < 100; i++) {
      const v = a();
      expect(v).toBe(b());
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
    expect(rng(0)()).toBe(rng(1)()); // graine nulle ramenée à 1, comme le prototype
  });

  it("cipherText(77, 40, 6) stable", () => {
    const t = cipherText(77, 40, 6);
    expect(t).toMatchInlineSnapshot(`
      "RQihsMiLrAud1LlZgeY7v4AxDSIrzql9iElrkdK2
      olrqlGqjOy8XyoFRv8kK+3Had9Pdyyuich4gxJgr
      jlG2CGvU4pfS/4e8hV0bdmNEi211O8j6YqIpqNjk
      jBq28H9zh1FET2QbGX961KdF9Dy7ZcwxogtDC9F4
      paQtlCOtMlsXldDp2EQuiyV50SSej1hrXQCnKILJ
      s4XNhgZs8TN++v89pU+F0NLXfzj5bp3IUSS5zBv8"
    `);
    expect(t.split("\n").map((l) => l.length)).toEqual([40, 40, 40, 40, 40, 40]);
    expect(t).toMatch(/^[A-Za-z0-9+/\n]+$/);
  });

  it("cipherVeil : (seed: number) => string, deux fois la même chaîne (M2)", () => {
    expect(cipherVeil.length).toBe(1);
    expect(cipherVeil(42)).toBe(cipherVeil(42));
    expect(cipherVeil(42)).not.toBe(cipherVeil(43));
    expect(cipherVeil(42).split("\n")).toHaveLength(18);
  });

  it("scramble : k = 0 inchangé, k = 1 même longueur, espaces gardées", () => {
    expect(scramble("abc", 0, 1)).toBe("abc");
    const s = scramble("photo de plage.jpg", 1, 9);
    expect(Array.from(s).length).toBe(Array.from("photo de plage.jpg").length);
    expect(s[5]).toBe(" ");
    expect(s).not.toBe("photo de plage.jpg");
    expect(Array.from(scramble("été 🌊", 1, 3)).length).toBe(5);
    expect(scramble("abcdef", 0.5, 2).slice(3)).toBe("def");
  });

  it("n'importe rien de crypto/, transfer/ ni index.ts (aucun import du tout)", () => {
    const raw = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "decor.ts"), "utf8");
    // Code seul : les commentaires nomment ce qui est interdit.
    const code = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(code).not.toMatch(/\bimport\b|\brequire\s*\(/);
    expect(code).not.toMatch(/crypto|transfer|index|getRandomValues/);
  });
});

describe("motifs d'impression (accueil v3)", () => {
  it("guilloche : n tracés, déterministes, dans la boîte", async () => {
    const { guilloche } = await import("./decor");
    const a = guilloche(400, 100, 6);
    expect(a).toHaveLength(6);
    expect(guilloche(400, 100, 6)).toEqual(a);
    for (const d of a) {
      expect(d.startsWith("M0 ")).toBe(true);
      const ys = [...d.matchAll(/[ML](\d+) (-?[\d.]+)/g)].map((m) => Number(m[2]));
      expect(ys.length).toBe(51);
      for (const y of ys) {
        expect(y).toBeGreaterThanOrEqual(0);
        expect(y).toBeLessThanOrEqual(100);
      }
    }
  });
  it("rosette : courbe fermée, bornée par R + r + d", async () => {
    const { rosette } = await import("./decor");
    const d = rosette(15, 1, 3, 24);
    expect(d.endsWith("Z")).toBe(true);
    for (const m of d.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)) {
      expect(Math.hypot(Number(m[1]) - 24, Number(m[2]) - 24)).toBeLessThanOrEqual(19.01);
    }
  });
});
