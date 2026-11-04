// Correspondance des erreurs du client (serveur simulé) et effacement des clés.
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { b64u, concat, utf8 } from "../crypto/encoding";
import { CHUNK, sealStream, segmentSize } from "../crypto/container";
import { KDF_MIN, deriveContent } from "../crypto/kdf";
import type { KLien, SGestion } from "../crypto/types";

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
    newKLien: () => {
      const b = m.newKLien();
      captured.buffers.push(b);
      return b;
    },
    newSGestion: () => {
      const b = m.newSGestion();
      captured.buffers.push(b);
      return b;
    },
    deriveAccess: async (k: import("../crypto/types").KLien) => {
      const r = await m.deriveAccess(k);
      captured.buffers.push(r.kAcces);
      return r;
    },
  };
});

import {
  BadPasswordError,
  LimitError,
  NotFoundError,
  collectToBlob,
  createShare,
  destroyShare,
  fetchMeta,
  openShare,
  shareStatus,
} from "./client";
import { manageLink, shareLink } from "./link";

const ORIGIN = "https://srv.test";
const ID = b64u(new Uint8Array(16).fill(5));
const LINK = shareLink(ORIGIN, ID, new Uint8Array(32).fill(1) as KLien);
const MANAGE = manageLink(ORIGIN, ID, new Uint8Array(32).fill(2) as SGestion);
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
    const e = await reject(openShare(LINK, PW, ORIGIN, undefined, s.net));
    expect(e).toEqual(new Error("reseau"));
    expect(s.calls.length).toBe(6); // meta : 1 + 5 essais
  });
  it("429 → LimitError(retryAfterS)", async () => {
    const s = server((_, p) => (p.endsWith("/unlock") ? j(429, { error: "limit", retry_after_s: 42 }) : undefined));
    const e = await reject(openShare(LINK, PW, ORIGIN, undefined, s.net));
    expect(e).toBeInstanceOf(LimitError);
    expect((e as LimitError).retryAfterS).toBe(42);
  });
  it("429 persistant sur une requête rejouable → LimitError", async () => {
    const s = server((_, p) => (p.endsWith("/meta") ? j(429, { error: "limit", retry_after_s: 0 }) : undefined));
    expect(await reject(openShare(LINK, PW, ORIGIN, undefined, s.net))).toBeInstanceOf(LimitError);
    expect(s.calls.length).toBe(6);
  });
  it("mauvais mot de passe → BadPasswordError(attemptsLeft)", async () => {
    const s = server((_, p) => (p.endsWith("/unlock") ? j(403, { error: "bad_password", attempts_left: 3 }) : undefined));
    const e = await reject(openShare(LINK, PW, ORIGIN, undefined, s.net));
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
    expect(await reject(openShare(LINK, PW, ORIGIN, undefined, s.net))).toBeInstanceOf(NotFoundError);
  });
  it("paquet corrompu : done() appelé d'office ; KDF refusée : aucun unlock", async () => {
    const s = server(() => undefined);
    await reject(openShare(LINK, PW, ORIGIN, undefined, s.net));
    expect(s.calls).toEqual(["GET /api/shares/ID/meta", "POST /api/shares/ID/unlock", "GET /api/shares/ID/segments/0", "POST /api/shares/ID/done"]);
    const k = server((_, p) => (p.endsWith("/meta") ? j(200, { ...META, kdf: { ops: 2, mem: 67108864 } }) : undefined));
    await reject(openShare(LINK, PW, ORIGIN, undefined, k.net));
    expect(k.calls).toEqual(["GET /api/shares/ID/meta"]);
  });
  it("lien invalide : erreur locale lien_invalide", async () => {
    await expect(openShare(MANAGE, PW, ORIGIN)).rejects.toThrow("lien_invalide");
  });
});

