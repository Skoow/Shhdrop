// Compatibilité (spec moteur §2.2, §11) : un partage créé par l'ANCIEN moteur TypeScript (vecteur
// `share` de engine/vectors/v2.json, produit avant sa suppression) est déposé tel quel dans le vrai
// serveur Go, puis ouvert par le client du site avec le nouveau moteur (WebAssembly).
// Enveloppe E, en-tête, morceau du manifeste, sel, V_preuve : les octets du vecteur. Les pièces des
// éléments (le vecteur n'en garde que les empreintes) sont refaites à partir de la graine k et du
// clair du vecteur, puis comparées à l'empreinte SHA-256 de chaque pièce de l'ancien moteur : ce
// sont donc ses octets exacts.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CAPTCHA_MIN_MS, openShare } from "../src/transfer/client";
import * as api from "../src/transfer/api";
import { deriveAccess, loadEngine, b64u, type KLien, type SGestion } from "../src/engine";
import { solveAltcha } from "./altcha";
import { startServer, type TestServer } from "./server";

const V = JSON.parse(readFileSync(new URL("../../engine/vectors/v2.json", import.meta.url), "utf8")).share;
const unhex = (s: string) => new Uint8Array(Buffer.from(s, "hex"));
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const b64 = (hex: string) => Buffer.from(hex, "hex").toString("base64url");

/** Clair d'un élément du vecteur (texte, ou xorshift32 : engine/vectors/README.md). */
function plainOf(item: { plain: { utf8?: string; xorshift32?: { seed: number; len: number } } }): Uint8Array {
  if (item.plain.utf8 !== undefined) return new TextEncoder().encode(item.plain.utf8);
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

describe("partage de l'ancien moteur, servi par le vrai serveur, ouvert par le nouveau", () => {
  let srv: TestServer;
  beforeAll(async () => {
    srv = await startServer();
  });
  afterAll(async () => {
    await srv?.dispose();
  });

  it("dépôt des octets du vecteur share, puis openShare : manifeste et chaque élément identiques", async () => {
    const E = await loadEngine();
    const c = api.ctx(srv.origin);
    const kLien = unhex(V.k_lien) as KLien;
    const { kAcces } = await deriveAccess(kLien);
    expect(Buffer.from(kAcces).toString("hex")).toBe(V.k_acces);
    // Création du brouillon (défi ALTCHA, 3 s au moins après son émission, comme le client).
    const cap = await api.captcha(c);
    const proof = await solveAltcha(cap.challenge);
    if (proof.kind !== "pow") throw new Error("preuve inattendue");
    const wait = cap.receivedAt + CAPTCHA_MIN_MS - performance.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    const { uploadToken } = await api.create(c, kAcces, unhex(V.s_gestion) as SGestion, { bucket: V.bucket, hp: "", shown_at: cap.shownAt, altcha: proof.payload });
    // Pièces de chaque élément : octets de l'ancien moteur (empreinte de chaque pièce vérifiée).
    const plains: Uint8Array[] = [];
    for (const item of V.items) {
      const plain = plainOf(item);
      plains.push(plain);
      expect(sha(plain)).toBe(item.plain_sha256);
      const k = unhex(item.k);
      const el = await E.wasm.elementSealer({ ...E.provider, random: () => new Uint8Array(k) }, item.size, item.first);
      for (const [j, w] of item.pieces.entries()) {
        const [lo, hi] = el.range(j);
        const bytes = (await el.piece(j, plain.subarray(lo, hi))) as Uint8Array<ArrayBuffer>;
        expect(sha(bytes), `${item.name} pièce ${j} : octets de l'ancien moteur`).toBe(w.sha256);
        const full = w.from === 0 && w.chunks === 64;
        await api.putSegment(c, uploadToken, w.seg, bytes, () => undefined, undefined, full ? undefined : w.from);
      }
      el.free();
    }
    // Finalisation : sel, Argon2id, V_preuve, E, en-tête et manifeste chiffré de l'ancien moteur.
    expect(sha(Buffer.from(V.tail, "base64url"))).toBe(V.tail_sha256);
    await api.finalize(c, uploadToken, {
      salt: b64(V.salt),
      kdf_ops: V.kdf_ops,
      kdf_mem: V.kdf_mem,
      proof_v: b64(V.v_preuve),
      envelope: b64(V.envelope),
      ttl_hours: 1,
      max_opens: 1,
      bucket: V.bucket,
      header: b64(V.header),
      tail: V.tail,
    });
    // Ouverture par le site (nouveau moteur), lien du vecteur à l'origine du serveur.
    const link = `${srv.origin}/#${b64u(kLien)}`;
    expect(link.slice(link.indexOf("#"))).toBe(V.link.slice(V.link.indexOf("#")));
    const o = await openShare(link, V.password, srv.origin);
    expect(o.manifest.rights).toBe(V.rights);
    expect(o.manifest.items.map((e) => [e.kind, e.name, e.mime, e.size])).toEqual(V.items.map((i: { kind: string; name: string; mime: string; size: number }) => [i.kind, i.name, i.mime, i.size]));
    for (const [i, w] of V.opened.items.entries()) {
      const got = await o.item(i);
      expect(got.length).toBe(w.len);
      expect(sha(got), `élément ${i}`).toBe(w.sha256);
      expect(Buffer.from(got).equals(Buffer.from(plains[i]!))).toBe(true);
    }
    await o.done();
    o.wipe();
  }, 120_000);
});
