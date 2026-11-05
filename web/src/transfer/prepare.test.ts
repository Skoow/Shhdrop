// Défi anti-robot récupéré à l'avance (pré-calcul, UI §9.4.2, Q2).
import { afterEach, describe, expect, it, vi } from "vitest";
import { prepareCaptcha } from "./prepare";

afterEach(() => vi.useRealTimers());

const ORIGIN = "https://srv.test";
const salt = (expires: number) => `${"a".repeat(24)}.${"b".repeat(16)}.0?expires=${expires}&`;
const challenge = (extra: Record<string, unknown> = {}) => ({
  algorithm: "SHA-256",
  challenge: "c",
  maxNumber: 1,
  salt: salt(1_800_000_120),
  signature: "g",
  shown_at: "jeton",
  ...extra,
});
const net = (body: unknown, date?: string) => {
  const calls: string[] = [];
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push(`${init?.method ?? "GET"} ${String(input)}`);
    return new Response(JSON.stringify(body), { status: 200, headers: date === undefined ? {} : { Date: date } });
  }) as typeof fetch;
  return { calls, net: { fetch: f, retryDelayMs: 1 } };
};

describe("prepareCaptcha", () => {
  it("GET /api/captcha ; défi sans shown_at ni fallback ; sans en-tête Date : expiresAt = performance.now() + 120 s", async () => {
    vi.useFakeTimers({ toFake: ["Date", "performance"] });
    const s = net(challenge({ fallback: "https://verif.test" }));
    const t = performance.now();
    const p = await prepareCaptcha(ORIGIN, s.net);
    expect(s.calls).toEqual(["GET https://srv.test/api/captcha"]);
    expect(p.challenge).toEqual({ algorithm: "SHA-256", challenge: "c", maxNumber: 1, salt: salt(1_800_000_120), signature: "g" });
    expect(p.fallbackOrigin).toBe("https://verif.test");
    expect(p.expiresAt).toBe(t + 120_000); // « expires= » ignoré : aucune heure du serveur à comparer
    // shown_at et l'instant de réception restent internes.
    expect(Object.keys(p).sort()).toEqual(["challenge", "expiresAt", "fallbackOrigin"]);
    expect(Object.isFrozen(p)).toBe(true);
  });
  it("en-tête Date : validité = min(120 s, expires − Date), toujours sur l'horloge du client", async () => {
    vi.useFakeTimers({ toFake: ["Date", "performance"] });
    const t = performance.now();
    const at = (expires: number, date: string) => prepareCaptcha(ORIGIN, net(challenge({ salt: salt(expires) }), date).net);
    const date = new Date(1_800_000_000_000).toUTCString(); // heure du serveur, sans rapport avec celle du client
    expect((await at(1_800_000_060, date)).expiresAt).toBe(t + 60_000);
    expect((await at(1_800_000_600, date)).expiresAt).toBe(t + 120_000); // plafond : durée de vie d'un défi
    expect((await at(1_799_999_990, date)).expiresAt).toBe(t - 10_000); // déjà périmé selon le serveur
    expect((await at(1_800_000_060, "pas une date")).expiresAt).toBe(t + 120_000);
    expect((await prepareCaptcha(ORIGIN, net(challenge({ salt: "s" }), date).net)).expiresAt).toBe(t + 120_000);
  });
  it("fallback absent ou qui n'est pas une origine → null", async () => {
    expect((await prepareCaptcha(ORIGIN, net(challenge()).net)).fallbackOrigin).toBeNull();
    for (const fallback of [42, "https://verif.test/chemin", "javascript:alert(1)", ""]) {
      expect((await prepareCaptcha(ORIGIN, net(challenge({ fallback })).net)).fallbackOrigin, String(fallback)).toBeNull();
    }
  });
  it("origine invalide : aucune requête ; réponse sans shown_at → erreur", async () => {
    const s = net(challenge());
    await expect(prepareCaptcha("https://srv.test/", s.net)).rejects.toThrow("origine_invalide");
    expect(s.calls).toEqual([]);
    await expect(prepareCaptcha(ORIGIN, net(challenge({ shown_at: undefined })).net)).rejects.toThrow("reponse_invalide");
  });
});
