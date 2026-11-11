// Correspondance des erreurs du client (serveur simulé) et effacement des clés.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { b64u, concat, unb64u, utf8 } from "../engine/pure";
import { CHUNK, CHUNK_CT, HEADER, KDF_MIN, SEG_CHUNKS, accessKeys, bucketFor, chunksFor, contentKeys, deriveAccess, loadEngine, manageLink, newSeed, parseLink, passwordKey, seal, segmentCount, segmentSize, shareId, shareLink, type Item, type KeepTtl, type KLien, type KMdp, type Rights, type SGestion } from "../engine";

/** Octroi d'ouverture factice (54 caractères base64url, spec §41.4). */
const GRANT0 = "G".repeat(54);
// Copies JavaScript des secrets que le client tient (K_lien, S_gestion, K_accès, K_mdp, K_preuve,
// aléa) : le test vérifie qu'elles sont mises à zéro. K_contenu, K_env, R et les graines des
// éléments restent dans le moteur (poignées opaques) : aucune copie JavaScript à effacer.
const captured = vi.hoisted(() => ({ buffers: [] as Uint8Array<ArrayBuffer>[], kMdp: [] as Uint8Array<ArrayBuffer>[], kLien: [] as Uint8Array[], ids: [] as Uint8Array[] }));
// Fournisseur WebCrypto : les tirages de 32 octets (graine R, graine k d'un élément) et les clés
// brutes passées à aesImport (K_contenu, K_env, clé d'un élément) sont des copies JavaScript que
// le moteur efface après usage : capturées aussi.
vi.mock("../engine/provider", async (orig) => {
  const m = await orig<typeof import("../engine/provider")>();
  return {
    ...m,
    createProvider: () => {
      const p = m.createProvider();
      return {
        ...p,
        random: (n: number) => {
          const b = p.random(n);
          if (n === 32) captured.buffers.push(b as Uint8Array<ArrayBuffer>);
          return b;
        },
        aesImport: (raw: Uint8Array) => {
          captured.buffers.push(raw as Uint8Array<ArrayBuffer>);
          return p.aesImport(raw);
        },
      };
    },
  };
});
vi.mock("../engine", async (orig) => {
  const m = await orig<typeof import("../engine")>();
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
    parseLink: async (...a: Parameters<typeof m.parseLink>) => {
      const r = await m.parseLink(...a);
      if (r.kind === "s") captured.kLien.push(r.kLien);
      return r;
    },
    shareId: async (k: import("../engine").KLien) => {
      const r = await m.shareId(k);
      captured.ids.push(r);
      return r;
    },
    deriveAccess: async (k: import("../engine").KLien) => {
      const r = await m.deriveAccess(k);
      captured.buffers.push(r.kAcces);
      return r;
    },
    accessKeys: async (...a: Parameters<typeof m.accessKeys>) => {
      const r = await m.accessKeys(...a);
      captured.buffers.push(r.kPreuve);
      return r;
    },
    passwordKeyForCreate: async (...a: Parameters<typeof m.passwordKeyForCreate>) => {
      const r = await m.passwordKeyForCreate(...a);
      captured.buffers.push(r);
      captured.kMdp.push(r);
      return r;
    },
    passwordKey: async (...a: Parameters<typeof m.passwordKey>) => {
      const r = await m.passwordKey(...a);
      captured.buffers.push(r);
      captured.kMdp.push(r);
      return r;
    },
  };
});

import {
  BadPasswordError,
  CAPTCHA_MIN_MS,
  LimitError,
  NotFoundError,
  ReadBudgetError,
  ServerError,
  collectToBlob,
  createShare,
  destroyShare,
  fetchMeta,
  openShare,
  shareStatus,
  type CaptchaCtx,
  type CaptchaProof,
} from "./client";
import { prepareCaptcha } from "./prepare";
import { SERVER_STALL_MS } from "./upload";

const ORIGIN = "https://srv.test";
const KLIEN = () => new Uint8Array(32).fill(1) as KLien;
const LINK = await shareLink(ORIGIN, new Uint8Array(32).fill(1) as KLien);
const MANAGE = await manageLink(ORIGIN, new Uint8Array(32).fill(2) as SGestion);
const PW = "Kq7!mP2#x?a"; // forme d'un mot de passe généré (D41-15)

type Reply = Response | "net";
type Route = (method: string, path: string) => Reply | undefined;
const j = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const SALT = new Uint8Array(16).fill(3);
const META = { expires_in_s: 3000, salt: b64u(SALT), kdf: { ops: 3, mem: 67108864 }, bucket: 16, segments: 1, opens_left: 2 };
const ENV0 = b64u(new Uint8Array(60)); // enveloppe quelconque (jamais déballée : paquet invalide)

