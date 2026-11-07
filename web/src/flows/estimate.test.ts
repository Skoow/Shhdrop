import { describe, expect, it } from "vitest";
import { ASSUMED_DOWN_BPS, ASSUMED_UP_BPS, transferSeconds } from "./estimate";

describe("temps estimés", () => {
  it("octets × surcoût du chiffrement ÷ débit ; rien à transférer → 0", () => {
    expect(transferSeconds(1_000_000, ASSUMED_UP_BPS)).toBeCloseTo(1.000244, 5);
    expect(transferSeconds(10 * ASSUMED_DOWN_BPS, ASSUMED_DOWN_BPS)).toBeGreaterThan(10);
    expect(transferSeconds(0, ASSUMED_UP_BPS)).toBe(0);
    expect(transferSeconds(100, 0)).toBe(0);
  });
});
