import { describe, expect, it } from "vitest";
import { middleEllipsis } from "./itemView";

describe("middleEllipsis (légendes des vignettes, scan UX)", () => {
  it("court : inchangé", () => expect(middleEllipsis("plage.jpg", 22)).toBe("plage.jpg"));
  it("long : début et fin gardés (l'extension reste lisible), 22 caractères au plus", () => {
    const s = middleEllipsis("photo-de-vacances-ete-2026-bretagne.jpg", 22);
    expect([...s]).toHaveLength(22);
    expect(s.startsWith("photo-de-vac")).toBe(true);
    expect(s.endsWith("bretagne.jpg".slice(-9))).toBe(true);
    expect(s).toContain("…");
  });
  it("coupe entre deux points de code, jamais au milieu d'un emoji", () => {
    const s = middleEllipsis("😀".repeat(30) + ".png", 12);
    expect([...s]).toHaveLength(12);
    expect(s).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
  });
});
