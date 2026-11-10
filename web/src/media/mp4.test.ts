// Task 9c : nettoyage en place des MP4, MOV et M4A (spec §35.2) sur les fichiers d'essai de
// scripts/gen-media-fixtures.sh (ffmpeg, repères fictifs « Reper… »).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ascii, u32be } from "./bytes";
import { children, fullBox, type Box } from "./isobmff";
import { cleanMp4 } from "./mp4";
import { patchedBlob } from "./patch";
import { found } from "./test-markers";

const fx = (n: string) => new Uint8Array(readFileSync(new URL(`./fixtures/${n}`, import.meta.url)));
const MARKERS = ["ReperTitre", "ReperArtiste", "ReperComment", "ReperMake", "ReperModel", "ReperSoftware", "ReperAlbum", "ReperLogiciel", "+12.5822", "2001-02-03", "Lavf"];

async function clean(bytes: Uint8Array): Promise<Uint8Array> {
  const src = new Blob([bytes as Uint8Array<ArrayBuffer>]);
  return new Uint8Array(await patchedBlob(src, await cleanMp4(src)).arrayBuffer());
}
/** Chemin de boîtes, ex. ["moov", "trak"] : toutes les boîtes qui y correspondent. */
function find(b: Uint8Array, path: string[], from = 0, to = b.length): Box[] {
  const [head, ...rest] = path;
  const hits = children(b, from, to).filter((x) => x.type === head);
  return rest.length === 0 ? hits : hits.flatMap((x) => find(b, rest, x.start + x.head, x.end));
}
const tracks = (b: Uint8Array) => find(b, ["moov", "trak"]);
const mdatOf = (b: Uint8Array) => find(b, ["mdat"]).map((x) => b.subarray(x.start, x.end));

describe("MP4, MOV, M4A : nettoyage en place", () => {
  for (const name of ["phone.mov", "faststart.mp4", "frag.mp4", "tags.m4a"]) {
    it(`${name} : aucun repère, même longueur, rien à refaire au 2e passage`, async () => {
      const src = fx(name);
      expect(found(src, MARKERS).length).toBeGreaterThan(0);
      const out = await clean(src);
      expect(found(out, MARKERS)).toEqual([]);
      expect(out.length).toBe(src.length);
      expect(await cleanMp4(new Blob([out as Uint8Array<ArrayBuffer>]))).toEqual([]);
    });
  }

  it("phone.mov : dates à 0, matrice de rotation gardée, piste tmcd devenue free et ses échantillons à zéro, audio et vidéo intacts", async () => {
    const src = fx("phone.mov");
    const out = await clean(src);
    for (const t of ["mvhd"]) {
      const [x] = find(out, ["moov", t]);
      const { version, body } = fullBox(out, x!);
      expect([...out.subarray(body, body + (version ? 16 : 8))].every((v) => v === 0)).toBe(true);
    }
    // Pistes gardées : vidéo et audio (tmcd retirée).
    const kinds = (b: Uint8Array) => tracks(b).map((t) => ascii(b, fullBox(b, find(b, ["hdlr"], t.start + t.head, t.end)[0] ?? find(b, ["mdia", "hdlr"], t.start + t.head, t.end)[0]!).body + 4, 4));
    expect(kinds(src)).toEqual(["vide", "soun", "tmcd"]);
    expect(kinds(out)).toEqual(["vide", "soun"]);
    // Matrice (36 octets après les champs de tkhd v0 : dates 8, id 4, réservé 4, durée 4, réservé 8, couche 2, groupe 2, volume 2, réservé 2).
    const matrix = (b: Uint8Array) => {
      const tk = find(b, ["tkhd"], tracks(b)[0]!.start + 8, tracks(b)[0]!.end)[0]!;
      const { version, body } = fullBox(b, tk);
      const m = body + (version ? 32 : 20) + 16;
      return [...b.subarray(m, m + 36)];
    };
    expect(matrix(out)).toEqual(matrix(src));
    const be = (...v: number[]) => v.flatMap((n) => [n >>> 24, (n >> 16) & 255, (n >> 8) & 255, n & 255]);
    expect(matrix(src)).not.toEqual(be(0x10000, 0, 0, 0, 0x10000, 0, 0, 0, 0x40000000)); // tournée de 90°, pas l'identité
    for (const t of tracks(out)) {
      const tk = find(out, ["tkhd"], t.start + 8, t.end)[0]!;
      const { body } = fullBox(out, tk);
      expect(u32be(out, body) + u32be(out, body + 4)).toBe(0);
    }
    // mdat : seuls les octets de l'échantillon tmcd (4 octets) changent, et deviennent nuls.
    const [a, b] = [mdatOf(src)[0]!, mdatOf(out)[0]!];
    const diff = [...a.keys()].filter((i) => a[i] !== b[i]);
    expect(diff.length).toBeGreaterThan(0);
    expect(diff.length).toBeLessThanOrEqual(4);
    expect(diff.every((i) => b[i] === 0)).toBe(true);
  });

  it("frag.mp4 : prft neutralisée, moof intacts", async () => {
    const src = fx("frag.mp4");
    const out = await clean(src);
    expect(find(out, ["prft"])).toEqual([]);
    const moofs = (b: Uint8Array) => find(b, ["moof"]).map((x) => [...b.subarray(x.start, x.end)]);
    expect(moofs(out)).toEqual(moofs(src));
    expect(moofs(src).length).toBeGreaterThan(0);
  });

  it("tags.m4a : ilst et pochette retirés, audio identique", async () => {
    const src = fx("tags.m4a");
    const out = await clean(src);
    expect(found(out, ["covr", "ilst"])).toEqual([]);
    expect(mdatOf(out)).toEqual(mdatOf(src));
  });

  it("boîtes uuid (XMP) et free remplie : à zéro", async () => {
    const src = fx("faststart.mp4");
    // uuid XMP de 40 octets et free contenant un repère, ajoutées en fin de fichier.
    const uuid = new Uint8Array(8 + 16 + 16);
    uuid.set([0, 0, 0, 40, 0x75, 0x75, 0x69, 0x64]);
    uuid.set(new TextEncoder().encode("ReperXMPReperXMP"), 24);
    const free = new Uint8Array(24);
    free.set([0, 0, 0, 24, 0x66, 0x72, 0x65, 0x65]);
    free.set(new TextEncoder().encode("ReperFreeReperFr"), 8);
    const all = new Uint8Array([...src, ...uuid, ...free]);
    const out = await clean(all);
    expect(found(out, ["ReperXMP", "ReperFree"])).toEqual([]);
    expect(out.length).toBe(all.length);
  });

  it("pièges : tronqué, sans moov, taille de boîte qui déborde → Malformed, jamais d'exception autre", async () => {
    const src = fx("faststart.mp4");
    for (const n of [7, 20, 100, 700, src.length - 1]) await expect(cleanMp4(new Blob([src.subarray(0, n)]))).rejects.toThrow(/malformed/);
    const noMoov = new Uint8Array(src);
    const m = find(noMoov, ["moov"])[0]!;
    noMoov.set([0x6a, 0x75, 0x6e, 0x6b], m.start + 4); // « junk »
    await expect(cleanMp4(new Blob([noMoov]))).rejects.toThrow(/malformed/);
    const big = new Uint8Array(src);
    big.set([0x7f, 0, 0, 0], m.start);
    await expect(cleanMp4(new Blob([big]))).rejects.toThrow(/malformed/);
  });
});
