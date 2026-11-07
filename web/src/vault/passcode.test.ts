import { describe, expect, it } from "vitest";
import { generatePassword } from "../crypto/password";
import { BLOCK, CORES_PACKED } from "./blocklist";
import { PASSCODE_MIN_CHARS, checkPasscode } from "./passcode";
import { decodeCores } from "./weakpw";

describe("listes du coffre", () => {
  it("entrées de 10 caractères ou plus en minuscules ; cœurs en lettres a à z", () => {
    expect(PASSCODE_MIN_CHARS).toBe(10); // = scripts/gen-lists.mjs
    expect(BLOCK.length).toBeGreaterThan(50);
    expect(BLOCK.every((w) => w === w.toLowerCase() && [...w].length >= PASSCODE_MIN_CHARS)).toBe(true);
    const cores = decodeCores(CORES_PACKED);
    expect(cores.size).toBeGreaterThan(15000);
    for (const w of ["unbelievable", "motdepasse", "soleil", "password", "chocolat", "iloveyou"]) expect(cores.has(w), w).toBe(true);
  });
});

describe("checkPasscode (spec §27.2, règles de §31)", () => {
  it("trop court", () => expect(checkPasscode("court")).toEqual({ ok: false, reason: "trop_court" }));
  it("trop courant", () => {
    expect(checkPasscode("unbelievable")).toEqual({ ok: false, reason: "trop_courant" });
    expect(checkPasscode("UNBELIEVABLE")).toEqual({ ok: false, reason: "trop_courant" });
  });
  it("faibles de 10 caractères ou plus refusés, chacun avec sa raison (audit M1)", () => {
    expect(checkPasscode("aaaaaaaaaa")).toEqual({ ok: false, reason: "repetition" });
    expect(checkPasscode("1234567890")).toEqual({ ok: false, reason: "suite" });
    expect(checkPasscode("azertyuiop")).toEqual({ ok: false, reason: "clavier" });
    expect(checkPasscode("aB3!aB3!aB")).toEqual({ ok: false, reason: "repetition" });
    for (const pw of ["motdepasse12", "motdepasse", "MotDépasse1", "p@ssw0rd2024", "chocolat123", "Soleil2024!", "iloveyou12", "password12", "marseille13"])
      expect(checkPasscode(pw), pw).toEqual({ ok: false, reason: "trop_courant" });
  });
  it("code solide et mots de passe générés acceptés", () => {
    for (const pw of ["Tigre-Velours-92-Brume", "J'aime le thé vert à 7 h", "Lpz7#qeW9!vk", "cheval-agrafe", "aB3!cD5?eF"]) expect(checkPasscode(pw), pw).toEqual({ ok: true });
    for (let i = 0; i < 100; i++) expect(checkPasscode(generatePassword())).toEqual({ ok: true });
  });
  it("longueur en points de code NFC", () => {
    expect(checkPasscode("é".repeat(9))).toEqual({ ok: false, reason: "trop_court" });
    expect(checkPasscode("é".repeat(9))).toEqual({ ok: false, reason: "trop_court" }); // 18 points de code, NFC : 9
    expect(checkPasscode("éàçùœæâêîô")).toEqual({ ok: true });
    expect(checkPasscode("😀🐙🌵🍋🎈🧭🪁🦊🌙🔑")).toEqual({ ok: true });
    expect(checkPasscode("😀".repeat(9))).toEqual({ ok: false, reason: "trop_court" });
  });
});
