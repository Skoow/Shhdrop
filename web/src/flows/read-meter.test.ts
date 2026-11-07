import { describe, expect, it } from "vitest";
import { CHUNK, SEG_CHUNKS, bucketFor, segmentSize } from "../index";
import { createReadMeter } from "./read-meter";

const SEG = CHUNK * SEG_CHUNKS; // 4 Mio de clair par segment
const MiB = 1048576;

describe("budget de lecture estimé (spec §24)", () => {
  it("budget = 2 × fichier chiffré + 2 segments 0 ; l'ouverture a lu le segment 0 et le manifeste", () => {
    const m = createReadMeter([{ kind: "file", offset: 0, size: 10 * MiB }]);
    const b = bucketFor(10 * MiB);
    const file = Array.from({ length: Math.ceil(b / 64) }, (_, n) => segmentSize(b, n)).reduce((a, x) => a + x, 0);
    expect(m.budget).toBe(2 * file + 2 * segmentSize(b, 0));
    expect(m.used).toBe(segmentSize(b, 0) + segmentSize(b, Math.ceil(b / 64) - 1));
  });

  it("une lecture complète en ordre puis un nouvel essai de chaque élément tiennent ; un 3ᵉ passage non", () => {
    const items = [
      { kind: "file" as const, offset: 0, size: 6 * MiB },
      { kind: "file" as const, offset: 6 * MiB, size: 9 * MiB },
      { kind: "text" as const, offset: 0, size: 12 },
    ];
    const m = createReadMeter(items);
    for (const i of [0, 1, 2]) {
      expect(m.canRead(i)).toBe(true);
      m.charge(i);
    }
    // Un nouvel essai de chaque élément tient toujours ; ensuite, on finit par refuser, sans
    // jamais dépasser le budget.
    let passes = 0;
    while (m.canRead(0) && m.canRead(1) && passes < 100) {
      m.charge(0);
      m.charge(1);
      m.interrupted();
      passes++;
      expect(m.used).toBeLessThanOrEqual(m.budget);
    }
    expect(passes).toBeGreaterThanOrEqual(1);
    expect(passes).toBeLessThan(100);
    expect(m.cost(2)).toBe(0); // un texte est dans le manifeste
  });

  it("lecture monotone : un élément loin devant compte aussi les segments sautés", () => {
    const items = [
      { kind: "file" as const, offset: 0, size: 3 * SEG },
      { kind: "file" as const, offset: 3 * SEG, size: SEG },
    ];
    const m = createReadMeter(items);
    const b = bucketFor(4 * SEG);
    expect(m.cost(1)).toBe([0, 1, 2, 3].reduce((a, n) => a + segmentSize(b, n), 0));
    m.charge(1);
    // Revenir à l'élément 0 : relu depuis son premier segment.
    expect(m.cost(0)).toBe([0, 1, 2].reduce((a, n) => a + segmentSize(b, n), 0));
  });

  it("segment partagé encore en cache : pas compté deux fois ; reprise au segment si le client la permet", () => {
    const items = [
      { kind: "file" as const, offset: 0, size: SEG + 10 },
      { kind: "file" as const, offset: SEG + 10, size: 2 * SEG },
    ];
    const m = createReadMeter(items, { resumable: true });
    const b = bucketFor(3 * SEG + 10);
    m.charge(0);
    expect(m.cost(1)).toBe(segmentSize(b, 2) + segmentSize(b, 3) - 0);
    m.charge(1);
    m.interrupted();
    expect(m.cost(1, 2 * SEG)).toBe(segmentSize(b, 3) - 0 + 0);
    const old = createReadMeter(items);
    old.charge(0);
    old.charge(1);
    old.interrupted();
    expect(old.cost(1, 2 * SEG)).toBe(segmentSize(b, 1) + segmentSize(b, 2) + segmentSize(b, 3));
  });
});
