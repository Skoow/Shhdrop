import { describe, expect, it } from "vitest";
import { createStats } from "./stats";

function clock() {
  let t = 0;
  return { now: () => t, at: (ms: number) => void (t = ms) };
}

describe("createStats (UI §9.4.1)", () => {
  it("vitesse : null avant 3 s, puis moyenne mobile exponentielle (τ = 3 s) sur une série connue", () => {
    const c = clock();
    const s = createStats(c.now);
    s.push(0, 10_000_000);
    c.at(1000);
    s.push(1_000_000, 10_000_000); // 1 Mo/s : première mesure, prise telle quelle
    expect(s.rate()).toBeNull();
    c.at(2000);
    s.push(3_000_000, 10_000_000); // 2 Mo/s
    c.at(3000);
    s.push(5_000_000, 10_000_000); // 2 Mo/s
    const a = 1 - Math.exp(-1 / 3);
    let v = 1_000_000;
    v += a * (2_000_000 - v);
    v += a * (2_000_000 - v);
    expect(s.rate()).toBeCloseTo(v, 3);
  });

  it("temps restant : null avant 5 s ou si la vitesse est nulle ; (total − envoyé) / vitesse ensuite", () => {
    const c = clock();
    const s = createStats(c.now);
    s.push(0, 100_000_000);
    for (let k = 1; k <= 4; k++) {
      c.at(k * 1000);
      s.push(k * 1_000_000, 100_000_000);
    }
    expect(s.rate()).toBeCloseTo(1_000_000, 3);
    expect(s.eta()).toBeNull();
    c.at(5000);
    s.push(5_000_000, 100_000_000);
    expect(s.eta()).toBeCloseTo(95, 3);
    // Plus aucun octet pendant longtemps : la vitesse tend vers 0 mais reste positive.
    const z = createStats(c.now);
    z.push(0, 10);
    c.at(10_000);
    z.push(0, 10);
    expect(z.rate()).toBe(0);
    expect(z.eta()).toBeNull();
  });

  it("percent : entier inférieur, jamais 100 avant sent === total", () => {
    const c = clock();
    const s = createStats(c.now);
    expect(s.percent()).toBe(0);
    s.push(999_999, 1_000_000);
    expect(s.percent()).toBe(99);
    s.push(425, 1000);
    expect(s.percent()).toBe(42);
    s.push(1000, 1000);
    expect(s.percent()).toBe(100);
  });

  it("reset : nouvelle mesure (après une pause ou une coupure), octets gardés", () => {
    const c = clock();
    const s = createStats(c.now);
    s.push(0, 100);
    c.at(4000);
    s.push(40, 100);
    expect(s.rate()).not.toBeNull();
    s.reset();
    expect(s.rate()).toBeNull();
    expect(s.percent()).toBe(40);
    c.at(8000);
    s.push(80, 100);
    expect(s.rate()).toBeCloseTo(10, 6);
  });
});