describe("fetchMeta, shareStatus, destroyShare : correspondance des erreurs", () => {
  it("fetchMeta", async () => {
    expect(await reject(fetchMeta(LINK, ORIGIN, server(() => j(404, { error: "not_found" })).net))).toBeInstanceOf(NotFoundError);
    expect(await reject(fetchMeta(LINK, ORIGIN, server(() => j(429, { error: "limit", retry_after_s: 0 })).net))).toBeInstanceOf(LimitError);
    expect(await reject(fetchMeta(LINK, ORIGIN, server(() => "net").net))).toEqual(new Error("reseau"));
    expect(await reject(fetchMeta(LINK, ORIGIN, server(() => j(200, { nope: 1 })).net))).toBeInstanceOf(NotFoundError);
    expect(await fetchMeta(LINK, ORIGIN, server(() => undefined).net)).toEqual({ expiresInS: 3000 });
  });
  it("shareStatus", async () => {
    expect(await reject(shareStatus(MANAGE, ORIGIN, server(() => j(404, { error: "not_found" })).net))).toBeInstanceOf(NotFoundError);
    expect(await reject(shareStatus(MANAGE, ORIGIN, server(() => j(500, { error: "internal" })).net))).toBeInstanceOf(NotFoundError);
    expect(await reject(shareStatus(MANAGE, ORIGIN, server(() => j(200, { opens_used: "x" })).net))).toBeInstanceOf(NotFoundError);
    expect(await reject(shareStatus(MANAGE, ORIGIN, server(() => "net").net))).toEqual(new Error("reseau"));
  });
  it("destroyShare", async () => {
    expect(await reject(destroyShare(MANAGE, ORIGIN, server(() => j(404, { error: "not_found" })).net))).toBeInstanceOf(NotFoundError);
    expect(await reject(destroyShare(MANAGE, ORIGIN, server(() => j(429, { error: "limit", retry_after_s: 9 })).net))).toBeInstanceOf(LimitError);
    expect(await reject(destroyShare(MANAGE, ORIGIN, server(() => "net").net))).toEqual(new Error("reseau"));
    // lien de partage : meta passe, destroy refusé (mauvais mot de passe côté serveur) → NotFoundError
    const s = server(() => undefined);
    expect(await reject(destroyShare(LINK, ORIGIN, { password: PW, ...s.net }))).toBeInstanceOf(NotFoundError);
    expect(s.calls).toEqual(["GET /api/shares/ID/meta", "POST /api/shares/ID/destroy"]);
    expect(await reject(destroyShare(LINK, ORIGIN, {}))).toEqual(new Error("mot_de_passe_requis"));
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

function pseudo(n: number, seed: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(n);
  let x = seed;
  for (let i = 0; i < n; i++) {
    x = (x * 1103515245 + 12345) >>> 0;
    out[i] = x >>> 24;
  }
  return out;
}
const same = (a: Uint8Array, b: Uint8Array) => Buffer.from(a).equals(Buffer.from(b));

describe("openShare en flux : segments à la demande, saveItem, collectToBlob", () => {
  const a = pseudo(3 * 1048576 + 7, 1);
  const b = pseudo(2.5 * 1048576, 2);
  let segs: Uint8Array<ArrayBuffer>[] = [];
  beforeAll(async () => {
    // Mêmes entrées que le lien et META : K_lien = 1…1, sel = 3…3, KDF minimale.
    const keys = await deriveContent(new Uint8Array(32).fill(1) as KLien, PW, new Uint8Array(16).fill(3), KDF_MIN);
    const s = await sealStream(
      [
        { kind: "text", name: "", mime: "text/plain", data: utf8("salut") },
        { kind: "file", name: "a.png", mime: "image/png", data: new Blob([a]) },
        { kind: "file", name: "b.bin", mime: "application/octet-stream", data: new Blob([b]) },
      ],
      keys,
    );
    for (let n = 0; n < s.segmentCount; n++) segs.push(await s.segment(n));
  }, 60_000);
  const route = (bad?: (n: number, seg: Uint8Array<ArrayBuffer>) => Uint8Array<ArrayBuffer>): Route => (_, p) => {
    if (p.endsWith("/meta")) return j(200, { ...META, bucket: 160, segments: 3 });
    if (p.endsWith("/unlock")) return j(200, { download_token: "t", segments: 3 });
    const m = /\/segments\/(\d+)$/.exec(p);
    if (m) {
      const n = Number(m[1]);
      return new Response(bad ? bad(n, new Uint8Array(segs[n]!)) : new Uint8Array(segs[n]!), { status: 200 });
    }
    return undefined;
  };

  it("seul le segment 0 est lu à l'ouverture ; saveItem et collectToBlob en flux", async () => {
    const s = server(route());
    const prog: [number, number][] = [];
    const o = await openShare(LINK, PW, ORIGIN, (d, t) => prog.push([d, t]), s.net);
    expect(s.calls).toEqual(["GET /api/shares/ID/meta", "POST /api/shares/ID/unlock", "GET /api/shares/ID/segments/0"]);
    expect(o.manifest.items.map((e) => e.name)).toEqual(["", "a.png", "b.bin"]);
    const parts: Uint8Array[] = [];
    await o.saveItem(2, async (c) => {
      expect(c.length).toBeLessThanOrEqual(CHUNK);
      parts.push(new Uint8Array(c));
    });
    expect(same(concat(...parts.map((p) => new Uint8Array(p))), b)).toBe(true);
    expect(s.calls.at(-1)).toBe("GET /api/shares/ID/segments/1");
    const blob = await collectToBlob(o, 1);
    expect(blob.type).toBe("application/octet-stream");
    expect(same(new Uint8Array(await blob.arrayBuffer()), a)).toBe(true);
    expect(await o.item(0)).toEqual(utf8("salut"));
    expect(s.calls.filter((c) => c.endsWith("/segments/2"))).toEqual([]); // bourrage seulement : jamais lu
    expect(prog).toEqual([[1, 3], [2, 3], [1, 3]]); // segment n lu → (n + 1, total)
    o.wipe();
    await o.done();
    expect(s.calls.at(-1)).toBe("POST /api/shares/ID/done");
  });

  it("collectToBlob replie les tranches dans un Blob tous les foldBytes (mémoire bornée)", async () => {
    const s = server(route());
    const o = await openShare(LINK, PW, ORIGIN, undefined, s.net);
    const sizes: number[] = [];
    const Real = globalThis.Blob;
    vi.stubGlobal(
      "Blob",
      class extends Real {
        constructor(parts?: BlobPart[], opts?: BlobPropertyBag) {
          // tranches en mémoire (hors Blob déjà replié) au moment de chaque repli
          sizes.push((parts ?? []).reduce((n, p) => n + (p instanceof Real ? 0 : (p as Uint8Array).length), 0));
          super(parts, opts);
        }
      },
    );
    let blob: Blob;
    try {
      blob = await collectToBlob(o, 1, 1048576);
    } finally {
      vi.unstubAllGlobals();
    }
    expect(sizes.length).toBeGreaterThanOrEqual(4); // 3 Mio par paquets de 1 Mio, puis la fin
    for (const n of sizes) expect(n).toBeLessThanOrEqual(1048576 + CHUNK);
    expect(blob.type).toBe("application/octet-stream");
    expect(same(new Uint8Array(await blob.arrayBuffer()), a)).toBe(true);
  });

  it("segment corrompu pendant saveItem → NotFoundError ; erreur du sink transmise telle quelle", async () => {
    const s = server(route((n, seg) => (n === 1 ? (seg[5]! ^= 1, seg) : seg)));
    const o = await openShare(LINK, PW, ORIGIN, undefined, s.net);
    expect(await reject(o.saveItem(2, () => undefined))).toBeInstanceOf(NotFoundError);
    const disk = new Error("disque_plein");
    expect(
      await reject(
        o.saveItem(1, () => {
          throw disk;
        }),
      ),
    ).toBe(disk);
    expect(await reject(o.item(9))).toEqual(new Error("element_inexistant"));
  });

  it("segment manquant (coupure persistante) pendant item → Error(\"reseau\")", async () => {
    let cut = false;
    const s = server((m, p) => (cut && p.endsWith("/segments/1") ? "net" : route()(m, p)));
    const o = await openShare(LINK, PW, ORIGIN, undefined, s.net);
    cut = true;
    expect(await reject(o.item(2))).toEqual(new Error("reseau"));
  });
});

describe("createShare en flux", () => {
  it("chaque segment est chiffré puis envoyé dans l'ordre ; progression par segment", async () => {
    const puts: [string, number][] = [];
    const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input).slice(ORIGIN.length);
      if (path === "/api/captcha") return j(200, { algorithm: "SHA-256", challenge: "c", maxNumber: 1, salt: "s", signature: "g", shown_at: "t" });
      if (path === "/api/shares") return j(201, { id: ID, upload_token: "u", segments: 3 });
      if (init?.method === "PUT") {
        puts.push([path.replace(ID, "ID"), (init.body as Uint8Array).length]);
        return new Response(null, { status: 204 });
      }
      if (path.endsWith("/finalize")) return j(200, { expires_in_s: 3600 });
      return j(404, { error: "not_found" });
    }) as typeof fetch;
    const prog: [number, number][] = [];
    const items = [{ kind: "file" as const, name: "x", mime: "x/y", data: new Blob([pseudo(5.5 * 1048576, 3)]) }];
    const r = await createShare(ORIGIN, items, {
      ttlHours: 1,
      maxOpens: 1,
      password: PW,
      solveCaptcha: async () => "x",
      fetch: f,
      retryDelayMs: 1,
      onProgress: (d, t) => prog.push([d, t]),
    });
    expect(r.expiresInS).toBe(3600);
    expect(puts).toEqual([0, 1, 2].map((n) => [`/api/shares/ID/segments/${n}`, segmentSize(160, n)]));
    expect(prog).toEqual([[0, 3], [1, 3], [2, 3], [3, 3]]);
  }, 20_000);
});

describe("origine attendue (audit F1)", () => {
  const k = LINK.slice(LINK.indexOf("#"));
  const evil = `https://evil.example:8443/s/${ID}${k}`;
  const creds = `https://user:pw@srv.test/s/${ID}${k}`;
  it("lien d'une autre origine ou avec identifiants : lien_invalide, aucune requête", async () => {
    for (const link of [evil, creds, `http://srv.test/s/${ID}${k}`]) {
      const s = server(() => undefined);
      await expect(fetchMeta(link, ORIGIN, s.net), link).rejects.toThrow("lien_invalide");
      await expect(openShare(link, PW, ORIGIN, undefined, s.net), link).rejects.toThrow("lien_invalide");
      await expect(destroyShare(link, ORIGIN, { password: PW, ...s.net }), link).rejects.toThrow("lien_invalide");
      expect(s.calls).toEqual([]);
    }
    const m = server(() => undefined);
    const evilManage = `https://evil.example/m/${ID}${MANAGE.slice(MANAGE.indexOf("#"))}`;
    await expect(shareStatus(evilManage, ORIGIN, m.net)).rejects.toThrow("lien_invalide");
    await expect(destroyShare(evilManage, ORIGIN, m.net)).rejects.toThrow("lien_invalide");
    expect(m.calls).toEqual([]);
  });
  it("origine attendue mal formée : origine_invalide", async () => {
    await expect(fetchMeta(LINK, "https://srv.test/", server(() => undefined).net)).rejects.toThrow("origine_invalide");
    await expect(shareStatus(MANAGE, "http://srv.test", server(() => undefined).net)).rejects.toThrow("origine_invalide");
  });
  it("createShare valide son origine avant toute requête", async () => {
    const s = server(() => undefined);
    const items = [{ kind: "text" as const, name: "", mime: "text/plain", data: new Uint8Array([97]) }];
    for (const o of ["http://srv.test/", "https://srv.test/x", "https://u:p@srv.test", "http://srv.test"]) {
      await expect(
        createShare(o, items, { ttlHours: 1, maxOpens: 1, password: PW, solveCaptcha: async () => "x", ...s.net }),
        o,
      ).rejects.toThrow("origine_invalide");
    }
    expect(s.calls).toEqual([]);
  });
});

describe("noms, aperçu et types dangereux à la réception (audit M4)", () => {
  it("cas de l'audit : « ../../facture‮fdp.exe\\u0000 » en text/html", async () => {
    const keys = await deriveContent(new Uint8Array(32).fill(1) as KLien, PW, new Uint8Array(16).fill(3), KDF_MIN);
    const sealed = await sealStream(
      [
        { kind: "text", name: "", mime: "text/plain", data: utf8("<b>salut</b>") },
        { kind: "file", name: "../../facture\u202Efdp.exe\u0000", mime: "text/html", data: utf8("<script>alert(1)</script>") },
        { kind: "file", name: "photo.png", mime: "image/png", data: new Uint8Array(10) },
      ],
      keys,
    );
    const seg = await sealed.segment(0);
    const s = server((_, p) => (p.endsWith("/segments/0") ? new Response(new Uint8Array(seg), { status: 200 }) : undefined));
    const o = await openShare(LINK, PW, ORIGIN, undefined, s.net);
    expect(o.manifest.items[1]!.name).toBe("../../facture\u202Efdp.exe\u0000"); // brut : ne jamais l'afficher
    expect(o.safeName(1)).toBe("facturefdp.exe");
    expect(o.previewKind(1)).toBe("none");
    expect(o.isRiskyFile(1)).toBe(true);
    expect(o.previewKind(0)).toBe("text");
    expect(o.previewKind(2)).toBe("image");
    expect(o.safeName(2)).toBe("photo.png");
    expect(o.isRiskyFile(2)).toBe(false);
    expect(() => o.safeName(9)).toThrow("element_inexistant");
    const blob = await collectToBlob(o, 1);
    expect(blob.type).toBe("application/octet-stream");
    expect(new TextDecoder().decode(await blob.arrayBuffer())).toBe("<script>alert(1)</script>");
    await o.done();
  });
});


describe("Opened.destroy et done en keepalive (S1)", () => {
  it("après la dernière ouverture (meta répond 404), destroy passe sans meta ; wipe efface les clés", async () => {
    const bodies: string[] = [];
    const headers: (string | null)[] = [];
    const keepalive: (boolean | undefined)[] = [];
    let unlocked = false;
    const keys = await deriveContent(new Uint8Array(32).fill(1) as KLien, PW, new Uint8Array(16).fill(3), KDF_MIN);
    const seg = await (await sealStream([{ kind: "text", name: "", mime: "text/plain", data: utf8("x") }], keys)).segment(0);
    const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const p = String(input).slice(ORIGIN.length).replace(ID, "ID");
      if (p.endsWith("/meta")) return unlocked ? j(404, { error: "not_found" }) : j(200, META);
      if (p.endsWith("/unlock")) {
        unlocked = true; // maxOpens=1 : le partage passe en « draining »
        return j(200, { download_token: "t", segments: 1 });
      }
      if (p.endsWith("/destroy")) {
        bodies.push(String(init?.body));
        headers.push(new Headers(init?.headers).get("X-Shh-Access"));
        return new Response(null, { status: 204 });
      }
      if (p.endsWith("/done")) {
        keepalive.push(init?.keepalive);
        return new Response(null, { status: 204 });
      }
      if (p.endsWith("/segments/0")) return new Response(new Uint8Array(seg), { status: 200 });
      return defaults(init?.method ?? "GET", p);
    }) as typeof fetch;
    const net = { fetch: f, retryDelayMs: 1 };
    const o = await openShare(LINK, PW, ORIGIN, undefined, net);
    await expect(fetchMeta(LINK, ORIGIN, net)).rejects.toBeInstanceOf(NotFoundError);
    await o.destroy("report");
    expect(bodies).toHaveLength(1);
    const b = JSON.parse(bodies[0]!) as Record<string, unknown>;
    expect(Object.keys(b).sort()).toEqual(["proof", "reason"]);
    expect(b.reason).toBe("report");
    expect(typeof b.proof).toBe("string");
    expect(headers[0]).toMatch(/^[A-Za-z0-9_-]{43}$/);
    await o.destroy();
    expect(JSON.parse(bodies[1]!)).toEqual({ proof: b.proof });
    await o.done();
    expect(keepalive).toEqual([true]);
    o.wipe();
    await expect(o.destroy()).rejects.toThrow("cles_effacees");
    expect(bodies).toHaveLength(2);
  });
});
