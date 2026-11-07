import { encode } from "uqr";
import { describe, expect, it } from "vitest";
import { QUIET, qrPath } from "./qr";

describe("qrPath (UI §9.5)", () => {
  it("lien de 80 caractères : taille attendue, chemin M h v z, autant de modules sombres que la matrice uqr", () => {
    const link = "https://shhdrop.example/#" + "A".repeat(43) + "x".repeat(80 - 25 - 43);
    expect(link).toHaveLength(80);
    const m = encode(link, { ecc: "M", border: 0 }).data;
    const { size, d } = qrPath(link);
    expect(size).toBe(m.length + 2 * QUIET);
    expect(m.length).toBe(37); // version 5 en correction M pour 80 octets
    expect(d).toMatch(/^[Mhvz0-9 -]+$/);
    const dark = m.flat().filter(Boolean).length;
    expect((d.match(/M/g) ?? []).length).toBe(dark);
  });
});
