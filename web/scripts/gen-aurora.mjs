// Nappes de l'aurore (UI §20.2 S8, §20.4 « Ambiance ») : trois PNG 128 × 128, RGBA.
// Couleur unie par nappe (menthe, marée, encre) ; l'alpha porte la forme : somme de taches
// gaussiennes allongées et tournées, tirées d'un générateur à graine fixe (LCG de da-v2/js/app.js),
// puis un tramage de ±1 niveau pour éviter les bandes une fois l'image agrandie par transform.
// Déterministe et sans dépendance : le test régénère les fichiers et les compare octet pour octet.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { crc32, deflateSync } from "node:zlib";

const SIZE = 128;

/** Graine, couleur et forme de chaque nappe (UI §20.3 : aucun violet). */
export const LAYERS = {
  "aurora-mint.png": { seed: 0x6d696e74, rgb: [0x5f, 0xe3, 0xb5], blobs: 3, peak: 0.64 },
  "aurora-tide.png": { seed: 0x74696465, rgb: [0x28, 0x80, 0x9a], blobs: 4, peak: 0.63 },
  "aurora-ink.png": { seed: 0x696e6b21, rgb: [0x34, 0x56, 0xaa], blobs: 4, peak: 0.62 },
};

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296;
}

function chunk(type, data) {
  const t = Buffer.from(type, "latin1");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])) >>> 0);
  return Buffer.concat([len, t, data, crc]);
}

/** Alpha (0 à 1) de la nappe : taches gaussiennes qui s'éteignent avant le bord (aucune coupure visible). */
function shape({ seed, blobs, peak }) {
  const r = rng(seed);
  const spots = Array.from({ length: blobs }, (_, i) => ({
    x: 0.5 + (r() - 0.5) * 0.28,
    y: 0.5 + (r() - 0.5) * 0.22,
    sx: 0.13 + r() * 0.07,
    sy: 0.07 + r() * 0.05,
    a: (r() - 0.5) * Math.PI * 0.6 + (i % 2 ? 0.35 : -0.25),
    w: 0.55 + r() * 0.45,
  }));
  const out = new Float64Array(SIZE * SIZE);
  let max = 0;
  for (let y = 0; y < SIZE; y++)
    for (let x = 0; x < SIZE; x++) {
      const u = (x + 0.5) / SIZE;
      const v = (y + 0.5) / SIZE;
      let s = 0;
      for (const p of spots) {
        const dx = u - p.x;
        const dy = v - p.y;
        const c = Math.cos(p.a);
        const n = Math.sin(p.a);
        const qx = (dx * c + dy * n) / p.sx;
        const qy = (-dx * n + dy * c) / p.sy;
        s += p.w * Math.exp(-0.5 * (qx * qx + qy * qy));
      }
      // Bord : fondu radial vers 0, pour que l'image agrandie n'ait aucun contour.
      const d = Math.hypot(u - 0.5, v - 0.5) / 0.5;
      const edge = Math.max(0, 1 - d * d) ** 2;
      out[y * SIZE + x] = s * edge;
      if (out[y * SIZE + x] > max) max = out[y * SIZE + x];
    }
  for (let i = 0; i < out.length; i++) out[i] = (out[i] / max) * peak;
  return out;
}

export function buildAurora(name) {
  const layer = LAYERS[name];
  if (!layer) throw new Error(`nappe inconnue : ${name}`);
  const alpha = shape(layer);
  const dither = rng(layer.seed ^ 0x9e3779b9);
  // Filtre PNG « Sub » (1) sur chaque ligne : couleur unie et alpha lisse se compressent bien mieux.
  const raw = Buffer.alloc(SIZE * (1 + SIZE * 4));
  let o = 0;
  for (let y = 0; y < SIZE; y++) {
    raw[o++] = 1;
    const prev = [0, 0, 0, 0];
    for (let x = 0; x < SIZE; x++) {
      const a = alpha[y * SIZE + x] * 255;
      const q = a < 1 ? 0 : Math.min(255, Math.max(0, Math.round(a + (dither() - 0.5))));
      const px = [layer.rgb[0], layer.rgb[1], layer.rgb[2], q];
      for (let c = 0; c < 4; c++) {
        raw[o++] = (px[c] - prev[c]) & 255;
        prev[c] = px[c];
      }
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(SIZE, 0);
  ihdr.writeUInt32BE(SIZE, 4);
  ihdr[8] = 8; // profondeur
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = join(dirname(dirname(fileURLToPath(import.meta.url))), "public", "assets");
  mkdirSync(dir, { recursive: true });
  for (const name of Object.keys(LAYERS)) {
    const png = buildAurora(name);
    writeFileSync(join(dir, name), png);
    console.log(`${name} écrit (${png.length} octets)`);
  }
}
