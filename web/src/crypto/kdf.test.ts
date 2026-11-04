import { describe, expect, it } from "vitest";
import { checkKdfParams, KDF_MAX, deriveAccess, deriveContent, deriveContentForCreate, hkdf, randomBytes, sha256, KDF_MIN } from "./kdf";
import type { KLien } from "./types";
import { b64u } from "./encoding";

const hex = (b: Uint8Array<ArrayBuffer>) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
const salt = new Uint8Array(16).fill(7);
const kLien = new Uint8Array(32).fill(1) as KLien;
const T = 30_000;

describe("hkdf", () => {
  it("reproduit le cas de test 3 de la RFC 5869", async () => {
    const okm = await hkdf(new Uint8Array(22).fill(0x0b), "", 42);
    expect(hex(okm)).toBe(
      "8da4e775a563c18f715f802a063c5a31b8a11f5c5ee1879ec3454e5f3c738d2d9d201395faa4b61a96c8",
    );
  });
  it("sort 32 octets par défaut", async () => {
    expect((await hkdf(kLien, "x")).length).toBe(32);
  });
});

describe("randomBytes / sha256", () => {
  it("longueur et aléa", () => {
    expect(randomBytes(32).length).toBe(32);
    expect(b64u(randomBytes(32))).not.toBe(b64u(randomBytes(32)));
  });
  it("sha256 de 'abc'", async () => {
    expect(hex(await sha256(new TextEncoder().encode("abc")))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});

describe("deriveAccess", () => {
  it("vAcces = sha256(kAcces), 32 octets, ne dépend que de kLien", async () => {
    const a = await deriveAccess(kLien);
    expect(a.kAcces.length).toBe(32);
    expect(hex(a.vAcces)).toBe(hex(await sha256(a.kAcces)));
    const b = await deriveAccess(new Uint8Array(kLien) as KLien);
    expect(hex(b.kAcces)).toBe(hex(a.kAcces));
    const c = await deriveAccess(new Uint8Array(32).fill(2) as KLien);
    expect(hex(c.kAcces)).not.toBe(hex(a.kAcces));
  });
});

describe("deriveContent", () => {
  it("refuse des paramètres trop faibles", async () => {
    await expect(deriveContent(kLien, "pw", salt, { ops: 2, mem: 67108864 })).rejects.toThrow(
      "paramètres KDF trop faibles",
    );
    await expect(deriveContent(kLien, "pw", salt, { ops: 3, mem: 33554432 })).rejects.toThrow(
      "paramètres KDF trop faibles",
    );
  });

  it("déterministe, sensible au mot de passe, clé non extractible", async () => {
    const a = await deriveContent(kLien, "motdepasse", salt, KDF_MIN);
    const b = await deriveContent(kLien, "motdepasse", salt, KDF_MIN);
    const c = await deriveContent(kLien, "motdepassf", salt, KDF_MIN);
    expect(hex(a.vPreuve)).toBe(hex(b.vPreuve));
    expect(hex(a.engagement)).toBe(hex(b.engagement));
    expect(hex(a.vPreuve)).not.toBe(hex(c.vPreuve));
    expect(hex(a.engagement)).not.toBe(hex(c.engagement));
    expect(a.kPreuve.length).toBe(32);
    expect(a.engagement.length).toBe(32);
    expect(hex(a.vPreuve)).toBe(hex(await sha256(a.kPreuve)));
    expect(a.kContenu.extractable).toBe(false);
    expect(a.kContenu.algorithm.name).toBe("AES-GCM");
    expect([...a.kContenu.usages].sort()).toEqual(["decrypt", "encrypt"]);
    await expect(crypto.subtle.exportKey("raw", a.kContenu)).rejects.toThrow();
  }, T);

  it("dépend de kLien et du sel", async () => {
    const a = await deriveContent(kLien, "pw", salt, KDF_MIN);
    const b = await deriveContent(new Uint8Array(32).fill(2) as KLien, "pw", salt, KDF_MIN);
    const c = await deriveContent(kLien, "pw", new Uint8Array(16).fill(8), KDF_MIN);
    expect(hex(b.vPreuve)).not.toBe(hex(a.vPreuve));
    expect(hex(c.vPreuve)).not.toBe(hex(a.vPreuve));
  }, T);

  it("NFC : formes composée et décomposée donnent la même clé", async () => {
    const composed = "Café-Été";
    const decomposed = "Café-Été";
    expect(composed).not.toBe(decomposed);
    const a = await deriveContent(kLien, composed, salt, KDF_MIN);
    const b = await deriveContent(kLien, decomposed, salt, KDF_MIN);
    expect(hex(a.vPreuve)).toBe(hex(b.vPreuve));
    expect(hex(a.engagement)).toBe(hex(b.engagement));
  }, T);
});

describe("bornes et tailles", () => {
  it("checkKdfParams : bornes exactes", () => {
    expect(() => checkKdfParams({ ...KDF_MIN })).not.toThrow();
    expect(() => checkKdfParams({ ...KDF_MAX })).not.toThrow();
    expect(() => checkKdfParams({ ops: 2, mem: KDF_MIN.mem })).toThrow("paramètres KDF trop faibles");
    expect(() => checkKdfParams({ ops: 3, mem: KDF_MIN.mem - 1 })).toThrow("paramètres KDF trop faibles");
    expect(() => checkKdfParams({ ops: 11, mem: 67108864 })).toThrow("paramètres KDF invalides");
    expect(() => checkKdfParams({ ops: 3, mem: 268435457 })).toThrow("paramètres KDF invalides");
    expect(() => checkKdfParams({ ops: 3.5, mem: 67108864 })).toThrow("paramètres KDF invalides");
    expect(() => checkKdfParams({ ops: 3, mem: 67108864.5 })).toThrow("paramètres KDF invalides");
    expect(() => checkKdfParams({ ops: NaN, mem: 67108864 })).toThrow("paramètres KDF invalides");
    expect(() => checkKdfParams({ ops: Infinity, mem: 67108864 })).toThrow("paramètres KDF invalides");
  });
  it("deriveContent rejette les paramètres hors bornes", async () => {
    for (const p of [
      { ops: 11, mem: 67108864 },
      { ops: 3, mem: 268435457 },
      { ops: 3.5, mem: 67108864 },
    ]) {
      await expect(deriveContent(kLien, "pw", salt, p)).rejects.toThrow("paramètres KDF invalides");
    }
  });
  it("tailles de kLien et de sel", async () => {
    const msg = "clé ou sel de taille invalide";
    await expect(deriveAccess(new Uint8Array(31) as KLien)).rejects.toThrow(msg);
    await expect(deriveAccess(new Uint8Array(33) as KLien)).rejects.toThrow(msg);
    await expect(deriveContent(new Uint8Array(31) as KLien, "pw", salt, KDF_MIN)).rejects.toThrow(msg);
    await expect(deriveContent(kLien, "pw", new Uint8Array(15), KDF_MIN)).rejects.toThrow(msg);
    await expect(deriveContent(kLien, "pw", new Uint8Array(17), KDF_MIN)).rejects.toThrow(msg);
  });
});

describe("mot de passe à la création et à l'ouverture (audit F9)", () => {
  it("deriveContent refuse le mot de passe vide", async () => {
    await expect(deriveContent(kLien, "", salt, KDF_MIN)).rejects.toThrow("mot_de_passe_vide");
  });
  it("deriveContentForCreate impose checkPassword et KDF_MIN", async () => {
    await expect(deriveContentForCreate(kLien, "", salt)).rejects.toThrow("mot_de_passe_trop_court");
    await expect(deriveContentForCreate(kLien, "court-court", salt)).rejects.toThrow("mot_de_passe_trop_court");
    await expect(deriveContentForCreate(kLien, "unbelievable", salt)).rejects.toThrow("mot_de_passe_trop_courant");
    const pw = "cheval-agrafe-pile-correct";
    const a = await deriveContentForCreate(kLien, pw, salt);
    const b = await deriveContent(kLien, pw, salt, KDF_MIN);
    expect(hex(a.kPreuve)).toBe(hex(b.kPreuve));
  });
});
