// Partie gardée en TypeScript (pure.ts, décisions B1 et B3 du contrôleur, Task 11) : égale au
// moteur Rust, prouvée sur les vecteurs communs (engine/vectors/v2.json) ET contre le moteur
// WebAssembly lui-même, cas par cas (même entrée → même sortie ou même message d'erreur).
import { readFileSync } from "node:fs";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { loadEngine, type Wasm } from "./load";
import * as P from "./pure";

const V = JSON.parse(readFileSync(new URL("../../../engine/vectors/v2.json", import.meta.url), "utf8"));
const unhex = (s: string) => new Uint8Array(Buffer.from(s, "hex"));
const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");
const utf8 = (s: string) => new TextEncoder().encode(s);

let W: Wasm;
beforeAll(async () => {
  W = (await loadEngine()).wasm;
});
afterEach(() => vi.restoreAllMocks());

/** Résultat ou message d'erreur d'un appel. */
function out(f: () => unknown): { ok: unknown } | { error: string } {
  try {
    return { ok: f() };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

describe("constantes : TypeScript = vecteurs = moteur", () => {
  it("toutes les constantes du format, du KDF et du mot de passe", () => {
    const C = V.constants;
    const eng = W.constants() as Record<string, unknown>;
    const ts: Record<string, unknown> = {
      BUCKETS: [...P.BUCKETS],
      CHUNK: P.CHUNK,
      CHUNK_CT: P.CHUNK_CT,
      CONTENT_MAX: P.CONTENT_MAX,
      DATA_CHUNKS: P.DATA_CHUNKS,
      DATA_SEGMENTS: P.DATA_SEGMENTS,
      HEADER: P.HEADER,
      KDF_CREATE: { ...P.KDF_CREATE },
      KDF_MAX: { ...P.KDF_MAX },
      KDF_MIN: { ...P.KDF_MIN },
      KEY_CHARS: P.KEY_CHARS,
      MANIFEST_MAX: P.MANIFEST_MAX,
      MAX_ITEMS: P.MAX_ITEMS,
      PASSWORD_ALPHABET: P.PASSWORD_ALPHABET,
      PASSWORD_FAMILIES: [...P.PASSWORD_FAMILIES],
      PASSWORD_LEN: P.PASSWORD_LEN,
      PASSWORD_SPECIALS: P.PASSWORD_SPECIALS,
      PREVIEW_MAX: P.PREVIEW_MAX,
      SEG_CHUNKS: P.SEG_CHUNKS,
      SEG_PLAIN: P.SEG_PLAIN,
      TAG: P.TAG,
      TEXT_BYTES_MAX: P.TEXT_BYTES_MAX,
      TEXT_MAX: P.TEXT_MAX,
    };
    for (const [k, v] of Object.entries(ts)) {
      expect(v, k).toEqual(C[k]);
      expect(eng[k], k).toEqual(C[k]);
    }
  });
});

describe("géométrie : TypeScript = vecteurs = moteur", () => {
  it("bucketFor, segmentCount, segmentSize, segmentsFor, chunksFor, footprintFor, isSmall, reservationFor, segmentsNeeded", () => {
    const s = V.sizing;
    let n = 0;
    const same = (name: string, ts: () => unknown, eng: () => unknown, c: { result?: unknown; error?: string }) => {
      const want = c.error !== undefined ? { error: c.error } : { ok: c.result };
      expect(out(ts), `${name} TS ${JSON.stringify(c)}`).toEqual(want);
      expect(out(eng), `${name} moteur ${JSON.stringify(c)}`).toEqual(want);
      n++;
    };
    for (const c of s.bucketFor) same("bucketFor", () => P.bucketFor(c.input), () => W.bucketFor(c.input), c);
    for (const c of s.segmentCount) same("segmentCount", () => P.segmentCount(c.input), () => W.segmentCount(c.input), c);
    for (const c of s.segmentSize) same("segmentSize", () => P.segmentSize(c.bucket, c.n), () => W.segmentSize(c.bucket, c.n), c);
    for (const c of s.segmentsFor) same("segmentsFor", () => P.segmentsFor(c.input), () => W.segmentsFor(c.input), c);
    for (const c of s.chunksFor) same("chunksFor", () => P.chunksFor(c.input), () => W.chunksFor(c.input), c);
    for (const c of s.footprintFor) same("footprintFor", () => P.footprintFor(c.input), () => W.footprintFor(c.input), c);
    for (const c of s.isSmall) same("isSmall", () => P.isSmall(c.input), () => W.isSmall(c.input), c);
    for (const c of s.reservationFor) same("reservationFor", () => P.reservationFor(c.input), () => W.reservationFor(c.input), c);
    for (const c of s.segmentsNeeded) same("segmentsNeeded", () => P.segmentsNeeded(c.input), () => W.segmentsNeeded(new Float64Array(c.input)), c);
    expect(n).toBeGreaterThan(50);
  });

  it("segmentSize de chaque segment de chaque palier : même valeur", () => {
    for (const b of P.BUCKETS) for (let k = 0; k < P.segmentCount(b); k++) expect(P.segmentSize(b, k), `${b}/${k}`).toBe(W.segmentSize(b, k));
  });
});

describe("base64url : TypeScript = vecteurs = moteur", () => {
  it("b64u et unb64u (refus compris)", () => {
    for (const c of V.encoding.b64u) {
      expect(P.b64u(unhex(c.bytes))).toBe(c.b64u);
      expect(W.b64u(unhex(c.bytes))).toBe(c.b64u);
    }
    for (const c of V.encoding.unb64u) {
      const want = c.error !== undefined ? { error: c.error } : { ok: c.bytes };
      expect(out(() => hex(P.unb64u(c.input))), c.input).toEqual(want);
      expect(out(() => hex(W.unb64u(c.input))), c.input).toEqual(want);
    }
  });
});

describe("liens : TypeScript = vecteurs = moteur (126 cas)", () => {
  const cases = V.link as { fn: string; args: string[]; result?: unknown; error?: string }[];

  it("checkOrigin, shareLinkWithPassword, splitPassword", () => {
    for (const c of cases) {
      const want = c.error !== undefined ? { error: c.error } : { ok: c.result };
      if (c.fn === "checkOrigin") {
        expect(out(() => P.checkOrigin(c.args[0]!)), JSON.stringify(c)).toEqual(want);
        expect(out(() => W.checkOrigin(c.args[0]!)), JSON.stringify(c)).toEqual(want);
      } else if (c.fn === "shareLinkWithPassword") {
        expect(out(() => P.shareLinkWithPassword(c.args[0]!, c.args[1]!)), JSON.stringify(c)).toEqual(want);
        // Le moteur ne lève que lien_invalide (l'ancien moteur laissait passer « Invalid URL » de new URL).
        const eng = out(() => String(W.shareLinkWithPassword(utf8(c.args[0]!), utf8(c.args[1]!))));
        expect(eng, JSON.stringify(c)).toEqual(c.error === "Invalid URL" ? { error: "lien_invalide" } : want);
      } else if (c.fn === "splitPassword") {
        expect(out(() => P.splitPassword(c.args[0]!)), JSON.stringify(c)).toEqual(want);
        expect(out(() => W.splitPassword(utf8(c.args[0]!))), JSON.stringify(c)).toEqual(want);
      }
    }
  });

  it("linkForm (forme seulement, clé non décodée) : même verdict, même origine, même genre que parseLink du moteur ; la clé est le texte du lien", () => {
    let n = 0;
    for (const c of cases.filter((x) => x.fn === "parseLink")) {
      const [url, base] = c.args as [string, string];
      const ts = out(() => P.linkForm(url, base));
      let eng = out(() => W.parseLink(utf8(url), base));
      if (url.includes("été.example")) {
        // Écart documenté (engine/vectors/README.md) : le moteur refuse un hôte non ASCII ; le site
        // ne lui passe que le lien normalisé par linkForm (origine en Punycode, comme location.href).
        expect(eng).toEqual({ error: "lien_invalide" });
        const f = (ts as { ok: P.LinkForm }).ok;
        eng = out(() => W.parseLink(utf8(`${f.origin}/#${f.key}`), base));
      }
      if (c.error !== undefined) {
        expect(ts, JSON.stringify(c)).toEqual({ error: c.error });
        expect(eng, JSON.stringify(c)).toEqual({ error: c.error });
      } else {
        const r = c.result as { kind: string; origin: string; key: string };
        const f = (ts as { ok: P.LinkForm }).ok;
        expect({ kind: f.kind, origin: f.origin }, JSON.stringify(c)).toEqual({ kind: r.kind, origin: r.origin });
        expect(hex(P.unb64u(f.key)), "clé (décodée ici pour le test seulement)").toBe(r.key);
        expect(eng, JSON.stringify(c)).toHaveProperty("ok");
        const p = (eng as { ok: { kind: string; origin: string; kLien?: Uint8Array; sGestion?: Uint8Array } }).ok;
        expect({ kind: p.kind, origin: p.origin, key: hex(p.kLien ?? p.sGestion!) }).toEqual(r);
      }
      n++;
    }
    expect(n).toBe(58);
  });

  it("linkForm : tout dernier caractère non canonique refusé, comme le moteur (balayage des 64 caractères)", () => {
    const head = "MDEyMzQ1Njc4OTo7PD0-P0BBQkNERUZHSElKS0xNTk";
    for (const ch of "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_") {
      for (const pre of ["#", "#m"]) {
        const url = `https://x.test/${pre}${head}${ch}`;
        const ts = out(() => P.linkForm(url, "/"));
        const eng = out(() => W.parseLink(utf8(url), "/"));
        expect("error" in ts, url).toBe("error" in eng);
      }
    }
  });
});

describe("mot de passe généré : TypeScript = vecteurs = moteur", () => {
  it("generatePassword : mêmes tirages en entrée → même mot de passe, tous les tirages consommés", () => {
    for (const c of V.password.generate as { label: string; password: string; random: string[] }[]) {
      const draws = c.random.map(unhex);
      let i = 0;
      vi.spyOn(crypto, "getRandomValues").mockImplementation(<T extends ArrayBufferView | null>(b: T): T => {
        const d = draws[i++]!;
        const u = b as unknown as Uint8Array;
        expect(u.length, c.label).toBe(d.length);
        u.set(d);
        return b;
      });
      expect(P.generatePassword(), c.label).toBe(c.password);
      expect(i, `${c.label} : tirages consommés`).toBe(draws.length);
      vi.restoreAllMocks();
      // Le moteur, avec les mêmes tirages (fournisseur rejoué).
      let j = 0;
      const provider = { random: (n: number) => (expect(n).toBe(draws[j]!.length), new Uint8Array(draws[j++]!)) } as never;
      expect(String(W.generatePassword(provider)), c.label).toBe(c.password);
      expect(j).toBe(draws.length);
    }
  });

  it("isGeneratedPassword : même verdict (vecteurs et 2 000 tirages)", () => {
    for (const c of V.password.is_generated as { password: string; ok: boolean }[]) {
      expect(P.isGeneratedPassword(c.password), c.password).toBe(c.ok);
      expect(W.isGeneratedPassword(utf8(c.password)), c.password).toBe(c.ok);
    }
    for (let k = 0; k < 2000; k++) {
      const pw = P.generatePassword();
      expect(W.isGeneratedPassword(utf8(pw)), pw).toBe(true);
      const bad = pw.slice(1) + "o"; // « o » hors alphabet
      expect(P.isGeneratedPassword(bad)).toBe(false);
      expect(W.isGeneratedPassword(utf8(bad))).toBe(false);
    }
  });
});

describe("checkKdfParams : mêmes refus que le moteur", () => {
  it("non entier, trop fort → invalides ; trop faible → trop faibles", () => {
    const salt = new Uint8Array(16);
    for (const p of [
      { ops: 3, mem: 67108864 },
      { ops: 2, mem: 67108864 },
      { ops: 3, mem: 1 },
      { ops: 4, mem: 67108864 },
      { ops: 3, mem: 134217728 },
      { ops: 3.5, mem: 67108864 },
      { ops: -3, mem: 67108864 },
    ]) {
      const ts = out(() => P.checkKdfParams(p));
      if ("ok" in ts) continue; // le moteur calculerait Argon2id (64 Mio) : vérifié ailleurs
      expect(out(() => W.passwordKey(utf8("x"), salt, p.ops, p.mem)), JSON.stringify(p)).toEqual(ts);
    }
  });
});
