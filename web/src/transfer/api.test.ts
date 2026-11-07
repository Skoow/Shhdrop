import { afterEach, describe, expect, it, vi } from "vitest";
import { BadResponse, HttpError, captcha, create, ctx, destroy, done, finalize, getSegment, meta, putSegment, status, unlock, type FinalizeBody } from "./api";
import type { KAcces, KPreuve } from "../crypto/types";
import type { SGestion } from "../crypto/types";

const FIN: FinalizeBody = {
  salt: "s".repeat(22),
  kdf_ops: 3,
  kdf_mem: 67108864,
  proof_v: "p".repeat(43),
  envelope: "e".repeat(80),
  ttl_hours: 1,
  max_opens: 2,
  fill_from: 3,
  fill_to: 6,
};

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
    const p = getSegment(ctx("http://x", { fetch: f as unknown as typeof fetch }), "t", 0, 1);
    const r = expect(p).rejects.toThrow("reseau");
    await vi.runAllTimersAsync();
    await r;
    expect(at.slice(1).map((t, i) => t - at[i]!)).toEqual([500, 1000, 2000, 4000, 8000]);
  });

  it("4xx : aucun nouvel essai ; 5xx : nouvel essai", async () => {
    const res = (s: number) => new Response(JSON.stringify({ error: s === 404 ? "not_found" : "internal" }), { status: s });
    const f404 = vi.fn(async () => res(404));
    await expect(getSegment(ctx("http://x", { fetch: f404 as unknown as typeof fetch }), "t", 0, 1)).rejects.toBeInstanceOf(HttpError);
    expect(f404).toHaveBeenCalledTimes(1);

    let n = 0;
    const f5xx = vi.fn(async () => (++n < 3 ? res(500) : new Response(new Uint8Array(1))));
    await getSegment(ctx("http://x", { fetch: f5xx as unknown as typeof fetch, retryDelayMs: 1 }), "t", 0, 1);
    expect(f5xx).toHaveBeenCalledTimes(3);
  });

  it("dernier essai : l'erreur réelle est relancée, pas « reseau »", async () => {
    const short = vi.fn(async () => new Response(new Uint8Array(3)));
    await expect(getSegment(ctx("http://x", { fetch: short as unknown as typeof fetch, retryDelayMs: 1 }), "t", 0, 10)).rejects.toBeInstanceOf(BadResponse);
    expect(short).toHaveBeenCalledTimes(6);
    const err500 = vi.fn(async () => new Response('{"error":"internal"}', { status: 500 }));
    const e = await getSegment(ctx("http://x", { fetch: err500 as unknown as typeof fetch, retryDelayMs: 1 }), "t", 0, 10).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(HttpError);
    expect((e as HttpError).status).toBe(500);
  });
});

