import { describe, expect, it } from "vitest";
import { transferSeconds } from "./estimate";

describe("temps estimés", () => {
  it("octets × surcoût du chiffrement ÷ débit mesuré ; rien à transférer → 0", () => {
    expect(transferSeconds(1_000_000, 1_000_000)).toBeCloseTo(1.000244, 5);
    expect(transferSeconds(25_000_000, 2_500_000)).toBeGreaterThan(10);
    expect(transferSeconds(0, 1_000_000)).toBe(0);
    expect(transferSeconds(100, 0)).toBe(0);
  });
});
