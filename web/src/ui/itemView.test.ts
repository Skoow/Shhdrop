import { describe, expect, it } from "vitest";
import { firstLine } from "./itemView";

describe("firstLine", () => {
  it("première ligne non vide, bornée", () => {
    expect(firstLine("\n  \nBonjour\nsuite")).toBe("Bonjour");
    expect(firstLine(undefined)).toBe("");
    expect(firstLine("x".repeat(200), 10)).toBe("x".repeat(10));
  });
});
