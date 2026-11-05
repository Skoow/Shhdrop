// Correspondance des erreurs du client (serveur simulé) et effacement des clés.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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
  CAPTCHA_MIN_MS,
  LimitError,
  NotFoundError,
  collectToBlob,
  createShare,
  destroyShare,
  fetchMeta,
  openShare,
  shareStatus,
  type CaptchaCtx,
  type CaptchaProof,
} from "./client";
import { manageLink, shareLink } from "./link";
import { prepareCaptcha } from "./prepare";
import { SERVER_STALL_MS } from "./upload";

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
    // Le lien est jugé avant le mot de passe.
    await expect(openShare(MANAGE, "", ORIGIN)).rejects.toThrow("lien_invalide");
  });
  it("mot de passe vide : refusé avant toute requête, erreur distincte (tâche M, point 2)", async () => {
    const s = server(() => undefined);
    const before = captured.buffers.length;
    expect(await reject(openShare(LINK, "", ORIGIN, undefined, s.net))).toEqual(new Error("mot_de_passe_requis"));
    expect(s.calls).toEqual([]);
    expect(captured.buffers.length).toBe(before); // aucune dérivation de clé non plus
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
  it("destroyShare : mot de passe vide refusé avant toute requête (tâche M, point 2)", async () => {
    const s = server(() => undefined);
    const before = captured.buffers.length;
    expect(await reject(destroyShare(LINK, ORIGIN, { password: "", ...s.net }))).toEqual(new Error("mot_de_passe_requis"));
    expect(s.calls).toEqual([]);
    expect(captured.buffers.length).toBe(before);
    // Lien de gestion : le mot de passe n'intervient pas (un « "" » ne bloque rien).
    expect(await destroyShare(MANAGE, ORIGIN, { password: "", ...server(() => new Response(null, { status: 204 })).net })).toBeUndefined();
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
    solveCaptcha: async () => ({ kind: "pow" as const, payload: "x" }),
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
      solveCaptcha: async () => ({ kind: "pow" as const, payload: "x" }),
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
        createShare(o, items, { ttlHours: 1, maxOpens: 1, password: PW, solveCaptcha: async () => ({ kind: "pow" as const, payload: "x" }), ...s.net }),
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

// ---------------------------------------------------------------------------------------
// Task 0 (Plan 2) : annulation, octets envoyés, pause, reprise sur coupure, preuve typée,
// défi préparé. Horloge simulée (setTimeout et Date) ; le chiffrement tourne en vrai.
// ---------------------------------------------------------------------------------------

type Up = { status: number; json: unknown };
type PutPlan = (n: number, attempt: number, onBytes: (b: number) => void, body: Uint8Array, signal?: AbortSignal) => Promise<Up> | Up;
const ok204 = (onBytes: (b: number) => void, body: Uint8Array): Up => {
  onBytes(body.length);
  return { status: 204, json: null };
};
const capSalt = (validS = 120) => `${"a".repeat(24)}.${"b".repeat(16)}.0?expires=${Math.floor(Date.now() / 1000) + validS}&`;

// Serveur simulé pour createShare : fetch (défi, création, finalize, destroy) + Uploader (PUT).
function sender(o: {
  segments: number;
  put?: PutPlan;
  finalize?: (attempt: number) => Reply | undefined;
  captcha?: () => Record<string, unknown>;
  /** En-tête Date de la réponse du défi (heure du serveur) ; absent par défaut. */
  captchaDate?: () => string;
  status?: () => Reply;
  onCaptcha?: () => void;
}) {
  const calls: string[] = [];
  const at: Record<string, number[]> = {};
  const bodies: Record<string, unknown>[] = [];
  const destroys: { body: unknown; keepalive: boolean | undefined }[] = [];
  const attempts = new Map<number, number>();
  let finalizeN = 0;
  const log = (k: string) => {
    calls.push(k);
    (at[k] ??= []).push(Date.now());
  };
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input).slice(ORIGIN.length).replace(ID, "ID");
    const method = init?.method ?? "GET";
    log(`${method} ${path}`);
    if (path === "/api/captcha") {
      o.onCaptcha?.();
      const body = o.captcha?.() ?? { algorithm: "SHA-256", challenge: "c", maxNumber: 1, salt: capSalt(), signature: "g", shown_at: "jeton" };
      return new Response(JSON.stringify(body), { status: 200, headers: o.captchaDate ? { Date: o.captchaDate() } : {} });
    }
    if (path === "/api/shares/ID/status") {
      if (new Headers(init?.headers).get("X-Shh-Manage") === null) return j(404, { error: "not_found" });
      const r = o.status?.();
      if (r === "net") throw new TypeError("fetch failed");
      return r ?? j(404, { error: "not_found" });
    }
    if (path === "/api/shares") {
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return j(201, { id: ID, upload_token: "u", segments: o.segments });
    }
    if (path === "/api/shares/ID/finalize") {
      const r = o.finalize?.(++finalizeN);
      if (r === "net") throw new TypeError("fetch failed");
      return r ?? j(200, { expires_in_s: 3600 });
    }
    if (path === "/api/shares/ID/destroy") {
      destroys.push({ body: JSON.parse(String(init?.body)), keepalive: init?.keepalive });
      return new Response(null, { status: 204 });
    }
    return j(404, { error: "not_found" });
  }) as typeof fetch;
  const upload = async (url: string, _h: Record<string, string>, body: Uint8Array, onBytes: (b: number) => void, signal?: AbortSignal) => {
    const n = Number(/\/segments\/(\d+)$/.exec(url)![1]);
    log(`PUT ${n}`);
    const a = (attempts.get(n) ?? 0) + 1;
    attempts.set(n, a);
    return o.put ? o.put(n, a, onBytes, body, signal) : ok204(onBytes, body);
  };
  return { fetch: f, upload, calls, at, bodies, destroys, attempts };
}

const SMALL = [{ kind: "text" as const, name: "", mime: "text/plain", data: new Uint8Array([97]) }];
const BIG_DATA = pseudo(5.5 * 1048576, 7); // palier 160 : 3 segments
const BIG = [{ kind: "file" as const, name: "x", mime: "x/y", data: new Blob([BIG_DATA]) }];
const BIG_SIZES = [0, 1, 2].map((n) => segmentSize(160, n));

const base = (s: ReturnType<typeof sender>) => ({
  ttlHours: 1 as const,
  maxOpens: 1,
  password: PW,
  solveCaptcha: vi.fn(async (_c: unknown, _x: CaptchaCtx): Promise<CaptchaProof> => ({ kind: "pow", payload: "x" })),
  fetch: s.fetch,
  upload: s.upload,
  retryDelayMs: 1,
});

// Fait avancer l'horloge simulée seulement quand plus rien d'autre ne tourne (le chiffrement
// et les promesses avancent en temps réel ; seules les attentes sont sautées).
async function drive<T>(p: Promise<T>): Promise<T> {
  let settled = false;
  p.then(
    () => (settled = true),
    () => (settled = true),
  );
  while (!settled) {
    for (let i = 0; i < 20 && !settled; i++) await new Promise((r) => setImmediate(r));
    if (!settled && vi.getTimerCount() > 0) await vi.advanceTimersToNextTimerAsync();
  }
  return p;
}
const isAbort = (e: unknown) => e instanceof DOMException && e.name === "AbortError";

describe("createShare : annulation (signal)", () => {
  beforeEach(() => {
    captured.buffers.length = 0;
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date", "performance"] });
  });
  afterEach(() => vi.useRealTimers());
  const wiped = () => {
    const s = captured.buffers.filter((b) => b.length === 32);
    expect(s.length).toBe(3); // K_lien, S_gestion, K_accès
    for (const b of s) expect(b.every((x) => x === 0)).toBe(true);
  };

  it("déjà annulé : AbortError, aucune requête", async () => {
    const s = sender({ segments: 1 });
    const ac = new AbortController();
    ac.abort();
    expect(isAbort(await reject(drive(createShare(ORIGIN, SMALL, { ...base(s), signal: ac.signal }))))).toBe(true);
    expect(s.calls).toEqual([]);
  });

  it("annulé avant solveCaptcha : AbortError, aucun POST /api/shares, clés à zéro", async () => {
    const ac = new AbortController();
    const s = sender({ segments: 1, onCaptcha: () => ac.abort() });
    const o = { ...base(s), signal: ac.signal };
    expect(isAbort(await reject(drive(createShare(ORIGIN, SMALL, o))))).toBe(true);
    expect(o.solveCaptcha).not.toHaveBeenCalled();
    expect(s.calls).toEqual(["GET /api/captcha"]);
    wiped();
  });

  it("annulé pendant solveCaptcha (preuve qui ne finit pas) : AbortError, aucun POST /api/shares", async () => {
    const ac = new AbortController();
    const s = sender({ segments: 1 });
    const o = {
      ...base(s),
      signal: ac.signal,
      solveCaptcha: vi.fn((): Promise<CaptchaProof> => {
        queueMicrotask(() => ac.abort());
        return new Promise(() => undefined);
      }),
    };
    expect(isAbort(await reject(drive(createShare(ORIGIN, SMALL, o))))).toBe(true);
    expect(s.calls).toEqual(["GET /api/captcha"]);
    wiped();
  });

  it("annulé pendant l'envoi : AbortError, POST /destroy avec manage en keepalive, clés à zéro", async () => {
    const ac = new AbortController();
    const s = sender({
      segments: 3,
      put: (n, _a, onBytes, body, signal) => {
        if (n < 1) return ok204(onBytes, body);
        return new Promise<Up>((_, rej) => {
          signal!.addEventListener("abort", () => rej(new DOMException("Aborted", "AbortError")));
          queueMicrotask(() => ac.abort());
        });
      },
    });
    expect(isAbort(await reject(drive(createShare(ORIGIN, BIG, { ...base(s), signal: ac.signal }))))).toBe(true);
    expect(s.calls.filter((c) => !c.startsWith("GET"))).toEqual(["POST /api/shares", "PUT 0", "PUT 1", "POST /api/shares/ID/destroy"]);
    expect(s.destroys).toHaveLength(1);
    expect(Object.keys(s.destroys[0]!.body as object)).toEqual(["manage"]);
    expect((s.destroys[0]!.body as { manage: string }).manage).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(s.destroys[0]!.keepalive).toBe(true);
    wiped();
  }, 30_000);

  it("annulé pendant une pause : AbortError et destruction", async () => {
    const ac = new AbortController();
    const s = sender({ segments: 1 });
    const pause = () => {
      queueMicrotask(() => ac.abort());
      return new Promise<void>(() => undefined);
    };
    expect(isAbort(await reject(drive(createShare(ORIGIN, SMALL, { ...base(s), signal: ac.signal, pause }))))).toBe(true);
    expect(s.calls).toEqual(["GET /api/captcha", "POST /api/shares", "POST /api/shares/ID/destroy"]);
    wiped();
  });

  it("succès : clés à zéro aussi, aucune destruction", async () => {
    const s = sender({ segments: 1 });
    const r = await drive(createShare(ORIGIN, SMALL, base(s)));
    expect(r.expiresInS).toBe(3600);
    expect(s.destroys).toEqual([]);
    wiped();
  });
});

describe("createShare : octets envoyés et pause", () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date", "performance"] }));
  afterEach(() => vi.useRealTimers());

  it("onBytes rend le maximum atteint : un nouvel essai n'émet rien avant de dépasser 60 % du segment", async () => {
    const L = BIG_SIZES[2]!;
    const part = (f: number) => Math.round(f * L);
    const s = sender({
      segments: 3,
      put: (n, a, onBytes, body) => {
        if (n === 2 && a === 1) {
          onBytes(part(0.3));
          onBytes(part(0.6));
          throw new TypeError("fetch failed");
        }
        if (n === 2) for (const f of [0.2, 0.4, 0.6, 0.61, 0.8]) onBytes(part(f));
        return ok204(onBytes, body);
      },
    });
    const seen: [number, number][] = [];
    await drive(createShare(ORIGIN, BIG, { ...base(s), onBytes: (d, t) => seen.push([d, t]) }));
    const total = BIG_SIZES.reduce((a, b) => a + b, 0);
    const a = BIG_SIZES[0]! + BIG_SIZES[1]!;
    expect(seen).toEqual(
      [0, BIG_SIZES[0]!, a, a + part(0.3), a + part(0.6), a + part(0.61), a + part(0.8), total].map((d) => [d, total]),
    );
  }, 30_000);

  it("pause : tant que la promesse n'est pas résolue, aucun PUT suivant", async () => {
    const events: string[] = [];
    const s = sender({
      segments: 3,
      put: (n, _a, onBytes, body) => {
        events.push(`PUT ${n}`);
        return ok204(onBytes, body);
      },
    });
    let k = 0;
    const pause = async () => {
      const i = k++;
      events.push(`pause ${i}`);
      if (i === 1) {
        // Longue pause (en temps réel et simulé) : rien ne doit partir pendant ce temps.
        for (let t = 0; t < 300; t++) await new Promise((r) => setImmediate(r));
        await new Promise((r) => setTimeout(r, 60_000));
        events.push("fin pause 1");
      }
    };
    await drive(createShare(ORIGIN, BIG, { ...base(s), pause }));
    expect(events).toEqual(["pause 0", "PUT 0", "pause 1", "fin pause 1", "PUT 1", "pause 2", "PUT 2"]);
  }, 30_000);
});

