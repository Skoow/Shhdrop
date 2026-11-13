// Tuile de bruit 128 × 128 pour le masque de dissolution (UI §7.4).
// Niveaux de gris + alpha (le masque CSS lit l'alpha) : blanc, alpha = bruit xorshift32, graine 0x5348.
// Déterministe : le test régénère le fichier et le compare à celui du dépôt.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { crc32, deflateSync } from "node:zlib";

const SIZE = 128;
const SEED = 0x5348;

function chunk(type, data) {
  const t = Buffer.from(type, "latin1");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])) >>> 0);
  return Buffer.concat([len, t, data, crc]);
}

export function buildGrain() {
  let s = SEED;
  const next = () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s;
  };
  // Chaque ligne : octet de filtre 0, puis (gris, alpha) par pixel.
  const raw = Buffer.alloc(SIZE * (1 + SIZE * 2));
  let o = 0;
  for (let y = 0; y < SIZE; y++) {
    raw[o++] = 0;
    for (let x = 0; x < SIZE; x++) {
      raw[o++] = 255;
      raw[o++] = next() >>> 24;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(SIZE, 0);
  ihdr.writeUInt32BE(SIZE, 4);
  ihdr[8] = 8; // profondeur
  ihdr[9] = 4; // gris + alpha
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = join(dirname(dirname(fileURLToPath(import.meta.url))), "src", "assets");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "grain.png"), buildGrain());
  console.log("grain.png écrit");
}
