import { describe, expect, it, vi } from "vitest";
import { PASSWORD_ALPHABET, PASSWORD_FAMILIES, PASSWORD_LEN, generatePassword, isGeneratedPassword } from "./password";

const FAMILIES = ["abcdefghkmnpqrtuvwxy", "ACDEFGHJKLMNPQRTUVWXY", "23456789", "!?@#$%&*+-=/()"];

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
  it("63 symboles distincts, quatre familles ; ni ambigus (0 O o 1 l I i j) ni sosies (S s Z z B) ni espace ni caractère inhabituel", () => {
    expect(PASSWORD_ALPHABET).toBe("abcdefghkmnpqrtuvwxyACDEFGHJKLMNPQRTUVWXY23456789!?@#$%&*+-=/()");
    expect(new Set(PASSWORD_ALPHABET).size).toBe(63);
    expect(PASSWORD_FAMILIES).toEqual(FAMILIES);
    expect(FAMILIES.join("")).toBe(PASSWORD_ALPHABET);
    for (const c of "SsZzB0Oo1lIij|`'\" :;.,_~^[]{}<>\\") expect(PASSWORD_ALPHABET).not.toContain(c);
    // Caractères spéciaux : seulement ceux des claviers de symboles des téléphones.
    for (const c of FAMILIES[3]!) expect("!?@#$%&*+-=/()").toContain(c);
  });
  it("entropie réelle (après la contrainte des 4 familles) : 43 300 477 597 441 680 000 mots de passe, 2^65,23 ≥ 60 bits", () => {
    const { total } = exact();
    expect(total).toBe(43_300_477_597_441_680_000n);
    // Inclusion-exclusion, indépendante du calcul par compositions.
    const sizes = FAMILIES.map((f) => BigInt(f.length));
    let ie = 0n;
    for (let m = 0; m < 16; m++) {
      const picked = sizes.filter((_, i) => (m >> i) & 1);
      const sign = (4 - picked.length) % 2 === 0 ? 1n : -1n;
      ie += sign * picked.reduce((a, b) => a + b, 0n) ** 11n;
    }
    expect(ie).toBe(total);
    // Tirage uniforme sur l'ensemble des mots de passe valides : entropie = log2(total).
    expect(Math.log2(Number(total))).toBeCloseTo(65.23, 2);
    expect(Math.log2(Number(total))).toBeGreaterThanOrEqual(60);
  });
});

describe("generatePassword", () => {
  it("10 000 tirages : 11 caractères de l'alphabet, 4 familles, fréquences dans [0,8 ; 1,2] × l'attendu", () => {
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

  it("tirage par crypto.getRandomValues et rejet (octet ≥ 252 jeté, puis octet % 63 : aucun biais) ; recommence sans les 4 familles", () => {
    // Premier tirage : 22 × « a » (une seule famille) → refusé ; second : 252 et 255 jetés,
    // puis a A 2 ! (63 → a, 83 → A, 104 → 2, 112 → !) a A 2.
    const pad = (a: number[]) => [...a, ...new Array(22 - a.length).fill(0)];
    const draws = [new Array(22).fill(0), pad([252, 0, 20, 255, 41, 49, 63, 83, 104, 112, 0, 20, 41])];
    const spy = vi.spyOn(crypto, "getRandomValues").mockImplementation(<T extends ArrayBufferView | null>(a: T): T => {
      (a as unknown as Uint8Array).set(draws.shift()!);
      return a;
    });
    try {
      expect(generatePassword()).toBe("aA2!aA2!aA2");
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
    expect(isGeneratedPassword("aC3!cD5?eFg")).toBe(true);
  });
  it("refuse toute autre chaîne à la création : longueur, alphabet (ambigus, anciens spéciaux), familles", () => {
    for (const pw of ["", "aC3!cD5?eF", "aB3!cD5?eF", "aC3!cD5?eFgh", "cheval-agrafe-pile", "aC3!cD5?eFl", "aC3!cD5?eFO", "aC3!cD5?eF0", "aC3!cD5?eF1", "aC3!cD5?eFi", "aC3!cD5?eFj", "aC3!cD5?eFS", "aC3!cD5?eFs", "aC3!cD5?eFZ", "aC3!cD5?eFz", "aC3!cD5?eFB", "aC3!cD5?eF:", "aC3!cD5?eF;", "aC3!cD5?eF|", "abcdefghkmn", "aC3cD5eF7gh", "aC3!cD5?eF ", "aC3!cD5?eé2"])
      expect(isGeneratedPassword(pw), pw).toBe(false);
  });
});