describe("createShare : reprise sur coupure (budget SERVER_STALL_MS)", () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date", "performance"] }));
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("3 minutes d'échecs puis succès : envoi terminé ; attentes 1, 2, 4, 8, 16, 30, 30… s ; un appel par essai", async () => {
    let t0 = 0;
    const s = sender({
      segments: 1,
      put: (_n, a, onBytes, body) => {
        if (a === 1) t0 = Date.now();
        if (Date.now() - t0 < 180_000) throw new TypeError("fetch failed");
        return ok204(onBytes, body);
      },
    });
    const retries: { attempt: number; inMs: number; offline: boolean }[] = [];
    const r = await drive(createShare(ORIGIN, SMALL, { ...base(s), onRetry: (x) => retries.push(x) }));
    expect(r.expiresInS).toBe(3600);
    const waits = [1000, 2000, 4000, 8000, 16000, 30000, 30000, 30000, 30000, 30000];
    expect(retries).toEqual(waits.map((inMs, i) => ({ attempt: i + 1, inMs, offline: false })));
    expect(s.attempts.get(0)).toBe(waits.length + 1);
  }, 30_000);

  it("429 : Retry-After respecté (max(attente, retry_after_s)) ; 5xx réessayé ; 4xx : arrêt et destruction", async () => {
    const replies: Up[] = [
      { status: 429, json: { error: "limit", retry_after_s: 7 } },
      { status: 429, json: { error: "limit", retry_after_s: 1 } },
      { status: 503, json: { error: "internal" } },
    ];
    const s = sender({ segments: 1, put: (_n, a, onBytes, body) => replies[a - 1] ?? ok204(onBytes, body) });
    const retries: number[] = [];
    await drive(createShare(ORIGIN, SMALL, { ...base(s), onRetry: (x) => retries.push(x.inMs) }));
    expect(retries).toEqual([7000, 2000, 4000]);

    const g = sender({ segments: 1, put: () => ({ status: 410, json: { error: "gone" } }) });
    expect(await reject(drive(createShare(ORIGIN, SMALL, base(g))))).toEqual(new Error("gone"));
    expect(g.attempts.get(0)).toBe(1);
    expect(g.destroys).toHaveLength(1);
  }, 30_000);

  it("échéance : un segment acquitté la repousse ; 10 min de coupure avant deux segments → succès", async () => {
    const start = new Map<number, number>();
    const s = sender({
      segments: 3,
      put: (n, a, onBytes, body) => {
        if (a === 1) start.set(n, Date.now());
        if (n > 0 && Date.now() - start.get(n)! < 600_000) throw new TypeError("fetch failed");
        return ok204(onBytes, body);
      },
    });
    const r = await drive(createShare(ORIGIN, BIG, base(s)));
    expect(r.expiresInS).toBe(3600);
  }, 30_000);

  it("échéance dépassée : Error(\"reseau\") puis destroy ; aucun essai lancé après « dernier acquittement + SERVER_STALL_MS »", async () => {
    let ack0 = 0;
    const s = sender({
      segments: 3,
      put: (n, _a, onBytes, body) => {
        if (n === 0) {
          ack0 = Date.now();
          return ok204(onBytes, body);
        }
        throw new TypeError("fetch failed");
      },
    });
    expect(await reject(drive(createShare(ORIGIN, BIG, base(s))))).toEqual(new Error("reseau"));
    const tries = s.at["PUT 1"]!;
    expect(tries.at(-1)! - ack0).toBeLessThanOrEqual(SERVER_STALL_MS);
    expect(tries.at(-1)! - ack0).toBeGreaterThan(SERVER_STALL_MS - 30_000);
    expect(s.destroys).toHaveLength(1);
    expect(s.destroys[0]!.keepalive).toBe(true);
    expect(s.at["POST /api/shares/ID/destroy"]![0]! - ack0).toBeLessThanOrEqual(SERVER_STALL_MS);
  }, 30_000);

  it("essai qui ne répond jamais : interrompu à l'échéance → Error(\"reseau\") puis destroy", async () => {
    let created = 0;
    const s = sender({
      segments: 1,
      put: (_n, _a, _b, _body, signal) => {
        created = Date.now(); // pas d'attente entre la création et le premier PUT
        return new Promise<Up>((_, rej) => signal!.addEventListener("abort", () => rej(new DOMException("Aborted", "AbortError"))));
      },
    });
    expect(await reject(drive(createShare(ORIGIN, SMALL, base(s))))).toEqual(new Error("reseau"));
    expect(s.at["POST /api/shares/ID/destroy"]![0]! - created).toBe(SERVER_STALL_MS);
  });

  it("événement online : essai immédiat ; offline signalé par navigator.onLine", async () => {
    const win = new EventTarget();
    vi.stubGlobal("addEventListener", win.addEventListener.bind(win));
    vi.stubGlobal("removeEventListener", win.removeEventListener.bind(win));
    vi.stubGlobal("navigator", { onLine: false });
    const s = sender({ segments: 1, put: (_n, a, onBytes, body) => (a < 3 ? Promise.reject(new TypeError("x")) : ok204(onBytes, body)) });
    const retries: { attempt: number; inMs: number; offline: boolean }[] = [];
    const onRetry = (x: (typeof retries)[number]) => {
      retries.push(x);
      if (x.attempt === 2) queueMicrotask(() => win.dispatchEvent(new Event("online")));
    };
    await drive(createShare(ORIGIN, SMALL, { ...base(s), onRetry }));
    expect(retries).toEqual([
      { attempt: 1, inMs: 1000, offline: true },
      { attempt: 2, inMs: 2000, offline: true },
    ]);
    const t = s.at["PUT 0"]!;
    expect(t[1]! - t[0]!).toBe(1000);
    expect(t[2]! - t[1]!).toBe(0); // online : sans attendre les 2 s
  });

  const READY = { opens_used: 0, max_opens: 1, expires_in_s: 3500, state: "ready" };
  it("réponse de finalize perdue, nouvel essai → 404, status « ready » : succès, aucune destruction", async () => {
    const s = sender({ segments: 1, finalize: (a) => (a === 1 ? "net" : j(404, { error: "not_found" })), status: () => j(200, READY) });
    const r = await drive(createShare(ORIGIN, SMALL, base(s)));
    expect(r.expiresInS).toBe(3500);
    expect(r.manage).toMatch(/\/m\//);
    expect(s.calls.filter((c) => c.startsWith("POST /api/shares/ID") || c.startsWith("GET /api/shares/ID"))).toEqual([
      "POST /api/shares/ID/finalize",
      "POST /api/shares/ID/finalize",
      "GET /api/shares/ID/status",
    ]);
    expect(s.destroys).toEqual([]);
  });
  it.each<[string, () => Reply]>([
    ["404", () => j(404, { error: "not_found" })],
    ["uploading", () => j(200, { ...READY, expires_in_s: 0, state: "uploading" })],
    ["coupure", () => "net"],
  ])("réponse de finalize perdue, nouvel essai → 404, status %s : destruction et NotFoundError", async (_, status) => {
    const s = sender({ segments: 1, finalize: (a) => (a === 1 ? "net" : j(404, { error: "not_found" })), status });
    expect(await reject(drive(createShare(ORIGIN, SMALL, base(s))))).toBeInstanceOf(NotFoundError);
    expect(s.calls).toContain("GET /api/shares/ID/status");
    expect(s.destroys).toHaveLength(1);
    expect(s.destroys[0]!.keepalive).toBe(true);
  });
  it("finalize : réponse définitive dès le premier essai (404, 409) → aucun status, aucun nouvel essai, destruction", async () => {
    for (const [code, err] of [[404, "not_found"], [409, "incomplete"]] as const) {
      const s = sender({ segments: 1, finalize: () => j(code, { error: err }), status: () => j(200, READY) });
      await reject(drive(createShare(ORIGIN, SMALL, base(s))));
      expect(s.calls.filter((c) => c.endsWith("/finalize"))).toHaveLength(1);
      expect(s.calls).not.toContain("GET /api/shares/ID/status");
      expect(s.destroys).toHaveLength(1);
    }
  });

  it("finalize coupé puis rétabli → succès, par le budget seul (aucun essai interne)", async () => {
    const s = sender({ segments: 1, finalize: (a) => (a < 3 ? "net" : undefined) });
    const retries: number[] = [];
    const r = await drive(createShare(ORIGIN, SMALL, { ...base(s), onRetry: (x) => retries.push(x.inMs) }));
    expect(r.expiresInS).toBe(3600);
    expect(retries).toEqual([1000, 2000]);
    expect(s.calls.filter((c) => c.endsWith("/finalize"))).toHaveLength(3);
  });
});