// Paquet v2 (un élément par entrée, chacun sous sa clé, spec §41.14) pour LINK et PW (K_lien =
// 1…1, sel = SALT) : segments (morceaux non utilisés laissés à zéro, jamais lus) et enveloppe E.
// Placement comme l'ancien paquet de ces tests : fichiers bout à bout (à la frontière de morceau),
// puis notes au début du dernier segment du palier (lues avec le manifeste, sans requête de plus).
// Les morceaux des éléments sont chiffrés ici par WebCrypto (graine k tirée ici, HKDF et nonces du
// moteur), pour placer un petit élément à cheval sur deux segments comme l'ancien paquet ; le
// manifeste, l'en-tête, R et E viennent du moteur.
type SealOpts = { rights?: Rights; keepTtlH?: KeepTtl };
let kMdpPW: Uint8Array<ArrayBuffer> | undefined;
const ELEMENT_AD = utf8("shhdrop/v2/element-ad");
async function pack(items: Item[], o?: SealOpts, idOverride?: Uint8Array<ArrayBuffer>) {
  kMdpPW ??= new Uint8Array(await passwordKey(PW, SALT, KDF_MIN));
  const E = await loadEngine();
  const W = E.wasm;
  const data = await Promise.all(items.map(async (it) => (it.data instanceof Uint8Array ? it.data : new Uint8Array(await it.data.arrayBuffer()))));
  const first: number[] = [];
  let next = 0;
  for (const [i, it] of items.entries()) {
    if (it.kind !== "file") continue;
    first[i] = next;
    next += chunksFor(data[i]!.length);
  }
  const texts = items.map((it, i) => (it.kind === "text" ? i : -1)).filter((i) => i >= 0);
  const textChunks = texts.reduce((n, i) => n + chunksFor(data[i]!.length), 0);
  const b0 = bucketFor((next + textChunks) * CHUNK);
  next = Math.max(next, (segmentCount(b0) - 1) * SEG_CHUNKS);
  for (const i of texts) {
    first[i] = next;
    next += chunksFor(data[i]!.length);
  }
  const chunks = new Map<number, Uint8Array>();
  const sealers: number[] = [];
  for (const [i, d] of data.entries()) {
    const k = crypto.getRandomValues(new Uint8Array(32));
    const key = await crypto.subtle.importKey("raw", W.hkdf(k, "shhdrop/v2/element", 32) as Uint8Array<ArrayBuffer>, "AES-GCM", false, ["encrypt"]);
    for (let c = 0; c < chunksFor(d.length); c++) {
      const plain = new Uint8Array(CHUNK);
      plain.set(d.subarray(c * CHUNK, (c + 1) * CHUNK));
      const iv = W.nonce(first[i]! + c, false) as Uint8Array<ArrayBuffer>;
      chunks.set(first[i]! + c, new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: ELEMENT_AD }, key, plain)));
    }
    // Scelleur du moteur qui tient la même graine k (aléa rejoué) : sealFinal la reprend.
    const el = await W.elementSealer({ ...E.provider, random: () => new Uint8Array(k) }, 0, 0);
    keepSealers.push(el);
    sealers.push(el.id);
  }
  const r = await newSeed();
  const keys = await contentKeys(r);
  const entries = items.map((it, i) => ({ kind: it.kind, name: it.name, mime: it.mime, size: data[i]!.length, first: first[i]!, sealer: sealers[i]!, ...(it.kind === "file" && it.clean ? { clean: it.clean } : {}) }));
  const fin = await W.sealFinal(entries, keys, o?.rights, o?.keepTtlH);
  const bucket = fin.bucket;
  const segs: Uint8Array<ArrayBuffer>[] = [];
  for (let n = 0; n < segmentCount(bucket); n++) segs.push(new Uint8Array(segmentSize(bucket, n)));
  const at = (i: number) => (i < SEG_CHUNKS ? HEADER : 0) + (i % SEG_CHUNKS) * CHUNK_CT;
  for (const [i, ct] of chunks) segs[Math.floor(i / SEG_CHUNKS)]!.set(ct, at(i));
  segs[0]!.set(fin.header, 0);
  segs[Math.floor((bucket - 1) / SEG_CHUNKS)]!.set(fin.tail, at(bucket - 1));
  const { kEnv } = await accessKeys(KLIEN(), new Uint8Array(kMdpPW) as KMdp);
  const envelope = b64u(await seal(kEnv, r, idOverride ?? (await shareId(KLIEN())), fin.header));
  return { segs, envelope, bucket, segments: segmentCount(bucket), header: fin.header as Uint8Array<ArrayBuffer>, r };
}
const keepSealers: unknown[] = [];
type Pack = Awaited<ReturnType<typeof pack>>;
const packRoute = (pk: Pack, bad?: (n: number, seg: Uint8Array<ArrayBuffer>) => Uint8Array<ArrayBuffer>): Route => (_, p) => {
  if (p.endsWith("/meta")) return j(200, { ...META, bucket: pk.bucket, segments: pk.segments });
  if (p.endsWith("/unlock")) return j(200, { download_token: "t", segments: pk.segments, envelope: pk.envelope, grant: GRANT0, opens_left: 0 });
  const m = /\/segments\/(\d+)$/.exec(p);
  if (m) {
    const n = Number(m[1]);
    return new Response(bad ? bad(n, new Uint8Array(pk.segs[n]!)) : new Uint8Array(pk.segs[n]!), { status: 200 });
  }
  return undefined;
};

function server(route: Route) {
  const calls: string[] = [];
  const f = async (input: RequestInfo | URL, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const path = String(input).slice(ORIGIN.length);
    calls.push(`${method} ${path}`);
    const r = route(method, path) ?? defaults(method, path);
    if (r === "net") throw new TypeError("fetch failed");
    return r;
  };
  return { net: { fetch: f as typeof fetch, retryDelayMs: 1 }, calls };
}
function defaults(method: string, path: string): Reply {
  if (path === "/api/shares/meta") return j(200, META);
  if (path === "/api/shares/unlock") return j(200, { download_token: "t", segments: 1, envelope: ENV0, grant: GRANT0, opens_left: 0 });
  if (path === "/api/shares/segments/0") return new Response(new Uint8Array(segmentSize(16, 0)), { status: 200 });
  if (path === "/api/shares/done") return new Response(null, { status: 204 });
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
    ["400 sur unlock", (_, p) => (p.endsWith("/unlock") ? j(400, { error: "bad_request" }) : undefined)],
    ["403 sans attempts_left", (_, p) => (p.endsWith("/unlock") ? j(403, { error: "bad_password" }) : undefined)],
    ["KDF trop faible", (_, p) => (p.endsWith("/meta") ? j(200, { ...META, kdf: { ops: 1, mem: 8192 } }) : undefined)],
    ["KDF trop forte", (_, p) => (p.endsWith("/meta") ? j(200, { ...META, kdf: { ops: 3, mem: 2 ** 30 } }) : undefined)],
    // Audit F4 : rien au-delà des paramètres de création (3 passes, 64 Mio).
    ["KDF 4 passes", (_, p) => (p.endsWith("/meta") ? j(200, { ...META, kdf: { ops: 4, mem: 67108864 } }) : undefined)],
    ["KDF 256 Mio, 10 passes", (_, p) => (p.endsWith("/meta") ? j(200, { ...META, kdf: { ops: 10, mem: 268435456 } }) : undefined)],
    ["meta sans sel", (_, p) => (p.endsWith("/meta") ? j(200, { ...META, salt: undefined }) : undefined)],
    ["sel de 15 octets", (_, p) => (p.endsWith("/meta") ? j(200, { ...META, salt: b64u(new Uint8Array(15)) }) : undefined)],
    ["palier inconnu", (_, p) => (p.endsWith("/meta") ? j(200, { ...META, bucket: 2 }) : undefined)],
    ["meta non JSON", (_, p) => (p.endsWith("/meta") ? new Response("<html>", { status: 200 }) : undefined)],
    ["unlock : nombre de segments différent", (_, p) => (p.endsWith("/unlock") ? j(200, { download_token: "t", segments: 2, envelope: ENV0, grant: GRANT0, opens_left: 0 }) : undefined)],
    ["unlock sans enveloppe", (_, p) => (p.endsWith("/unlock") ? j(200, { download_token: "t", segments: 1 }) : undefined)],
    ["enveloppe de 59 octets", (_, p) => (p.endsWith("/unlock") ? j(200, { download_token: "t", segments: 1, envelope: b64u(new Uint8Array(59)), grant: GRANT0, opens_left: 0 }) : undefined)],
    ["palier 1 annoncé, paquet invalide", (_, p) => (p.endsWith("/meta") ? j(200, { ...META, bucket: 1 }) : undefined)],
    ["segment de mauvaise taille (persistant)", (_, p) => (p.endsWith("/segments/0") ? new Response(new Uint8Array(10)) : undefined)],
    ["paquet corrompu", () => undefined],
  ];
  it.each(notFound)("%s → NotFoundError", async (_, route) => {
    const s = server(route);
    expect(await reject(openShare(LINK, PW, ORIGIN, undefined, s.net))).toBeInstanceOf(NotFoundError);
  });
  it("5xx persistant → ServerError (texte fixe) ; 503 « frozen » → maintenance (tâche UP)", async () => {
    const e500 = await reject(openShare(LINK, PW, ORIGIN, undefined, server((_, p) => (p.endsWith("/unlock") ? j(500, { error: "internal" }) : undefined)).net));
    expect(e500).toBeInstanceOf(ServerError);
    expect((e500 as ServerError).maintenance).toBe(false);
    const meta503 = await reject(fetchMeta(LINK, ORIGIN, server((_, p) => (p.endsWith("/meta") ? j(503, { error: "frozen" }) : undefined)).net));
    expect(meta503).toBeInstanceOf(ServerError);
    expect((meta503 as ServerError).maintenance).toBe(true);
    // Code choisi par le serveur : jamais affiché ; un autre 503 reste une erreur du serveur.
    const busy = await reject(fetchMeta(LINK, ORIGIN, server((_, p) => (p.endsWith("/meta") ? j(503, { error: "busy" }) : undefined)).net));
    expect((busy as ServerError).maintenance).toBe(false);
  });
  it("paquet corrompu : done() appelé d'office ; KDF refusée : aucun unlock", async () => {
    const s = server(() => undefined);
    await reject(openShare(LINK, PW, ORIGIN, undefined, s.net));
    expect(s.calls).toEqual(["GET /api/shares/meta", "POST /api/shares/unlock", "GET /api/shares/segments/0", "POST /api/shares/done"]);
    for (const kdf of [{ ops: 2, mem: 67108864 }, { ops: 4, mem: 67108864 }, { ops: 3, mem: 67108865 }, { ops: 10, mem: 268435456 }]) {
      const k = server((_, p) => (p.endsWith("/meta") ? j(200, { ...META, kdf }) : undefined));
      expect(await reject(openShare(LINK, PW, ORIGIN, undefined, k.net))).toBeInstanceOf(NotFoundError);
      expect(k.calls, JSON.stringify(kdf)).toEqual(["GET /api/shares/meta"]);
    }
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
  it("mot de passe vide ou fait de blancs : K_lien effacée quand même (audit F3)", async () => {
    for (const pw of ["", " ", "\t\r\n "]) {
      const s = server(() => undefined);
      const n = captured.kLien.length;
      expect(await reject(openShare(LINK, pw, ORIGIN, undefined, s.net)), JSON.stringify(pw)).toEqual(new Error("mot_de_passe_requis"));
      expect(s.calls).toEqual([]);
      expect(captured.kLien.length).toBe(n + 1);
      expect(captured.kLien.at(-1)!.every((b) => b === 0)).toBe(true);
    }
  });
  it("échec au premier appel au serveur : K_lien et id effacés (audit F3)", async () => {
    const s = server(() => j(404, { error: "not_found" }));
    expect(await reject(openShare(LINK, PW, ORIGIN, undefined, s.net))).toBeInstanceOf(NotFoundError);
    expect(captured.kLien.at(-1)!.every((b) => b === 0)).toBe(true);
    expect(captured.ids.at(-1)!.length).toBe(16);
    expect(captured.ids.at(-1)!.every((b) => b === 0)).toBe(true);
  });
});

