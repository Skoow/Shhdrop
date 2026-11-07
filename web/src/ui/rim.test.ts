import { describe, expect, it } from "vitest";
import { notches, rimOffset } from "./rim";

describe("rimOffset (S3)", () => {
  it("décalage = 100 − 100 × restant / total", () => {
    expect(rimOffset(6 * 3600, 12 * 3600)).toBe(50);
    expect(rimOffset(12 * 3600, 12 * 3600)).toBe(0);
    expect(rimOffset(0, 3600)).toBe(100);
    expect(rimOffset(5000, 3600)).toBe(0); // borné
    expect(rimOffset(10, 0)).toBe(100);
    expect(rimOffset(Number.NaN, 10)).toBe(100);
  });
});

describe("notches", () => {
  it("une encoche par ouverture restante", () => {
    expect(notches(2)).toHaveLength(2);
    expect(notches(0)).toEqual([]);
    expect(notches(null)).toEqual([]);
    expect(notches(3)).toEqual([25, 50, 75]);
    expect(notches(40)).toHaveLength(10);
  });
});
