// Paquet d'un envoi dès l'ajout (spec §41.14) : clé par élément, éléments sur des frontières
// de segment, manifeste et en-tête produits au clic, palier final canonique.
import { describe, expect, it, vi } from "vitest";
import { CHUNK, CHUNK_CT, HEADER, SEG_CHUNKS, bucketFor, openStream, segmentCount, segmentSize } from "./container";
import { DATA_SEGMENTS, SEG_PLAIN, elementSealer, reservationFor, sealFinal, segmentsFor } from "./elements";
import { utf8 } from "./encoding";
import { contentKeys, newSeed } from "./envelope";

const MIB = 1048576;

function pseudo(n: number, seed: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(n);
  let x = seed;
  for (let i = 0; i < n; i++) {
    x = (x * 1103515245 + 12345) >>> 0;
    out[i] = x >>> 24;
  }
  return out;
}

const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);

/** Émule le fichier du serveur après finalize : segments reçus (pleins), trous en aléa, en-tête, manifeste. */
function assemble(bucket: number, uploaded: Map<number, Uint8Array>, header: Uint8Array, tail: Uint8Array) {
  const segs: Uint8Array<ArrayBuffer>[] = [];
  for (let n = 0; n < segmentCount(bucket); n++) {
    const size = segmentSize(bucket, n);
    const up = uploaded.get(n);
    const s = new Uint8Array(size);
    if (up) s.set(up.subarray(0, size));
    else for (let o = 0; o < size; o += 65536) crypto.getRandomValues(s.subarray(o, Math.min(size, o + 65536)));
    segs.push(s);
  }
  segs[0]!.set(header, 0);
  const last = bucket - 1;
  const n = Math.floor(last / SEG_CHUNKS);
  segs[n]!.set(tail, (n === 0 ? HEADER : 0) + (last % SEG_CHUNKS) * CHUNK_CT);
  return segs;
}

async function upload(blob: Blob, first: number, out: Map<number, Uint8Array>) {
  const el = await elementSealer(blob, first);
  for (let j = 0; j < el.segments; j++) out.set(first + j, await el.segment(j));
  return el;
}