describe("fetchMeta, shareStatus, destroyShare : correspondance des erreurs", () => {
  it("fetchMeta", async () => {
    expect(await reject(fetchMeta(LINK, ORIGIN, server(() => j(404, { error: "not_found" })).net))).toBeInstanceOf(NotFoundError);
    expect(await reject(fetchMeta(LINK, ORIGIN, server(() => j(429, { error: "limit", retry_after_s: 0 })).net))).toBeInstanceOf(LimitError);
    expect(await reject(fetchMeta(LINK, ORIGIN, server(() => "net").net))).toEqual(new Error("reseau"));
    expect(await reject(fetchMeta(LINK, ORIGIN, server(() => j(200, { nope: 1 })).net))).toBeInstanceOf(NotFoundError);
    expect(await fetchMeta(LINK, ORIGIN, server(() => undefined).net)).toEqual({ expiresInS: 3000, opensLeft: 2 });
    // Ouvertures restantes absentes ou hors bornes : réponse refusée (ruling 5).
    for (const bad of [{ ...META, opens_left: undefined }, { ...META, opens_left: 0 }, { ...META, opens_left: 1.5 }])
      expect(await reject(fetchMeta(LINK, ORIGIN, server((_m, path) => (path.endsWith("/meta") ? j(200, bad) : undefined)).net))).toBeInstanceOf(NotFoundError);
  });
  it("shareStatus", async () => {
    expect(await reject(shareStatus(MANAGE, ORIGIN, server(() => j(404, { error: "not_found" })).net))).toBeInstanceOf(NotFoundError);
    expect(await reject(shareStatus(MANAGE, ORIGIN, server(() => j(500, { error: "internal" })).net))).toBeInstanceOf(ServerError);
    expect(await reject(shareStatus(MANAGE, ORIGIN, server(() => j(200, { opens_used: "x" })).net))).toBeInstanceOf(NotFoundError);
    expect(await reject(shareStatus(MANAGE, ORIGIN, server(() => "net").net))).toEqual(new Error("reseau"));
    for (const code of [400, 403, 405])
      expect(await reject(shareStatus(MANAGE, ORIGIN, server(() => j(code, { error: "nope" })).net)), String(code)).toBeInstanceOf(ServerError);
  });
  it("destroyShare", async () => {
    expect(await reject(destroyShare(MANAGE, ORIGIN, server(() => j(404, { error: "not_found" })).net))).toBeInstanceOf(NotFoundError);
    expect(await reject(destroyShare(MANAGE, ORIGIN, server(() => j(429, { error: "limit", retry_after_s: 9 })).net))).toBeInstanceOf(LimitError);
    expect(await reject(destroyShare(MANAGE, ORIGIN, server(() => "net").net))).toEqual(new Error("reseau"));
    // Revue du 10 novembre : seul 404 ou 410 vaut « disparu ». Un refus d'un intermédiaire
    // (403 d'un pare-feu, 400, 405, 413) ne doit pas faire afficher « supprimé ».
    for (const code of [400, 401, 403, 405, 413]) {
      const e = await reject(destroyShare(MANAGE, ORIGIN, server(() => j(code, { error: "nope" })).net));
      expect(e, String(code)).toBeInstanceOf(ServerError);
    }
    expect(await reject(destroyShare(MANAGE, ORIGIN, server(() => j(410, { error: "gone" })).net))).toBeInstanceOf(NotFoundError);
    // lien de partage : meta passe, destroy refusé (mauvais mot de passe côté serveur) → NotFoundError
    const s = server(() => undefined);
    expect(await reject(destroyShare(LINK, ORIGIN, { password: PW, ...s.net }))).toBeInstanceOf(NotFoundError);
    expect(s.calls).toEqual(["GET /api/shares/meta", "POST /api/shares/destroy"]);
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
    captured.kMdp.length = 0;
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
  // Échec avant la création (spec §41.14 : la création du brouillon précède Argon2id) :
  // K_lien, S_gestion, K_accès, tous à zéro ; aucun K_mdp calculé.
  const allWiped = () => {
    expect(secrets().length).toBeGreaterThanOrEqual(3);
    expect(captured.kMdp).toHaveLength(0);
    for (const b of secrets()) expect(b.every((x) => x === 0)).toBe(true);
  };
  it("échec au défi anti-robot (réseau)", async () => {
    const f = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    const items = [{ kind: "text" as const, name: "", mime: "text/plain", data: new Uint8Array([97]) }];
    await expect(createShare(ORIGIN, items, opts(f))).rejects.toThrow("reseau");
    allWiped();
  });
  it("échec au scellement (aucun élément)", async () => {
    await expect(createShare(ORIGIN, [], opts(globalThis.fetch))).rejects.toThrow("vide");
    // Refusé avant tout : aucune clé tirée, aucun Argon2id.
    expect(captured.kMdp).toEqual([]);
    expect(secrets()).toEqual([]);
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
    allWiped();
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

/** Fichier du serveur après finalize d'un brouillon (spec §41.14) : segments reçus, trous à zéro, en-tête, manifeste. */
function serverFile(bucket: number, sent: Map<number, Uint8Array>, fin: Record<string, unknown>): Uint8Array<ArrayBuffer>[] {
  const segs = Array.from({ length: Math.ceil(bucket / 64) }, (_, n) => {
    const out = new Uint8Array(segmentSize(bucket, n));
    const got = sent.get(n);
    if (got) out.set(got.subarray(0, out.length));
    return out;
  });
  segs[0]!.set(unb64u(fin.header as string), 0);
  const L = Math.floor((bucket - 1) / 64);
  segs[L]!.set(unb64u(fin.tail as string), (L === 0 ? 48 : 0) + ((bucket - 1) % 64) * 65552);
  return segs;
}

describe("openShare en flux : segments à la demande, saveItem, collectToBlob", () => {
  const a = pseudo(3 * 1048576 + 7, 1);
  const b = pseudo(2.5 * 1048576, 2);
  let pk: Pack;
  beforeAll(async () => {
    pk = await pack([
      { kind: "text", name: "", mime: "text/plain", data: utf8("salut") },
      { kind: "file", name: "a.png", mime: "image/png", data: new Blob([a]) },
      { kind: "file", name: "b.bin", mime: "application/octet-stream", data: new Blob([b]) },
    ]);
  }, 60_000);
  const route = (bad?: (n: number, seg: Uint8Array<ArrayBuffer>) => Uint8Array<ArrayBuffer>): Route => packRoute(pk, bad);

  it("ouverture : unlock → enveloppe → segment 0 (en-tête) et dernier segment (manifeste) ; saveItem et collectToBlob en flux", async () => {
    expect(pk.bucket).toBe(160);
    const s = server(route());
    const prog: [number, number][] = [];
    const o = await openShare(LINK, PW, ORIGIN, (d, t) => prog.push([d, t]), s.net);
    expect(s.calls).toEqual([
      "GET /api/shares/meta",
      "POST /api/shares/unlock",
      "GET /api/shares/segments/0",
      "GET /api/shares/segments/2",
    ]);
    expect(o.manifest.items.map((e) => e.name)).toEqual(["", "a.png", "b.bin"]);
    const parts: Uint8Array[] = [];
    await o.saveItem(2, async (c) => {
      expect(c.length).toBeLessThanOrEqual(CHUNK);
      parts.push(new Uint8Array(c));
    });
    expect(same(concat(...parts.map((p) => new Uint8Array(p))), b)).toBe(true);
    expect(s.calls.at(-1)).toBe("GET /api/shares/segments/1");
    const blob = await collectToBlob(o, 1);
    expect(blob.type).toBe("application/octet-stream");
    expect(same(new Uint8Array(await blob.arrayBuffer()), a)).toBe(true);
    expect(await o.item(0)).toEqual(utf8("salut"));
    expect(o.manifest.rights).toBe("enregistrer");
    expect(prog).toEqual([[1, 3], [3, 3], [1, 3], [2, 3], [1, 3]]); // segment n lu → (n + 1, total)
    o.wipe();
    await o.done();
    expect(s.calls.at(-1)).toBe("POST /api/shares/done");
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
      if (path === "/api/shares") return j(201, { upload_token: "u", segments: 3 });
      if (init?.method === "PUT") {
        puts.push([path.replace(/\/api\/shares\/[A-Za-z0-9_-]{22}\//, "/api/shares/"), (init.body as Uint8Array).length]);
        return new Response(null, { status: 204 });
      }
      if (path.endsWith("/finalize")) return j(200, { expires_in_s: 3600 });
      return j(404, { error: "not_found" });
    }) as typeof fetch;
    const prog: [number, number][] = [];
    const items = [{ kind: "file" as const, name: "x", mime: "x/y", data: new Blob([pseudo(9 * 1048576, 3)]) }];
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
    expect(puts).toEqual([
      ["/api/shares/segments/0", segmentSize(400, 0)],
      ["/api/shares/segments/1", segmentSize(400, 1)],
      ["/api/shares/segments/2?from=0", 16 * 65552], // fin du fichier seulement (audit H-2)
    ]);
    expect(prog).toEqual([[0, 3], [1, 3], [2, 3], [3, 3]]);
  }, 20_000);
});

describe("origine attendue (audit F1)", () => {
  const k = LINK.slice(LINK.indexOf("#"));
  const evil = `https://evil.example:8443/${k}`;
  const creds = `https://user:pw@srv.test/${k}`;
  it("lien d'une autre origine ou avec identifiants : lien_invalide, aucune requête", async () => {
    for (const link of [evil, creds, `http://srv.test/${k}`, `${ORIGIN}/s${k}`]) {
      const s = server(() => undefined);
      await expect(fetchMeta(link, ORIGIN, s.net), link).rejects.toThrow("lien_invalide");
      await expect(openShare(link, PW, ORIGIN, undefined, s.net), link).rejects.toThrow("lien_invalide");
      await expect(destroyShare(link, ORIGIN, { password: PW, ...s.net }), link).rejects.toThrow("lien_invalide");
      expect(s.calls).toEqual([]);
    }
    const m = server(() => undefined);
    const evilManage = `https://evil.example/${MANAGE.slice(MANAGE.indexOf("#"))}`;
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
    const pk = await pack([
      { kind: "text", name: "", mime: "text/plain", data: utf8("<b>salut</b>") },
      { kind: "file", name: "../../facture\u202Efdp.exe\u0000", mime: "text/html", data: utf8("<script>alert(1)</script>") },
      { kind: "file", name: "photo.png", mime: "image/png", data: new Uint8Array(10) },
    ]);
    const s = server(packRoute(pk));
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
    const pk = await pack([{ kind: "text", name: "", mime: "text/plain", data: utf8("x") }]);
    const seg = pk.segs[0]!;
    const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const p = String(input).slice(ORIGIN.length);
      if (p.endsWith("/meta")) return unlocked ? j(404, { error: "not_found" }) : j(200, { ...META, bucket: pk.bucket });
      if (p.endsWith("/unlock")) {
        unlocked = true; // maxOpens=1 : le partage passe en « draining »
        return j(200, { download_token: "t", segments: 1, envelope: pk.envelope, grant: GRANT0, opens_left: 0 });
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
  const finals: Record<string, unknown>[] = [];
  const creates: { access: string | null; manage: string | null }[] = [];
  const destroys: { manage: string | null; body: unknown; keepalive: boolean | undefined }[] = [];
  const attempts = new Map<number, number>();
  let finalizeN = 0;
  const log = (k: string) => {
    calls.push(k);
    (at[k] ??= []).push(Date.now());
  };
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    // Aucun id dans les chemins (spec §32).
    const path = String(input).slice(ORIGIN.length);
    const method = init?.method ?? "GET";
    log(`${method} ${path}`);
    if (path === "/api/captcha") {
      o.onCaptcha?.();
      const body = o.captcha?.() ?? { algorithm: "SHA-256", challenge: "c", maxNumber: 1, salt: capSalt(), signature: "g", shown_at: "jeton" };
      return new Response(JSON.stringify(body), { status: 200, headers: o.captchaDate ? { Date: o.captchaDate() } : {} });
    }
    if (path === "/api/manage/status") {
      if (new Headers(init?.headers).get("X-Shh-Manage") === null) return j(404, { error: "not_found" });
      const r = o.status?.();
      if (r === "net") throw new TypeError("fetch failed");
      return r ?? j(404, { error: "not_found" });
    }
    if (path === "/api/shares") {
      const b = JSON.parse(String(init?.body)) as Record<string, unknown>;
      bodies.push(b);
      const h = new Headers(init?.headers);
      creates.push({ access: h.get("X-Shh-Access"), manage: h.get("X-Shh-Manage") });
      return j(201, { upload_token: "u", segments: o.segments });
    }
    if (path === "/api/shares/finalize") {
      finals.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      const r = o.finalize?.(++finalizeN);
      if (r === "net") throw new TypeError("fetch failed");
      return r ?? j(200, { expires_in_s: 3600 });
    }
    if (path === "/api/manage/destroy") {
      destroys.push({ manage: new Headers(init?.headers).get("X-Shh-Manage"), body: init?.body, keepalive: init?.keepalive });
      return new Response(null, { status: 204 });
    }
    return j(404, { error: "not_found" });
  }) as typeof fetch;
  const upload = async (url: string, _h: Record<string, string>, body: Uint8Array, onBytes: (b: number) => void, signal?: AbortSignal) => {
    const n = Number(/\/segments\/(\d+)(?:\?from=\d+)?$/.exec(url)![1]);
    log(`PUT ${n}`);
    const a = (attempts.get(n) ?? 0) + 1;
    attempts.set(n, a);
    return o.put ? o.put(n, a, onBytes, body, signal) : ok204(onBytes, body);
  };
  return { fetch: f, upload, calls, at, bodies, finals, creates, destroys, attempts };
}

// Petit fichier : un segment de données (0) ; un texte seul ne fait aucun PUT (spec §41.14).
const SMALL = [{ kind: "file" as const, name: "a", mime: "text/plain", data: new Uint8Array([97]) }];
// 9 Mio : 2 segments pleins puis 16 morceaux du segment 2 (audit H-2 : aucun bourrage envoyé) ;
// le manifeste part avec finalize (tail).
const BIG_DATA = pseudo(9 * 1048576, 7);
const BIG = [{ kind: "file" as const, name: "x", mime: "x/y", data: new Blob([BIG_DATA]) }];
const BIG_SIZES = [segmentSize(400, 0), segmentSize(400, 1), 16 * 65552];

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
    captured.kMdp.length = 0;
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date", "performance"] });
  });
  afterEach(() => vi.useRealTimers());
  // Au moins K_lien, S_gestion, K_accès (et, dès l'envoi, graine et clé brute de l'élément ;
  // au succès, R, K_contenu brute, K_mdp, K_env brute, K_preuve) : toutes les copies JavaScript à
  // zéro. K_maître ne sort plus du moteur (aucune copie JavaScript) : 10 au succès, plus 11.
  const wiped = (min = 3) => {
    const s = captured.buffers.filter((b) => b.length === 32);
    expect(s.length).toBeGreaterThanOrEqual(min);
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
    expect(s.calls.filter((c) => !c.startsWith("GET"))).toEqual(["POST /api/shares", "PUT 0", "PUT 1", "POST /api/manage/destroy"]);
    expect(s.destroys).toHaveLength(1);
    expect(s.destroys[0]!.body).toBeUndefined(); // S_gestion en en-tête seulement
    expect(s.destroys[0]!.manage).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(s.destroys[0]!.manage).toBe(s.creates[0]!.manage);
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
    expect(s.calls).toEqual(["GET /api/captcha", "POST /api/shares", "POST /api/manage/destroy"]);
    wiped();
  });

  it("succès : clés à zéro aussi, aucune destruction", async () => {
    const s = sender({ segments: 1 });
    const r = await drive(createShare(ORIGIN, SMALL, base(s)));
    expect(r.expiresInS).toBe(3600);
    expect(s.destroys).toEqual([]);
    wiped(10);
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
    expect(s.at["POST /api/manage/destroy"]![0]! - ack0).toBeLessThanOrEqual(SERVER_STALL_MS);
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
    expect(s.at["POST /api/manage/destroy"]![0]! - created).toBe(SERVER_STALL_MS);
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
    expect(r.manage).toMatch(/^https:\/\/srv\.test\/#m[A-Za-z0-9_-]{43}$/);
    expect(s.calls.filter((c) => c.startsWith("POST /api/shares/") || c.startsWith("GET /api/manage/"))).toEqual([
      "POST /api/shares/finalize",
      "POST /api/shares/finalize",
      "GET /api/manage/status",
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
    expect(s.calls).toContain("GET /api/manage/status");
    expect(s.destroys).toHaveLength(1);
    expect(s.destroys[0]!.keepalive).toBe(true);
  });
  it("finalize : réponse définitive dès le premier essai (404, 409) → aucun status, aucun nouvel essai, destruction", async () => {
    for (const [code, err] of [[404, "not_found"], [409, "incomplete"]] as const) {
      const s = sender({ segments: 1, finalize: () => j(code, { error: err }), status: () => j(200, READY) });
      await reject(drive(createShare(ORIGIN, SMALL, base(s))));
      expect(s.calls.filter((c) => c.endsWith("/finalize"))).toHaveLength(1);
      expect(s.calls).not.toContain("GET /api/manage/status");
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
  const POW_KEYS = ["altcha", "bucket", "hp", "shown_at"];

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
    expect(s.finals[0]!.salt).toBe(kdfSalt());
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
    expect(s.finals[0]!.salt).toBe(kdfSalt());
    expect(s.finals[0]!.salt).not.toBe(chSalt);
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

// ---------------------------------------------------------------------------------------
// Task K1 : chiffrement v2 (clé de contenu aléatoire enveloppée, paquet SHH2, spec §29).
// ---------------------------------------------------------------------------------------

describe("createShare v2 : création, envoi sans le bourrage, finalisation", () => {
  beforeEach(() => {
    captured.buffers.length = 0;
    captured.kMdp.length = 0;
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date", "performance"] });
  });
  afterEach(() => vi.useRealTimers());

  it("11 Mio (spec §41.14) : création au palier de réservation ; segments 0, 1, 2 ; finalize avec bucket, header et tail, sans fill ; le lien s'ouvre", async () => {
    const data = pseudo(11 * 1048576, 9);
    const s = sender({ segments: 7 });
    const sent = new Map<number, Uint8Array<ArrayBuffer>>();
    const upload: typeof s.upload = async (url, h, body, onBytes, signal) => {
      sent.set(Number(/\/segments\/(\d+)(?:\?from=0)?$/.exec(url)![1]), new Uint8Array(body)); // fin partielle : depuis le morceau 0
      return s.upload(url, h, body, onBytes, signal);
    };
    const prog: [number, number][] = [];
    const r = await drive(
      createShare(ORIGIN, [{ kind: "file", name: "gros.bin", mime: "x/y", data: new Blob([data]) }], {
        ...base(s),
        upload,
        maxOpens: 3,
        ttlHours: 6,
        onProgress: (d, t) => prog.push([d, t]),
      }),
    );
    // Création : palier et preuve dans le corps ; K_accès et S_gestion en en-tête (spec §29.8, §32).
    expect(Object.keys(s.bodies[0]!).sort()).toEqual(["altcha", "bucket", "hp", "shown_at"]);
    expect(s.bodies[0]!.bucket).toBe(400); // 3 segments pleins + morceau du manifeste
    expect(s.creates[0]!.access).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(s.creates[0]!.manage).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(s.calls.filter((c) => c.startsWith("PUT"))).toEqual(["PUT 0", "PUT 1", "PUT 2"]);
    expect(prog).toEqual([[0, 3], [1, 3], [2, 3], [3, 3]]);
    const fin = s.finals[0]!;
    expect(Object.keys(fin).sort()).toEqual(["bucket", "envelope", "header", "kdf_mem", "kdf_ops", "max_opens", "proof_v", "salt", "tail", "ttl_hours"]);
    expect(fin).toMatchObject({ bucket: 400, kdf_ops: 3, kdf_mem: 67108864, ttl_hours: 6, max_opens: 3 });
    expect(fin.envelope).toMatch(/^[A-Za-z0-9_-]{80}$/);
    expect(fin.header).toMatch(/^[A-Za-z0-9_-]{64}$/);
    expect(fin.tail).toMatch(/^[A-Za-z0-9_-]{87403}$/);
    expect(fin.proof_v).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(fin.salt).toMatch(/^[A-Za-z0-9_-]{22}$/);

    vi.useRealTimers();
    expect(r.link).toMatch(/^https:\/\/srv\.test\/#[A-Za-z0-9_-]{43}$/);
    expect(r.manage).toMatch(/^https:\/\/srv\.test\/#m[A-Za-z0-9_-]{43}$/);
    const lk = await parseLink(r.link);
    expect(lk.kind === "s" && b64u((await deriveAccess(lk.kLien)).kAcces)).toBe(s.creates[0]!.access);
    expect(r.manage.slice(r.manage.indexOf("#m") + 2)).toBe(s.creates[0]!.manage);
    const segs = serverFile(400, sent, fin);
    const rd = server(() => undefined);
    const net = {
      retryDelayMs: 1,
      fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = String(input).slice(ORIGIN.length);
        rd.calls.push(`${init?.method ?? "GET"} ${path}`);
        if (path.endsWith("/meta")) return j(200, { expires_in_s: 60, salt: fin.salt, kdf: { ops: 3, mem: 67108864 }, bucket: 400, segments: 7, opens_left: 1 });
        if (path.endsWith("/unlock")) return j(200, { download_token: "t", segments: 7, envelope: fin.envelope, grant: GRANT0, opens_left: 0 });
        const m = /\/segments\/(\d+)$/.exec(path);
        if (m) return new Response(new Uint8Array(segs[Number(m[1])]!), { status: 200 });
        return new Response(null, { status: 204 });
      }) as typeof fetch,
    };
    const o = await openShare(r.link, PW, ORIGIN, undefined, net);
    expect(o.manifest.items[0]!.name).toBe("gros.bin");
    expect(same(await o.item(0), data)).toBe(true);
    expect(rd.calls.filter((c) => /segments\/[345]$/.test(c))).toEqual([]); // bourrage jamais lu
  }, 60_000);

  it("droit par défaut « enregistrer » ; rights et keepTtlH écrits dans le manifeste chiffré ; note seule : un élément (D41-36), relue", async () => {
    const t = [{ kind: "text" as const, name: "", mime: "text/plain", data: utf8("x") }];
    const open1 = async (o: Partial<{ rights: "voir" | "enregistrer" | "coffre"; keepTtlH: 12 }>) => {
      const s = sender({ segments: 1 });
      const sent = new Map<number, Uint8Array<ArrayBuffer>>();
      const upload: typeof s.upload = async (url, h, body, onBytes, signal) => {
        sent.set(Number(/\/segments\/(\d+)/.exec(url)![1]), new Uint8Array(body));
        return s.upload(url, h, body, onBytes, signal);
      };
      const r = await drive(createShare(ORIGIN, t, { ...base(s), upload, ...o }));
      vi.useRealTimers();
      expect(s.calls.filter((c) => c.startsWith("PUT"))).toEqual(["PUT 0"]);
      const fin = s.finals[0]!;
      expect(fin.bucket).toBe(16);
      const segs = serverFile(16, sent, fin);
      const f = (async (input: RequestInfo | URL) => {
        const path = String(input).slice(ORIGIN.length);
        if (path.endsWith("/meta")) return j(200, { expires_in_s: 60, salt: fin.salt, kdf: { ops: 3, mem: 67108864 }, bucket: 16, segments: 1, opens_left: 1 });
        if (path.endsWith("/unlock")) return j(200, { download_token: "t", segments: 1, envelope: fin.envelope, grant: GRANT0, opens_left: 0 });
        if (path.endsWith("/segments/0")) return new Response(new Uint8Array(segs[0]!), { status: 200 });
        return new Response(null, { status: 204 });
      }) as typeof fetch;
      const opened = await openShare(r.link, PW, ORIGIN, undefined, { fetch: f, retryDelayMs: 1 });
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date", "performance"] });
      expect(opened.manifest.items[0]!.text).toBe("x");
      return opened.manifest;
    };
    expect((await open1({})).rights).toBe("enregistrer");
    expect((await open1({ rights: "voir" })).rights).toBe("voir");
    const c = await open1({ rights: "coffre", keepTtlH: 12 });
    expect([c.rights, c.keep_ttl_h]).toEqual(["coffre", 12]);
  }, 60_000);

  it("mot de passe généré de 8 caractères accepté ; saisi de 8 caractères refusé avant toute requête", async () => {
    const { generatePassword } = await import("../engine/pure");
    const s = sender({ segments: 1 });
    await drive(createShare(ORIGIN, SMALL, { ...base(s), password: generatePassword() }));
    expect(s.finals).toHaveLength(1);
    const t = sender({ segments: 1 });
    await expect(drive(createShare(ORIGIN, SMALL, { ...base(t), password: "aB3!aB3!" }))).rejects.toThrow("mot_de_passe_non_genere");
    expect(t.calls).toEqual([]);
  });

  it("nouvel essai d'un segment : mêmes octets renvoyés, aucun morceau rechiffré (nonces uniques)", async () => {
    const spy = vi.spyOn(crypto.subtle, "encrypt");
    try {
      const bodies = new Map<number, string[]>();
      const s = sender({
        segments: 3,
        put: (n, a, onBytes, body) => {
          (bodies.get(n) ?? bodies.set(n, []).get(n)!).push(Buffer.from(body).toString("base64"));
          if (a < 3) throw new TypeError("fetch failed");
          return ok204(onBytes, body);
        },
      });
      await drive(createShare(ORIGIN, BIG, base(s)));
      for (const [, v] of bodies) {
        expect(v).toHaveLength(3);
        expect(new Set(v).size).toBe(1);
      }
      // Morceaux de l'élément : 144 chiffrements (9 Mio, aucun bourrage), 144 nonces distincts sous sa
      // clé ; plus le manifeste (K_contenu) et E (K_env).
      const byKey = new Map<CryptoKey, string[]>();
      for (const c of spy.mock.calls) {
        const iv = Buffer.from((c[0] as AesGcmParams).iv as Uint8Array).toString("hex");
        (byKey.get(c[1]) ?? byKey.set(c[1], []).get(c[1])!).push(iv);
      }
      const sizes = [...byKey.values()].map((v) => v.length).sort((a, b) => a - b);
      expect(sizes).toEqual([1, 1, 144]);
      for (const v of byKey.values()) expect(new Set(v).size).toBe(v.length);
    } finally {
      spy.mockRestore();
    }
  }, 30_000);

  it("création refusée (400) : erreur « bad_request », destruction inutile (rien n'a été créé), clés à zéro", async () => {
    const s = sender({ segments: 1 });
    const f = (async (input: RequestInfo | URL, init?: RequestInit) =>
      String(input).endsWith("/api/shares") ? j(400, { error: "bad_request" }) : s.fetch(input, init)) as typeof fetch;
    await expect(drive(createShare(ORIGIN, SMALL, { ...base(s), fetch: f }))).rejects.toThrow("bad_request");
    expect(s.destroys).toEqual([]);
    allZero();
  });

  // Création refusée : aucune clé de contenu ni Argon2id ; K_lien, S_gestion, K_accès à zéro.
  const allZero = () => {
    const sec = captured.buffers.filter((b) => b.length === 32);
    expect(sec.length).toBeGreaterThanOrEqual(3);
    expect(captured.kMdp).toHaveLength(0);
    for (const b of sec) expect(b.every((x) => x === 0)).toBe(true);
  };
});

describe("openShare v2 : enveloppe, engagement, rejeu", () => {
  const items = [{ kind: "text" as const, name: "", mime: "text/plain", data: utf8("bonjour") }];
  it("unlock → envelope → lecture ; R, K_mdp, K_maître, K_env à zéro dès l'ouverture ; K_accès et K_preuve jusqu'à wipe()", async () => {
    const pk = await pack(items);
    captured.buffers.length = 0;
    captured.kMdp.length = 0;
    const s = server(packRoute(pk));
    const o = await openShare(LINK, PW, ORIGIN, undefined, s.net);
    expect(await o.item(0)).toEqual(utf8("bonjour"));
    expect(s.calls).toEqual(["GET /api/shares/meta", "POST /api/shares/unlock", "GET /api/shares/segments/0"]);
    const sec = captured.buffers.filter((b) => b.length === 32);
    const live = sec.filter((b) => b.some((x) => x !== 0));
    expect(captured.kMdp).toHaveLength(1);
    expect(captured.kMdp[0]!.every((x) => x === 0)).toBe(true);
    expect(live).toHaveLength(2); // K_accès et K_preuve (signalement après la dernière ouverture, S1)
    o.wipe();
    for (const b of sec) expect(b.every((x) => x === 0)).toBe(true);
  });

  const bad = async (route: Route) => {
    const s = server(route);
    expect(await reject(openShare(LINK, PW, ORIGIN, undefined, s.net))).toBeInstanceOf(NotFoundError);
    expect(s.calls.at(-1)).toBe("POST /api/shares/done"); // done() d'office
    return s;
  };

  it("C_engagement faux (enveloppe cohérente avec l'en-tête fabriqué) → paquet_corrompu → NotFoundError", async () => {
    const pk = await pack(items);
    const forged = new Uint8Array(pk.header);
    forged[40]! ^= 1;
    const { kEnv } = await accessKeys(KLIEN(), new Uint8Array(kMdpPW!) as KMdp);
    const envelope = b64u(await seal(kEnv, pk.r, await shareId(KLIEN()), forged));
    const seg0 = new Uint8Array(pk.segs[0]!);
    seg0.set(forged, 0);
    await bad(packRoute({ ...pk, envelope, segs: [seg0] }));
  });

  it("enveloppe échangée (celle d'un autre partage, autre id) ou modifiée → NotFoundError", async () => {
    const pk = await pack(items);
    const other = await pack(items, undefined, new Uint8Array(16).fill(9));
    await bad(packRoute({ ...pk, envelope: other.envelope }));
    // Rejeu : le paquet et l'enveloppe d'un ancien partage servis pour ce lien (autre id).
    await bad(packRoute({ ...other }));
    const e = Buffer.from(pk.envelope, "base64url");
    e[20]! ^= 1;
    await bad(packRoute({ ...pk, envelope: e.toString("base64url") }));
    // Paquet d'un autre partage (même lien) avec l'enveloppe de celui-ci : en-tête différent.
    const third = await pack(items);
    await bad(packRoute({ ...pk, segs: third.segs }));
  });

  it("mauvais mot de passe (serveur qui accepterait quand même) : enveloppe illisible → NotFoundError", async () => {
    const pk = await pack(items);
    const s = server(packRoute(pk));
    expect(await reject(openShare(LINK, "un-autre-mot-de-passe", ORIGIN, undefined, s.net))).toBeInstanceOf(NotFoundError);
  });

  it("paquet tronqué (dernier segment court) ou modifié → NotFoundError", async () => {
    const pk = await pack([{ kind: "file", name: "f", mime: "x/y", data: new Blob([pseudo(5.5 * 1048576, 4)]) }]);
    await bad(packRoute(pk, (n, seg) => (n === 2 ? seg.slice(0, -1) : seg)));
    // Dernier morceau (manifeste) modifié. Un octet du bourrage, lui, n'est jamais lu ni vérifié.
    await bad(packRoute(pk, (n, seg) => (n === 2 ? (seg[seg.length - 100]! ^= 1, seg) : seg)));
  }, 30_000);

  it("ancien format (/s/<id>#clé, spec §32 : aucune compatibilité) : lien_invalide, aucune requête", async () => {
    const s = server(() => undefined);
    const forged = `${ORIGIN}/s/${b64u(new Uint8Array(16).fill(5))}#${b64u(KLIEN())}`;
    await expect(openShare(forged, PW, ORIGIN, undefined, s.net)).rejects.toThrow("lien_invalide");
    await expect(fetchMeta(forged, ORIGIN, s.net)).rejects.toThrow("lien_invalide");
    await expect(destroyShare(forged, ORIGIN, { password: PW, ...s.net })).rejects.toThrow("lien_invalide");
    expect(s.calls).toEqual([]);
  });
});

describe("budget de lecture par ouverture (audit M1, spec §24)", () => {
  // Même formule que share.ReadBudget (Go) : ouverture complète v2 (fichier + segment 0 +
  // dernier segment) plus un nouvel essai de chaque segment (fichier).
  const readBudget = (bucket: number) => {
    const total = 48 + bucket * 65552;
    const last = Math.ceil(bucket / 64) - 1;
    return 2 * total + segmentSize(bucket, 0) + segmentSize(bucket, last);
  };
  it("la formule est celle du serveur (budget.go)", async () => {
    const { readFileSync } = await import("node:fs");
    const go = readFileSync(new URL("../../../server/internal/share/budget.go", import.meta.url), "utf8");
    expect(go).toContain("2*totalSize(bucket) + int64(SegmentSize(bucket, 0)) + int64(SegmentSize(bucket, SegmentCount(bucket)-1))");
  });

  it("ouverture complète (tous les éléments enregistrés) + un nouvel essai de chaque segment : sous le budget", async () => {
    // Deux fichiers qui se partagent un segment, un texte : palier 400, bourrage [3, 6).
    const pk = await pack([
      { kind: "text", name: "", mime: "text/plain", data: utf8("t") },
      { kind: "file", name: "a", mime: "x/y", data: new Blob([pseudo(6 * 1048576, 1)]) },
      { kind: "file", name: "b", mime: "x/y", data: new Blob([pseudo(5 * 1048576, 2)]) },
    ]);
    expect(pk.bucket).toBe(400);
    let served = 0;
    const tried = new Set<number>();
    const s = server((m, p) => {
      const g = /\/segments\/(\d+)$/.exec(p);
      if (g) {
        const n = Number(g[1]);
        served += pk.segs[n]!.length; // le serveur débite le segment entier
        if (!tried.has(n)) {
          tried.add(n);
          return new Response(pk.segs[n]!.slice(0, 10), { status: 200 }); // réponse tronquée → nouvel essai
        }
      }
      return packRoute(pk)(m, p);
    });
    const o = await openShare(LINK, PW, ORIGIN, undefined, s.net);
    for (let i = 0; i < 3; i++) await o.saveItem(i, () => undefined);
    expect([...tried].sort()).toEqual([0, 1, 2, 6]); // le bourrage n'est jamais lu
    expect(served).toBeLessThanOrEqual(readBudget(400));
  }, 30_000);

  it("429 « budget » : définitif, aucun nouvel essai → ReadBudgetError ; 429 / 503 de places : réessayés", async () => {
    const pk = await pack([{ kind: "file", name: "a", mime: "x/y", data: new Blob([pseudo(5.5 * 1048576, 3)]) }]);
    let budgetCalls = 0;
    const s = server((m, p) => {
      if (p.endsWith("/segments/1")) {
        budgetCalls++;
        return j(429, { error: "budget", retry_after_s: 60 });
      }
      return packRoute(pk)(m, p);
    });
    const o = await openShare(LINK, PW, ORIGIN, undefined, s.net);
    expect(await reject(o.item(0))).toBeInstanceOf(ReadBudgetError);
    expect(budgetCalls).toBe(1);
    let busy = 0;
    const t = server((m, p) => {
      if (p.endsWith("/segments/1") && busy++ < 2) return busy === 1 ? j(503, { error: "busy", retry_after_s: 0 }) : j(429, { error: "limit", retry_after_s: 0 });
      return packRoute(pk)(m, p);
    });
    const o2 = await openShare(LINK, PW, ORIGIN, undefined, t.net);
    expect(same(await o2.item(0), pseudo(5.5 * 1048576, 3))).toBe(true);
    expect(busy).toBe(3);
  }, 30_000);
});

describe("base de l'application (scan de sécurité du 7 novembre, F2)", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("démo (/shhdrop/) : les liens rendus par createShare, avec la base, sont acceptés ; la racine aussi", async () => {
    vi.stubEnv("BASE_URL", "/shhdrop/");
    const atBase = MANAGE.replace("/#m", "/shhdrop/#m");
    expect(atBase).not.toBe(MANAGE);
    const s = server(() => j(404, { error: "not_found" }));
    expect(await reject(destroyShare(atBase, ORIGIN, s.net))).toBeInstanceOf(NotFoundError);
    expect(await reject(shareStatus(atBase, ORIGIN, s.net))).toBeInstanceOf(NotFoundError);
    expect(await fetchMeta(LINK.replace("/#", "/shhdrop/#"), ORIGIN, server(() => undefined).net)).toEqual({ expiresInS: 3000, opensLeft: 2 });
    expect(await fetchMeta(LINK, ORIGIN, server(() => undefined).net)).toEqual({ expiresInS: 3000, opensLeft: 2 });
    // Ouvertures restantes absentes ou hors bornes : réponse refusée (ruling 5).
    for (const bad of [{ ...META, opens_left: undefined }, { ...META, opens_left: 0 }, { ...META, opens_left: 1.5 }])
      expect(await reject(fetchMeta(LINK, ORIGIN, server((_m, path) => (path.endsWith("/meta") ? j(200, bad) : undefined)).net))).toBeInstanceOf(NotFoundError);
    // Autre chemin, ancien format : toujours refusés, sans requête.
    const none = server(() => undefined);
    for (const bad of [MANAGE.replace("/#m", "/autre/#m"), `${ORIGIN}/s/${b64u(new Uint8Array(16).fill(5))}#${b64u(KLIEN())}`]) {
      await expect(destroyShare(bad, ORIGIN, none.net), bad).rejects.toThrow("lien_invalide");
    }
    expect(none.calls).toEqual([]);
  });

  it("production (/) : un lien sous /shhdrop/ est refusé", async () => {
    const s = server(() => undefined);
    await expect(destroyShare(MANAGE.replace("/#m", "/shhdrop/#m"), ORIGIN, s.net)).rejects.toThrow("lien_invalide");
    expect(s.calls).toEqual([]);
  });
});
