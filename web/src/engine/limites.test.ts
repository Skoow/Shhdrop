// Cas limites (audit M7) : engine/vectors/v2-limites.json, produit par le moteur Rust
// (engine/core/tests/limites.rs), rejoué ici par le build WebAssembly avec le fournisseur
// WebCrypto du site, et pour les liens par la partie TypeScript (pure.ts) : mêmes sorties,
// mêmes messages d'erreur, à partir des seules entrées du fichier.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { passwordKey as kdfOpen } from "./argon2";
import { loadEngine, type Engine, type Wasm } from "./load";
import type { FinalEntry } from "./pkg/shhdrop_wasm.js";
import { createProvider, type WebCryptoProvider } from "./provider";
import * as P from "./pure";

const V = JSON.parse(readFileSync(new URL("../../../engine/vectors/v2-limites.json", import.meta.url), "utf8"));
const unhex = (s: string) => new Uint8Array(Buffer.from(s, "hex"));
const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const utf8 = (s: string) => new TextEncoder().encode(s);

let E: Engine;
let W: Wasm;
beforeAll(async () => {
  E = await loadEngine();
  W = E.wasm;
});

/** Résultat ou message d'erreur d'un appel, synchrone ou non. */
async function out<T>(f: () => T | Promise<T>): Promise<{ ok: T } | { error: string }> {
  try {
    return { ok: await f() };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** Fournisseur WebCrypto réel dont l'aléa rejoue `draws` ; copie des clés brutes importées. */
function replay(draws: Uint8Array[]): { p: WebCryptoProvider; imports: Uint8Array[] } {
  const real = createProvider();
  const q = [...draws];
  const imports: Uint8Array[] = [];
  const p: WebCryptoProvider = {
    ...real,
    random(n: number) {
      const d = q.shift();
      if (!d || d.length !== n) throw new Error("tirage inattendu");
      return new Uint8Array(d);
    },
    async aesImport(raw: Uint8Array) {
      imports.push(new Uint8Array(raw));
      return real.aesImport(raw);
    },
  };
  return { p, imports };
}

type Plain = { hex?: string; utf8?: string; repeat?: [string, number]; then?: string; xorshift32?: { seed: number; len: number } };

/** Clair décrit dans le fichier (README : `hex`, `utf8`, `repeat` + `then`, `xorshift32`). */
function plain(s: Plain): Uint8Array {
  if (s.hex !== undefined) return unhex(s.hex);
  if (s.utf8 !== undefined) return utf8(s.utf8);
  if (s.repeat) return utf8(s.repeat[0].repeat(s.repeat[1]) + (s.then ?? ""));
  const { seed, len } = s.xorshift32!;
  const buf = new Uint8Array(Math.ceil(len / 4) * 4);
  const dv = new DataView(buf.buffer);
  let x = seed >>> 0;
  for (let i = 0; i < buf.length; i += 4) {
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    dv.setUint32(i, x, true);
  }
  return buf.subarray(0, len);
}

describe("v2-limites.json : liens", () => {
  it("clés en « m », « - », « _ », 0x00 et 0xff : lien écrit par le moteur, relu par le moteur et par linkForm", () => {
    for (const c of V.links.written) {
      const key = unhex(c.key);
      const link = String(c.fn === "shareLink" ? W.shareLink(V.links.origin, key, c.base) : W.manageLink(V.links.origin, key, c.base));
      expect(link, c.label).toBe(c.link);
      const p = W.parseLink(utf8(link), c.base);
      expect({ kind: p.kind, origin: p.origin, key: hex(p.kind === "s" ? p.kLien : p.sGestion) }, c.label).toEqual(c.parsed);
      const f = P.linkForm(link, c.base);
      expect({ kind: f.kind, origin: f.origin, key: hex(P.unb64u(f.key)) }, c.label).toEqual(c.parsed);
    }
  });

  it("chaque dernier caractère, « - » et « _ » en tête, avant la fin et en fin : même verdict (moteur et linkForm)", async () => {
    let ok = 0;
    for (const c of V.links.parse) {
      const eng = await out(() => W.parseLink(utf8(c.url), c.base));
      const ts = await out(() => P.linkForm(c.url, c.base));
      if (c.result.error !== undefined) {
        expect(eng, c.label).toEqual({ error: c.result.error });
        expect(ts, c.label).toEqual({ error: c.result.error });
        continue;
      }
      ok++;
      const p = (eng as { ok: ReturnType<Wasm["parseLink"]> }).ok;
      expect({ kind: p.kind, origin: p.origin, key: hex(p.kind === "s" ? p.kLien : p.sGestion) }, c.label).toEqual(c.result);
      const f = (ts as { ok: P.LinkForm }).ok;
      expect({ kind: f.kind, origin: f.origin, key: hex(P.unb64u(f.key)) }, c.label).toEqual(c.result);
    }
    expect(ok).toBe(16 * 3 + 7);
  });

  it("QR « lien.mot de passe » avec une clé de partage en « m » (moteur et pure.ts)", async () => {
    for (const c of V.links.qr) {
      const want = c.error !== undefined ? { error: c.error } : { ok: c.link_with_password };
      expect(await out(() => String(W.shareLinkWithPassword(utf8(c.link), utf8(c.password)))), c.label).toEqual(want);
      expect(await out(() => P.shareLinkWithPassword(c.link, c.password)), c.label).toEqual(want);
      if (c.error !== undefined) continue;
      expect(W.splitPassword(utf8(c.link_with_password)), c.label).toEqual(c.split);
      expect(P.splitPassword(c.link_with_password), c.label).toEqual(c.split);
    }
  });
});

describe("v2-limites.json : partages (notes limites, fin de palier, 200 et 201 éléments)", () => {
  for (const c of V.shares) {
    it(c.label, async () => {
      type Item = { kind: "text" | "file"; name: string; mime: string; first: number; plain: Plain; k: string };
      const items = c.items as Item[];
      const plains = items.map((it) => plain(it.plain));
      const entries: FinalEntry[] = [];
      const pieces: Uint8Array[][] = [];
      const placed: { seg: number; from: number; ct: Uint8Array }[] = [];
      const held: { free(): void }[] = []; // scelleurs gardés vivants jusqu'à sealFinal (graines)
      for (const [i, it] of items.entries()) {
        const el = await W.elementSealer(replay([unhex(it.k)]).p, plains[i]!.length, it.first);
        held.push(el);
        const list: Uint8Array[] = [];
        const shape = el.pieces();
        for (const [j, pc] of shape.entries()) {
          const [lo, hi] = el.range(j);
          const ct = await el.piece(j, plains[i]!.subarray(lo, hi));
          list.push(ct);
          placed.push({ seg: pc.seg, from: pc.from, ct });
        }
        expect(shape.map((pc, j) => ({ ...pc, len: list[j]!.length, sha256: sha(list[j]!) })), `${c.label} : pièces de ${i}`).toEqual(c.pieces[i]);
        pieces.push(list);
        entries.push({ kind: it.kind, name: it.name, mime: it.mime, size: plains[i]!.length, first: it.first, sealer: el.id });
      }
      const t = replay([unhex(c.r), new Uint8Array(12)]);
      const seed = W.newSeed(t.p);
      const keys = await W.contentKeys(seed);
      const fin = await out(() => W.sealFinal(entries, keys, c.rights, undefined));
      for (const el of held) el.free();
      if (c.error !== undefined) {
        expect(fin).toEqual({ error: c.error });
        return;
      }
      const { bucket, header, tail } = (fin as { ok: { bucket: number; header: Uint8Array; tail: Uint8Array } }).ok;
      expect([bucket, hex(header), sha(tail)]).toEqual([c.bucket, c.header, c.tail_sha256]);
      // Manifeste exact : déchiffré avec la K_contenu copiée à l'import.
      type B = Uint8Array<ArrayBuffer>;
      const k = await crypto.subtle.importKey("raw", t.imports[0] as B, "AES-GCM", false, ["decrypt"]);
      const pt = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: W.nonce(bucket - 1, true) as B, additionalData: header as B }, k, tail as B));
      const len = new DataView(pt.buffer).getUint32(pt.length - 4);
      expect(new TextDecoder().decode(pt.subarray(pt.length - 4 - len, pt.length - 4))).toBe(c.manifest_json);
      // Fichiers du serveur, puis ouverture complète par l'enveloppe et le lecteur.
      const segs = Array.from({ length: W.segmentCount(bucket) }, (_, n) => new Uint8Array(W.segmentSize(bucket, n)));
      for (const { seg, from, ct } of placed) segs[seg]!.set(ct, seg === 0 ? (from === 0 ? 0 : P.HEADER + from * P.CHUNK_CT) : from * P.CHUNK_CT);
      segs[0]!.set(header, 0);
      segs.at(-1)!.set(tail, segs.at(-1)!.length - P.CHUNK_CT);
      const ak = await W.accessKeys(t.p, new Uint8Array(32), new Uint8Array(32));
      const env = await W.seal(ak, seed, new Uint8Array(16), header);
      const ck = await W.contentKeysChecked(await W.open(ak, env, new Uint8Array(16), header), keys.engagement);
      const rd = await W.openReader(ck, async (n: number) => segs[n]!, bucket);
      const opened = [];
      for (const i of items.keys()) {
        const parts: Uint8Array[] = [];
        await rd.streamItem(i, (b: Uint8Array) => void parts.push(new Uint8Array(b)));
        const got = new Uint8Array(Buffer.concat(parts));
        expect(hex(got) === hex(plains[i]!), `${c.label} : élément ${i} relu`).toBe(true);
        opened.push({ len: got.length, sha256: sha(got) });
      }
      expect(opened).toEqual(c.opened);
      for (const x of [rd, ck, ak, keys]) x.free();
    }, 60_000);
  }
});

