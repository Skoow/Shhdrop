// Le moteur WebAssembly, avec le fournisseur WebCrypto, redonne TOUS les vecteurs de
// engine/vectors/v2.json (produits par l'ancien moteur TypeScript), comme les tests Rust
// (engine/core/tests/vectors.rs) avec le fournisseur RustCrypto : WebCrypto ≡ RustCrypto
// (spec §9). Plus : règles du fournisseur et des frontières (Task 9).
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { handle, type KdfJob, type KdfReply } from "./argon2.worker";
import { passwordKey, passwordKeyForCreate } from "./argon2";
import { loadEngine, type Engine, type Wasm } from "./load";
import type { FinalEntry } from "./pkg/shhdrop_wasm.js";
import { createProvider, type WebCryptoProvider } from "./provider";

const here = dirname(fileURLToPath(import.meta.url));
const V = JSON.parse(readFileSync(join(here, "../../../engine/vectors/v2.json"), "utf8"));
const WASM = join(here, "pkg/shhdrop_wasm_bg.wasm");

// ------------------------------------------------------------------------------- outils

const unhex = (s: string) => new Uint8Array(Buffer.from(s, "hex"));
const hex = (b: Uint8Array | ArrayBuffer) => Buffer.from(b instanceof ArrayBuffer ? new Uint8Array(b) : b).toString("hex");
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const utf8 = (s: string) => new TextEncoder().encode(s);
const b64u = (b: Uint8Array) => Buffer.from(b).toString("base64url");
const concat = (parts: ArrayBuffer[]) => new Uint8Array(Buffer.concat(parts.map((p) => new Uint8Array(p))));

/** Message d'erreur d'un appel synchrone ou asynchrone, ou `null` s'il réussit. */
async function errorOf(f: () => unknown): Promise<string | null> {
  try {
    await f();
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}

/** Compare au cas : `result` attendu (transformé par `want`), ou `error` (message exact). */
async function check<T>(c: { error?: string; result?: unknown }, f: () => T | Promise<T>, want: (r: unknown) => unknown = (r) => r) {
  if (typeof c.error === "string") {
    expect(await errorOf(f), JSON.stringify(c)).toBe(c.error);
  } else {
    expect(await f(), JSON.stringify(c)).toEqual(want(c.result));
  }
}

/**
 * Fournisseur WebCrypto réel, avec un aléa rejoué (champ `random` des vecteurs, dans l'ordre ;
 * au-delà, l'aléa échoue) et la copie des clés brutes importées (pour vérifier une clé sans
 * qu'elle sorte du moteur : la poignée chiffre comme la clé du vecteur).
 */
function testProvider(draws: (string | Uint8Array)[] = []) {
  const real = createProvider();
  const q = draws.map((d) => (typeof d === "string" ? unhex(d) : d));
  const imports: { h: number; raw: Uint8Array }[] = [];
  const given: Uint8Array[] = [];
  const p: WebCryptoProvider = {
    ...real,
    random(n: number) {
      const d = q.shift();
      if (!d) throw new Error("plus d'aléa dans le vecteur");
      expect(d.length, "taille du tirage").toBe(n);
      const out = new Uint8Array(d);
      given.push(out);
      return out;
    },
    async aesImport(raw: Uint8Array) {
      const copy = new Uint8Array(raw);
      const h = await real.aesImport(raw);
      imports.push({ h, raw: copy });
      return h;
    },
  };
  return { p, real, imports, given, left: () => q.length };
}

/** La poignée `h` tient la clé `raw` : même sonde AES-GCM sous les deux. */
async function sameKey(real: WebCryptoProvider, h: number, raw: string) {
  const k = await crypto.subtle.importKey("raw", unhex(raw), "AES-GCM", false, ["encrypt"]);
  const iv = new Uint8Array(12).fill(7);
  const plain = new Uint8Array(16).map((_, i) => i);
  const ad = utf8("sonde");
  const want = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: ad }, k, plain));
  const got = concat(await real.aesSealBatch(h, ad, iv, plain, 16));
  expect(hex(got)).toBe(hex(want));
}

let E: Engine;
let W: Wasm;

beforeAll(async () => {
  // Le site lit le .wasm par fetch (Task 10 : avec son empreinte) ; ici, depuis le disque.
  vi.stubGlobal("fetch", async () => new Response(readFileSync(WASM)));
  E = await loadEngine();
  W = E.wasm;
  vi.unstubAllGlobals();
});

afterEach(() => vi.restoreAllMocks());

// ------------------------------------------------------------------------------- vecteurs

