import { describe, expect, it } from "vitest";
import { WORDS } from "./wordlist-eff";
import { BLOCK, CORES_PACKED } from "./blocklist";
import { decodeCores } from "./weakpw";
import { generatePassword } from "./password";
import { PW_MIN_CHARS, checkPassword, generatePassphrase, generatePassphraseWords, uniformIndex } from "./passphrase";

describe("listes", () => {
  it("WORDS : 7776 mots en [a-z-]", () => {
    expect(WORDS.length).toBe(7776);
    expect(WORDS.every((w) => /^[a-z-]+$/.test(w))).toBe(true);
  });
  it("listes : entrées de 10 caractères ou plus en minuscules ; cœurs en lettres a à z", () => {
    expect(BLOCK.length).toBeGreaterThan(50);
    expect(BLOCK.every((w) => w === w.toLowerCase() && [...w].length >= PW_MIN_CHARS)).toBe(true);
    const cores = decodeCores(CORES_PACKED);
    expect(cores.size).toBeGreaterThan(15000);
    for (const w of ["unbelievable", "motdepasse", "soleil", "password", "chocolat", "iloveyou"]) expect(cores.has(w), w).toBe(true);
  });
});

describe("generatePassphrase", () => {
  it("format et appartenance (mots tirés, pas de découpage sur « - » car certains mots en contiennent)", () => {
    for (let i = 0; i < 50; i++) {
      const words = generatePassphraseWords();
      expect(words).toHaveLength(4);
      expect(words.every((w) => WORDS.includes(w))).toBe(true);
    }
    expect(generatePassphrase()).toMatch(/^[a-z-]+(-[a-z-]+){3}$/);
  });
  it("generatePassphrase = mots joints par « - », nombre paramétrable", () => {
    expect(generatePassphrase(6).length).toBeGreaterThan(6 * 2);
    expect(generatePassphraseWords(6)).toHaveLength(6);
  });
  it("deux phrases successives diffèrent", () => {
    expect(generatePassphrase()).not.toBe(generatePassphrase());
  });
});

describe("uniformIndex", () => {
  const fake = (...vals: number[]) => {
    let i = 0;
    return (n: number) => {
      expect(n).toBe(4);
      const dv = new DataView(new ArrayBuffer(4));
      dv.setUint32(0, vals[i++]!);
      return new Uint8Array(dv.buffer);
    };
  };
  it("rejette les tirages >= floor(2^32/7776)*7776", () => {
    expect(uniformIndex(7776, fake(0xffffffff, 0x00000005))).toBe(5);
  });
  it("renvoie le reste modulo max pour un tirage accepté", () => {
    expect(uniformIndex(7776, fake(7776 * 3 + 42))).toBe(42);
  });
  it("valeurs hors bornes refusées", () => {
    expect(() => uniformIndex(0)).toThrow();
    expect(() => uniformIndex(2 ** 32 + 1)).toThrow();
    expect(() => uniformIndex(1.5)).toThrow();
  });
  it("resultat toujours dans [0,max)", () => {
    for (let i = 0; i < 200; i++) expect(uniformIndex(7)).toBeLessThan(7);
  });
});

describe("checkPassword", () => {
  it("trop court", () => expect(checkPassword("court")).toEqual({ ok: false, reason: "trop_court" }));
  it("trop courant", () => {
    expect(checkPassword("unbelievable")).toEqual({ ok: false, reason: "trop_courant" });
    expect(checkPassword("UNBELIEVABLE")).toEqual({ ok: false, reason: "trop_courant" });
  });
  it("faibles de 10 caractères ou plus refusés, chacun avec sa raison (audit M1)", () => {
    expect(checkPassword("aaaaaaaaaa")).toEqual({ ok: false, reason: "repetition" });
    expect(checkPassword("1234567890")).toEqual({ ok: false, reason: "suite" });
    expect(checkPassword("azertyuiop")).toEqual({ ok: false, reason: "clavier" });
    for (const pw of ["motdepasse12", "motdepasse", "MotDépasse1", "p@ssw0rd2024", "chocolat123", "Soleil2024!", "iloveyou12", "password12", "marseille13"])
      expect(checkPassword(pw), pw).toEqual({ ok: false, reason: "trop_courant" });
  });
  it("mot de passe saisi solide et mots de passe générés acceptés", () => {
    for (const pw of ["Tigre-Velours-92-Brume", "J'aime le thé vert à 7 h", "Lpz7#qeW9!vk"]) expect(checkPassword(pw), pw).toEqual({ ok: true });
    for (let i = 0; i < 100; i++) expect(checkPassword(generatePassword())).toEqual({ ok: true });
  });
  it("phrase générée acceptée", () => {
    for (let i = 0; i < 100; i++) expect(checkPassword(generatePassphrase())).toEqual({ ok: true });
  });
  it("longueur en points de code NFC", () => {
    expect(checkPassword("\u00e9".repeat(9))).toEqual({ ok: false, reason: "trop_court" });
    expect(checkPassword("e\u0301".repeat(9))).toEqual({ ok: false, reason: "trop_court" }); // 18 points de code, NFC : 9
    expect(checkPassword("éàçùœæâêîô")).toEqual({ ok: true });
    expect(checkPassword("😀🐙🌵🍋🎈🧭🪁🦊🌙🔑")).toEqual({ ok: true });
    expect(checkPassword("😀".repeat(9))).toEqual({ ok: false, reason: "trop_court" });
  });
});

describe("phrases de passe trop courtes (audit F9)", () => {
  it("moins de 4 mots : refusé", () => {
    for (const n of [0, 1, 2, 3, 3.5, NaN]) {
      expect(() => generatePassphrase(n), String(n)).toThrow(RangeError);
      expect(() => generatePassphraseWords(n), String(n)).toThrow(RangeError);
    }
    expect(generatePassphraseWords(4)).toHaveLength(4);
  });
});

