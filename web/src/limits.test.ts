// Les chiffres affichés (limits.ts) sont ceux que le serveur impose : on les lit dans le code Go.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BUCKETS, CHUNK, MANIFEST_MAX } from "./engine/pure";
import { UPLOAD_WINDOW_MS } from "./flows/send.svelte";
import { CONTENT_MAX, CREATES_PER_DAY, MAX_ITEMS, MAX_OPENS, PENDING_MAX, PW_TRIES, TTL_HOURS, TTL_MAX_HOURS } from "./limits";

const go = (f: string) => readFileSync(new URL(`../../server/internal/${f}`, import.meta.url), "utf8");

describe("limites : mêmes valeurs côté serveur (Go)", () => {
  const service = go("share/service.go");
  const sizing = go("share/sizing.go");
  it("audit M14 : partages par jour et envois en préparation à la fois, par connexion", () => {
    const lim = go("limits/limits.go");
    expect(/CreatesPer64\s*=\s*(\d+)/.exec(lim)?.[1]).toBe(String(CREATES_PER_DAY));
    expect(/PendingPer64\s*=\s*(\d+)/.exec(lim)?.[1]).toBe(String(PENDING_MAX));
    expect(/pendingRetry\s*=\s*60 \* time\.Second/.test(lim)).toBe(true); // seuil « en cours » de send.svelte.ts
  });
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
    expect(MAX_ITEMS).toBe(200);
  });
  it("taille : 2 Gio de données ; le plus grand palier est celui de la spec (32 769 morceaux)", () => {
    expect(CONTENT_MAX).toBe(2 ** 31);
    expect(BUCKETS.at(-1)).toBe(32769);
  });
  it("délai d'envoi : 6 h, comme uploadWindow et purgeWindow du serveur", () => {
    expect(/uploadWindow\s*=\s*(\d+) \* 3600/.exec(service)?.[1]).toBe(String(UPLOAD_WINDOW_MS / 3600_000));
    expect(/purgeWindow\s*=\s*(\d+) \* 3600/.exec(service)?.[1]).toBe(String(UPLOAD_WINDOW_MS / 3600_000));
  });
  it("quotas du jour : 6 Gio par connexion, 12 Gio par /48 (trois partages pleins) ; abandonnés 12 et 24 Gio", () => {
    const lim = go("limits/limits.go");
    const gib = (name: string) => Number(new RegExp(`${name}\\s*=\\s*(\\d+) << 30`).exec(lim)?.[1]);
    expect(gib("BytesPer64") * 2 ** 30).toBe(3 * CONTENT_MAX);
    expect(gib("BytesPer48")).toBe(2 * gib("BytesPer64"));
    expect(gib("AbandonedPer64")).toBe(gib("BytesPer64") * 2);
    expect(gib("AbandonedPer48")).toBe(gib("BytesPer48") * 2);
  });
  it("stockage total par défaut : 200 Gio", () => {
    expect(/StorageMaxBytes: (\d+),/.exec(go("config/config.go"))?.[1]).toBe(String(200 * 2 ** 30));
  });
});

describe("durées de capture (décision du 8 novembre)", () => {
  it("gratuit 5 min / 30 min ; Plus 15 min / 2 h ; Pro 30 min / 2 h ; seule la limite gratuite s'applique", async () => {
    const { CAPTURE_MAX_S, CAPTURE_TIER } = await import("./limits");
    expect(CAPTURE_MAX_S).toEqual({ free: { video: 300, voice: 1800 }, plus: { video: 900, voice: 7200 }, pro: { video: 1800, voice: 7200 } });
    expect(CAPTURE_TIER).toBe("free");
  });
});
