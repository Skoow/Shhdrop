import { describe, expect, it } from "vitest";
import { edgeScroll, shiftFor, targetIndex } from "./reorder";

describe("reorder", () => {
  const centers = [50, 150, 250, 350];
  it("targetIndex : vers le bas, vers le haut, sur place", () => {
    expect(targetIndex(50, centers, 0)).toBe(0);
    expect(targetIndex(160, centers, 0)).toBe(1);
    expect(targetIndex(400, centers, 0)).toBe(3);
    expect(targetIndex(140, centers, 3)).toBe(1);
    expect(targetIndex(-20, centers, 3)).toBe(0);
    expect(targetIndex(255, centers, 2)).toBe(2);
  });
  it("edgeScroll : nul au milieu, croissant vers les bords, borné", () => {
    expect(edgeScroll(400, 800)).toBe(0);
    expect(edgeScroll(0, 800)).toBe(-14);
    expect(edgeScroll(-50, 800)).toBe(-14);
    expect(edgeScroll(800, 800)).toBe(14);
    expect(edgeScroll(770, 800)).toBeGreaterThan(0);
    expect(edgeScroll(770, 800)).toBeLessThan(14);
  });
  it("shiftFor : les lignes entre départ et arrivée s'écartent d'une hauteur", () => {
    expect([0, 1, 2, 3].map((i) => shiftFor(i, 0, 2, 60))).toEqual([0, -60, -60, 0]);
    expect([0, 1, 2, 3].map((i) => shiftFor(i, 3, 1, 60))).toEqual([0, 60, 60, 0]);
  });
});
