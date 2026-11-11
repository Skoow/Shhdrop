// Partie TypeScript gardée (pure.ts, décision B1 du contrôleur) : cas de l'ancien crypto/password.test.ts.
import { describe, expect, it, vi } from "vitest";
import { PASSWORD_ALPHABET, PASSWORD_FAMILIES, PASSWORD_LEN, PASSWORD_SPECIALS, generatePassword, isGeneratedPassword } from "./pure";

const FAMILIES = ["abcdefghkmnpqrtuvwxy", "ACDEFGHJKLMNPQRTUVWXY", "23456789", "!?@#$%&*+-=/()"];

// Nombre de compositions (n_min, n_maj, n_chiffres, n_symboles), chacune ≥ 1 et n_symboles = 3, et poids
// multinomial : sert à calculer l'espérance exacte d'apparition de chaque symbole sous la
// contrainte « 4 familles présentes, exactement 3 spéciaux » (le tirage recommencé n'est pas uniforme par symbole).
function exact(): { total: bigint; expectedPerSymbol: number[] } {
  const sizes = FAMILIES.map((f) => f.length);
  const fact = (n: number): bigint => (n <= 1 ? 1n : BigInt(n) * fact(n - 1));
  let total = 0n;
  const weighted = [0n, 0n, 0n, 0n];
  const L = PASSWORD_LEN;
  for (let a = 1; a <= L - 3; a++)
    for (let b = 1; a + b <= L - 2; b++)
      for (let c = 1; a + b + c <= L - 1; c++) {
        const d = L - a - b - c;
        if (d !== 3) continue;
        const n = [a, b, c, d];
        let w = fact(L);
        n.forEach((k, i) => (w = (w / fact(k)) * BigInt(sizes[i]!) ** BigInt(k)));
        total += w;
        n.forEach((k, i) => (weighted[i]! += w * BigInt(k)));
      }
  // Espérance d'occurrences d'UN symbole de la famille i dans un mot de passe.
  return { total, expectedPerSymbol: weighted.map((x, i) => Number(x) / Number(total) / sizes[i]!) };
}

describe("PASSWORD_ALPHABET (spec §31)", () => {
  it("63 symboles distincts, quatre familles ; ni ambigus (0 O o 1 l I i j) ni sosies (S s Z z B) ni espace ni caractère inhabituel", () => {
    expect(PASSWORD_ALPHABET).toBe("abcdefghkmnpqrtuvwxyACDEFGHJKLMNPQRTUVWXY23456789!?@#$%&*+-=/()");
    expect(new Set(PASSWORD_ALPHABET).size).toBe(63);
    expect(PASSWORD_FAMILIES).toEqual(FAMILIES);
    expect(FAMILIES.join("")).toBe(PASSWORD_ALPHABET);
    for (const c of "SsZzB0Oo1lIij|`'\" :;.,_~^[]{}<>\\") expect(PASSWORD_ALPHABET).not.toContain(c);
    // Caractères spéciaux : seulement ceux des claviers de symboles des téléphones.
    for (const c of FAMILIES[3]!) expect("!?@#$%&*+-=/()").toContain(c);
  });
  it("entropie réelle (≥ 1 minuscule, majuscule, chiffre, exactement 3 spéciaux) : 11 062 464 629 113 497 600 mots de passe, 2^63,26 ≥ 60 bits", () => {
    expect(PASSWORD_SPECIALS).toBe(3);
    const { total } = exact();
    expect(total).toBe(11_062_464_629_113_497_600n);
    // Inclusion-exclusion, indépendante du calcul par compositions : on place k = 3 spéciaux
    // (C(11,3) × 14^3), puis les 11 − k autres places couvrent les trois autres familles
    // (inclusion-exclusion sur les familles absentes, alphabet de 20 + 21 + 8 = 49 symboles).
    const sizes = FAMILIES.slice(0, 3).map((f) => BigInt(f.length));
    const fact = (n: number): bigint => (n <= 1 ? 1n : BigInt(n) * fact(n - 1));
    const binom = (n: number, k: number) => fact(n) / (fact(k) * fact(n - k));
    let ie = 0n;
    for (let k = 3; k <= 3; k++) {
      let rest = 0n;
      for (let m = 0; m < 8; m++) {
        const picked = sizes.filter((_, i) => (m >> i) & 1);
        const sign = (3 - picked.length) % 2 === 0 ? 1n : -1n;
        rest += sign * picked.reduce((a, b) => a + b, 0n) ** BigInt(11 - k);
      }
      ie += binom(11, k) * 14n ** BigInt(k) * rest;
    }
    expect(ie).toBe(total);
    // Tirage uniforme sur l'ensemble des mots de passe valides : entropie = log2(total).
    expect(Math.log2(Number(total))).toBeCloseTo(63.26, 2);
    expect(Math.log2(Number(total))).toBeGreaterThanOrEqual(60);
  });
});

