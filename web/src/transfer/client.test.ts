// Correspondance des erreurs du client (serveur simulé) et effacement des clés.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { b64u } from "../crypto/encoding";
import { segmentSize } from "../crypto/container";

const captured = vi.hoisted(() => ({ buffers: [] as Uint8Array<ArrayBuffer>[] }));
vi.mock("../crypto/kdf", async (orig) => {
  const m = await orig<typeof import("../crypto/kdf")>();
  return {
    ...m,
    randomBytes: (n: number) => {
      const b = m.randomBytes(n);
      captured.buffers.push(b);
      return b;
    },
    deriveAccess: async (k: Uint8Array<ArrayBuffer>) => {
      const r = await m.deriveAccess(k);
      captured.buffers.push(r.kAcces);
      return r;
    },
  };
});

import { BadPasswordError, LimitError, NotFoundError, createShare, destroyShare, fetchMeta, openShare, shareStatus } from "./client";
import { manageLink, shareLink } from "./link";

const ORIGIN = "https://srv.test";
const ID = b64u(new Uint8Array(16).fill(5));
const LINK = shareLink(ORIGIN, ID, new Uint8Array(32).fill(1));
const MANAGE = manageLink(ORIGIN, ID, new Uint8Array(32).fill(2));
const PW = "cheval-agrafe-pile-correct";

type Reply = Response | "net";
type Route = (method: string, path: string) => Reply | undefined;
const j = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const META = { expires_in_s: 3000, salt: b64u(new Uint8Array(16).fill(3)), kdf: { ops: 3, mem: 67108864 }, bucket: 1, segments: 1 };

function server(route: Route) {
  const calls: string[] = [];
  const f = async (input: RequestInfo | URL, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const path = String(input).slice(ORIGIN.length).replace(ID, "ID");
    calls.push(`${method} ${path}`);
    const r = route(method, path) ?? defaults(method, path);
    if (r === "net") throw new TypeError("fetch failed");
    return r;
  };
  return { net: { fetch: f as typeof fetch, retryDelayMs: 1 }, calls };
}
function defaults(method: string, path: string): Reply {
  if (path === "/api/shares/ID/meta") return j(200, META);
  if (path === "/api/shares/ID/unlock") return j(200, { download_token: "t", segments: 1 });
  if (path === "/api/shares/ID/segments/0") return new Response(new Uint8Array(segmentSize(1, 0)), { status: 200 });
  if (path === "/api/shares/ID/done") return new Response(null, { status: 204 });
  return j(404, { error: "not_found" });
}
const reject = (p: Promise<unknown>) => p.then(() => { throw new Error("aurait dû échouer"); }, (e: unknown) => e);

