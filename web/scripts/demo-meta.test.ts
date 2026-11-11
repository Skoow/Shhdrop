// CSP de la démo (test d'intrusion du 11 novembre) : mêmes directives que la production
// (server/internal/api/headers.go), sauf les écarts écrits dans demo-meta.mjs.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { DEMO_CSP } from "./demo-meta.mjs";

const parse = (csp: string) => new Map(csp.split(";").map((d) => d.trim()).filter(Boolean).map((d) => [d.split(/\s+/u)[0]!, d] as const));

function productionCsp(): string {
  const go = readFileSync(fileURLToPath(new URL("../../server/internal/api/headers.go", import.meta.url)), "utf8");
  const m = /\{"Content-Security-Policy",((?:\s*"[^"]*"\s*\+?)+)\}/u.exec(go);
  if (!m) throw new Error("CSP de production introuvable dans headers.go");
  return [...m[1]!.matchAll(/"([^"]*)"/gu)].map((x) => x[1]).join("");
}

describe("CSP de la démo", () => {
  test("mêmes directives que la production, hors connect-src ('none') et frame-ancestors (sans effet en meta)", () => {
    const prod = parse(productionCsp());
    const demo = parse(DEMO_CSP);
    expect(demo.get("connect-src")).toBe("connect-src 'none'");
    expect(demo.has("frame-ancestors")).toBe(false);
    for (const [name, d] of prod) {
      if (name === "connect-src" || name === "frame-ancestors") continue;
      expect(demo.get(name), name).toBe(d);
    }
    expect([...demo.keys()].filter((k) => !prod.has(k))).toEqual([]);
  });
  test("Trusted Types et worker-src présents", () => {
    expect(DEMO_CSP).toContain("require-trusted-types-for 'script'");
    expect(DEMO_CSP).toContain("trusted-types svelte-trusted-html shhdrop");
    expect(DEMO_CSP).toContain("worker-src 'self' blob:");
  });
});