describe("vecteurs v2.json, moteur WebAssembly et fournisseur WebCrypto", () => {
  it("constants", () => {
    const c = W.constants() as Record<string, unknown>;
    for (const [k, v] of Object.entries(V.constants)) {
      if (k === "ENVELOPE_AD") continue; // étiquette interne du moteur, vérifiée par `envelope`
      if (k === "ELEMENT_AD") expect(hex(c[k] as Uint8Array), k).toBe(v);
      else expect(c[k], k).toEqual(v);
    }
    expect(Object.keys(c).sort()).toEqual(Object.keys(V.constants).filter((k) => k !== "ENVELOPE_AD").sort());
  });

  it("encoding", async () => {
    expect(V.encoding.b64u.length).toBeGreaterThan(0);
    for (const c of V.encoding.b64u) expect(W.b64u(unhex(c.bytes))).toBe(c.b64u);
    expect(V.encoding.unb64u.length).toBeGreaterThan(0);
    for (const c of V.encoding.unb64u) await check(c, () => hex(W.unb64u(c.input)), () => c.bytes);
  });

  it("password.generate : tirages rejoués, tous consommés", () => {
    for (const c of V.password.generate) {
      const t = testProvider(c.random);
      expect(String(W.generatePassword(t.p))).toBe(c.password);
      expect(t.left()).toBe(0);
    }
  });

  it("password.is_generated", () => {
    expect(V.password.is_generated.length).toBeGreaterThan(0);
    for (const c of V.password.is_generated) expect(W.isGeneratedPassword(utf8(c.password)), c.password).toBe(c.ok);
  });

  it("link : chaque fonction, chaque cas (écart IDN documenté)", async () => {
    const IDN = "https://été.example/#MDEyMzQ1Njc4OTo7PD0-P0BBQkNERUZHSElKS0xNTk8";
    const seen = new Map<string, number>();
    let idn = 0;
    for (const c of V.link) {
      const a = c.args as string[];
      seen.set(c.fn, (seen.get(c.fn) ?? 0) + 1);
      switch (c.fn) {
        case "shareLink":
          await check(c, () => String(W.shareLink(a[0]!, unhex(a[1]!), a[2]!)));
          break;
        case "manageLink":
          await check(c, () => String(W.manageLink(a[0]!, unhex(a[1]!), a[2]!)));
          break;
        case "checkOrigin":
          await check(c, () => W.checkOrigin(a[0]!));
          break;
        case "parseLink":
          if (a[0] === IDN) {
            // engine/vectors/README.md : Rust refuse un hôte non ASCII (JS : Punycode).
            expect(c.result.origin).toBe("https://xn--t-9fab.example");
            expect(await errorOf(() => W.parseLink(utf8(a[0]!), a[1]!))).toBe("lien_invalide");
            idn++;
            break;
          }
          await check(
            c,
            () => {
              const r = W.parseLink(utf8(a[0]!), a[1]!);
              return { kind: r.kind, origin: r.origin, key: hex(r.kind === "s" ? r.kLien : r.sGestion) };
            },
            (r) => r,
          );
          break;
        case "shareLinkWithPassword":
          if (c.error === "Invalid URL") expect(await errorOf(() => W.shareLinkWithPassword(utf8(a[0]!), utf8(a[1]!)))).toBe("lien_invalide");
          else await check(c, () => String(W.shareLinkWithPassword(utf8(a[0]!), utf8(a[1]!))));
          break;
        case "splitPassword": {
          const r = W.splitPassword(utf8(a[0]!));
          expect({ href: String(r.href), password: r.password === null ? null : String(r.password) }).toEqual(c.result);
          break;
        }
        default:
          throw new Error(`fonction inconnue : ${c.fn}`);
      }
    }
    expect(idn).toBe(1);
    for (const f of ["shareLink", "manageLink", "checkOrigin", "parseLink", "shareLinkWithPassword", "splitPassword"]) expect(seen.get(f) ?? 0, f).toBeGreaterThan(0);
  });

  it("hkdf", () => {
    expect(V.hkdf.length).toBe(10);
    for (const c of V.hkdf) expect(hex(W.hkdf(unhex(c.ikm), c.info, c.len)), c.name).toBe(c.okm);
  });

  it("sha256", () => {
    expect(V.sha256.length).toBeGreaterThan(0);
    for (const c of V.sha256) expect(hex(W.sha256(unhex(c.input)))).toBe(c.digest);
  });

  it("argon2id : passwordKey, passwordKeyForCreate, NFC et refus (dont ops 2,5, non tronqué)", async () => {
    let computed = 0;
    for (const c of V.argon2id) {
      expect(hex(utf8(c.password))).toBe(c.password_utf8);
      const salt = unhex(c.salt);
      const run = () => hex(c.fn === "passwordKey" ? W.passwordKey(utf8(c.password), salt, c.ops, c.mem) : W.passwordKeyForCreate(utf8(c.password), salt));
      if (c.fn === "passwordKeyForCreate") expect({ ops: c.ops, mem: c.mem }).toEqual(V.constants.KDF_CREATE);
      await check(c, run, () => c.key);
      if (c.error === undefined) computed++;
    }
    expect(computed).toBe(3);
    expect(V.argon2id.some((c: { ops: number }) => c.ops === 2.5)).toBe(true);
  });

  it("access : K_accès, V_accès, id, K_env (poignée), K_preuve, V_preuve ; refus de taille", async () => {
    let ok = 0, refused = 0;
    for (const c of V.access) {
      if (typeof c.error === "string") {
        const t = testProvider();
        const f = { deriveAccess: () => W.deriveAccess(unhex(c.k_lien)), shareId: () => W.shareId(unhex(c.k_lien)), accessKeys: () => W.accessKeys(t.p, unhex(c.k_lien), unhex(c.k_mdp)) }[c.fn as string];
        expect(await errorOf(f!), c.name).toBe(c.error);
        refused++;
        continue;
      }
      const a = W.deriveAccess(unhex(c.k_lien));
      expect(hex(a.kAcces)).toBe(c.k_acces);
      expect(hex(a.vAcces)).toBe(c.v_acces);
      expect(hex(W.shareId(unhex(c.k_lien)))).toBe(c.id);
      const ikm = new Uint8Array([...unhex(c.k_lien), ...unhex(c.k_mdp)]);
      expect(hex(W.hkdf(ikm, "shhdrop/v2/maitre", 32))).toBe(c.k_maitre);
      expect(hex(W.hkdf(unhex(c.k_maitre), "shhdrop/v2/enveloppe", 32))).toBe(c.k_env);
      const t = testProvider();
      const ak = await W.accessKeys(t.p, unhex(c.k_lien), unhex(c.k_mdp));
      expect(t.imports.map((i) => hex(i.raw))).toEqual([c.k_env]);
      await sameKey(t.real, t.imports[0]!.h, c.k_env);
      expect(hex(ak.kPreuve)).toBe(c.k_preuve);
      expect(hex(ak.vPreuve)).toBe(c.v_preuve);
      ok++;
    }
    expect([ok, refused]).toEqual([2, 4]);
  });

  /** R du vecteur, déballée par l'enveloppe (comme à l'ouverture) : seule source de contentKeysChecked. */
  async function openedSeed(r: Uint8Array) {
    const t = testProvider([r, new Uint8Array(12)]);
    const seed = W.newSeed(t.p);
    const ak = await W.accessKeys(t.p, new Uint8Array(32).fill(1), new Uint8Array(32).fill(2));
    const id = new Uint8Array(16), hdr = new Uint8Array(48);
    const e = await W.seal(ak, seed, id, hdr);
    return { seed: await W.open(ak, e, id, hdr), t };
  }

  it("content : K_contenu (poignée), engagement, sonde ; contentKeysChecked ; refus", async () => {
    let ok = 0, refused = 0, notApplicable = 0;
    for (const c of V.content) {
      if (typeof c.error === "string") {
        if (c.r.length !== 64) {
          // Sans objet : R n'entre jamais depuis JavaScript (newSeed la tire, open la déballe).
          expect(c.error).toBe("graine invalide");
          notApplicable++;
          continue;
        }
        expect(c.fn).toBe("contentKeysChecked");
        const { seed } = await openedSeed(unhex(c.r));
        expect(await errorOf(() => W.contentKeysChecked(seed, unhex(c.engagement))), c.name).toBe(c.error);
        refused++;
        continue;
      }
      const fresh = testProvider([c.r]);
      const k1 = await W.contentKeys(W.newSeed(fresh.p));
      const { seed, t } = await openedSeed(unhex(c.r));
      const before = t.imports.length;
      const k2 = await W.contentKeysChecked(seed, unhex(c.engagement));
      for (const [ck, prov, h] of [
        [k1, fresh.real, fresh.imports[0]!],
        [k2, t.real, t.imports[before]!],
      ] as const) {
        expect(hex(ck.engagement)).toBe(c.engagement);
        expect(hex(h.raw)).toBe(c.k_contenu);
        await sameKey(prov, h.h, c.k_contenu);
        const probe = concat(await prov.aesSealBatch(h.h, W.header(ck.engagement), W.nonce(0, false), unhex(c.probe_plain), 16));
        expect(hex(probe)).toBe(c.probe);
      }
      expect(hex(W.hkdf(unhex(c.r), "shhdrop/v2/contenu", 32))).toBe(c.k_contenu);
      ok++;
    }
    expect([ok, refused, notApplicable]).toEqual([2, 2, 2]);
  });

  it("envelope : seal (nonce rejoué, tout consommé) et open (succès, altérations → paquet_corrompu)", async () => {
    let sealed = 0, opened = 0, refused = 0;
    for (const c of V.envelope) {
      if (c.fn === "seal") {
        const t = testProvider(c.random);
        const ak = await W.accessKeys(t.p, unhex(c.k_lien), unhex(c.k_mdp));
        const s = testProvider([c.r]);
        const seed = W.newSeed(s.p);
        const eng = (await W.contentKeys(seed)).engagement;
        expect(hex(W.header(eng))).toBe(c.header);
        expect(hex(W.shareId(unhex(c.k_lien)))).toBe(c.id);
        expect(hex(await W.seal(ak, seed, unhex(c.id), unhex(c.header)))).toBe(c.e);
        expect(t.left()).toBe(0);
        sealed++;
      } else {
        const t = testProvider();
        const ak = await W.accessKeys(t.p, unhex(c.k_lien), unhex(c.k_mdp));
        if (typeof c.error === "string") {
          expect(c.error).toBe("paquet_corrompu");
          expect(await errorOf(() => W.open(ak, unhex(c.e), unhex(c.id), unhex(c.header))), c.name).toBe(c.error);
          refused++;
        } else {
          // R déballée : opaque ; on la vérifie par ses clés (K_contenu = HKDF(R)).
          const seed = await W.open(ak, unhex(c.e), unhex(c.id), unhex(c.header));
          const eng = W.hkdf(unhex(c.r), "shhdrop/v2/contenu", 32);
          await W.contentKeysChecked(seed, (await W.contentKeys(W.newSeed(testProvider([c.r]).p))).engagement);
          expect(hex(t.imports.at(-1)!.raw)).toBe(hex(eng));
          opened++;
        }
      }
    }
    expect([sealed, opened, refused]).toEqual([1, 1, 10]);
  });

  it("header : header(engagement) et readHeader(seg0)", async () => {
    let built = 0, read = 0, refused = 0;
    for (const c of V.header) {
      if (c.fn === "header") {
        await check(c, () => hex(W.header(unhex(c.engagement))), () => c.header);
        built++;
      } else {
        await check(c, () => {
          const r = W.readHeader(unhex(c.seg0));
          return [hex(r.header), hex(r.engagement)];
        }, () => [c.header, c.engagement]);
        if (c.error === undefined) read++;
        else refused++;
      }
    }
    // Les deux engagements de 31 et 33 octets (sans objet en Rust) sont rejoués ici.
    expect([built, read, refused]).toEqual([5, 2, 7]);
  });

  it("nonce", () => {
    expect(V.nonce.length).toBe(28);
    for (const c of V.nonce) expect(hex(W.nonce(c.index, c.last))).toBe(c.nonce);
  });

  it("sizing : toutes les fonctions, entrées -1 et 0,5 comprises (refusées comme en JavaScript)", async () => {
    const s = V.sizing;
    for (const c of s.bucketFor) await check(c, () => W.bucketFor(c.input));
    expect(s.segmentCount.length).toBe(11);
    for (const c of s.segmentCount) expect(W.segmentCount(c.input)).toBe(c.result);
    expect(s.segmentSize.length).toBeGreaterThanOrEqual(30);
    for (const c of s.segmentSize) expect(W.segmentSize(c.bucket, c.n)).toBe(c.result);
    for (const c of s.segmentsFor) await check(c, () => W.segmentsFor(c.input));
    for (const c of s.chunksFor) await check(c, () => W.chunksFor(c.input));
    for (const c of s.footprintFor) await check(c, () => W.footprintFor(c.input));
    for (const c of s.isSmall) expect(W.isSmall(c.input), String(c.input)).toBe(c.result);
    expect(s.reservationFor.length).toBe(516);
    for (const c of s.reservationFor) await check(c, () => W.reservationFor(c.input));
    for (const c of s.segmentsNeeded) await check(c, () => W.segmentsNeeded(new Float64Array(c.input)));
  });

  it("element : graine tirée, plages, refus sans tirage (first -1 et 1,5 compris)", async () => {
    let ok = 0, refused = 0;
    for (const c of V.element) {
      const t = testProvider(c.random);
      if (typeof c.error === "string") {
        expect(await errorOf(() => W.elementSealer(t.p, c.size, c.first)), c.label).toBe(c.error);
        expect(t.imports.length).toBe(0);
        refused++;
      } else {
        const el = await W.elementSealer(t.p, c.size, c.first);
        expect(hex(el.k())).toBe(c.k);
        expect(el.pieces()).toEqual(c.pieces);
        expect(t.imports.map((i) => hex(i.raw))).toEqual([hex(W.hkdf(unhex(c.k), "shhdrop/v2/element", 32))]);
        ok++;
      }
      expect(t.left()).toBe(0);
    }
    expect(ok + refused).toBe(V.element.length);
    expect(refused).toBe(V.element.filter((c: { error?: string }) => c.error).length);
    expect(ok).toBeGreaterThanOrEqual(10);
  });

  /** Entrées de sealFinal d'un cas. */
  const finalEntries = (entries: { kind: string; name: string; mime: string; size: number; first: number; k: string; clean?: string }[]) =>
    entries.map((e) => ({ ...e, k: unhex(e.k) })) as FinalEntry[];

  /** Clair du morceau du manifeste, déchiffré avec la K_contenu copiée à l'import. */
  async function manifestOf(raw: Uint8Array, bucket: number, header: Uint8Array, tail: Uint8Array) {
    type B = Uint8Array<ArrayBuffer>;
    const k = await crypto.subtle.importKey("raw", raw as B, "AES-GCM", false, ["decrypt"]);
    const pt = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: W.nonce(bucket - 1, true) as B, additionalData: header as B }, k, tail as B));
    const len = new DataView(pt.buffer).getUint32(pt.length - 4);
    return new TextDecoder().decode(pt.subarray(pt.length - 4 - len, pt.length - 4));
  }

  it("manifest (sealFinal) : palier, en-tête, morceau chiffré, JSON exact ; refus", async () => {
    let refused = 0;
    expect(V.manifest.length).toBe(16);
    for (const c of V.manifest) {
      const t = testProvider([c.r]);
      const keys = await W.contentKeys(W.newSeed(t.p));
      const run = () => W.sealFinal(finalEntries(c.entries), keys, c.rights, c.keep_ttl_h);
      if (typeof c.error === "string") {
        expect(await errorOf(run), c.name).toBe(c.error);
        refused++;
        continue;
      }
      const fin = await run();
      expect(fin.bucket, c.name).toBe(c.bucket);
      expect(hex(fin.header)).toBe(c.header);
      expect(sha(fin.tail)).toBe(c.tail_sha256);
      // Le moteur écrit le JSON de l'ancien moteur octet pour octet.
      expect(await manifestOf(t.imports[0]!.raw, fin.bucket, fin.header, fin.tail), c.name).toBe(c.manifest_json);
    }
    expect(refused).toBe(7);
  });

  /** Clair d'un élément de `share` (texte, ou xorshift32 : README, « Gros clairs »). */
  function sharePlain(item: { plain: { utf8?: string; xorshift32?: { seed: number; len: number } } }): Uint8Array {
    if (item.plain.utf8 !== undefined) return utf8(item.plain.utf8);
    const { seed, len } = item.plain.xorshift32!;
    const out = new Uint8Array(Math.ceil(len / 4) * 4);
    const dv = new DataView(out.buffer);
    let s = seed >>> 0;
    for (let i = 0; i < out.length; i += 4) {
      s ^= s << 13;
      s >>>= 0;
      s ^= s >>> 17;
      s ^= s << 5;
      s >>>= 0;
      dv.setUint32(i, s, true);
    }
    return out.subarray(0, len);
  }

  it("share : pièces, enveloppe, en-tête, manifeste et segments assemblés de l'ancien moteur ; puis ouverture complète", async () => {
    const sh = V.share;
    const C = V.constants;
    const draw = (step: string) => sh.random.find((r: { step: string }) => r.step === step).bytes[0] as string;
    const segs: Uint8Array[] = sh.segments.map((s: { size: number }) => new Uint8Array(s.size));
    expect(segs.length).toBe(W.segmentCount(sh.bucket));
    const plains: Uint8Array[] = [];
    for (const item of sh.items) {
      const plain = sharePlain(item);
      plains.push(plain);
      expect(sha(plain)).toBe(item.plain_sha256);
      const el = await W.elementSealer(testProvider([item.k]).p, item.size, item.first);
      const pieces = el.pieces();
      expect(pieces.length).toBe(item.pieces.length);
      for (const [j, w] of item.pieces.entries()) {
        expect(pieces[j]).toEqual({ seg: w.seg, from: w.from, chunks: w.chunks });
        const [lo, hi] = el.range(j);
        const got = await el.piece(j, plain.subarray(lo, hi));
        expect(got.length).toBe(w.len);
        expect(sha(got), `${item.name} pièce ${j}`).toBe(w.sha256);
        if (w.b64u) expect(b64u(got)).toBe(w.b64u);
        else {
          expect(hex(got.subarray(0, 64))).toBe(w.first64);
          expect(hex(got.subarray(got.length - 64))).toBe(w.last64);
        }
        const at = w.seg === 0 ? (w.from === 0 ? 0 : C.HEADER + w.from * C.CHUNK_CT) : w.from * C.CHUNK_CT;
        segs[w.seg]!.set(got, at);
      }
      el.free();
    }
    // Finalisation : R du vecteur, en-tête et morceau du manifeste octet pour octet.
    const seed = W.newSeed(testProvider([sh.r]).p);
    const keys = await W.contentKeys(seed);
    expect(hex(keys.engagement)).toBe(sh.engagement);
    const fin = await W.sealFinal(finalEntries(sh.items), keys, sh.rights, undefined);
    expect(fin.bucket).toBe(sh.bucket);
    expect(hex(fin.header)).toBe(sh.header);
    expect(b64u(fin.tail)).toBe(sh.tail);
    segs[0]!.set(fin.header, 0);
    segs.at(-1)!.set(fin.tail, segs.at(-1)!.length - C.CHUNK_CT);
    for (const [n, w] of sh.segments.entries()) expect(sha(segs[n]!), `segment ${n}`).toBe(w.sha256_zero_filled);
    // Lien, lien de gestion, lien du QR, mot de passe, enveloppe (nonce du vecteur).
    const kLien = unhex(sh.k_lien);
    expect(String(W.shareLink(sh.origin, kLien, "/"))).toBe(sh.link);
    expect(String(W.manageLink(sh.origin, unhex(sh.s_gestion), "/"))).toBe(sh.manage_link);
    expect(String(W.shareLinkWithPassword(utf8(sh.link), utf8(sh.password)))).toBe(sh.link_with_password);
    expect(String(W.generatePassword(testProvider([draw("password")]).p))).toBe(sh.password);
    expect(hex(W.passwordKeyForCreate(utf8(sh.password), unhex(sh.salt)))).toBe(sh.k_mdp);
    const akCreate = await W.accessKeys(testProvider([draw("envelope_nonce")]).p, kLien, unhex(sh.k_mdp));
    expect(hex(await W.seal(akCreate, seed, W.shareId(kLien), fin.header))).toBe(sh.envelope);
    expect(hex(akCreate.vPreuve)).toBe(sh.v_preuve);
    expect(hex(akCreate.kPreuve)).toBe(sh.k_preuve);
    const da = W.deriveAccess(kLien);
    expect([hex(da.kAcces), hex(da.vAcces), hex(W.shareId(kLien))]).toEqual([sh.k_acces, sh.v_acces, sh.id]);

    // Ouverture (Review Focus 2) : lien → Argon2id → enveloppe → engagement → manifeste.
    const parsed = W.parseLink(utf8(sh.link), "/");
    expect(parsed.kind).toBe("s");
    if (parsed.kind !== "s") return;
    expect(parsed.origin).toBe(sh.origin);
    const kMdp = W.passwordKey(utf8(sh.password), unhex(sh.salt), sh.kdf_ops, sh.kdf_mem);
    const t = testProvider();
    const ak = await W.accessKeys(t.p, parsed.kLien, kMdp);
    expect(hex(ak.vPreuve)).toBe(sh.v_preuve);
    const { header, engagement } = W.readHeader(segs[0]!);
    const r = await W.open(ak, unhex(sh.envelope), W.shareId(parsed.kLien), header);
    const ck = await W.contentKeysChecked(r, engagement);
    const fetched: number[] = [];
    const rd = await W.openReader(ck, async (n: number) => (fetched.push(n), segs[n] ?? new Uint8Array()), sh.bucket);
    expect(fetched).toEqual([0, 6, 0]);
    expect(rd.manifest()).toEqual(sh.opened.manifest);
    for (const [i, w] of sh.opened.items.entries()) {
      const got = await rd.item(i);
      expect(got.length).toBe(w.len);
      expect(sha(got)).toBe(w.sha256);
      expect(hex(got) === hex(plains[i]!), `élément ${i}`).toBe(true);
      const parts: Uint8Array[] = [];
      await rd.streamItem(i, (c: Uint8Array) => void parts.push(c));
      expect(parts.every((p) => p.length <= C.CHUNK)).toBe(true);
      expect(sha(new Uint8Array(Buffer.concat(parts))), `flux ${i}`).toBe(w.sha256);
    }
    const held = t.real.held();
    expect(held).toBeGreaterThan(0);
    rd.free();
    ck.free();
    ak.free();
    expect(t.real.held(), "toutes les clés oubliées").toBe(0);
  });
});

