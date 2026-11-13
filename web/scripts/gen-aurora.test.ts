// Nappes de l'aurore (UI §20.2 S8, §20.6 point 6) : générées, déterministes, légères.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
// @ts-expect-error module .mjs sans déclarations
import { buildAurora } from "./gen-aurora.mjs";

const assets = join(dirname(dirname(fileURLToPath(import.meta.url))), "src", "assets");
const FILES: Record<string, string> = {
  "aurora-mint.png": "5FE3B5",
  "aurora-tide.png": "28809A",
  "aurora-ink.png": "3456AA",
};

/** IHDR et pixels RGBA, filtre « Sub » (1) défait (seul filtre écrit par gen-aurora.mjs). */
function decode(buf: Buffer) {
  expect(buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(true);
  let off = 8;
  let ihdr: Buffer = Buffer.alloc(0);
  const idat: Buffer[] = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.subarray(off + 4, off + 8).toString("latin1");
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === "IHDR") ihdr = data;
    if (type === "IDAT") idat.push(data);
    off += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = 1 + 128 * 4;
  for (let y = 0; y < 128; y++) {
    expect(raw[y * stride]).toBe(1);
    for (let i = 4; i < 128 * 4; i++) raw[y * stride + 1 + i] = (raw[y * stride + 1 + i]! + raw[y * stride + 1 + i - 4]!) & 255;
    raw[y * stride] = 0;
  }
  return { w: ihdr.readUInt32BE(0), h: ihdr.readUInt32BE(4), depth: ihdr[8], type: ihdr[9], raw };
}

describe("gen-aurora.mjs", () => {
  for (const [name, color] of Object.entries(FILES)) {
    it(`${name} : 128 × 128 RGBA, couleur #${color}, fichier commité identique octet pour octet`, () => {
      const a = buildAurora(name) as Buffer;
      const b = buildAurora(name) as Buffer;
      expect(a.equals(b)).toBe(true);
      expect(a.equals(readFileSync(join(assets, name)))).toBe(true);

      const { w, h, depth, type, raw } = decode(a);
      expect([w, h, depth, type]).toEqual([128, 128, 8, 6]);
      // Couleur dominante : celle des pixels visibles, pondérée par l'alpha.
      const weight = new Map<string, number>();
      let visible = 0;
      for (let y = 0; y < 128; y++) {
        const row = y * (1 + 128 * 4);
        expect(raw[row]).toBe(0);
        for (let x = 0; x < 128; x++) {
          const p = row + 1 + x * 4;
          const alpha = raw[p + 3]!;
          if (alpha === 0) continue;
          visible++;
          const k = [raw[p]!, raw[p + 1]!, raw[p + 2]!].map((v) => v.toString(16).padStart(2, "0")).join("").toUpperCase();
          weight.set(k, (weight.get(k) ?? 0) + alpha);
        }
      }
      const dominant = [...weight.entries()].sort((x, y) => y[1] - x[1])[0]![0];
      expect(dominant).toBe(color);
      expect(visible).toBeGreaterThan(128 * 128 * 0.2);
      // Aucun pixel opaque au bord : l'image agrandie n'a pas de contour.
      for (const [x, y] of [[0, 0], [127, 0], [0, 127], [127, 127], [64, 0], [0, 64]] as const)
        expect(raw[y * (1 + 128 * 4) + 1 + x * 4 + 3], `${x},${y}`).toBe(0);
    });
  }

  it("total des trois nappes < 16 Ko", () => {
    const total = Object.keys(FILES).reduce((n, f) => n + readFileSync(join(assets, f)).length, 0);
    expect(total).toBeLessThan(16 * 1024);
  });

  it("nappe inconnue : erreur", () => expect(() => buildAurora("x.png")).toThrow());
});
