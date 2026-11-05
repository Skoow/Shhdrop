// Décodage PNG et luminance relative (WCAG) des captures Chromium : fonds de section de
// l'accueil v4 (UI §20.11), sous le plafond K5.
import { inflateSync } from "node:zlib";

/** Décodeur PNG minimal (8 bits, RGB ou RGBA, non entrelacé, filtres 0 à 4) : les captures de Chromium. */
export function decodePng(buf: Buffer): { w: number; h: number; ch: number; px: Uint8Array } {
  let off = 8;
  let w = 0;
  let h = 0;
  let ch = 0;
  const idat: Buffer[] = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.subarray(off + 4, off + 8).toString("latin1");
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === "IHDR") {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      if (data[8] !== 8) throw new Error("PNG : profondeur 8 bits attendue");
      if (data[12] !== 0) throw new Error("PNG : non entrelacé attendu");
      ch = data[9] === 6 ? 4 : data[9] === 2 ? 3 : 0;
      if (ch === 0) throw new Error("PNG : RGB ou RGBA attendu");
    }
    if (type === "IDAT") idat.push(data);
    off += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * ch;
  const px = new Uint8Array(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)]!;
    const src = y * (stride + 1) + 1;
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? px[y * stride + i - ch]! : 0;
      const b = y > 0 ? px[(y - 1) * stride + i]! : 0;
      const c = y > 0 && i >= ch ? px[(y - 1) * stride + i - ch]! : 0;
      const x = raw[src + i]!;
      let v: number;
      if (f === 0) v = x;
      else if (f === 1) v = x + a;
      else if (f === 2) v = x + b;
      else if (f === 3) v = x + ((a + b) >> 1);
      else {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      }
      px[y * stride + i] = v & 255;
    }
  }
  return { w, h, ch, px };
}

export const lin = (v: number) => {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};

/** Luminance relative maximale d'une capture PNG. */
export function maxRelLuminance(buf: Buffer): number {
  const { w, h, ch, px } = decodePng(buf);
  let max = 0;
  for (let i = 0; i < w * h; i++) {
    const o = i * ch;
    const l = 0.2126 * lin(px[o]!) + 0.7152 * lin(px[o + 1]!) + 0.0722 * lin(px[o + 2]!);
    if (l > max) max = l;
  }
  return max;
}