describe("éléments (spec §41.14)", () => {
  it("segmentsFor, reservationFor : segments entiers, dernier morceau libre pour le manifeste", () => {
    expect(SEG_PLAIN).toBe(4 * MIB);
    expect(DATA_SEGMENTS).toBe(512);
    expect([0, 1, 4 * MIB, 4 * MIB + 1].map(segmentsFor)).toEqual([0, 1, 1, 2]);
    expect(reservationFor(0)).toBe(1);
    expect(reservationFor(1)).toBe(80); // segment 0 plein + morceau du manifeste
    expect(reservationFor(2)).toBe(160);
    expect(reservationFor(512)).toBe(32769);
    expect(() => reservationFor(513)).toThrow("trop_gros");
  });

  it("aller-retour : deux fichiers gardés, un retiré, ordre d'affichage du manifeste, palier final canonique", async () => {
    const a = pseudo(5 * MIB, 1); // segments 0 et 1
    const removed = pseudo(3 * MIB, 2); // segment 2, retiré ensuite
    const b = pseudo(100_000, 3); // segment 3
    const up = new Map<number, Uint8Array>();
    const ea = await upload(new Blob([a]), 0, up);
    await upload(new Blob([removed]), 2, up);
    const eb = await upload(new Blob([b]), 3, up);
    up.delete(2); // effacé par le serveur
    const keys = await contentKeys(newSeed());
    const fin = await sealFinal(
      [
        { kind: "text", name: "note", mime: "text/plain", text: "bonjour" },
        { kind: "file", name: "b.bin", mime: "application/octet-stream", size: b.length, firstSeg: 3, k: eb.k },
        { kind: "file", name: "a.bin", mime: "application/octet-stream", size: a.length, firstSeg: 0, k: ea.k },
      ],
      keys,
      { rights: "enregistrer" },
    );
    expect(fin.bucket).toBe(bucketFor(3 * SEG_PLAIN + b.length));
    expect(fin.header.length).toBe(HEADER);
    expect(fin.tail.length).toBe(CHUNK_CT);
    const segs = assemble(fin.bucket, up, fin.header, fin.tail);
    const rd = await openStream(async (n) => new Uint8Array(segs[n]!), fin.bucket, keys);
    expect(rd.manifest.items.map((e) => e.name)).toEqual(["note", "b.bin", "a.bin"]);
    expect(rd.manifest.items.map((e) => e.offset)).toEqual([0, 3 * SEG_PLAIN, 0]);
    expect(same(await rd.item(1), b)).toBe(true);
    expect(same(await rd.item(2), a)).toBe(true);
    expect(new TextDecoder().decode(await rd.item(0))).toBe("bonjour");
  });

  it("segment 0 : zone d'en-tête vide (écrite par le serveur) ; chaque segment produit une seule fois", async () => {
    const el = await elementSealer(new Blob([pseudo(10, 4)]), 0);
    const s = await el.segment(0);
    expect(s.length).toBe(HEADER + SEG_CHUNKS * CHUNK_CT);
    expect(s.subarray(0, HEADER).every((x) => x === 0)).toBe(true);
    await expect(el.segment(0)).rejects.toThrow("segment_deja_produit");
    await expect(el.segment(1)).rejects.toThrow("segment_invalide");
    const el5 = await elementSealer(new Blob([pseudo(10, 4)]), 5);
    expect((await el5.segment(0)).length).toBe(SEG_CHUNKS * CHUNK_CT);
  });

  it("clé neuve par élément : même contenu, même place → chiffrés différents ; jamais de clé en clair", async () => {
    const data = pseudo(70_000, 5);
    const e1 = await elementSealer(new Blob([data]), 1);
    const e2 = await elementSealer(new Blob([data]), 1);
    expect(same(e1.k, e2.k)).toBe(false);
    const s1 = await e1.segment(0), s2 = await e2.segment(0);
    expect(same(s1.subarray(0, 100), s2.subarray(0, 100))).toBe(false);
  });

  it("aucun nonce répété sous une même clé d'élément", async () => {
    const spy = vi.spyOn(crypto.subtle, "encrypt");
    try {
      const el = await elementSealer(new Blob([pseudo(9 * MIB, 6)]), 7);
      for (let j = 0; j < el.segments; j++) await el.segment(j);
      const ivs = spy.mock.calls.map((c) => Array.from((c[0] as AesGcmParams).iv as Uint8Array).join(","));
      expect(new Set(ivs).size).toBe(ivs.length);
      expect(ivs.length).toBe(3 * SEG_CHUNKS);
    } finally {
      spy.mockRestore();
    }
  });

  it("intégrité : morceau échangé entre deux éléments, ou clé d'élément absente → paquet_corrompu", async () => {
    const a = pseudo(CHUNK * 2, 7), b = pseudo(CHUNK * 2, 8);
    const up = new Map<number, Uint8Array>();
    const ea = await upload(new Blob([a]), 0, up);
    const eb = await upload(new Blob([b]), 1, up);
    const keys = await contentKeys(newSeed());
    const fin = await sealFinal(
      [
        { kind: "file", name: "a", mime: "x/y", size: a.length, firstSeg: 0, k: ea.k },
        { kind: "file", name: "b", mime: "x/y", size: b.length, firstSeg: 1, k: eb.k },
      ],
      keys,
      {},
    );
    const segs = assemble(fin.bucket, up, fin.header, fin.tail);
    // Premier morceau de b recopié à la place du premier morceau de a.
    segs[0]!.set(segs[1]!.subarray(0, CHUNK_CT), HEADER);
    const rd = await openStream(async (n) => new Uint8Array(segs[n]!), fin.bucket, keys);
    await expect(rd.item(0)).rejects.toThrow("paquet_corrompu");
    expect(same(await rd.item(1), b)).toBe(true);
  });

  it("sealFinal : manifeste trop gros, place au-delà de 2 Gio, ou éléments qui se chevauchent refusés", async () => {
    const keys = await contentKeys(newSeed());
    const k = new Uint8Array(32);
    await expect(sealFinal([{ kind: "text", name: "t", mime: "text/plain", text: "x".repeat(70_000) }], keys, {})).rejects.toThrow();
    await expect(sealFinal([{ kind: "file", name: "f", mime: "x/y", size: 10, firstSeg: 512, k }], await contentKeys(newSeed()), {})).rejects.toThrow("trop_gros");
    await expect(
      sealFinal(
        [
          { kind: "file", name: "f", mime: "x/y", size: 5 * MIB, firstSeg: 0, k },
          { kind: "file", name: "g", mime: "x/y", size: 10, firstSeg: 1, k },
        ],
        await contentKeys(newSeed()),
        {},
      ),
    ).rejects.toThrow("chevauchement");
    expect(utf8("x").length).toBe(1);
  });

  it("lecture : `k` mal formé (longueur) → paquet_corrompu", async () => {
    const up = new Map<number, Uint8Array>();
    const el = await upload(new Blob([pseudo(10, 9)]), 0, up);
    const keys = await contentKeys(newSeed());
    const fin = await sealFinal([{ kind: "file", name: "a", mime: "x/y", size: 10, firstSeg: 0, k: el.k.slice(0, 31) }], keys, {});
    const segs = assemble(fin.bucket, up, fin.header, fin.tail);
    await expect(openStream(async (n) => new Uint8Array(segs[n]!), fin.bucket, keys)).rejects.toThrow("paquet_corrompu");
  });
});
