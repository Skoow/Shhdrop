// Les chiffres affichés (limits.ts) sont ceux que le serveur impose : on les lit dans le code Go.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BUCKETS, CHUNK, MANIFEST_MAX } from "./crypto/container";
import { CONTENT_MAX, MAX_ITEMS, MAX_OPENS, PW_TRIES, TTL_HOURS, TTL_MAX_HOURS } from "./limits";

const go = (f: string) => readFileSync(new URL(`../../server/internal/${f}`, import.meta.url), "utf8");

describe("limites : mêmes valeurs côté serveur (Go)", () => {
  const service = go("share/service.go");
  const sizing = go("share/sizing.go");
  it("essais de mot de passe", () => {
    expect(/maxAttempts\s*=\s*(\d+)/.exec(service)?.[1]).toBe(String(PW_TRIES));
  });
  it("ouvertures : 1 à MAX_OPENS", () => {
    expect(/MaxOpens < 1 \|\| r\.MaxOpens > (\d+)/.exec(service)?.[1]).toBe(String(MAX_OPENS));
  });
  it("durées proposées", () => {
    const m = /func validTTL\(h int\) bool \{ return ([^}]*) \}/.exec(service)?.[1] ?? "";
    expect([...m.matchAll(/h == (\d+)/g)].map((x) => Number(x[1]))).toEqual([...TTL_HOURS]);
    expect(Math.max(...TTL_HOURS)).toBe(TTL_MAX_HOURS);
  });
  it("taille : plus grand palier du serveur moins la réserve du manifeste", () => {
    const b = /var Buckets = \[\]int\{([^}]*)\}/.exec(sizing)?.[1] ?? "";
    const goBuckets = b.split(",").map((x) => Number(x.trim()));
    expect(goBuckets).toEqual([...BUCKETS]);
    expect(CONTENT_MAX).toBe(goBuckets.at(-1)! * CHUNK - 4 - MANIFEST_MAX);
  });
  it("éléments par partage (le serveur ne les voit pas : chiffrés dans le manifeste)", () => {
    expect(MAX_ITEMS).toBe(10);
  });
});
