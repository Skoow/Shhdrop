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
const net = (body: unknown) => {
  const calls: string[] = [];
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push(`${init?.method ?? "GET"} ${String(input)}`);
    return new Response(JSON.stringify(body), { status: 200 });
  }) as typeof fetch;
  return { calls, net: { fetch: f, retryDelayMs: 1 } };
};

describe("prepareCaptcha", () => {
  it("GET /api/captcha ; défi sans shown_at ni fallback ; expiresAt lu dans « expires= » du sel", async () => {
    const s = net(challenge({ fallback: "https://verif.test" }));
    const p = await prepareCaptcha(ORIGIN, s.net);
    expect(s.calls).toEqual(["GET https://srv.test/api/captcha"]);
    expect(p.challenge).toEqual({ algorithm: "SHA-256", challenge: "c", maxNumber: 1, salt: salt(1_800_000_120), signature: "g" });
    expect(p.fallbackOrigin).toBe("https://verif.test");
    expect(p.expiresAt).toBe(1_800_000_120_000);
    // shown_at et l'instant de réception restent internes.
    expect(Object.keys(p).sort()).toEqual(["challenge", "expiresAt", "fallbackOrigin"]);
    expect(Object.isFrozen(p)).toBe(true);
  });
  it("fallback absent ou qui n'est pas une origine → null ; sel sans « expires= » → expiresAt 0 (périmé)", async () => {
    expect((await prepareCaptcha(ORIGIN, net(challenge()).net)).fallbackOrigin).toBeNull();
    for (const fallback of [42, "https://verif.test/chemin", "javascript:alert(1)", ""]) {
      expect((await prepareCaptcha(ORIGIN, net(challenge({ fallback })).net)).fallbackOrigin, String(fallback)).toBeNull();
    }
    expect((await prepareCaptcha(ORIGIN, net(challenge({ salt: "s" })).net)).expiresAt).toBe(0);
  });
  it("origine invalide : aucune requête ; réponse sans shown_at → erreur", async () => {
    const s = net(challenge());
    await expect(prepareCaptcha("https://srv.test/", s.net)).rejects.toThrow("origine_invalide");
    expect(s.calls).toEqual([]);
    await expect(prepareCaptcha(ORIGIN, net(challenge({ shown_at: undefined })).net)).rejects.toThrow("reponse_invalide");
  });
});
