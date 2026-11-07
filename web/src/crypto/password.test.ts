import { describe, expect, it, vi } from "vitest";
import { PASSWORD_ALPHABET, PASSWORD_FAMILIES, PASSWORD_LEN, generatePassword, isGeneratedPassword } from "./password";

const FAMILIES = ["abcdefghijkmnpqrstuvwxyz", "ABCDEFGHJKLMNPQRSTUVWXYZ", "23456789", "!#$%+=?@&*-/:;()"];

// Nombre de compositions (n_min, n_maj, n_chiffres, n_symboles), chacune ≥ 1, et poids
// multinomial : sert à calculer l'espérance exacte d'apparition de chaque symbole sous la
// contrainte « 4 familles présentes » (le tirage recommencé n'est pas uniforme par symbole).
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
        if (d < 1) continue;
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
  it("72 symboles distincts, quatre familles, aucun caractère ambigu ; l'ancien alphabet (64) est inclus", () => {
    expect(PASSWORD_ALPHABET).toBe("abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!#$%+=?@&*-/:;()");
    expect(new Set(PASSWORD_ALPHABET).size).toBe(72);
    for (const c of "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!#$%+=?@") expect(PASSWORD_ALPHABET).toContain(c);
    expect(PASSWORD_FAMILIES).toEqual(FAMILIES);
    expect(FAMILIES.join("")).toBe(PASSWORD_ALPHABET);
    for (const c of "0O1lIo|`'\" ") expect(PASSWORD_ALPHABET).not.toContain(c);
  });
  it("nombre exact de mots de passe : 2 245 913 002 660 331 520 (2^60,96) : au moins 60 bits d'entropie", () => {
    const { total } = exact();
    expect(total).toBe(2_245_913_002_660_331_520n);
    expect(Math.log2(Number(total))).toBeCloseTo(60.96, 2);
    expect(Math.log2(Number(total))).toBeGreaterThanOrEqual(60);
  });
});

describe("generatePassword", () => {
  it("10 000 tirages : 10 caractères de l'alphabet, 4 familles, fréquences dans [0,8 ; 1,2] × l'attendu", () => {
    const N = 10_000;
    const counts = new Map<string, number>();
    for (let i = 0; i < N; i++) {
      const p = generatePassword();
      expect([...p]).toHaveLength(PASSWORD_LEN);
      expect(PASSWORD_LEN).toBe(10);
      for (const c of p) {
        expect(PASSWORD_ALPHABET).toContain(c);
        counts.set(c, (counts.get(c) ?? 0) + 1);
      }
      for (const f of FAMILIES) expect([...p].some((c) => f.includes(c)), `${p} : famille ${f}`).toBe(true);
      for (const c of "0O1lIo") expect(p).not.toContain(c);
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

  it("tirage par crypto.getRandomValues et rejet (octet ≥ 216 jeté, puis octet % 72 : aucun biais) ; recommence sans les 4 familles", () => {
    // Premier tirage : 20 × « a » (une seule famille) → refusé ; second : 216 et 255 jetés,
    // puis a A 2 ! (72 → a, 168 → A, 120 → 2, 128 → !) a A.
    const pad = (a: number[]) => [...a, ...new Array(20 - a.length).fill(0)];
    const draws = [new Array(20).fill(0), pad([216, 0, 24, 255, 48, 56, 72, 168, 120, 128, 0, 24])];
    const spy = vi.spyOn(crypto, "getRandomValues").mockImplementation(<T extends ArrayBufferView | null>(a: T): T => {
      (a as unknown as Uint8Array).set(draws.shift()!);
      return a;
    });
    try {
      expect(generatePassword()).toBe("aA2!aA2!aA");
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
    expect(isGeneratedPassword("aB3!cD5?eF")).toBe(true);
  });
  it("refuse toute autre chaîne : longueur, alphabet (ambigus l, o, I, O, 0, 1), familles", () => {
    for (const pw of ["", "aB3!cD5?e", "aB3!cD5?eFg", "cheval-agrafe-pile", "aB3!cD5?el", "aB3!cD5?eO", "aB3!cD5?e0", "aB3!cD5?e1", "aB3!cD5?e|", "abcdefghij", "aB3cD5eF7g", "aB3!cD5?e ", "aB3!cD5?é2"])
      expect(isGeneratedPassword(pw), pw).toBe(false);
  });
});
