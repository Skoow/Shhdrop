// Compte v2 (conception 2026-11-14-compte-email-design.md §5.1, §6, §21.2.2, §21.5) :
// engine/vectors/compte.json rejoué par le build WebAssembly sous Node (le pseudo par le module
// du salon), à partir des seules entrées du fichier ; dérivations recalculées à part (Argon2id de
// node:crypto, HKDF de WebCrypto) ; enveloppes et coffres ouverts et refaits par WebCrypto, comme
// le site le fera.
import { argon2Sync, createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { handle } from "./argon2.worker";
import * as I from "./index";
import { loadEngine, type Engine, type Wasm } from "./load";
import { loadSalonEngine, type SalonEngine } from "../salon/engine";

const V = JSON.parse(readFileSync(new URL("../../../engine/vectors/compte.json", import.meta.url), "utf8"));
const unhex = (s: string) => new Uint8Array(Buffer.from(s, "hex"));
const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");
const text = (s: string) => Buffer.from(s, "hex").toString("utf8");
const utf8 = (s: string) => new TextEncoder().encode(s);
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

let E: Engine;
let W: Wasm;
let S: SalonEngine;
beforeAll(async () => {
  E = await loadEngine();
  W = E.wasm;
  S = await loadSalonEngine();
});

/** Résultat ou message d'erreur d'un appel, synchrone ou non. */
async function out<T>(f: () => T | Promise<T>): Promise<{ ok: T } | { error: string }> {
  try {
    return { ok: await f() };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

async function hkdf(ikm: Uint8Array, info: string): Promise<string> {
  const k = await crypto.subtle.importKey("raw", ikm as Uint8Array<ArrayBuffer>, "HKDF", false, ["deriveBits"]);
  return hex(new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: utf8(info) }, k, 256)));
}

async function aesSeal(key: Uint8Array, nonce: Uint8Array, ad: Uint8Array, plain: Uint8Array): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey("raw", key as Uint8Array<ArrayBuffer>, "AES-GCM", false, ["encrypt"]);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce as Uint8Array<ArrayBuffer>, additionalData: ad as Uint8Array<ArrayBuffer> }, k, plain as Uint8Array<ArrayBuffer>));
  return new Uint8Array([...nonce, ...ct]);
}

async function aesOpen(key: Uint8Array, ad: Uint8Array, sealed: Uint8Array): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey("raw", key as Uint8Array<ArrayBuffer>, "AES-GCM", false, ["decrypt"]);
  return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: sealed.slice(0, 12), additionalData: ad as Uint8Array<ArrayBuffer> }, k, sealed.slice(12)));
}