describe("envoi : PUT de segment et finalize sans essai interne (le budget de createShare réessaie)", () => {
  it("putSegment : un seul appel de l'Uploader ; erreur HTTP → HttpError (retry_after_s lu) ; coupure transmise", async () => {
    const up = vi.fn(async () => ({ status: 429, json: { error: "limit", retry_after_s: 9 } }));
    const c = ctx("http://x", { upload: up });
    const e = await putSegment(c, "t", 2, new Uint8Array(4), () => undefined).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(HttpError);
    expect([(e as HttpError).status, (e as HttpError).retryAfterS]).toEqual([429, 9]);
    expect(up).toHaveBeenCalledTimes(1);
    expect(up.mock.calls[0]).toEqual([
      "http://x/api/shares/segments/2",
      { Authorization: "Bearer t", "Content-Type": "application/octet-stream" },
      new Uint8Array(4),
      expect.any(Function),
      undefined,
    ]);
    const cut = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    await expect(putSegment(ctx("http://x", { upload: cut }), "t", 0, new Uint8Array(1), () => undefined)).rejects.toBeInstanceOf(TypeError);
    expect(cut).toHaveBeenCalledTimes(1);
    const ok = vi.fn(async () => ({ status: 204, json: null }));
    await putSegment(ctx("http://x", { upload: ok }), "t", 0, new Uint8Array(1), () => undefined);
  });

  it("finalize : un seul appel ; coupure → « reseau » ; signal transmis à fetch", async () => {
    const f = vi.fn(async (_: RequestInfo | URL, _i?: RequestInit): Promise<Response> => {
      throw new TypeError("fetch failed");
    });
    await expect(finalize(ctx("http://x", { fetch: f as unknown as typeof fetch, retryDelayMs: 1 }), "t", FIN)).rejects.toThrow("reseau");
    expect(f).toHaveBeenCalledTimes(1);
    const ac = new AbortController();
    const g = vi.fn(async (_: RequestInfo | URL, _i?: RequestInit) => new Response('{"expires_in_s":5}'));
    expect(await finalize(ctx("http://x", { fetch: g as unknown as typeof fetch }), "t", FIN, ac.signal)).toBe(5);
    expect(g.mock.calls[0]![1]!.signal).toBe(ac.signal);
  });

  it("finalize annulé : AbortError (pas « reseau »)", async () => {
    const ac = new AbortController();
    const f = vi.fn(async () => {
      ac.abort();
      throw new DOMException("Aborted", "AbortError");
    });
    await expect(finalize(ctx("http://x", { fetch: f as unknown as typeof fetch }), "t", FIN, ac.signal)).rejects.toMatchObject({ name: "AbortError" });
  });
});

