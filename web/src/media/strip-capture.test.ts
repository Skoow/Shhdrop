// Fichiers réels produits par MediaRecorder de Chromium 153 (caméra et micro factices),
// dans media/fixtures/ : vidéo MP4 et WebM, vocal MP4 et WebM.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { stripCaptureMeta } from "./strip-capture";

const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));
const latin = (b: Uint8Array) => Array.from(b, (c) => String.fromCharCode(c)).join("");
const bytes = async (b: Blob) => new Uint8Array(await b.arrayBuffer());
const diff = (a: Uint8Array, b: Uint8Array) => a.reduce((n, x, i) => n + (x === b[i] ? 0 : 1), 0);

/** Dates (création, modification) de chaque mvhd / tkhd / mdhd du moov. */
function mp4Dates(b: Uint8Array): { box: string; dates: bigint[] }[] {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const out: { box: string; dates: bigint[] }[] = [];
  const walk = (s: number, e: number) => {
    for (let o = s; o + 8 <= e; ) {
      const size = v.getUint32(o);
      const t = latin(b.subarray(o + 4, o + 8));
      if (["mvhd", "tkhd", "mdhd"].includes(t)) {
        const v1 = b[o + 8] === 1;
        out.push({ box: t, dates: v1 ? [v.getBigUint64(o + 12), v.getBigUint64(o + 20)] : [BigInt(v.getUint32(o + 12)), BigInt(v.getUint32(o + 16))] });
      } else if (["moov", "trak", "mdia"].includes(t)) walk(o + 8, o + size);
      o += size;
    }
  };
  walk(0, b.length);
  return out;
}

describe("métadonnées des captures (MediaRecorder de Chromium)", () => {
  for (const name of ["chromium.webm", "chromium-audio.webm"]) {
    it(`${name} : MuxingApp et WritingApp (« Chrome ») vidés, même taille, rien d'autre ne change`, async () => {
      const src = fixture(name);
      expect(latin(src.subarray(0, 200))).toContain("Chrome");
      const r = await stripCaptureMeta(new Blob([src], { type: "video/webm" }));
      expect(r.stripped).toBe(true);
      expect(r.blob.type).toBe("video/webm");
      const out = await bytes(r.blob);
      expect(out.length).toBe(src.length);
      expect(latin(out)).not.toContain("Chrome");
      // Les deux éléments restent (obligatoires), vides : 0x4D80 et 0x5741, taille 6, six zéros.
      expect(latin(out.subarray(0, 200))).toContain("\x4d\x80\x86\0\0\0\0\0\0\x57\x41\x86\0\0\0\0\0\0");
      expect(diff(src, out)).toBe(12);
    });
  }
  for (const name of ["chromium.mp4", "chromium.m4a"]) {
    it(`${name} : dates de création et de modification (mvhd, tkhd, mdhd) mises à 0, même taille`, async () => {
      const src = fixture(name);
      const before = mp4Dates(src);
      expect(before.length).toBeGreaterThanOrEqual(3);
      expect(before.every((x) => x.dates.every((d) => d > 3_000_000_000n))).toBe(true); // vraies dates (secondes depuis 1904)
      const r = await stripCaptureMeta(new Blob([src], { type: "video/mp4" }));
      expect(r.stripped).toBe(true);
      const out = await bytes(r.blob);
      expect(out.length).toBe(src.length);
      const after = mp4Dates(out);
      expect(after.map((x) => x.box)).toEqual(before.map((x) => x.box));
      expect(after.every((x) => x.dates.every((d) => d === 0n))).toBe(true);
      expect(diff(src, out)).toBeLessThanOrEqual(before.length * 16);
      expect(out.subarray(out.length - 4096)).toEqual(src.subarray(src.length - 4096)); // les données ne bougent pas
    });
  }

  it("MP4 synthétique : version 0 (dates sur 4 octets), udta et meta → free remplies de zéros (contenu illisible)", async () => {
    const box = (t: string, body: number[]) => [0, 0, 0, 8 + body.length, ...[...t].map((c) => c.charCodeAt(0)), ...body];
    const mvhd = box("mvhd", [0, 0, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 9]);
    const udta = box("udta", [...box("\xa9too", [...Buffer.from("ReperEncodeur")])]);
    const meta = box("meta", [0, 0, 0, 0, ...box("ilst", [...Buffer.from("ReperTitre")])]);
    const moov = box("moov", [...mvhd, ...udta, ...meta]);
    const src = new Uint8Array([...box("ftyp", [105, 115, 111, 109]), ...moov]);
    const out = await bytes((await stripCaptureMeta(new Blob([src]))).blob);
    expect(out.length).toBe(src.length);
    expect(latin(out)).toContain("mvhd\0\0\0\0\0\0\0\0\0\0\0\0\x09\x09");
    expect(latin(out)).toContain(`\0\0\0${String.fromCharCode(udta.length)}free${"\0".repeat(udta.length - 8)}`);
    expect(latin(out)).toContain(`free${"\0".repeat(meta.length - 8)}`);
    for (const t of ["udta", "meta", "\xa9too", "ilst", "ReperEncodeur", "ReperTitre"]) expect(latin(out)).not.toContain(t);
  });

  it("inconnu ou abîmé : Blob rendu inchangé (stripped: false)", async () => {
    for (const src of [new Uint8Array([1, 2, 3]), new Uint8Array(0), fixture("chromium.webm").subarray(0, 60), fixture("chromium.mp4").subarray(0, 300)]) {
      const blob = new Blob([src]);
      const r = await stripCaptureMeta(blob);
      expect(r.stripped).toBe(false);
      expect(r.blob).toBe(blob);
    }
  });
});