describe("compte.json : rejoué par le moteur WebAssembly", () => {
  it("normaliser (≥ 40 cas) : canon, exacte ou erreur exacte", async () => {
    expect(V.normaliser.length).toBeGreaterThanOrEqual(40);
    for (const c of V.normaliser) {
      const got = await out(() => W.normaliserAdresse(text(c.entree_hex)));
      if ("error" in c) expect(got, c.label).toEqual({ error: c.error });
      else expect(got, c.label).toEqual({ ok: { canon: c.canon, exacte: c.exacte } });
      expect(await out(() => I.normaliserAdresse(text(c.entree_hex))), c.label).toEqual(got);
    }
  });

  it("sel : SHA-256(« shhdrop/v2/compte/sel » ‖ 0x00 ‖ canon)[0..16], recalculé par node:crypto", () => {
    for (const c of V.sel) expect(sha(utf8(`shhdrop/v2/compte/sel\0${c.canon}`)).slice(0, 32), c.canon).toBe(c.sel);
  });

  it("deriver : moteur, Worker, et recalcul indépendant (Argon2id de node:crypto, HKDF de WebCrypto)", async () => {
    expect(V.deriver.length).toBeGreaterThanOrEqual(5);
    for (const c of V.deriver) {
      const pw = text(c.mdp_hex);
      const want = "error" in c ? { error: c.error } : { ok: { aAuth: c.a_auth, kekMdp: c.kek_mdp } };
      const viaIndex = await out(async () => {
        const r = await I.deriverCompte(pw, c.canon);
        return { aAuth: hex(r.aAuth), kekMdp: hex(r.kekMdp) };
      });
      expect(viaIndex, c.label).toEqual(want);
      // Calcul du Worker (même module) : 64 octets, A_auth puis KEK_mdp.
      const r = handle({ module: E.module, pw: utf8(pw), salt: new Uint8Array(0), ops: 0, mem: 0, create: false, compte: c.canon });
      if ("error" in c) expect(r, c.label).toEqual({ error: c.error });
      else expect("k" in r && hex(r.k), c.label).toBe(c.a_auth + c.kek_mdp);
      if ("error" in c) continue;
      const salt = unhex(sha(utf8(`shhdrop/v2/compte/sel\0${c.canon}`)).slice(0, 32));
      const nfc = pw.replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, "").normalize("NFC");
      const m = new Uint8Array(argon2Sync("argon2id", { message: nfc, nonce: salt, parallelism: 1, tagLength: 32, memory: 65536, passes: 3 }));
      expect(await hkdf(m, "shhdrop/v2/compte/auth"), c.label).toBe(c.a_auth);
      expect(await hkdf(m, "shhdrop/v2/compte/enveloppe-mdp"), c.label).toBe(c.kek_mdp);
    }
    // Les cas `same_key_as` donnent bien la même clé que leur référence.
    for (const c of V.deriver.filter((x: { same_key_as?: string }) => x.same_key_as)) {
      const ref = V.deriver.find((x: { label: string }) => x.label === c.same_key_as);
      expect(c.a_auth).toBe(ref.a_auth);
    }
  });

  it("cles : K_prive, K_profil, K_etiquette par le moteur et par WebCrypto (HKDF)", async () => {
    for (const c of V.cles) {
      const k = unhex(c.k_compte);
      const s = unhex(c.s_profil);
      expect(hex(W.clePrive(k))).toBe(c.k_prive);
      expect(hex(W.cleAppareil(k))).toBe(c.k_appareil);
      expect(hex(W.cleProfil(s))).toBe(c.k_profil);
      expect(hex(await I.clePrive(k))).toBe(c.k_prive);
      expect(hex(await I.cleAppareil(k))).toBe(c.k_appareil);
      expect(hex(await I.cleProfil(s))).toBe(c.k_profil);
      expect(await hkdf(k, "shhdrop/v2/compte/blob")).toBe(c.k_prive);
      expect(await hkdf(k, "shhdrop/v2/compte/appareil")).toBe(c.k_appareil);
      expect(await hkdf(s, "shhdrop/v2/compte/profil")).toBe(c.k_profil);
    }
    for (const n of [31, 33, 0]) {
      expect(await out(() => W.clePrive(new Uint8Array(n)))).toEqual({ error: "clé ou sel de taille invalide" });
      expect(await out(() => I.cleProfil(new Uint8Array(n)))).toEqual({ error: "clé ou sel de taille invalide" });
    }
  });

  it("pseudo (≥ 30 cas) : affichage, p_canon, réservé, ou erreur exacte", async () => {
    expect(V.pseudo.length).toBeGreaterThanOrEqual(30);
    for (const c of V.pseudo) {
      const got = await out(async () => {
        const a = S.pseudoValide(text(c.entree_hex));
        const p = S.cleUnicite(a);
        return { affiche_hex: hex(utf8(a)), p_canon_hex: hex(utf8(p)), reserve: S.pseudoReserve(p) };
      });
      if ("error" in c) expect(got, c.label).toEqual({ error: c.error });
      else expect(got, c.label).toEqual({ ok: { affiche_hex: c.affiche_hex, p_canon_hex: c.p_canon_hex, reserve: c.reserve } });
    }
    for (const r of V.constants.reserves) {
      expect(S.cleUnicite(r.mot)).toBe(text(r.p_canon_hex));
      expect(S.pseudoReserve(text(r.p_canon_hex)), r.mot).toBe(true);
    }
    // Absent du moteur des partages (chargé sur toutes les pages de partage) : ses tables Unicode
    // n'y sont pas (web/scripts/check-dist.mjs, ENGINE_BROTLI_MAX).
    for (const f of ["pseudoValide", "pseudoCanon", "pseudoReserve"]) {
      expect(f in W, f).toBe(false);
      expect(f in I, f).toBe(false);
    }
  });

  it("mot_de_passe : longueur, adresse, ou erreur exacte", async () => {
    for (const c of V.mot_de_passe) {
      const a = W.normaliserAdresse(c.email);
      const got = await out(() => I.motDePasseValide(text(c.mdp_hex), a));
      expect(got, c.label).toEqual("error" in c ? { error: c.error } : { ok: undefined });
    }
  });
});

