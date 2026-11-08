import { describe, expect, it } from "vitest";
import { clockText, roundQuarter } from "./ready";

const at = (h: number, m: number) => new Date(2026, 10, 5, h, m, 0).getTime();

describe("Lien prêt : heure d'effacement (M12)", () => {
  it("arrondi au quart d'heure le plus proche", () => {
    expect(clockText(roundQuarter(at(9, 41)), "fr")).toBe("09 h 45");
    expect(clockText(roundQuarter(at(9, 36)), "fr")).toBe("09 h 30");
    expect(clockText(roundQuarter(at(23, 53)), "fr")).toBe("00 h 00");
    expect(clockText(roundQuarter(at(9, 41)), "en")).toBe("9:45 AM");
  });
});