describe("openShare : correspondance des erreurs", () => {
  it("coupure persistante → Error(\"reseau\")", async () => {
    const s = server(() => "net");
    const e = await reject(openShare(LINK, PW, undefined, s.net));
    expect(e).toEqual(new Error("reseau"));
    expect(s.calls.length).toBe(6); // meta : 1 + 5 essais
  });
  it("429 → LimitError(retryAfterS)", async () => {
    const s = server((_, p) => (p.endsWith("/unlock") ? j(429, { error: "limit", retry_after_s: 42 }) : undefined));
    const e = await reject(openShare(LINK, PW, undefined, s.net));
    expect(e).toBeInstanceOf(LimitError);
    expect((e as LimitError).retryAfterS).toBe(42);
  });
  it("429 persistant sur une requête rejouable → LimitError", async () => {
    const s = server((_, p) => (p.endsWith("/meta") ? j(429, { error: "limit", retry_after_s: 0 }) : undefined));
    expect(await reject(openShare(LINK, PW, undefined, s.net))).toBeInstanceOf(LimitError);
    expect(s.calls.length).toBe(6);
  });
  it("mauvais mot de passe → BadPasswordError(attemptsLeft)", async () => {
    const s = server((_, p) => (p.endsWith("/unlock") ? j(403, { error: "bad_password", attempts_left: 3 }) : undefined));
    const e = await reject(openShare(LINK, PW, undefined, s.net));
    expect(e).toBeInstanceOf(BadPasswordError);
    expect((e as BadPasswordError).attemptsLeft).toBe(3);
  });
  const notFound: [string, Route][] = [
    ["404 sur meta", (_, p) => (p.endsWith("/meta") ? j(404, { error: "not_found" }) : undefined)],
    ["500 sur unlock", (_, p) => (p.endsWith("/unlock") ? j(500, { error: "internal" }) : undefined)],
    ["400 sur unlock", (_, p) => (p.endsWith("/unlock") ? j(400, { error: "bad_request" }) : undefined)],
    ["403 sans attempts_left", (_, p) => (p.endsWith("/unlock") ? j(403, { error: "bad_password" }) : undefined)],
    ["KDF trop faible", (_, p) => (p.endsWith("/meta") ? j(200, { ...META, kdf: { ops: 1, mem: 8192 } }) : undefined)],
    ["KDF trop forte", (_, p) => (p.endsWith("/meta") ? j(200, { ...META, kdf: { ops: 3, mem: 2 ** 30 } }) : undefined)],
    ["meta sans sel", (_, p) => (p.endsWith("/meta") ? j(200, { ...META, salt: undefined }) : undefined)],
    ["sel de 15 octets", (_, p) => (p.endsWith("/meta") ? j(200, { ...META, salt: b64u(new Uint8Array(15)) }) : undefined)],
    ["palier inconnu", (_, p) => (p.endsWith("/meta") ? j(200, { ...META, bucket: 2 }) : undefined)],
    ["meta non JSON", (_, p) => (p.endsWith("/meta") ? new Response("<html>", { status: 200 }) : undefined)],
    ["unlock : nombre de segments différent", (_, p) => (p.endsWith("/unlock") ? j(200, { download_token: "t", segments: 2 }) : undefined)],
    ["segment de mauvaise taille (persistant)", (_, p) => (p.endsWith("/segments/0") ? new Response(new Uint8Array(10)) : undefined)],
    ["paquet corrompu", () => undefined],
  ];
  it.each(notFound)("%s → NotFoundError", async (_, route) => {
    const s = server(route);
    expect(await reject(openShare(LINK, PW, undefined, s.net))).toBeInstanceOf(NotFoundError);
  });
  it("paquet corrompu : done() appelé d'office ; KDF refusée : aucun unlock", async () => {
    const s = server(() => undefined);
    await reject(openShare(LINK, PW, undefined, s.net));
    expect(s.calls).toEqual(["GET /api/shares/ID/meta", "POST /api/shares/ID/unlock", "GET /api/shares/ID/segments/0", "POST /api/shares/ID/done"]);
    const k = server((_, p) => (p.endsWith("/meta") ? j(200, { ...META, kdf: { ops: 2, mem: 67108864 } }) : undefined));
    await reject(openShare(LINK, PW, undefined, k.net));
    expect(k.calls).toEqual(["GET /api/shares/ID/meta"]);
  });
  it("lien invalide : erreur locale lien_invalide", async () => {
    await expect(openShare(MANAGE, PW)).rejects.toThrow("lien_invalide");
  });
});

