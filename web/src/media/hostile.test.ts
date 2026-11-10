// Entrées hostiles (revue du 10 novembre, spec §35.2) : un fichier piégé ne doit ni geler la
// page (boucle sans borne, recherche quadratique) ni tout charger en mémoire ; le nettoyage
// échoue proprement (`Malformed`, donc `echec`) ou réussit vite.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanFlac } from "./flac";
import { cleanHeif } from "./heif";
import { cleanOgg } from "./ogg";
import { cleanWav } from "./wav";
import { readZip } from "./zip";

const enc = new TextEncoder();
const fx = (n: string) => new Uint8Array(readFileSync(new URL(`./fixtures/${n}`, import.meta.url)));
const sha = async (b: Blob) => createHash("sha256").update(new Uint8Array(await b.arrayBuffer())).digest("hex");

/** Blob dont chaque lecture (slice) est notée : taille demandée. */
function spied(b: Blob): { blob: Blob; reads: number[] } {
  const reads: number[] = [];
  const blob = { size: b.size, type: b.type, slice: (s = 0, e = b.size) => (reads.push(Math.min(e, b.size) - s), b.slice(s, e)) } as unknown as Blob;
  return { blob, reads };
}

/** Octets écrits petit-boutiste / gros-boutiste. */
const le32 = (v: number) => [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255];
const be32 = (v: number) => [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
const be16 = (v: number) => [(v >>> 8) & 255, v & 255];
function cat(parts: (Uint8Array | number[])[]): Uint8Array<ArrayBuffer> {
  const n = parts.reduce((a, p) => a + p.length, 0);
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
const box = (type: string, ...payload: (Uint8Array | number[])[]) => {
  const body = cat(payload);
  return cat([be32(8 + body.length), enc.encode(type), body]);
};

describe("ZIP piégé", () => {
  it("répertoire central de 17 Mio : refusé sans être lu", async () => {
    const cdSize = 17 << 20;
    const eocd = cat([le32(0x06054b50), [0, 0, 0, 0, 1, 0, 1, 0], le32(cdSize), le32(0), [0, 0]]);
    const { blob, reads } = spied(new Blob([new Uint8Array(cdSize), eocd]));
    await expect(readZip(blob)).rejects.toThrow(/zip_repertoire_trop_grand/);
    expect(Math.max(...reads)).toBeLessThanOrEqual(22 + 65535);
  });
});

/** HEIF minimal : `nExif` éléments Exif puis `nOther` autres, un extent de `len` octets chacun (tous au même endroit si `sameAt`). */
function heif(nExif: number, nOther: number, len = 1, sameAt = false): Blob {
  const infe = (id: number) => box("infe", [2, 0, 0, 0], be16(id), [0, 0], enc.encode("Exif"), [0]);
  const hdlr = box("hdlr", [0, 0, 0, 0], be32(0), enc.encode("pict"), new Uint8Array(12), [0]);
  const iinf = box("iinf", [0, 0, 0, 0], be16(nExif), ...Array.from({ length: nExif }, (_, k) => infe(k + 1)));
  const ftyp = box("ftyp", enc.encode("heic"), be32(0), enc.encode("mif1heic"));
  const n = nExif + nOther;
  const ilocLen = 8 + 4 + 2 + 4 + n * 18;
  const data = ftyp.length + 8 + 4 + hdlr.length + iinf.length + ilocLen + 8;
  const recs: number[][] = [];
  for (let k = 0; k < n; k++) recs.push([...be32(k + 1), 0, 0, 0, 0, ...be16(1), ...be32(data + (sameAt ? 0 : k)), ...be32(len)]);
  const iloc = box("iloc", [2, 0, 0, 0], [0x44, 0x00], be32(n), cat(recs));
  expect(iloc.length).toBe(ilocLen);
  return new Blob([ftyp, box("meta", [0, 0, 0, 0], hdlr, iinf, iloc), box("mdat", new Uint8Array(sameAt ? len : n))]);
}

describe("HEIF piégé", () => {
  it("1 000 éléments Exif et 150 000 autres : sans recherche quadratique (< 500 ms)", async () => {
    const file = heif(1000, 150_000);
    const t = performance.now();
    expect(await cleanHeif(file)).toEqual([]);
    const ms = performance.now() - t;
    expect(ms, `${ms} ms`).toBeLessThan(500);
  });
  it("20 000 extents EXIF/XMP : Malformed avant de les lire un par un", async () => {
    const { blob, reads } = spied(heif(20_000, 0));
    await expect(cleanHeif(blob)).rejects.toThrow(/heif_trop_d_extents/);
    expect(reads.length).toBeLessThan(100);
  });
  it("1 000 extents EXIF de 32 Mio au même endroit : Malformed sans allouer 32 Gio", async () => {
    // Garde-fou : `total` (ici 32 Gio) est refusé avant d'allouer le contenu de remplacement.
    await expect(cleanHeif(heif(1000, 0, 32 << 20, true))).rejects.toThrow(/heif_trop_de_correctifs/);
  });
});

describe("FLAC et WAV piégés", () => {
  const BLOCKS = 150_000;
  it("FLAC : 150 000 blocs vides → Malformed, vite", async () => {
    const blocks: number[][] = [[0, 0, 0, 34, ...new Array(34).fill(0)]];
    for (let k = 0; k < BLOCKS; k++) blocks.push([k === BLOCKS - 1 ? 0x81 : 1, 0, 0, 0]);
    const file = new Blob([enc.encode("fLaC"), cat(blocks), new Uint8Array([0xff, 0xf8])]);
    const t = performance.now();
    await expect(cleanFlac(file)).rejects.toThrow(/trop_de_blocs/);
    expect(performance.now() - t).toBeLessThan(500);
  });
  it("WAV : 150 000 blocs vides → Malformed, vite", async () => {
    const chunks: number[][] = [[...enc.encode("fmt "), ...le32(16), ...new Array(16).fill(0)]];
    for (let k = 0; k < BLOCKS; k++) chunks.push([...enc.encode("junk"), 0, 0, 0, 0]);
    chunks.push([...enc.encode("data"), ...le32(2), 0, 0]);
    const body = cat(chunks);
    const file = new Blob([enc.encode("RIFF"), new Uint8Array(le32(4 + body.length)), enc.encode("WAVE"), body]);
    const t = performance.now();
    await expect(cleanWav(file)).rejects.toThrow(/trop_de_blocs/);
    expect(performance.now() - t).toBeLessThan(500);
  });
});

describe("Ogg : pages renumérotées repliées dans le Blob", () => {
  afterEach(() => vi.unstubAllGlobals());
  /** Empreintes des sorties avant le repli (même code de nettoyage, 10 novembre). */
  const BEFORE: Record<string, string> = {
    "meta.opus": "156c095d6fb02ea733a8054de21de0b2ec4168b08e8eddeb3b80f5df6289d45e",
    "meta.ogg": "ad285f8ea7a002596be985e1ed8031047ea80df808af932bd9a46199fb8f46db",
    "long.opus": "5b77e6b241ff29f992834e2c58d28a97179223e38e2513c501d78e70538cefbd",
  };
  for (const [name, hash] of Object.entries(BEFORE)) {
    it(`${name} : mêmes octets qu'avant (repli par défaut et repli de 256 octets)`, async () => {
      expect(await sha((await cleanOgg(new Blob([fx(name)])))!)).toBe(hash);
      expect(await sha((await cleanOgg(new Blob([fx(name)]), 256))!)).toBe(hash);
    });
  }
  it("long.opus, repli de 256 octets : jamais plus de 256 octets + une page en mémoire JS", async () => {
    const src = fx("long.opus");
    // Pages : OpusHead, OpusTags (sur deux pages), puis trois pages audio (2208, 2109, 102 octets).
    const pages: number[] = [];
    for (let o = 0; o < src.length; ) {
      const n = src[o + 26]!;
      let len = 27 + n;
      for (let i = 0; i < n; i++) len += src[o + 27 + i]!;
      pages.push(len);
      o += len;
    }
    expect(pages.length).toBe(6);
    const maxPage = Math.max(...pages.slice(3));
    const file = new Blob([src]);
    const Native = Blob;
    let held = 0;
    vi.stubGlobal(
      "Blob",
      class extends Native {
        constructor(parts?: BlobPart[], o?: BlobPropertyBag) {
          held = Math.max(held, (parts ?? []).reduce((a, p) => a + (ArrayBuffer.isView(p) ? p.byteLength : 0), 0));
          super(parts, o);
        }
      },
    );
    const out = await cleanOgg(file, 256);
    vi.unstubAllGlobals();
    expect(await sha(out!)).toBe(BEFORE["long.opus"]);
    expect(held).toBeLessThanOrEqual(256 + maxPage);
  });
});

describe("Ogg piégé : nombre de pages borné (10 novembre)", () => {
  it("au-delà du plafond de pages, refus net (sinon des millions de pages de 27 octets figent l'onglet)", async () => {
    const file = new Blob([fx("long.opus")]);
    // Le fichier d'essai a bien plus de 5 pages : avec un plafond de 5, il doit être refusé.
    await expect(cleanOgg(file, undefined, 5)).rejects.toThrow(/trop_de_pages/);
    // Plafond par défaut : le fichier d'essai passe toujours.
    await expect(cleanOgg(file)).resolves.not.toBeUndefined();
  });
});
