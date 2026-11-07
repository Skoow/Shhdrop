import { describe, expect, it } from "vitest";
import { midSplit } from "./midname";

describe("midSplit : ellipse au milieu, la fin du nom et l'extension restent visibles", () => {
  it("nom court : rien n'est mis de côté", () => {
    expect(midSplit("photo")).toEqual({ head: "photo", tail: "" });
    expect(midSplit("rapport-2026")).toEqual({ head: "rapport-2026", tail: "" });
  });
  it("garde le dernier mot (espace, tiret, souligné) quand il est court", () => {
    expect(midSplit("Coucher de soleil sur la plage en août 2026")).toEqual({ head: "Coucher de soleil sur la plage en août", tail: " 2026" });
    expect(midSplit("schema-architecture-reseau-final")).toEqual({ head: "schema-architecture-reseau", tail: "-final" });
  });
  it("sinon les 6 derniers caractères ; jamais un caractère coupé en deux (emoji, accents composés)", () => {
    expect(midSplit("IMG20261104123456789")).toEqual({ head: "IMG20261104123", tail: "456789" });
    const r = midSplit("vacances👨‍👩‍👧famille-ensemble");
    expect(r.head + r.tail).toBe("vacances👨‍👩‍👧famille-ensemble");
  });
  it("tête + queue = nom complet, toujours", () => {
    for (const n of ["a b c d e f g h i j k l", "x".repeat(80), "Enregistrement de la réunion du conseil"]) {
      const r = midSplit(n);
      expect(r.head + r.tail).toBe(n);
    }
  });
});

describe("midSplitName", () => {
  it("l'extension reste avec la queue", async () => {
    const { midSplitName } = await import("./midname");
    expect(midSplitName("Contrat de location appartement signé.pdf")).toEqual({ head: "Contrat de location appartement", tail: " signé.pdf" });
    expect(midSplitName("court.txt")).toEqual({ head: "court", tail: ".txt" });
  });
});