describe("createShare : preuve anti-robot typée et défi préparé", () => {
  beforeEach(() => {
    captured.buffers.length = 0;
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date", "performance"] });
  });
  afterEach(() => vi.useRealTimers());
  const kdfSalt = () => b64u(captured.buffers.find((b) => b.length === 16)!);
  const POW_KEYS = ["access_v", "altcha", "bucket", "hp", "kdf", "manage_v", "max_opens", "proof_v", "salt", "shown_at", "ttl_hours"];

  it("solveCaptcha reçoit le défi et { fallbackOrigin: null, mode: \"pow\" } ; { kind: \"pow\" } → corps altcha", async () => {
    const s = sender({ segments: 1 });
    const o = base(s);
    await drive(createShare(ORIGIN, SMALL, o));
    expect(o.solveCaptcha).toHaveBeenCalledTimes(1);
    const [ch, cx] = o.solveCaptcha.mock.calls[0]!;
    expect(Object.keys(ch as object).sort()).toEqual(["algorithm", "challenge", "maxNumber", "salt", "signature"]);
    expect(cx).toEqual({ fallbackOrigin: null, mode: "pow" });
    const b = s.bodies[0]!;
    expect(Object.keys(b).sort()).toEqual(POW_KEYS);
    expect(b.altcha).toBe("x");
    expect(b.shown_at).toBe("jeton");
    expect(b.salt).toBe(kdfSalt());
  });

  it("{ kind: \"recaptcha\" } → corps recaptcha + captcha_salt (sel du défi), sans altcha ; salt reste le sel KDF", async () => {
    const chSalt = capSalt();
    const s = sender({
      segments: 1,
      captcha: () => ({ algorithm: "SHA-256", challenge: "c", maxNumber: 1, salt: chSalt, signature: "g", shown_at: "jeton", fallback: "https://verif.test" }),
    });
    const o = { ...base(s), solveCaptcha: vi.fn(async (): Promise<CaptchaProof> => ({ kind: "recaptcha", token: "tok" })) };
    await drive(createShare(ORIGIN, SMALL, o));
    expect(o.solveCaptcha.mock.calls[0]).toEqual([expect.anything(), { fallbackOrigin: "https://verif.test", mode: "pow" }]);
    const b = s.bodies[0]!;
    expect(Object.keys(b).sort()).toEqual([...POW_KEYS.filter((k) => k !== "altcha"), "captcha_salt", "recaptcha"].sort());
    expect(b.recaptcha).toBe("tok");
    expect(b.captcha_salt).toBe(chSalt);
    expect(b.salt).toBe(kdfSalt());
    expect(b.salt).not.toBe(chSalt);
  });

  it("défi préparé valable plus de 15 s : ni GET /api/captcha ni solveCaptcha ; preuve préparée utilisée ; aucune attente après 5 s", async () => {
    const s = sender({ segments: 1 });
    const cap = await prepareCaptcha(ORIGIN, { fetch: s.fetch });
    const received = Date.now();
    vi.advanceTimersByTime(5000);
    const o = { ...base(s), prepared: { cap, proof: Promise.resolve<CaptchaProof>({ kind: "pow", payload: "pre" }) } };
    const t = Date.now();
    await drive(createShare(ORIGIN, SMALL, o));
    expect(s.calls.filter((c) => c === "GET /api/captcha")).toHaveLength(1); // celui de prepareCaptcha
    expect(o.solveCaptcha).not.toHaveBeenCalled();
    expect(s.bodies[0]!.altcha).toBe("pre");
    expect(s.at["POST /api/shares"]![0]).toBe(t);
    expect(t - received).toBe(5000);
  });

  it("défi préparé 1 s plus tôt : la création attend 2,1 s (3,1 s depuis la réception du défi)", async () => {
    const s = sender({ segments: 1 });
    const cap = await prepareCaptcha(ORIGIN, { fetch: s.fetch });
    const received = Date.now();
    vi.advanceTimersByTime(1000);
    await drive(createShare(ORIGIN, SMALL, { ...base(s), prepared: { cap, proof: Promise.resolve<CaptchaProof>({ kind: "pow", payload: "pre" }) } }));
    expect(s.at["POST /api/shares"]![0]! - received).toBe(CAPTCHA_MIN_MS);
  });

  it.each([
    ["en avance de 10 min sur le serveur", -600_000],
    ["en retard de 10 min sur le serveur", 600_000],
  ])("horloge du client %s : la preuve préparée est utilisée", async (_, skew) => {
    const server = () => Date.now() + skew; // heure du serveur
    const s = sender({
      segments: 1,
      captchaDate: () => new Date(server()).toUTCString(),
      captcha: () => ({
        algorithm: "SHA-256",
        challenge: "c",
        maxNumber: 1,
        salt: `${"a".repeat(24)}.${"b".repeat(16)}.0?expires=${Math.floor(server() / 1000) + 120}&`,
        signature: "g",
        shown_at: "jeton",
      }),
    });
    const cap = await prepareCaptcha(ORIGIN, { fetch: s.fetch });
    vi.advanceTimersByTime(5000);
    const o = { ...base(s), prepared: { cap, proof: Promise.resolve<CaptchaProof>({ kind: "pow", payload: "pre" }) } };
    await drive(createShare(ORIGIN, SMALL, o));
    expect(s.calls.filter((c) => c === "GET /api/captcha")).toHaveLength(1);
    expect(o.solveCaptcha).not.toHaveBeenCalled();
    expect(s.bodies[0]!.altcha).toBe("pre");
  });

  it("validité mesurée sur l'horloge monotone : un saut de Date.now() n'y change rien ; 120 s au plus", async () => {
    const s = sender({ segments: 1 });
    const cap = await prepareCaptcha(ORIGIN, { fetch: s.fetch });
    vi.setSystemTime(Date.now() + 3_600_000); // horloge murale avancée d'une heure, performance.now() inchangé
    const o = { ...base(s), prepared: { cap, proof: Promise.resolve<CaptchaProof>({ kind: "pow", payload: "pre" }) } };
    await drive(createShare(ORIGIN, SMALL, o));
    expect(o.solveCaptcha).not.toHaveBeenCalled();
    // 106 s après la réception : il reste 14 s sur les 120 s du défi → nouveau défi.
    const s2 = sender({ segments: 1 });
    const cap2 = await prepareCaptcha(ORIGIN, { fetch: s2.fetch });
    vi.advanceTimersByTime(106_000);
    const o2 = { ...base(s2), prepared: { cap: cap2, proof: Promise.resolve<CaptchaProof>({ kind: "pow", payload: "pre" }) } };
    await drive(createShare(ORIGIN, SMALL, o2));
    expect(o2.solveCaptcha).toHaveBeenCalledTimes(1);
  });

  it("défi préparé valable moins de 15 s, déjà utilisé, ou d'une autre origine : nouveau défi et solveCaptcha", async () => {
    const short = sender({
      segments: 1,
      captchaDate: () => new Date(Date.now()).toUTCString(),
      captcha: () => ({ algorithm: "SHA-256", challenge: "c", maxNumber: 1, salt: capSalt(14), signature: "g", shown_at: "jeton" }),
    });
    const cap = await prepareCaptcha(ORIGIN, { fetch: short.fetch });
    // La preuve écartée peut échouer sans rejet non géré.
    const o = { ...base(short), prepared: { cap, proof: Promise.reject<CaptchaProof>(new Error("worker")) } };
    await drive(createShare(ORIGIN, SMALL, o));
    expect(short.calls.filter((c) => c === "GET /api/captcha")).toHaveLength(2);
    expect(o.solveCaptcha).toHaveBeenCalledTimes(1);
    expect(short.bodies[0]!.altcha).toBe("x");

    const s = sender({ segments: 1 });
    const used = await prepareCaptcha(ORIGIN, { fetch: s.fetch });
    const pre = () => ({ cap: used, proof: Promise.resolve<CaptchaProof>({ kind: "pow", payload: "pre" }) });
    await drive(createShare(ORIGIN, SMALL, { ...base(s), prepared: pre() }));
    const again = { ...base(s), prepared: pre() };
    await drive(createShare(ORIGIN, SMALL, again)); // un défi ne sert qu'une fois
    expect(again.solveCaptcha).toHaveBeenCalledTimes(1);
    expect(s.bodies.map((b) => b.altcha)).toEqual(["pre", "x"]);

    const other = await prepareCaptcha("https://srx.test", { fetch: s.fetch });
    const o3 = { ...base(s), prepared: { cap: other, proof: Promise.resolve<CaptchaProof>({ kind: "pow", payload: "pre" }) } };
    await drive(createShare(ORIGIN, SMALL, o3));
    expect(o3.solveCaptcha).toHaveBeenCalledTimes(1);
  }, 30_000);
});
