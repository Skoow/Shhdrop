import { afterEach, describe, expect, it, vi } from "vitest";
import { BadResponse, HttpError, captcha, ctx, destroy, finalize, getSegment, putSegment } from "./api";
import type { SGestion } from "../crypto/types";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("nouveaux essais (routes rejouables hors envoi)", () => {
  it("coupure persistante : 1 + 5 essais, attentes 0,5 → 8 s, puis « reseau »", async () => {
    vi.useFakeTimers();
    const at: number[] = [];
    const f = vi.fn(async () => {
      at.push(Date.now());
      throw new TypeError("fetch failed");
    });
    const p = getSegment(ctx("http://x", { fetch: f as unknown as typeof fetch }), "id", "t", 0, 1);
    const r = expect(p).rejects.toThrow("reseau");
    await vi.runAllTimersAsync();
    await r;
    expect(at.slice(1).map((t, i) => t - at[i]!)).toEqual([500, 1000, 2000, 4000, 8000]);
  });

  it("4xx : aucun nouvel essai ; 5xx : nouvel essai", async () => {
    const res = (s: number) => new Response(JSON.stringify({ error: s === 404 ? "not_found" : "internal" }), { status: s });
    const f404 = vi.fn(async () => res(404));
    await expect(getSegment(ctx("http://x", { fetch: f404 as unknown as typeof fetch }), "id", "t", 0, 1)).rejects.toBeInstanceOf(HttpError);
    expect(f404).toHaveBeenCalledTimes(1);

    let n = 0;
    const f5xx = vi.fn(async () => (++n < 3 ? res(500) : new Response(new Uint8Array(1))));
    await getSegment(ctx("http://x", { fetch: f5xx as unknown as typeof fetch, retryDelayMs: 1 }), "id", "t", 0, 1);
    expect(f5xx).toHaveBeenCalledTimes(3);
  });

  it("dernier essai : l'erreur réelle est relancée, pas « reseau »", async () => {
    const short = vi.fn(async () => new Response(new Uint8Array(3)));
    await expect(getSegment(ctx("http://x", { fetch: short as unknown as typeof fetch, retryDelayMs: 1 }), "id", "t", 0, 10)).rejects.toBeInstanceOf(BadResponse);
    expect(short).toHaveBeenCalledTimes(6);
    const err500 = vi.fn(async () => new Response('{"error":"internal"}', { status: 500 }));
    const e = await getSegment(ctx("http://x", { fetch: err500 as unknown as typeof fetch, retryDelayMs: 1 }), "id", "t", 0, 10).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(HttpError);
    expect((e as HttpError).status).toBe(500);
  });
});

describe("envoi : PUT de segment et finalize sans essai interne (le budget de createShare réessaie)", () => {
  it("putSegment : un seul appel de l'Uploader ; erreur HTTP → HttpError (retry_after_s lu) ; coupure transmise", async () => {
    const up = vi.fn(async () => ({ status: 429, json: { error: "limit", retry_after_s: 9 } }));
    const c = ctx("http://x", { upload: up });
    const e = await putSegment(c, "i d", "t", 2, new Uint8Array(4), () => undefined).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(HttpError);
    expect([(e as HttpError).status, (e as HttpError).retryAfterS]).toEqual([429, 9]);
    expect(up).toHaveBeenCalledTimes(1);
    expect(up.mock.calls[0]).toEqual([
      "http://x/api/shares/i%20d/segments/2",
      { Authorization: "Bearer t", "Content-Type": "application/octet-stream" },
      new Uint8Array(4),
      expect.any(Function),
      undefined,
    ]);
    const cut = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    await expect(putSegment(ctx("http://x", { upload: cut }), "id", "t", 0, new Uint8Array(1), () => undefined)).rejects.toBeInstanceOf(TypeError);
    expect(cut).toHaveBeenCalledTimes(1);
    const ok = vi.fn(async () => ({ status: 204, json: null }));
    await putSegment(ctx("http://x", { upload: ok }), "id", "t", 0, new Uint8Array(1), () => undefined);
  });

  it("finalize : un seul appel ; coupure → « reseau » ; signal transmis à fetch", async () => {
    const f = vi.fn(async (_: RequestInfo | URL, _i?: RequestInit): Promise<Response> => {
      throw new TypeError("fetch failed");
    });
    await expect(finalize(ctx("http://x", { fetch: f as unknown as typeof fetch, retryDelayMs: 1 }), "id", "t")).rejects.toThrow("reseau");
    expect(f).toHaveBeenCalledTimes(1);
    const ac = new AbortController();
    const g = vi.fn(async (_: RequestInfo | URL, _i?: RequestInit) => new Response('{"expires_in_s":5}'));
    expect(await finalize(ctx("http://x", { fetch: g as unknown as typeof fetch }), "id", "t", ac.signal)).toBe(5);
    expect(g.mock.calls[0]![1]!.signal).toBe(ac.signal);
  });

  it("finalize annulé : AbortError (pas « reseau »)", async () => {
    const ac = new AbortController();
    const f = vi.fn(async () => {
      ac.abort();
      throw new DOMException("Aborted", "AbortError");
    });
    await expect(finalize(ctx("http://x", { fetch: f as unknown as typeof fetch }), "id", "t", ac.signal)).rejects.toMatchObject({ name: "AbortError" });
  });
});

it("destroy avec S_gestion : keepalive si demandé", async () => {
  const f = vi.fn(async (_: RequestInfo | URL, _i?: RequestInit) => new Response(null, { status: 204 }));
  const c = ctx("http://x", { fetch: f as unknown as typeof fetch });
  await destroy(c, "id", { sGestion: new Uint8Array(32) as SGestion }, undefined, true);
  await destroy(c, "id", { sGestion: new Uint8Array(32) as SGestion });
  expect(f.mock.calls.map((x) => x[1]!.keepalive)).toEqual([true, undefined]);
});

describe("choix du transport des segments", () => {
  class X {}
  it("XMLHttpRequest présent et fetch non fourni → XMLHttpRequest ; fetch fourni → fetch", async () => {
    vi.stubGlobal("XMLHttpRequest", X);
    const { xhrUploader } = await import("./upload");
    expect(ctx("http://x").upload).toBe(xhrUploader);
    const f = vi.fn(async (_: RequestInfo | URL, _i?: RequestInit) => new Response(null, { status: 204 }));
    const c = ctx("http://x", { fetch: f as unknown as typeof fetch });
    expect(c.upload).not.toBe(xhrUploader);
    await c.upload("http://x/a", {}, new Uint8Array(1), () => undefined);
    expect(f).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
    expect(ctx("http://x").upload).not.toBe(xhrUploader); // Node : pas de XMLHttpRequest
  });
});

it("captcha : défi sans shown_at ni fallback, sel du défi et origine de repli lus", async () => {
  const body = { algorithm: "SHA-256", challenge: "c", maxNumber: 1, salt: "s?expires=1800000000&", signature: "g", shown_at: "j", fallback: "https://v.test" };
  const f = vi.fn(async () => new Response(JSON.stringify(body)));
  const r = await captcha(ctx("http://x", { fetch: f as unknown as typeof fetch }));
  expect(r).toMatchObject({
    challenge: { algorithm: "SHA-256", challenge: "c", maxNumber: 1, salt: "s?expires=1800000000&", signature: "g" },
    shownAt: "j",
    salt: "s?expires=1800000000&",
    fallbackOrigin: "https://v.test",
    expiresAt: 1_800_000_000_000,
  });
  expect(typeof r.receivedAt).toBe("number");
});
