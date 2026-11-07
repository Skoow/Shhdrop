import { describe, expect, it } from "vitest";
import { cores, decodeCores, encodeCores, normalizeForList, patternReason, weakReason } from "./weakpw";
import { generatePassword } from "./password";

const none = { block: new Set<string>(), cores: new Set<string>() };

describe("patternReason", () => {
  it.each([
    ["aaaaaaaaaa", "repetition"],
    ["ababababab", "repetition"],
    ["abcabcabcabc", "repetition"],
    ["😀".repeat(10), "repetition"],
    ["1234567890", "suite"],
    ["0987654321", "suite"],
    ["abcdefghij", "suite"],
    ["2468013579", "suite"],
    ["azertyuiop", "clavier"],
    ["qwertyuiop", "clavier"],
    ["AZERTY1234", "clavier"],
    ["asdfghjkl;", "clavier"],
    ["1q2w3e4r5t", "clavier"],
    ["1qaz2wsx3edc", "clavier"],
    ["qsdfghjklm", "clavier"],
  ])("%s → %s", (pw, why) => expect(patternReason(pw)).toBe(why));

  it.each(["Tigre-Velours-92-Brume", "correct horse battery staple", "J'aime le thé vert à 7 h", "éàçùœæâêîô"])("%s : aucune règle de forme", (pw) =>
    expect(patternReason(pw)).toBeNull(),
  );

  it("mots de passe tirés au hasard : presque jamais refusés (mesuré : 14 sur 400 000)", () => {
    // Un mot de passe généré est accepté de toute façon (liste des récents) ; ceci borne les
    // refus d'un mot de passe aléatoire venu d'ailleurs (gestionnaire de mots de passe).
    let refused = 0;
    for (let i = 0; i < 2000; i++) if (patternReason(generatePassword()) !== null) refused++;
    expect(refused).toBeLessThanOrEqual(2);
  });
  it("répétition comptée casse comprise", () => expect(patternReason("TtTkq9#Lm2")).toBeNull());
});

describe("cœurs de dictionnaire", () => {
  it("chiffres et symboles des bords retirés, accents et séparateurs aussi, leet lu", () => {
    expect(cores("motdepasse12")).toEqual(["motdepasse"]);
    expect(cores("MotDePasse!")).toEqual(["motdepasse"]);
    expect(cores("mot de passe 2024")).toEqual(["motdepasse"]);
    expect(cores("2024Soleil")).toEqual(["soleil"]);
    expect(cores("p@ssw0rd123")).toEqual(["password"]);
    expect(cores("b1ue")).toEqual(["biue", "blue"]);
    expect(cores("12ab34")).toEqual([]);
  });
  it("normalizeForList : minuscules, sans accents", () => expect(normalizeForList("MotDépasse")).toBe("motdepasse"));
  it("codage compact aller-retour", () => {
    const list = ["abeille", "abricot", "abricots", "motdepasse", "motdepassee", "soleil", "zzzzzzzzzzzzzzzz", "zzzzzzzzzzzzzzzzz"];
    const enc = encodeCores(list);
    expect([...decodeCores(enc)]).toEqual(list);
    expect(() => encodeCores(["b", "a"])).toThrow();
    expect(() => encodeCores(["a1"])).toThrow();
  });
});

describe("weakReason", () => {
  const lists = { block: new Set(["ilovemydog"]), cores: new Set(["motdepasse", "soleil"]) };
  it("liste entière et cœurs", () => {
    expect(weakReason("ILoveMyDog", lists)).toBe("trop_courant");
    expect(weakReason("motdepasse12", lists)).toBe("trop_courant");
    expect(weakReason("Soleil-2024!", lists)).toBe("trop_courant");
    expect(weakReason("Soleil-Lune-Mer", lists)).toBeNull();
  });
  it("règles de forme avant les listes", () => expect(weakReason("aaaaaaaaaa", none)).toBe("repetition"));
});