describe("fetchMeta, shareStatus, destroyShare : correspondance des erreurs", () => {
  it("fetchMeta", async () => {
    expect(await reject(fetchMeta(LINK, server(() => j(404, { error: "not_found" })).net))).toBeInstanceOf(NotFoundError);
    expect(await reject(fetchMeta(LINK, server(() => j(429, { error: "limit", retry_after_s: 0 })).net))).toBeInstanceOf(LimitError);
    expect(await reject(fetchMeta(LINK, server(() => "net").net))).toEqual(new Error("reseau"));
    expect(await reject(fetchMeta(LINK, server(() => j(200, { nope: 1 })).net))).toBeInstanceOf(NotFoundError);
    expect(await fetchMeta(LINK, server(() => undefined).net)).toEqual({ expiresInS: 3000 });
  });
  it("shareStatus", async () => {
    expect(await reject(shareStatus(MANAGE, server(() => j(404, { error: "not_found" })).net))).toBeInstanceOf(NotFoundError);
    expect(await reject(shareStatus(MANAGE, server(() => j(500, { error: "internal" })).net))).toBeInstanceOf(NotFoundError);
    expect(await reject(shareStatus(MANAGE, server(() => j(200, { opens_used: "x" })).net))).toBeInstanceOf(NotFoundError);
    expect(await reject(shareStatus(MANAGE, server(() => "net").net))).toEqual(new Error("reseau"));
  });
  it("destroyShare", async () => {
    expect(await reject(destroyShare(MANAGE, server(() => j(404, { error: "not_found" })).net))).toBeInstanceOf(NotFoundError);
    expect(await reject(destroyShare(MANAGE, server(() => j(429, { error: "limit", retry_after_s: 9 })).net))).toBeInstanceOf(LimitError);
    expect(await reject(destroyShare(MANAGE, server(() => "net").net))).toEqual(new Error("reseau"));
    // lien de partage : meta passe, destroy refusé (mauvais mot de passe côté serveur) → NotFoundError
    const s = server(() => undefined);
    expect(await reject(destroyShare(LINK, { password: PW, ...s.net }))).toBeInstanceOf(NotFoundError);
    expect(s.calls).toEqual(["GET /api/shares/ID/meta", "POST /api/shares/ID/destroy"]);
    expect(await reject(destroyShare(LINK, {}))).toEqual(new Error("mot_de_passe_requis"));
  });
});

describe("createShare : clés effacées même en cas d'échec", () => {
  beforeEach(() => {
    captured.buffers.length = 0;
  });
  const opts = (fetch: typeof globalThis.fetch) => ({
    ttlHours: 1 as const,
    maxOpens: 1,
    password: PW,
    solveCaptcha: async () => "x",
    fetch,
    retryDelayMs: 1,
  });
  const secrets = () => captured.buffers.filter((b) => b.length === 32);
  it("échec au défi anti-robot (réseau)", async () => {
    const f = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    const items = [{ kind: "text" as const, name: "", mime: "text/plain", data: new Uint8Array([97]) }];
    await expect(createShare(ORIGIN, items, opts(f))).rejects.toThrow("reseau");
    expect(secrets().length).toBe(3); // K_lien, S_gestion, K_accès
    for (const b of secrets()) expect(b.every((x) => x === 0)).toBe(true);
  });
  it("échec au scellement (aucun élément)", async () => {
    await expect(createShare(ORIGIN, [], opts(globalThis.fetch))).rejects.toThrow("vide");
    expect(secrets().length).toBe(3);
    for (const b of secrets()) expect(b.every((x) => x === 0)).toBe(true);
  });
  it("429 à la création → LimitError", async () => {
    const f = (async (input: RequestInfo | URL) =>
      String(input).endsWith("/api/captcha")
        ? j(200, { algorithm: "SHA-256", challenge: "c", maxNumber: 1, salt: "s", signature: "g", shown_at: "t" })
        : j(429, { error: "limit", retry_after_s: 3600 })) as typeof fetch;
    const items = [{ kind: "text" as const, name: "", mime: "text/plain", data: new Uint8Array([97]) }];
    const e = await reject(createShare(ORIGIN, items, opts(f)));
    expect(e).toBeInstanceOf(LimitError);
    expect((e as LimitError).retryAfterS).toBe(3600);
    for (const b of secrets()) expect(b.every((x) => x === 0)).toBe(true);
  }, 20_000);
});