it("destroy avec S_gestion : keepalive si demandé", async () => {
  const f = vi.fn(async (_: RequestInfo | URL, _i?: RequestInit) => new Response(null, { status: 204 }));
  const c = ctx("http://x", { fetch: f as unknown as typeof fetch });
  await destroy(c, { sGestion: new Uint8Array(32) as SGestion }, undefined, true);
  await destroy(c, { sGestion: new Uint8Array(32) as SGestion });
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

it("captcha : défi sans shown_at ni fallback, sel du défi et origine de repli lus ; échéance sur l'horloge monotone", async () => {
  vi.useFakeTimers({ toFake: ["Date", "performance"] });
  const t = performance.now();
  const body = { algorithm: "SHA-256", challenge: "c", maxNumber: 1, salt: "s?expires=1800000030&", signature: "g", shown_at: "j", fallback: "https://v.test" };
  const f = vi.fn(async () => new Response(JSON.stringify(body), { headers: { Date: new Date(1_800_000_000_000).toUTCString() } }));
  const r = await captcha(ctx("http://x", { fetch: f as unknown as typeof fetch }));
  expect(r).toMatchObject({
    challenge: { algorithm: "SHA-256", challenge: "c", maxNumber: 1, salt: "s?expires=1800000030&", signature: "g" },
    shownAt: "j",
    salt: "s?expires=1800000030&",
    fallbackOrigin: "https://v.test",
    receivedAt: t,
    expiresAt: t + 30_000,
  });
});

describe("API v2 (spec §29.8)", () => {
  it("create : corps bucket et preuve seulement ; K_accès et S_gestion en en-tête ; réponse upload_token et segments", async () => {
    const f = vi.fn(async (_: RequestInfo | URL, _i?: RequestInit) => new Response('{"upload_token":"u","segments":7}', { status: 201 }));
    const body = { bucket: 400, hp: "", shown_at: "t", altcha: "x" };
    const ka = new Uint8Array(32).fill(1) as KAcces, sg = new Uint8Array(32).fill(2) as SGestion;
    expect(await create(ctx("http://x", { fetch: f as unknown as typeof fetch }), ka, sg, body)).toEqual({ uploadToken: "u", segments: 7 });
    const [url, init] = f.mock.calls[0]!;
    expect(url).toBe("http://x/api/shares");
    expect(JSON.parse(String(init!.body))).toEqual(body);
    const h = new Headers(init!.headers);
    expect(h.get("X-Shh-Access")).toBe(Buffer.from(ka).toString("base64url"));
    expect(h.get("X-Shh-Manage")).toBe(Buffer.from(sg).toString("base64url"));
    expect(h.get("Content-Type")).toBe("application/json");
  });
  it("aucun chemin ne porte d'identifiant ; gestion par /api/manage/* (spec §32)", async () => {
    const urls: string[] = [];
    const bodies: unknown[] = [];
    const heads: Headers[] = [];
    const f = vi.fn(async (u: RequestInfo | URL, i?: RequestInit) => {
      urls.push(`${i?.method} ${String(u)}`);
      bodies.push(i?.body);
      heads.push(new Headers(i?.headers));
      const p = new URL(String(u)).pathname;
      if (p.endsWith("/meta")) return new Response('{"expires_in_s":1,"salt":"s","kdf":{"ops":3,"mem":1},"bucket":1,"segments":1,"opens_left":1}');
      if (p.endsWith("/status")) return new Response('{"opens_used":0,"max_opens":1,"expires_in_s":1,"state":"ready"}');
      if (p.includes("/segments/")) return new Response(new Uint8Array(1));
      return new Response(null, { status: 204 });
    });
    const c = ctx("http://x", { fetch: f as unknown as typeof fetch, retryDelayMs: 1 });
    const ka = new Uint8Array(32) as KAcces, kp = new Uint8Array(32) as KPreuve, sg = new Uint8Array(32).fill(9) as SGestion;
    await meta(c, ka);
    await getSegment(c, "t", 3, 1);
    await done(c, "t");
    await destroy(c, { kAcces: ka, kPreuve: kp }, "report");
    await destroy(c, { sGestion: sg });
    await status(c, sg);
    expect(urls).toEqual([
      "GET http://x/api/shares/meta",
      "GET http://x/api/shares/segments/3",
      "POST http://x/api/shares/done",
      "POST http://x/api/shares/destroy",
      "POST http://x/api/manage/destroy",
      "GET http://x/api/manage/status",
    ]);
    // Gestion : S_gestion en en-tête seulement, corps vide.
    expect(bodies[4]).toBeUndefined();
    expect(heads[4]!.get("X-Shh-Manage")).toBe(Buffer.from(sg).toString("base64url"));
    expect(heads[5]!.get("X-Shh-Manage")).toBe(Buffer.from(sg).toString("base64url"));
    expect(JSON.parse(String(bodies[3]))).toEqual({ proof: Buffer.from(kp).toString("base64url"), reason: "report" });
  });
  it("finalize : jeton en en-tête, corps JSON exact", async () => {
    const f = vi.fn(async (_: RequestInfo | URL, _i?: RequestInit) => new Response('{"expires_in_s":5}'));
    await finalize(ctx("http://x", { fetch: f as unknown as typeof fetch }), "t", FIN);
    const init = f.mock.calls[0]![1]!;
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer t");
    expect(new Headers(init.headers).get("Content-Type")).toBe("application/json");
    expect(JSON.parse(String(init.body))).toEqual(FIN);
  });
  it("unlock : envelope de 80 caractères base64url exigée (60 octets) ; sinon BadResponse", async () => {
    const env = Buffer.alloc(60, 7).toString("base64url");
    const reply = (envelope: unknown) =>
      vi.fn(async () => new Response(JSON.stringify({ download_token: "d", segments: 1, envelope })));
    const k = new Uint8Array(32) as KAcces, p = new Uint8Array(32) as KPreuve;
    const r = await unlock(ctx("http://x", { fetch: reply(env) as unknown as typeof fetch }), k, p);
    expect(r.envelope).toEqual(new Uint8Array(60).fill(7));
    for (const bad of [undefined, 5, env.slice(1), env + "A", env.slice(0, 79) + "=", env.slice(0, 79) + "\n", env.slice(0, 78) + "+/"]) {
      await expect(unlock(ctx("http://x", { fetch: reply(bad) as unknown as typeof fetch }), k, p), String(bad)).rejects.toBeInstanceOf(BadResponse);
    }
  });
});
