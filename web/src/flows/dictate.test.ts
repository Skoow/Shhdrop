import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PASSWORD_ALPHABET } from "../index";
import { dictate, dictateLabel } from "./dictate";

describe("mode dictée (S5)", () => {
  it("chaque caractère de l'alphabet généré a une étiquette non vide, distincte des autres", () => {
    for (const lang of ["fr", "en"] as const) {
      const labels = [...PASSWORD_ALPHABET].map((c) => dictateLabel(c, lang));
      for (const l of labels) expect(l.trim().length).toBeGreaterThan(1);
      expect(new Set(labels).size).toBe(labels.length);
    }
  });

  it("paires ambiguës : étiquettes distinctes", () => {
    for (const [a, b] of [["O", "0"], ["l", "I"], ["I", "1"], ["l", "1"], ["B", "8"], ["S", "5"], ["Z", "2"], ["G", "6"], ["s", "S"], ["c", "C"]])
      expect(dictateLabel(a!, "fr")).not.toBe(dictateLabel(b!, "fr"));
    // Épeler : alphabet radio (OTAN), casse dite à part.
    expect(dictateLabel("B", "fr")).toBe("B comme Bravo, majuscule");
    expect(dictateLabel("k", "fr")).toBe("k comme Kilo, minuscule");
    expect(dictateLabel("7", "fr")).toBe("7, chiffre");
    expect(dictateLabel("!", "fr")).toBe("! point d'exclamation");
    expect(dictate("aB7!", "en").map((x) => x.label)).toEqual(["a as in Alfa, lowercase", "B as in Bravo, uppercase", "7, digit", "! exclamation mark"]);
  });

  it("module local : aucune synthèse vocale ni requête réseau", () => {
    const src = readFileSync(new URL("./dictate.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/speechSynthesis|SpeechSynthesis|fetch\s*\(|XMLHttpRequest|sendBeacon|WebSocket/);
  });
});

describe("groupes de lecture", () => {
  it("par 4, séparateur visuel seulement ; recoller les groupes rend le mot de passe", async () => {
    const { groups } = await import("./dictate");
    expect(groups("K7m4Xq2p9r")).toEqual(["K7m4", "Xq2p", "9r"]);
    expect(groups("K7m4Xq2p9r").join("")).toBe("K7m4Xq2p9r");
    expect(groups("")).toEqual([]);
  });
});