// ------------------------------------------------------------------------------- frontières

describe("fournisseur WebCrypto et frontières du moteur", () => {
  it("loadEngine : une seule fois", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    expect(await loadEngine()).toBe(E);
    expect(f).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("clés importées non extractibles, AES-GCM, chiffrer et déchiffrer seulement", async () => {
    const spy = vi.spyOn(crypto.subtle, "importKey");
    await W.accessKeys(createProvider(), new Uint8Array(32), new Uint8Array(32));
    expect(spy).toHaveBeenCalledTimes(1);
    const [format, , alg, extractable, usages] = spy.mock.calls[0]!;
    expect([format, alg, extractable, usages]).toEqual(["raw", { name: "AES-GCM" }, false, ["encrypt", "decrypt"]]);
  });

  it("aucune clé dans la table avant le retour de aesImport ; poignées jamais réutilisées", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const real = crypto.subtle.importKey.bind(crypto.subtle);
    vi.spyOn(crypto.subtle, "importKey").mockImplementation(async (...a: Parameters<typeof real>) => {
      await gate;
      return real(...a);
    });
    const p = createProvider();
    const pending = W.accessKeys(p, new Uint8Array(32), new Uint8Array(32));
    await new Promise((r) => setTimeout(r, 10));
    expect(p.held()).toBe(0);
    release();
    const ak = await pending;
    expect(p.held()).toBe(1);
    ak.free();
    expect(p.held()).toBe(0);
    const h1 = await p.aesImport(new Uint8Array(32));
    p.aesDrop(h1);
    const h2 = await p.aesImport(new Uint8Array(32));
    expect(h2).not.toBe(h1);
    p.aesDrop(h2);
  });

  it("aléa : une exception ou une taille fausse → aleatoire_indisponible, jamais un tampon nul", async () => {
    const boom = { ...createProvider(), random: () => { throw new Error("QuotaExceededError"); } };
    expect(await errorOf(() => W.generatePassword(boom))).toBe("aleatoire_indisponible");
    expect(await errorOf(() => W.newSeed(boom))).toBe("aleatoire_indisponible");
    expect(await errorOf(() => W.elementSealer(boom, 10, 0))).toBe("aleatoire_indisponible");
    const short = { ...createProvider(), random: (n: number) => new Uint8Array(n - 1) };
    expect(await errorOf(() => W.newSeed(short))).toBe("aleatoire_indisponible");
    const notBytes = { ...createProvider(), random: () => [1, 2, 3] as unknown as Uint8Array };
    expect(await errorOf(() => W.newSeed(notBytes))).toBe("aleatoire_indisponible");
    // Le fournisseur par défaut : crypto.getRandomValues.
    const spy = vi.spyOn(crypto, "getRandomValues");
    W.newSeed(createProvider());
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("secrets mis à zéro aux frontières : clé brute après import, aléa après copie, clair des lots", async () => {
    const t = testProvider([new Uint8Array(32).fill(9), new Uint8Array(12)]);
    const raws: Uint8Array[] = [];
    const plains: Uint8Array[] = [];
    const opened: ArrayBuffer[] = [];
    const p: WebCryptoProvider = {
      ...t.p,
      async aesImport(raw) {
        raws.push(raw);
        return t.p.aesImport(raw);
      },
      async aesSealBatch(h, ad, n, plain, chunk) {
        plains.push(plain);
        return t.real.aesSealBatch(h, ad, n, plain, chunk);
      },
      async aesOpenBatch(h, ad, n, ct, chunkCt) {
        const r = await t.real.aesOpenBatch(h, ad, n, ct, chunkCt);
        opened.push(...r);
        return r;
      },
    };
    const el = await W.elementSealer(p, 10, 0);
    expect(t.given[0]!.every((b) => b === 0), "tirage effacé").toBe(true);
    expect(raws.length).toBe(1);
    expect(raws[0]!.every((b) => b === 0), "clé brute effacée").toBe(true);
    await el.piece(0, utf8("0123456789"));
    expect(plains[0]!.length).toBe(65536);
    expect(plains[0]!.every((b) => b === 0), "clair du lot effacé").toBe(true);
    // Ouverture : le clair rendu par le fournisseur est effacé après sa copie.
    const ak = await W.accessKeys(p, new Uint8Array(32), new Uint8Array(32));
    const s = testProvider([new Uint8Array(32).fill(5)]);
    const e = await W.seal(ak, W.newSeed(s.p), new Uint8Array(16), new Uint8Array(48));
    await W.open(ak, e, new Uint8Array(16), new Uint8Array(48));
    expect(opened.length).toBe(1);
    expect(new Uint8Array(opened[0]!).every((b) => b === 0), "R rendue par WebCrypto effacée").toBe(true);
  });

  it("lot refusé (un tag faux) : rien rendu, clairs partiels effacés, paquet_corrompu", async () => {
    const p = createProvider();
    const h = await p.aesImport(new Uint8Array(32).fill(3));
    const n = new Uint8Array(24);
    n[11] = 0;
    n[23] = 1;
    const ct = concat(await p.aesSealBatch(h, new Uint8Array(), n, new Uint8Array(32), 16));
    const kept: ArrayBuffer[] = [];
    const real = crypto.subtle.decrypt.bind(crypto.subtle);
    vi.spyOn(crypto.subtle, "decrypt").mockImplementation(async (...a: Parameters<typeof real>) => {
      const r = await real(...a);
      kept.push(r);
      return r;
    });
    ct[40] ^= 1; // second morceau abîmé
    expect(await errorOf(() => p.aesOpenBatch(h, new Uint8Array(), n, ct, 32))).toBe("paquet_corrompu");
    expect(kept.length).toBe(1);
    expect(new Uint8Array(kept[0]!).every((b) => b === 0)).toBe(true);
    p.aesDrop(h);
    expect(await errorOf(() => p.aesSealBatch(h, new Uint8Array(), n, new Uint8Array(32), 16))).toBe("cle_inconnue");
  });

  it("ContentKeys : une seule par graine neuve ; clés d'ouverture jamais pour un manifeste", async () => {
    const seed = W.newSeed(testProvider([new Uint8Array(32).fill(4)]).p);
    const keys = await W.contentKeys(seed);
    expect(await errorOf(() => W.contentKeys(seed)), "jamais recréée depuis la même R").toBe("cle_deja_utilisee");
    expect(await errorOf(() => W.contentKeysChecked(seed, keys.engagement)), "R neuve : pas de clés d'ouverture").toBe("cle_deja_utilisee");
    const entry: FinalEntry[] = [{ kind: "text", name: "n", mime: "text/plain", size: 1, first: 0, k: new Uint8Array(32) }];
    await W.sealFinal(entry, keys, undefined, undefined);
    expect(await errorOf(() => W.sealFinal(entry, keys, undefined, undefined)), "un seul manifeste").toBe("cle_deja_utilisee");
    // R déballée : seulement contentKeysChecked, et ces clés ne chiffrent pas de manifeste.
    const t = testProvider([new Uint8Array(32).fill(4), new Uint8Array(12)]);
    const ak = await W.accessKeys(t.p, new Uint8Array(32), new Uint8Array(32));
    const e = await W.seal(ak, W.newSeed(t.p), new Uint8Array(16), new Uint8Array(48));
    const opened = await W.open(ak, e, new Uint8Array(16), new Uint8Array(48));
    expect(await errorOf(() => W.contentKeys(opened))).toBe("cle_deja_utilisee");
    const checked = await W.contentKeysChecked(opened, keys.engagement);
    expect(await errorOf(() => W.sealFinal(entry, checked, undefined, undefined))).toBe("cle_deja_utilisee");
  });

  it("nombres non entiers jamais tronqués (3,5 ≠ 3) ; entrées mal formées refusées", async () => {
    const pw = utf8("aC3!cD5?#Fg"), salt = new Uint8Array(16);
    expect(await errorOf(() => W.passwordKey(pw, salt, 3.5, 67108864))).toBe("paramètres KDF invalides");
    expect(await errorOf(() => W.passwordKey(pw, salt, 3, 67108864.5))).toBe("paramètres KDF invalides");
    expect(await errorOf(() => W.passwordKey(pw, salt, -3, 67108864))).toBe("paramètres KDF trop faibles");
    expect(await errorOf(() => W.passwordKey(pw, salt, NaN, 67108864))).toBe("paramètres KDF invalides");
    expect(await errorOf(() => W.passwordKey(new Uint8Array(), salt, 2.5, 1))).toBe("mot_de_passe_vide");
    expect(await errorOf(() => W.nonce(1.5, false))).toBe("taille_invalide");
    expect(await errorOf(() => W.segmentSize(16, 1))).toBe("segment_invalide");
    expect(await errorOf(() => W.bucketFor(Infinity))).toBe("taille_invalide");
    const el = await W.elementSealer(testProvider([new Uint8Array(32)]).p, 10, 0);
    expect(await errorOf(() => el.range(0.5))).toBe("segment_invalide");
    expect(await errorOf(() => el.piece(1, new Uint8Array(10)))).toBe("segment_invalide");
    expect(await errorOf(() => el.piece(0, new Uint8Array(9)))).toBe("lecture_incomplete");
    expect(await errorOf(() => el.piece(0, new Uint8Array(10)))).toBe("segment_deja_produit");
    const keys = await W.contentKeys(W.newSeed(testProvider([new Uint8Array(32)]).p));
    const ok: FinalEntry = { kind: "file", name: "f", mime: "m", size: 1, first: 0, k: new Uint8Array(32) };
    for (const bad of [{ ...ok, kind: "dossier" }, { ...ok, k: new Uint8Array(31) }, { ...ok, clean: "inconnu" }, { ...ok, name: 3 }])
      expect(await errorOf(() => W.sealFinal([bad as never], keys, undefined, undefined))).toBe("entree_invalide");
    expect(await errorOf(() => W.sealFinal([{ ...ok, size: 0.5 }], keys, undefined, undefined))).toBe("taille_invalide");
    expect(await errorOf(() => W.sealFinal([{ ...ok, kind: "text", size: 0.5 }], keys, undefined, undefined))).toBe("texte_trop_long");
    expect(await errorOf(() => W.sealFinal([ok], keys, "coffre", 6.5))).toBe("droits_invalides");
    const ak = await W.accessKeys(createProvider(), new Uint8Array(32), new Uint8Array(32));
    expect(await errorOf(() => W.seal(ak, W.newSeed(createProvider()), new Uint8Array(15), new Uint8Array(48)))).toBe("enveloppe : id ou en-tête invalide");
  });

  /** Petit partage (une note) prêt à ouvrir : segments et clés d'ouverture. */
  async function tinyShare() {
    const t = testProvider([new Uint8Array(32).fill(1), new Uint8Array(32).fill(2), new Uint8Array(12)]);
    const el = await W.elementSealer(t.p, 5, 0);
    const piece = await el.piece(0, utf8("salut"));
    const seed = W.newSeed(t.p);
    const keys = await W.contentKeys(seed);
    const fin = await W.sealFinal([{ kind: "text", name: "n", mime: "text/plain", size: 5, first: 0, k: el.k() }], keys, undefined, undefined);
    const seg = new Uint8Array(W.segmentSize(fin.bucket, 0));
    seg.set(piece, 0);
    seg.set(fin.header, 0);
    seg.set(fin.tail, seg.length - fin.tail.length);
    const ak = await W.accessKeys(t.p, new Uint8Array(32), new Uint8Array(32));
    const e = await W.seal(ak, seed, new Uint8Array(16), fin.header);
    const ck = await W.contentKeysChecked(await W.open(ak, e, new Uint8Array(16), fin.header), keys.engagement);
    return { seg, ck, bucket: fin.bucket };
  }

  it("rejets de fetchSegment et du puits rendus tels quels (pas paquet_corrompu)", async () => {
    const { seg, ck, bucket } = await tinyShare();
    const net = new TypeError("reseau");
    expect(await W.openReader(ck, async () => { throw net; }, bucket).catch((e: unknown) => e)).toBe(net);
    expect(await W.openReader(ck, () => { throw net; }, bucket).catch((e: unknown) => e)).toBe(net);
    expect(await errorOf(() => W.openReader(ck, async () => new Uint8Array(10), bucket))).toBe("paquet_corrompu");
    let fail = false;
    const rd = await W.openReader(ck, async () => {
      if (fail) throw net;
      return seg;
    }, bucket);
    expect(rd.manifest().items[0]!.text).toBe("salut");
    const sinkErr = new Error("disque plein");
    expect(await rd.streamItem(0, async () => { throw sinkErr; }).catch((e: unknown) => e)).toBe(sinkErr);
    rd.wipe();
    expect(new TextDecoder().decode(await rd.item(0))).toBe("salut");
    expect(await errorOf(() => rd.item(1))).toBe("element_inexistant");
    expect(await errorOf(() => rd.item(0.5))).toBe("element_inexistant");
    fail = true;
    expect(await rd.item(0).then(() => "réussi")).toBe("réussi"); // une note ne relit rien
    expect(await errorOf(() => W.openReader(ck, async () => seg, 17))).toBe("paquet_corrompu");
  });
});

// ------------------------------------------------------------------------------- Argon2id

describe("Argon2id : Worker neuf par appel (couche TypeScript)", () => {
  const PW = "aC3!cD5?#Fg";
  const salt = new Uint8Array(16).map((_, i) => i);

  it("refuse elle-même les paramètres non entiers avant le moteur (mêmes messages, même ordre)", async () => {
    const run = (pw: string, s: Uint8Array, ops: number, mem: number) => errorOf(() => passwordKey(E, pw, s, { ops, mem }));
    expect(await run(PW, salt, 3.5, 67108864)).toBe("paramètres KDF invalides");
    expect(await run(PW, salt, 3, Number.MAX_SAFE_INTEGER + 2)).toBe("paramètres KDF invalides");
    expect(await run("", salt, 3.5, 67108864)).toBe("mot_de_passe_vide");
    expect(await run(PW, new Uint8Array(15), 3.5, 67108864)).toBe("clé ou sel de taille invalide");
    expect(await run(PW, salt, 2, 67108864)).toBe("paramètres KDF trop faibles");
    expect(await errorOf(() => passwordKeyForCreate(E, "motdepasse", salt))).toBe("mot_de_passe_non_genere");
  });

  it("Worker : un neuf par appel, arrêté après, mot de passe effacé, même clé que dans la page", async () => {
    const want = hex(W.passwordKeyForCreate(utf8(PW), salt));
    const workers: FakeWorker[] = [];
    class FakeWorker {
      onmessage: ((e: MessageEvent) => void) | null = null;
      onerror: ((e: ErrorEvent) => void) | null = null;
      onmessageerror: (() => void) | null = null;
      terminated = false;
      job?: KdfJob;
      constructor() {
        workers.push(this);
      }
      postMessage(job: KdfJob) {
        this.job = structuredClone(job);
        setTimeout(() => {
          const r = handle(this.job!);
          this.onmessage?.({ data: structuredClone(r) } as MessageEvent);
        }, 0);
      }
      terminate() {
        this.terminated = true;
      }
    }
    const start = async () => new FakeWorker() as unknown as Worker;
    expect(hex(await passwordKeyForCreate(E, PW, salt, start))).toBe(want);
    expect(hex(await passwordKey(E, PW, salt, V.constants.KDF_MIN, start))).toBe(want);
    expect(workers.length).toBe(2);
    for (const w of workers) {
      expect(w.terminated).toBe(true);
      expect(w.job!.pw.every((b) => b === 0), "copie du Worker effacée").toBe(true);
      expect(w.job!.module).toBeInstanceOf(WebAssembly.Module); // clone du module compilé de la page
    }
    // Refus du moteur dans le Worker : même message.
    expect(await errorOf(() => passwordKey(E, PW, salt, { ops: 2, mem: 67108864 }, start))).toBe("paramètres KDF trop faibles");
    expect(workers.at(-1)!.terminated).toBe(true);
  });

  it("sans `start` explicite : celui du moteur (chargement vérifié, Task 10)", async () => {
    const want = hex(W.passwordKeyForCreate(utf8(PW), salt));
    let n = 0;
    const engine: Engine = { ...E, start: async () => (n++, fakeWorker((job) => handle(job))) };
    expect(hex(await passwordKeyForCreate(engine, PW, salt))).toBe(want);
    expect(n).toBe(1);
  });

  it("repli dans la page, avec le moteur déjà vérifié, si le Worker ne se crée pas ou ne démarre pas ; jamais sur un refus du moteur", async () => {
    const want = hex(W.passwordKeyForCreate(utf8(PW), salt));
    const inPage = vi.spyOn(W, "passwordKeyForCreate");
    // Worker impossible à créer (CSP ancienne, script du Worker refusé : Error("reseau")…).
    expect(hex(await passwordKeyForCreate(E, PW, salt, () => Promise.reject(new Error("reseau"))))).toBe(want);
    // Script du Worker qui ne démarre pas (événement error).
    const dead = fakeWorker(null);
    expect(hex(await passwordKeyForCreate(E, PW, salt, async () => dead))).toBe(want);
    expect((dead as unknown as { terminated: boolean }).terminated).toBe(true);
    expect(inPage).toHaveBeenCalledTimes(2);
    // Refus du moteur dans le Worker : rendu tel quel, pas de second calcul dans la page.
    inPage.mockClear();
    const refuse = fakeWorker(() => ({ error: "mot_de_passe_non_genere" }));
    expect(await errorOf(() => passwordKeyForCreate(E, PW, salt, async () => refuse))).toBe("mot_de_passe_non_genere");
    expect(inPage).not.toHaveBeenCalled();
  });
});

/** Faux Worker : `reply` répond au travail ; null : le script ne démarre pas (événement error). */
function fakeWorker(reply: ((job: KdfJob) => KdfReply) | null): Worker {
  const w = {
    onmessage: null as ((e: MessageEvent) => void) | null,
    onerror: null as ((e: { preventDefault(): void }) => void) | null,
    onmessageerror: null,
    terminated: false,
    postMessage(job: KdfJob) {
      const copy = structuredClone(job);
      setTimeout(() => (reply ? w.onmessage?.({ data: structuredClone(reply(copy)) } as MessageEvent) : w.onerror?.({ preventDefault() {} })), 0);
    },
    terminate() {
      w.terminated = true;
    },
  };
  return w as unknown as Worker;
}