describe("compte.json : enveloppes et coffres, ouverts et refaits par WebCrypto", () => {
  it("enveloppes du mot de passe : 60 octets, AD = « SHH-CENV1 » ‖ h ‖ « mdp », KEK_mdp de deriver", async () => {
    expect(V.enveloppes.length).toBeGreaterThan(0);
    for (const c of V.enveloppes) {
      const d = V.deriver.find((x: { label: string }) => x.label === c.deriver);
      expect(d.kek_mdp).toBe(c.kek_mdp);
      const ad = new Uint8Array([...utf8("SHH-CENV1"), ...unhex(c.h), ...utf8("mdp")]);
      expect(hex(ad)).toBe(c.ad);
      const env = unhex(c.env_mdp);
      expect(env.length).toBe(60);
      expect(hex(await aesOpen(unhex(c.kek_mdp), ad, env))).toBe(c.k_compte);
      expect(hex(await aesSeal(unhex(c.kek_mdp), unhex(c.nonce), ad, unhex(c.k_compte)))).toBe(c.env_mdp);
      // Autre h : refusé.
      const autre = new Uint8Array([...utf8("SHH-CENV1"), ...new Uint8Array(16), ...utf8("mdp")]);
      await expect(aesOpen(unhex(c.kek_mdp), autre, env)).rejects.toThrow();
    }
  });

  for (const [section, magie, champ, cle] of [
    ["coffre_prive", "SHH-ACCT1", "k_compte", "k_prive"],
    ["coffre_profil", "SHH-PROF1", "s_profil", "k_profil"],
  ] as const) {
    it(`${section} : « ${magie} » ‖ gen ‖ nonce ‖ AES-256-GCM, clair au palier, clé tirée de ${champ}`, async () => {
      expect(V[section].length).toBeGreaterThanOrEqual(2);
      for (const c of V[section]) {
        const src = V.cles.find((x: Record<string, string>) => x[champ] === c[champ]);
        expect(c.cle).toBe(src[cle]);
        const key = unhex(c.cle);
        const gen = new Uint8Array(8);
        new DataView(gen.buffer).setBigUint64(0, BigInt(c.gen));
        const ad = new Uint8Array([...utf8(magie), ...unhex(c.h), ...gen]);
        expect(hex(ad)).toBe(c.ad);
        const json = unhex(c.json_hex);
        const clair = new Uint8Array(c.palier);
        new DataView(clair.buffer).setUint32(0, json.length);
        clair.set(json, 4);
        const blob = new Uint8Array([...utf8(magie), ...gen, ...(await aesSeal(key, unhex(c.nonce), ad, clair))]);
        expect(blob.length, c.label).toBe(c.blob_len);
        expect(sha(blob), c.label).toBe(c.blob_sha256);
        if (c.blob) expect(hex(blob)).toBe(c.blob);
        // Ouverture comme le site la fera : magie, gen, puis longueur et JSON.
        expect(new TextDecoder().decode(blob.slice(0, 9))).toBe(magie);
        expect(new DataView(blob.buffer, 9, 8).getBigUint64(0)).toBe(BigInt(c.gen));
        const p = await aesOpen(key, ad, blob.slice(17));
        expect(p.length).toBe(c.palier);
        const n = new DataView(p.buffer).getUint32(0);
        expect(hex(p.slice(4, 4 + n))).toBe(c.json_hex);
        expect(p.slice(4 + n).every((x) => x === 0)).toBe(true);
        JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(p.slice(4, 4 + n)));
      }
    });
  }
});
