// Garde de l'aperçu (test d'intrusion du 11 novembre) : dimensions lues dans l'en-tête, sans
// décoder l'image ; au-delà de 50 mégapixels, ou dimensions introuvables, pas d'aperçu.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { PREVIEW_MAX_PIXELS, imagePixels, previewable } from "./dimensions";

const FX = (n: string) => new Blob([readFileSync(fileURLToPath(new URL(`./fixtures/${n}`, import.meta.url)))]);
const blob = (...parts: (number[] | string | Uint8Array<ArrayBuffer>)[]) =>
  new Blob(parts.map((p) => (typeof p === "string" ? new TextEncoder().encode(p) : p instanceof Uint8Array ? p : new Uint8Array(p))));
const be16 = (n: number) => [n >> 8, n & 255];
const be32 = (n: number) => [(n >>> 24) & 255, (n >> 16) & 255, (n >> 8) & 255, n & 255];
const le16 = (n: number) => [n & 255, n >> 8];
const le24 = (n: number) => [n & 255, (n >> 8) & 255, (n >> 16) & 255];
const le32 = (n: number) => [...le24(n), (n >>> 24) & 255];

/** JPEG minimal ; `apps` segments APP1 de 60000 octets avant le SOF. */
function jpeg(w: number, h: number, apps = 1): Blob {
  const app = [new Uint8Array([0xff, 0xe1, ...be16(60_002)]), new Uint8Array(60_000)];
  return blob([0xff, 0xd8], ...Array.from({ length: apps }, () => app).flat(), [0xff, 0xff, 0xc2, 0, 11, 8, ...be16(h), ...be16(w), 1, 1, 0x11, 0], [0xff, 0xda, 0, 8, 1, 1, 0, 0, 0x3f, 0, 0, 0xff, 0xd9]);
}
const png = (w: number, h: number) => blob([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13], "IHDR", [...be32(w), ...be32(h), 8, 6, 0, 0, 0], [0, 0, 0, 0]);
function gif(sw: number, sh: number, fw: number, fh: number): Blob {
  const app = [0x21, 0xff, 11, ..."NETSCAPE2.0".split("").map((c) => c.charCodeAt(0)), 3, 1, 0, 0, 0];
  return blob("GIF89a", [...le16(sw), ...le16(sh), 0, 0, 0], app, [0x2c, 0, 0, 0, 0, ...le16(fw), ...le16(fh), 0, 2, 1, 0, 0, 0x3b]);
}
const riff = (body: number[]) => blob("RIFF", le32(body.length + 4), "WEBP", body);
const chunk = (type: string, data: number[]) => [...type.split("").map((c) => c.charCodeAt(0)), ...le32(data.length), ...data];
const vp8x = (w: number, h: number) => riff(chunk("VP8X", [0, 0, 0, 0, ...le24(w - 1), ...le24(h - 1)]));
const vp8l = (w: number, h: number) => {
  const bits = (w - 1) | ((h - 1) << 14);
  return riff(chunk("VP8L", [0x2f, ...le32(bits), 0, 0, 0]));
};
const vp8 = (w: number, h: number) => riff(chunk("VP8 ", [0, 0, 0, 0x9d, 0x01, 0x2a, ...le16(w), ...le16(h), 0, 0]));
function box(type: string, ...body: number[][]): number[] {
  const flat = body.flat();
  return [...be32(flat.length + 8), ...type.split("").map((c) => c.charCodeAt(0)), ...flat];
}
const ispe = (w: number, h: number) => box("ispe", [0, 0, 0, 0], be32(w), be32(h));
const heif = (...sizes: [number, number][]) =>
  blob(box("ftyp", "heic".split("").map((c) => c.charCodeAt(0)), [0, 0, 0, 0]), box("meta", [0, 0, 0, 0], box("iprp", box("ipco", ...sizes.map(([w, h]) => ispe(w, h))))), box("mdat", [1, 2, 3]));

describe("imagePixels : en-tête seulement", () => {
  test("JPEG : SOF après 1,2 Mo de segments APP (plus que l'en-tête lu d'un coup)", async () => {
    expect(await imagePixels(jpeg(4000, 3000, 20))).toBe(12_000_000);
  });
  test("JPEG de 60000 × 60000 : plus de 50 mégapixels, refusé", async () => {
    const b = jpeg(60000, 60000);
    expect(await imagePixels(b)).toBe(3_600_000_000);
    expect(await previewable(b)).toBe(false);
  });
  test("JPEG à hauteur 0 (DNL) ou sans SOF : inconnu", async () => {
    expect(await imagePixels(jpeg(100, 0))).toBeNull();
    expect(await imagePixels(blob([0xff, 0xd8, 0xff, 0xd9]))).toBeNull();
  });
  test("PNG", async () => {
    expect(await imagePixels(png(640, 480))).toBe(307_200);
    expect(await previewable(png(10000, 5001))).toBe(false);
  });
  test("GIF : la première image peut agrandir l'écran logique (Chromium)", async () => {
    expect(await imagePixels(gif(10, 10, 5, 5))).toBe(100);
    expect(await imagePixels(gif(10, 10, 9000, 9000))).toBe(81_000_000);
  });
  test("WebP : VP8X, VP8L, VP8", async () => {
    expect(await imagePixels(vp8x(16384, 16384))).toBe(16384 * 16384);
    expect(await imagePixels(vp8l(300, 200))).toBe(60_000);
    expect(await imagePixels(vp8(1920, 1080))).toBe(1920 * 1080);
  });
  test("HEIC / AVIF : la plus grande propriété ispe", async () => {
    expect(await imagePixels(heif([512, 512], [8000, 8000]))).toBe(64_000_000);
    expect(await imagePixels(heif())).toBeNull();
  });
  test("fichiers réels du dépôt : dimensions trouvées, sous la borne", async () => {
    for (const n of ["iphone-like.jpg", "progressive.jpg", "meta.png", "meta.gif", "meta.webp", "simple.webp", "meta.heic", "meta.avif"]) {
      const px = await imagePixels(FX(n));
      expect(px, n).toBeGreaterThan(0);
      expect(await previewable(FX(n)), n).toBe(true);
    }
  });
  test("format inconnu (BMP, SVG) ou tronqué : pas d'aperçu", async () => {
    expect(await previewable(blob("BM", new Uint8Array(60)))).toBe(false);
    expect(await previewable(blob("<svg xmlns='http://www.w3.org/2000/svg'/>"))).toBe(false);
    expect(await previewable(blob([0x89, 0x50, 0x4e, 0x47]))).toBe(false);
    expect(await previewable(new Blob([]))).toBe(false);
  });
  test("borne : exactement 50 mégapixels permis, un de plus refusé", async () => {
    expect(PREVIEW_MAX_PIXELS).toBe(50_000_000);
    expect(await previewable(png(10000, 5000))).toBe(true);
    expect(await previewable(png(50_000_001, 1))).toBe(false);
  });
});