describe("v2-limites.json : Argon2id (NFC difficiles, blancs en bord)", () => {
  it("moteur WebAssembly : même clé, même texte NFC, mêmes refus", async () => {
    for (const c of V.argon2id) {
      const pw = unhex(c.password_utf8);
      expect(new TextDecoder().decode(pw), c.label).toBe(c.password);
      const r = await out(() => hex(c.fn === "passwordKeyForCreate" ? W.passwordKeyForCreate(pw, unhex(c.salt)) : W.passwordKey(pw, unhex(c.salt), c.ops, c.mem)));
      expect(r, c.label).toEqual(c.error !== undefined ? { error: c.error } : { ok: c.key });
      if (c.nfc_utf8 !== undefined) {
        // Ce qu'Argon2id reçoit : blancs ASCII de bord retirés, puis NFC (moteur JavaScript ici).
        expect(hex(utf8(c.password.replace(/^[ \t\r\n]+/, "").replace(/[ \t\r\n]+$/, "").normalize("NFC"))), c.label).toBe(c.nfc_utf8);
      }
    }
  }, 120_000);

  it("couche TypeScript (argon2.ts) : le mot de passe collé avec des blancs en bord donne la clé sans blancs", async () => {
    const c = V.argon2id.find((x: { label: string }) => x.label === "blancs_ascii_en_bord");
    const k = await kdfOpen(E, c.password, unhex(c.salt), { ops: c.ops, mem: c.mem });
    expect(hex(k)).toBe(c.key);
  }, 60_000);
});
