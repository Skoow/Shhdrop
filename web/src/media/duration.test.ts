import { describe, expect, it } from "vitest";
import { formatClock } from "./duration";

describe("formatClock", () => {
  it("minutes:secondes, heures au besoin, jamais négatif", () => {
    expect(formatClock(72)).toBe("1:12");
    expect(formatClock(5)).toBe("0:05");
    expect(formatClock(3725)).toBe("1:02:05");
    expect(formatClock(-3)).toBe("0:00");
    expect(formatClock(59.6)).toBe("1:00");
  });
});
