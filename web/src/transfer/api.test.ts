import { afterEach, describe, expect, it, vi } from "vitest";
import { BadResponse, HttpError, ctx, getSegment, putSegment } from "./api";

afterEach(() => vi.useRealTimers());

describe("nouveaux essais", () => {
  it("coupure persistante : 1 + 5 essais, attentes 0,5 → 8 s, puis « reseau »", async () => {
    vi.useFakeTimers();
    const at: number[] = [];
    const f = vi.fn(async () => {
      at.push(Date.now());
      throw new TypeError("fetch failed");
    });
    const p = putSegment(ctx("http://x", { fetch: f as unknown as typeof fetch }), "id", "t", 0, new Uint8Array(1));
    const r = expect(p).rejects.toThrow("reseau");
    await vi.runAllTimersAsync();
    await r;
    expect(at.slice(1).map((t, i) => t - at[i]!)).toEqual([500, 1000, 2000, 4000, 8000]);
  });

  it("4xx : aucun nouvel essai ; 5xx : nouvel essai", async () => {
    const res = (s: number) => new Response(JSON.stringify({ error: s === 404 ? "not_found" : "internal" }), { status: s });
    const f404 = vi.fn(async () => res(404));
    await expect(putSegment(ctx("http://x", { fetch: f404 as unknown as typeof fetch }), "id", "t", 0, new Uint8Array(1))).rejects.toBeInstanceOf(HttpError);
    expect(f404).toHaveBeenCalledTimes(1);

    let n = 0;
    const f5xx = vi.fn(async () => (++n < 3 ? res(500) : new Response(null, { status: 204 })));
    await putSegment(ctx("http://x", { fetch: f5xx as unknown as typeof fetch, retryDelayMs: 1 }), "id", "t", 0, new Uint8Array(1));
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
