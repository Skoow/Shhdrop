// Logo « Trame » et favicon (scripts/gen-logo.mjs) : sorties à jour, géométrie tenue.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
// @ts-expect-error module .mjs sans déclarations
import { OUTPUTS, build, mark } from "./gen-logo.mjs";
// @ts-expect-error module .mjs sans déclarations
import { ico } from "./gen-icons.mjs";

const web = dirname(dirname(fileURLToPath(import.meta.url)));

describe("gen-logo", () => {
  it("les fichiers commités sont ceux que produit le générateur", () => {
    for (const [rel, gen] of Object.entries(OUTPUTS as Record<string, () => string>))
      expect(readFileSync(join(web, rel), "utf8"), rel).toBe(gen());
  });

  it("trame légère : 6 tranches, une quarantaine de points, rien d'autre qu'arcs et déplacements", () => {
    const b = build();
    expect(b.dots).toHaveLength(6);
    expect(b.count).toBeGreaterThan(30);
    expect(b.count).toBeLessThan(50);
    for (const d of b.dots) expect(d).toMatch(/^(M[-\d. ]+a[-\d. ]+a[-\d. ]+)+$/);
  });

  it("favicon : bords des bandes sur des unités paires (net à 16 px)", () => {
    const d = mark() as string;
    const ys = [
      ...[...d.matchAll(/M[\d.]+ ([\d.]+)/g)].map((m) => Number(m[1])),
      ...[...d.matchAll(/A[\d.]+ [\d.]+ 0 [01] [01] [\d.]+ ([\d.]+)/g)].map((m) => Number(m[1])),
    ];
    expect(ys.length).toBeGreaterThan(0);
    for (const y of ys) expect(y % 2, String(y)).toBe(0);
  });

  it("favicon.ico : en-tête ICO, entrées 16 et 32 en PNG", () => {
    const buf = readFileSync(join(web, "public", "favicon.ico"));
    expect([buf.readUInt16LE(0), buf.readUInt16LE(2), buf.readUInt16LE(4)]).toEqual([0, 1, 2]);
    expect([buf[6], buf[22]]).toEqual([16, 32]);
    const off = buf.readUInt32LE(6 + 12);
    expect(buf.subarray(off, off + 4).toString("latin1")).toBe("\x89PNG");
    const one = ico([{ size: 16, data: Buffer.from("x") }]);
    expect(one.readUInt32LE(18)).toBe(22);
  });
});
