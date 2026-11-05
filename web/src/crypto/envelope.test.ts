import { createDecipheriv } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { accessKeys, contentKeys, contentKeysChecked, ENVELOPE_LEN, newSeed, open, seal, shareId, type Seed } from "./envelope";
import { deriveAccess } from "./kdf";
import type { KLien, KMdp } from "./types";

const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");
const unhex = (s: string) => new Uint8Array(Buffer.from(s, "hex"));
const fill = (n: number, v: number) => new Uint8Array(n).fill(v);

// Vecteurs fixes calculés par un script Node indépendant (node:crypto : hkdfSync avec un sel
// vide, createHmac, createHash, createCipheriv aes-256-gcm), pas par le code testé :
//   K_lien = 32 × 0x01, K_mdp = 32 × 0x02, R = 32 × 0x03, nonce de E = 12 × 0x09.
const V = {
  id: "934a65e8f83c4367f2c9e06e57102838",
  kAcces: "18554f2b3ad9a1d610c2a99ef25a76805db4e2d92893390db2b5ab3795d7af39",
  kEnv: "0f47dc9237440aa7751d694831720ad23e9919c93cf680a4dbecf3ce96788c5d",
  kPreuve: "f992bca7aaa9f0b869d9f19b4d51b5b4f0e1f39a5271351cef97849131b51987",
  vPreuve: "d337b5181afdd7df70e0e884a3658b3bb04422ff695fc154839daa502becef86",
  kContenu: "ef08e342beeeb7c47a5df739869634808022487f6ff30d240b54cb218d1e4bff",
  engagement: "41c12c1f2f51bdaf632eb1d8d7d4aa0f78cdf11fa08fab30c4863f85afc57393",
  header: "5348483202000000000000000000000041c12c1f2f51bdaf632eb1d8d7d4aa0f78cdf11fa08fab30c4863f85afc57393",
  E:
    "090909090909090909090909a82bff94be2636db6e821fb69e6fa475753c587dc8f0a75a579a9cf7a16099ff" +
    "7d0db85e8dc8a180255de6e1d989f940",
};

const kLien = fill(32, 1) as KLien;
const kMdp = fill(32, 2) as KMdp;
const R = () => fill(32, 3) as Seed;
const header = unhex(V.header);

describe("vecteurs fixes (script Node indépendant)", () => {
  it("shareId, K_accès, V_preuve, C_engagement", async () => {
    expect(hex(await shareId(kLien))).toBe(V.id);
    expect(hex((await deriveAccess(kLien)).kAcces)).toBe(V.kAcces);
    const a = await accessKeys(kLien, kMdp);
    expect(hex(a.kPreuve)).toBe(V.kPreuve);
    expect(hex(a.vPreuve)).toBe(V.vPreuve);
    expect(hex((await contentKeys(R())).engagement)).toBe(V.engagement);
  });

  it("open déballe une enveloppe fabriquée par Node (même K_env, mêmes données authentifiées)", async () => {
    const { kEnv } = await accessKeys(kLien, kMdp);
    expect(hex(await open(kEnv, unhex(V.E), unhex(V.id), header))).toBe(hex(R()));
  });

  it("seal produit une enveloppe que Node déballe avec la K_env calculée par Node", async () => {
    const { kEnv } = await accessKeys(kLien, kMdp);
    const e = await seal(kEnv, R(), unhex(V.id), header);
    expect(e.length).toBe(60);
    const d = createDecipheriv("aes-256-gcm", unhex(V.kEnv), e.subarray(0, 12));
    d.setAAD(Buffer.concat([Buffer.from("shhdrop/v2/enveloppe"), unhex(V.id), header]));
    d.setAuthTag(e.subarray(44));
    expect(hex(Buffer.concat([d.update(e.subarray(12, 44)), d.final()]))).toBe(hex(R()));
  });

  it("K_contenu = HKDF(R, « shhdrop/v2/contenu ») : Node déchiffre ce que WebCrypto chiffre", async () => {
    const { kContenu } = await contentKeys(R());
    const iv = fill(12, 0);
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, kContenu, fill(5, 0x41)));
    const d = createDecipheriv("aes-256-gcm", unhex(V.kContenu), iv);
    d.setAuthTag(ct.subarray(5));
    expect(Buffer.concat([d.update(ct.subarray(0, 5)), d.final()]).toString()).toBe("AAAAA");
  });
});