describe("generatePassword", () => {
  it("10 000 tirages : 11 caractères de l'alphabet, 4 familles, exactement 3 spéciaux, fréquences dans [0,8 ; 1,2] × l'attendu", () => {
    const N = 10_000;
    const counts = new Map<string, number>();
    for (let i = 0; i < N; i++) {
      const p = generatePassword();
      expect([...p]).toHaveLength(PASSWORD_LEN);
      expect(PASSWORD_LEN).toBe(11);
      for (const c of p) {
        expect(PASSWORD_ALPHABET).toContain(c);
        counts.set(c, (counts.get(c) ?? 0) + 1);
      }
      for (const f of FAMILIES) expect([...p].some((c) => f.includes(c)), `${p} : famille ${f}`).toBe(true);
      expect([...p].filter((c) => FAMILIES[3]!.includes(c)).length, p).toBe(3);
      for (const c of "0O1lIoijSsZzB") expect(p).not.toContain(c);
    }
    const { expectedPerSymbol } = exact();
    FAMILIES.forEach((f, i) => {
      const want = expectedPerSymbol[i]! * N;
      for (const c of f) {
        const got = counts.get(c) ?? 0;
        expect(got, `« ${c} » : ${got} pour ${want.toFixed(0)} attendus`).toBeGreaterThanOrEqual(0.8 * want);
        expect(got).toBeLessThanOrEqual(1.2 * want);
      }
    });
  });

  it("tirage par crypto.getRandomValues et rejet (octet ≥ 252 jeté, puis octet % 63 : aucun biais) ; recommence sans les 4 familles ou sans exactement 3 spéciaux", () => {
    // Premier tirage : 22 × « a » (une seule famille) → refusé ; second : 4 familles mais deux
    // spéciaux seulement → refusé ; troisième : quatre spéciaux → refusé ; quatrième : 252 et
    // 255 jetés, puis a A 2 ! (112 → !) ? (63 → a, 83 → A, 104 → 2) a A.
    const pad = (a: number[]) => [...a, ...new Array(22 - a.length).fill(0)];
    const draws = [
      new Array(22).fill(0),
      pad([0, 20, 41, 49, 50]),
      pad([0, 20, 41, 49, 50, 51, 52]),
      pad([252, 0, 20, 255, 41, 49, 112, 50, 63, 83, 104, 0, 20]),
    ];
    const spy = vi.spyOn(crypto, "getRandomValues").mockImplementation(<T extends ArrayBufferView | null>(a: T): T => {
      (a as unknown as Uint8Array).set(draws.shift()!);
      return a;
    });
    try {
      expect(generatePassword()).toBe("aA2!!?aA2aA");
      expect(draws).toHaveLength(0);
    } finally {
      spy.mockRestore();
    }
  });
});

describe("isGeneratedPassword : seule la forme générée est acceptée (D41-15)", () => {
  it("accepte tout mot de passe généré, même ancien ou recopié caractère par caractère", () => {
    const first = generatePassword();
    for (let i = 0; i < 40; i++) expect(isGeneratedPassword(generatePassword())).toBe(true);
    expect(isGeneratedPassword(first)).toBe(true);
    expect(isGeneratedPassword([...first].join(""))).toBe(true);
    expect(isGeneratedPassword("aC3!cD5?#Fg")).toBe(true);
    expect(isGeneratedPassword("a!C?3#D5eFg")).toBe(true);
    expect(isGeneratedPassword("aC3!cD5?#F@")).toBe(false); // quatre spéciaux
  });
  it("refuse toute autre chaîne à la création : longueur, alphabet (ambigus, anciens spéciaux), familles, autre chose que 3 spéciaux", () => {
    for (const pw of ["", "aC3!cD5?#F", "aB3!cD5?#F", "aC3!cD5?#Fgh", "cheval-agrafe-pile", "aC3!cD5?#Fl", "aC3!cD5?#FO", "aC3!cD5?#F0", "aC3!cD5?#F1", "aC3!cD5?#Fi", "aC3!cD5?#Fj", "aC3!cD5?#FS", "aC3!cD5?#Fs", "aC3!cD5?#FZ", "aC3!cD5?#Fz", "aC3!cD5?#FB", "aC3!cD5?#F:", "aC3!cD5?#F;", "aC3!cD5?#F|", "abcdefghkmn", "aC3cD5eF7gh", "aC3!cD5?#F ", "aC3!cD5?eé2", "aC3!cD5?eFg", "aC3!cD5eFgh", "!?#abcdefgh"])
      expect(isGeneratedPassword(pw), pw).toBe(false);
  });
});
