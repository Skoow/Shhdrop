// Task 9c : nettoyage de l'audio par réassemblage (spec §35.2) : MP3, Ogg Opus et Vorbis, FLAC,
// WAV, sur les fichiers d'essai de scripts/gen-media-fixtures.sh (ffmpeg, repères fictifs).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cleanFlac } from "./flac";
import { audioRange } from "./mp3";
import { cleanOgg, oggCrc } from "./ogg";
import { found, indexOf } from "./test-markers";
import { cleanWav } from "./wav";

const fx = (n: string) => new Uint8Array(readFileSync(new URL(`./fixtures/${n}`, import.meta.url)));
const blob = (b: Uint8Array) => new Blob([b as Uint8Array<ArrayBuffer>]);
const bytes = async (b: Blob) => new Uint8Array(await b.arrayBuffer());
const MARKERS = ["ReperTitre", "ReperArtiste", "ReperComment", "ReperAlbum", "ReperOriginator", "ReperLogiciel", "Lavf", "2001-02-03"];

/** Pages Ogg : [numéro, CRC juste, données]. */
function oggPages(b: Uint8Array) {
  const out: { seq: number; crcOk: boolean; body: Uint8Array }[] = [];
  for (let o = 0; o < b.length; ) {
    const n = b[o + 26]!;
    let len = 0;
    for (let i = 0; i < n; i++) len += b[o + 27 + i]!;
    const page = b.subarray(o, o + 27 + n + len);
    const dv = new DataView(page.buffer, page.byteOffset);
    out.push({ seq: dv.getUint32(18, true), crcOk: dv.getUint32(22, true) === oggCrc(page), body: page.subarray(27 + n) });
    o += page.length;
  }
  return out;
}

describe("MP3", () => {
  it("meta.mp3 : ID3v2 (pochette comprise) et ID3v1 coupées ; commence par une trame, Xing gardée", async () => {
    const src = fx("meta.mp3");
    expect(found(src, MARKERS).length).toBeGreaterThan(0);
    const r = await audioRange(blob(src));
    const out = src.subarray(r.from, r.to);
    expect(found(out, MARKERS)).toEqual([]);
    expect(out[0]).toBe(0xff);
    expect(out[1]! & 0xe0).toBe(0xe0);
    expect(indexOf(out.subarray(0, 200), new TextEncoder().encode("Info")) >= 0 || indexOf(out.subarray(0, 200), new TextEncoder().encode("Xing")) >= 0).toBe(true);
    expect(src.length - r.to).toBe(128); // ID3v1
    const again = await audioRange(blob(out));
    expect(again).toEqual({ from: 0, to: out.length });
  });
  it("pièges : sans trame, ID3 qui déborde → Malformed", async () => {
    await expect(audioRange(blob(new Uint8Array([0x49, 0x44, 0x33, 3, 0, 0, 0x7f, 0x7f, 0x7f, 0x7f])))).rejects.toThrow(/malformed/);
    await expect(audioRange(blob(new TextEncoder().encode("ID3\x03\x00\x00\x00\x00\x00\x02ab hello")))).rejects.toThrow(/malformed/);
  });
});

describe("Ogg Opus et Vorbis", () => {
  for (const name of ["meta.opus", "meta.ogg"]) {
    it(`${name} : commentaires vides, CRC justes, numéros consécutifs, pages audio identiques`, async () => {
      const src = fx(name);
      expect(found(src, MARKERS).length).toBeGreaterThan(0);
      const out = await bytes((await cleanOgg(blob(src)))!);
      expect(found(out, MARKERS)).toEqual([]);
      const [a, b] = [oggPages(src), oggPages(out)];
      expect(b.every((p) => p.crcOk)).toBe(true);
      expect(b.map((p) => p.seq)).toEqual(b.map((_, i) => i));
      // Pages audio : les 2 dernières (les fichiers d'essai n'en ont que 2 ou 3 après les en-têtes).
      const tail = (ps: typeof a) => ps.slice(-2).map((p) => [...p.body]);
      expect(tail(b)).toEqual(tail(a));
      expect(await cleanOgg(blob(out))).toBeNull();
    });
  }
  it("long.opus : commentaires sur plusieurs pages → pages audio renumérotées, CRC recalculés, données identiques", async () => {
    const src = fx("long.opus");
    const out = await bytes((await cleanOgg(blob(src)))!);
    expect(found(out, ["ReperLong"])).toEqual([]);
    const [a, b] = [oggPages(src), oggPages(out)];
    expect(b.length).toBeLessThan(a.length);
    expect(b.every((p) => p.crcOk)).toBe(true);
    expect(b.map((p) => p.seq)).toEqual(b.map((_, i) => i));
    const n = b.length - 2; // pages audio
    expect(b.slice(2).map((p) => [...p.body])).toEqual(a.slice(a.length - n).map((p) => [...p.body]));
  });
  it("CRC faux, flux chaîné → Malformed", async () => {
    const src = fx("meta.opus");
    const bad = new Uint8Array(src);
    bad[bad.length - 1] ^= 1;
    await expect(cleanOgg(blob(bad))).rejects.toThrow(/malformed/);
    await expect(cleanOgg(blob(new Uint8Array([...src, ...src])))).rejects.toThrow(/malformed/);
  });
});

describe("FLAC et WAV", () => {
  it("meta.flac : VORBIS_COMMENT et PICTURE retirés, trames identiques", async () => {
    const src = fx("meta.flac");
    expect(found(src, MARKERS).length).toBeGreaterThan(0);
    const out = await bytes((await cleanFlac(blob(src)))!);
    expect(found(out, MARKERS)).toEqual([]);
    const sync = (b: Uint8Array) => b.findIndex((v, i) => i > 8 && v === 0xff && (b[i + 1]! & 0xfe) === 0xf8);
    expect([...out.subarray(sync(out))]).toEqual([...src.subarray(sync(src))]);
    expect(out[4]! & 0x7f).toBe(0); // STREAMINFO en premier
    expect(await cleanFlac(blob(out))).toBeNull();
  });
  it("meta.wav : LIST et bext retirés, taille RIFF juste, data identique", async () => {
    const src = fx("meta.wav");
    expect(found(src, MARKERS).length).toBeGreaterThan(0);
    const out = await bytes((await cleanWav(blob(src)))!);
    expect(found(out, MARKERS)).toEqual([]);
    expect(new DataView(out.buffer).getUint32(4, true) + 8).toBe(out.length);
    const data = (b: Uint8Array) => b.subarray(indexOf(b, new TextEncoder().encode("data")));
    expect([...data(out)]).toEqual([...data(src)]);
    expect(await cleanWav(blob(out))).toBeNull();
    const rf64 = new Uint8Array(src);
    rf64.set(new TextEncoder().encode("RF64"));
    await expect(cleanWav(blob(rf64))).rejects.toThrow(/malformed/);
  });
});