describe("seal / open", () => {
  const id = unhex(V.id);
  it("aller-retour, E de 60 octets, nonces différents pour deux seal du même R", async () => {
    const { kEnv } = await accessKeys(kLien, kMdp);
    const e1 = await seal(kEnv, R(), id, header);
    const e2 = await seal(kEnv, R(), id, header);
    expect(e1.length).toBe(ENVELOPE_LEN);
    expect(ENVELOPE_LEN).toBe(60);
    expect(hex(e1.subarray(0, 12))).not.toBe(hex(e2.subarray(0, 12)));
    expect(hex(await open(kEnv, e1, id, header))).toBe(hex(R()));
    expect(hex(await open(kEnv, e2, id, header))).toBe(hex(R()));
  });

  it("même erreur paquet_corrompu : autre id, autre en-tête, octet de E modifié, autre mot de passe, E tronquée ou allongée", async () => {
    const { kEnv } = await accessKeys(kLien, kMdp);
    const e = await seal(kEnv, R(), id, header);
    const other = (await accessKeys(kLien, fill(32, 4) as KMdp)).kEnv; // autre K_mdp = autre mot de passe
    const otherLink = (await accessKeys(fill(32, 5) as KLien, kMdp)).kEnv;
    const otherId = id.slice();
    otherId[0]! ^= 1;
    const otherHeader = header.slice();
    otherHeader[47]! ^= 1;
    const cases: [CryptoKey, Uint8Array, Uint8Array, Uint8Array][] = [
      [kEnv, e, otherId, header],
      [kEnv, e, id, otherHeader],
      [other, e, id, header],
      [otherLink, e, id, header],
      [kEnv, e.subarray(0, 59), id, header],
      [kEnv, new Uint8Array([...e, 0]), id, header],
      [kEnv, e, id.subarray(0, 15), header],
      [kEnv, e, id, header.subarray(0, 47)],
    ];
    for (let i = 0; i < e.length; i++) {
      const t = e.slice();
      t[i]! ^= 0x80;
      cases.push([kEnv, t, id, header]);
    }
    for (const [k, ee, ii, hh] of cases) await expect(open(k, ee, ii, hh)).rejects.toThrow(/^paquet_corrompu$/);
  });

  it("enveloppe d'un autre partage (même lien et mot de passe, autre R) : déballe l'autre R, refusée par l'engagement", async () => {
    // Le serveur échange E entre deux partages : les données authentifiées (id, en-tête) l'empêchent.
    const { kEnv } = await accessKeys(kLien, kMdp);
    const r2 = newSeed();
    const h2 = new Uint8Array([...header.subarray(0, 16), ...(await contentKeys(r2)).engagement]);
    const e2 = await seal(kEnv, r2, id, h2);
    await expect(open(kEnv, e2, id, header)).rejects.toThrow(/^paquet_corrompu$/);
  });
});

describe("contentKeys / contentKeysChecked", () => {
  it("K_contenu non extractible, AES-GCM ; R non modifiée", async () => {
    const r = R();
    const k = await contentKeys(r);
    expect(k.kContenu.extractable).toBe(false);
    expect(k.kContenu.algorithm.name).toBe("AES-GCM");
    expect((k.kContenu.algorithm as AesKeyAlgorithm).length).toBe(256);
    expect(k.engagement.length).toBe(32);
    expect(hex(r)).toBe(hex(R()));
  });
  it("K_env non extractible", async () => {
    const { kEnv } = await accessKeys(kLien, kMdp);
    expect(kEnv.extractable).toBe(false);
    expect((kEnv.algorithm as AesKeyAlgorithm).length).toBe(256);
  });
  it("engagement faux (un bit, autre R, longueur) → paquet_corrompu ; juste → mêmes clés", async () => {
    const good = unhex(V.engagement);
    expect(hex((await contentKeysChecked(R(), good)).engagement)).toBe(V.engagement);
    const bad = good.slice();
    bad[0]! ^= 1;
    await expect(contentKeysChecked(R(), bad)).rejects.toThrow(/^paquet_corrompu$/);
    await expect(contentKeysChecked(newSeed(), good)).rejects.toThrow(/^paquet_corrompu$/);
    await expect(contentKeysChecked(R(), good.subarray(0, 31))).rejects.toThrow(/^paquet_corrompu$/);
  });
  it("vérifie l'engagement avec crypto.subtle.verify (pas de comparaison maison)", async () => {
    const spy = vi.spyOn(crypto.subtle, "verify");
    await contentKeysChecked(R(), unhex(V.engagement));
    expect(spy).toHaveBeenCalledWith("HMAC", expect.anything(), expect.anything(), expect.anything());
    spy.mockRestore();
  });
});

describe("accessKeys", () => {
  it("K_maître et K_lien ‖ K_mdp mis à zéro ; K_lien et K_mdp inchangés", async () => {
    const zeroed: Uint8Array[] = [];
    const orig = crypto.subtle.importKey.bind(crypto.subtle);
    const spy = vi.spyOn(crypto.subtle, "importKey").mockImplementation(((f: KeyFormat, k: BufferSource, ...rest: unknown[]) => {
      if (k instanceof Uint8Array) zeroed.push(k);
      return (orig as (...a: unknown[]) => Promise<CryptoKey>)(f, k, ...rest);
    }) as typeof crypto.subtle.importKey);
    const kl = fill(32, 1) as KLien, km = fill(32, 2) as KMdp;
    await accessKeys(kl, km);
    spy.mockRestore();
    // Matières importées : K_lien ‖ K_mdp (64 o), K_maître (HKDF ×2), K_env : toutes à zéro ensuite.
    const own = zeroed.filter((k) => k !== kl && k !== km);
    expect(own.some((k) => k.length === 64)).toBe(true);
    for (const k of own) expect(k.every((x) => x === 0), `longueur ${k.length}`).toBe(true);
    expect(hex(kl)).toBe(hex(fill(32, 1)));
    expect(hex(km)).toBe(hex(fill(32, 2)));
  });
  it("tailles refusées", async () => {
    await expect(accessKeys(fill(31, 1) as KLien, kMdp)).rejects.toThrow();
    await expect(accessKeys(kLien, fill(31, 1) as KMdp)).rejects.toThrow();
    await expect(shareId(fill(33, 1) as KLien)).rejects.toThrow();
  });
});

describe("étiquettes", () => {
  it("toutes préfixées shhdrop/v2/ ; aucune étiquette v1", () => {
    const srcs = ["./envelope.ts", "./kdf.ts", "./container.ts"].map((f) => readFileSync(new URL(f, import.meta.url), "utf8"));
    const labels = srcs.flatMap((s) => [...s.matchAll(/"shhdrop\/[^"]*"/g)].map((m) => m[0]));
    expect(labels.length).toBeGreaterThanOrEqual(7);
    for (const l of labels) expect(l).toMatch(/^"shhdrop\/v2\/[a-z]+"$/);
    for (const s of srcs) expect(s).not.toContain("shhdrop/v1/");
  });
});
