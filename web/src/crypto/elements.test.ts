// Paquet d'un envoi dès l'ajout (spec §41.14) : clé par élément, éléments sur des frontières
// de segment, manifeste et en-tête produits au clic, palier final canonique.
import { describe, expect, it, vi } from "vitest";
import { CHUNK, CHUNK_CT, HEADER, SEG_CHUNKS, bucketFor, openStream, segmentCount, segmentSize } from "./container";
import { DATA_SEGMENTS, SEG_PLAIN, chunksFor, elementSealer, footprintFor, isSmall, reservationFor, sealFinal, segmentsFor, segmentsNeeded } from "./elements";
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

/** Envoie les plages de l'élément placé au morceau `first` dans des segments complets (aléa ailleurs). */
async function upload(blob: Blob, first: number, out: Map<number, Uint8Array>) {
  const el = await elementSealer(blob, first);
  for (const [j, p] of el.pieces.entries()) {
    const pre = p.seg === 0 ? HEADER : 0;
    let s = out.get(p.seg);
    if (!s) {
      const fresh = new Uint8Array(pre + SEG_CHUNKS * CHUNK_CT);
      for (let o = 0; o < fresh.length; o += 65536) crypto.getRandomValues(fresh.subarray(o, Math.min(fresh.length, o + 65536)));
      out.set(p.seg, (s = fresh));
    }
    const b = await el.piece(j);
    s.set(b, pre + p.from * CHUNK_CT - (p.seg === 0 && p.from === 0 ? HEADER : 0));
  }
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
    await upload(new Blob([removed]), 128, up);
    const eb = await upload(new Blob([b]), 192, up);
    const note = utf8("bonjour é"); // note élément (D41-36), juste après b dans le segment 3
    const en = await upload(new Blob([note]), 194, up);
    up.delete(2); // effacé par le serveur
    const keys = await contentKeys(newSeed());
    const fin = await sealFinal(
      [
        { kind: "text", name: "note", mime: "text/plain", size: note.length, first: 194, k: en.k },
        { kind: "file", name: "b.bin", mime: "application/octet-stream", size: b.length, first: 192, k: eb.k },
        { kind: "file", name: "a.bin", mime: "application/octet-stream", size: a.length, first: 0, k: ea.k },
      ],
      keys,
      { rights: "enregistrer" },
    );
    expect(fin.bucket).toBe(bucketFor(194 * CHUNK + note.length));
    expect(fin.header.length).toBe(HEADER);
    expect(fin.tail.length).toBe(CHUNK_CT);
    const segs = assemble(fin.bucket, up, fin.header, fin.tail);
    const rd = await openStream(async (n) => new Uint8Array(segs[n]!), fin.bucket, keys);
    expect(rd.manifest.items.map((e) => e.name)).toEqual(["note", "b.bin", "a.bin"]);
    expect(rd.manifest.items.map((e) => e.offset)).toEqual([194 * CHUNK, 3 * SEG_PLAIN, 0]);
    // Texte déchiffré à l'ouverture ; le manifeste chiffré ne le porte pas.
    expect(rd.manifest.items[0]!.text).toBe("bonjour é");
    expect(same(await rd.item(1), b)).toBe(true);
    expect(same(await rd.item(2), a)).toBe(true);
    expect(new TextDecoder().decode(await rd.item(0))).toBe("bonjour é");
  });

  it("note de 100 000 caractères (D41-36) : élément chiffré, relue à l'ouverture ; UTF-8 invalide → paquet_corrompu", async () => {
    const long = "é".repeat(99_999) + "€"; // 100 000 points de code, 200 001 octets : bien plus que MANIFEST_MAX
    const raw = utf8(long);
    const up = new Map<number, Uint8Array>();
    const el = await upload(new Blob([raw]), 0, up);
    const keys = await contentKeys(newSeed());
    const fin = await sealFinal([{ kind: "text", name: "n", mime: "text/plain", size: raw.length, first: 0, k: el.k }], keys, {});
    const segs = assemble(fin.bucket, up, fin.header, fin.tail);
    const rd = await openStream(async (n) => new Uint8Array(segs[n]!), fin.bucket, keys);
    expect(rd.manifest.items[0]!.text).toBe(long);
    expect(rd.manifest.items[0]!.size).toBe(raw.length);
    const up2 = new Map<number, Uint8Array>();
    const bad = await upload(new Blob([new Uint8Array([0xff, 0xfe])]), 0, up2);
    const keys2 = await contentKeys(newSeed());
    const fin2 = await sealFinal([{ kind: "text", name: "n", mime: "text/plain", size: 2, first: 0, k: bad.k }], keys2, {});
    const segs2 = assemble(fin2.bucket, up2, fin2.header, fin2.tail);
    await expect(openStream(async (n) => new Uint8Array(segs2[n]!), fin2.bucket, keys2)).rejects.toThrow("paquet_corrompu");
  });

  it("segment 0 : zone d'en-tête vide (écrite par le serveur) ; chaque segment produit une seule fois", async () => {
    const el = await elementSealer(new Blob([pseudo(10, 4)]), 0);
    const s = await el.piece(0);
    expect(s.length).toBe(HEADER + CHUNK_CT); // un morceau, aucun bourrage
    expect(s.subarray(0, HEADER).every((x) => x === 0)).toBe(true);
    await expect(el.piece(0)).rejects.toThrow("segment_deja_produit");
    await expect(el.piece(1)).rejects.toThrow("segment_invalide");
    const el5 = await elementSealer(new Blob([pseudo(10, 4)]), 320);
    expect((await el5.piece(0)).length).toBe(CHUNK_CT);
  });

  it("clé neuve par élément : même contenu, même place → chiffrés différents ; jamais de clé en clair", async () => {
    const data = pseudo(70_000, 5);
    const e1 = await elementSealer(new Blob([data]), 64);
    const e2 = await elementSealer(new Blob([data]), 64);
    expect(same(e1.k, e2.k)).toBe(false);
    const s1 = await e1.piece(0), s2 = await e2.piece(0);
    expect(same(s1.subarray(0, 100), s2.subarray(0, 100))).toBe(false);
  });

  it("aucun nonce répété sous une même clé d'élément", async () => {
    const spy = vi.spyOn(crypto.subtle, "encrypt");
    try {
      const el = await elementSealer(new Blob([pseudo(9 * MIB, 6)]), 448);
      for (let j = 0; j < el.pieces.length; j++) await el.piece(j);
      const ivs = spy.mock.calls.map((c) => Array.from((c[0] as AesGcmParams).iv as Uint8Array).join(","));
      expect(new Set(ivs).size).toBe(ivs.length);
      expect(ivs.length).toBe(144); // 9 Mio : 144 morceaux, pas 3 segments pleins
      expect(el.pieces).toEqual([
        { seg: 7, from: 0, chunks: 64 },
        { seg: 8, from: 0, chunks: 64 },
        { seg: 9, from: 0, chunks: 16 },
      ]);
    } finally {
      spy.mockRestore();
    }
  });

  it("intégrité : morceau échangé entre deux éléments, ou clé d'élément absente → paquet_corrompu", async () => {
    const a = pseudo(CHUNK * 2, 7), b = pseudo(CHUNK * 2, 8);
    const up = new Map<number, Uint8Array>();
    const ea = await upload(new Blob([a]), 0, up);
    const eb = await upload(new Blob([b]), 64, up);
    const keys = await contentKeys(newSeed());
    const fin = await sealFinal(
      [
        { kind: "file", name: "a", mime: "x/y", size: a.length, first: 0, k: ea.k },
        { kind: "file", name: "b", mime: "x/y", size: b.length, first: 64, k: eb.k },
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
    await expect(sealFinal([{ kind: "text", name: "t", mime: "text/plain", size: 400_001, first: 0, k }], keys, {})).rejects.toThrow("texte_trop_long");
    await expect(sealFinal([{ kind: "file", name: "x".repeat(70_000), mime: "x/y", size: 1, first: 0, k }], await contentKeys(newSeed()), {})).rejects.toThrow("manifeste_trop_gros");
    await expect(sealFinal([{ kind: "file", name: "f", mime: "x/y", size: 10, first: 32768, k }], await contentKeys(newSeed()), {})).rejects.toThrow("trop_gros");
    await expect(
      sealFinal(
        [
          { kind: "file", name: "f", mime: "x/y", size: 5 * MIB, first: 0, k },
          { kind: "file", name: "g", mime: "x/y", size: 10, first: 64, k },
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
    const fin = await sealFinal([{ kind: "file", name: "a", mime: "x/y", size: 10, first: 0, k: el.k.slice(0, 31) }], keys, {});
    const segs = assemble(fin.bucket, up, fin.header, fin.tail);
    await expect(openStream(async (n) => new Uint8Array(segs[n]!), fin.bucket, keys)).rejects.toThrow("paquet_corrompu");
  });

  it("nettoyage dans le manifeste chiffré (D41-35) : relu ; absent → absent ; valeur inconnue ignorée", async () => {
    const up = new Map<number, Uint8Array>();
    const a = await upload(new Blob([pseudo(10, 3)]), 0, up);
    const b = await upload(new Blob([pseudo(10, 4)]), 1, up);
    const c = await upload(new Blob([pseudo(10, 5)]), 2, up);
    const t = await upload(new Blob([utf8("x")]), 3, up);
    const keys = await contentKeys(newSeed());
    const fin = await sealFinal(
      [
        { kind: "file", name: "a.jpg", mime: "image/jpeg", size: 10, first: 0, k: a.k, clean: "image" },
        { kind: "file", name: "b.zip", mime: "application/zip", size: 10, first: 1, k: b.k, clean: "tel_quel" },
        { kind: "file", name: "c.bin", mime: "x/y", size: 10, first: 2, k: c.k },
        { kind: "text", name: "t", mime: "text/plain", size: 1, first: 3, k: t.k },
      ],
      keys,
      {},
    );
    const segs = assemble(fin.bucket, up, fin.header, fin.tail);
    const rd = await openStream(async (n) => new Uint8Array(segs[n]!), fin.bucket, keys);
    expect(rd.manifest.items.map((e) => e.clean)).toEqual(["image", "tel_quel", undefined, undefined]);
    // Le clair du serveur ne contient rien du nettoyage : seul le morceau chiffré le porte.
    const plain = new TextDecoder().decode(fin.header);
    expect(plain).not.toMatch(/image|tel_quel|clean/);
    // Version plus récente : valeur inconnue → ignorée (pas une erreur).
    const keys2 = await contentKeys(newSeed());
    const odd = await sealFinal([{ kind: "file", name: "a", mime: "x/y", size: 10, first: 0, k: a.k, clean: "plus_tard" as never }], keys2, {});
    const rd2 = await openStream(async (n) => new Uint8Array(assemble(odd.bucket, up, odd.header, odd.tail)[n]!), odd.bucket, keys2);
    expect(rd2.manifest.items[0]!.clean).toBeUndefined();
    expect("clean" in rd2.manifest.items[0]!).toBe(false);
  });

  // Audit H-2 : petits éléments empaquetés dans un segment partagé, sans bourrage.
  it("empaquetage : petits éléments par morceaux dans un segment partagé, grand élément sur sa frontière ; lecture", async () => {
    expect([0, 1, CHUNK, CHUNK + 1, SEG_PLAIN - 1, SEG_PLAIN].map(chunksFor)).toEqual([0, 1, 1, 2, 64, 64]);
    expect([0, 1, SEG_PLAIN - 1, SEG_PLAIN].map(isSmall)).toEqual([false, true, true, false]);
    // Emprise (Q-H2-1) : petit élément arrondi à une puissance de deux de morceaux, jusqu'au segment.
    expect([0, 1, CHUNK + 1, 3 * CHUNK, 5 * CHUNK, 33 * CHUNK, SEG_PLAIN - 1, SEG_PLAIN, SEG_PLAIN + 1].map(footprintFor)).toEqual([0, 1, 2, 4, 8, 64, 64, 64, 65]);
    expect(segmentsNeeded([5 * CHUNK, 5 * CHUNK, 5 * CHUNK, 5 * CHUNK, 5 * CHUNK, 5 * CHUNK, 5 * CHUNK, 5 * CHUNK, 1])).toBe(2); // 8 × 8 + 1
    // 20 photos de 1 Mo : 16 morceaux chacune, 320 morceaux, 5 segments (et non 20).
    expect(segmentsNeeded(Array(20).fill(1_000_000))).toBe(5);
    expect(segmentsNeeded([SEG_PLAIN + 1, 10, 10])).toBe(3);
    // Q-H2-2 (D41-21) : dernier segment d'un grand élément arrondi à une puissance de deux de morceaux.
    expect([SEG_PLAIN + 3 * CHUNK, SEG_PLAIN + 33 * CHUNK, 2 * SEG_PLAIN, 2 * SEG_PLAIN + 5 * CHUNK + 1].map(footprintFor)).toEqual([68, 128, 128, 136]);
    await expect(elementSealer(new Blob([pseudo(2 * CHUNK, 1)]), 63)).rejects.toThrow("place_invalide"); // déborde du segment
    await expect(elementSealer(new Blob([pseudo(SEG_PLAIN, 1)]), 1)).rejects.toThrow("place_invalide"); // grand hors frontière
    const a = pseudo(100_000, 11); // morceaux 0-1
    const gone = pseudo(150_000, 12); // 3 morceaux, emprise 4 (Q-H2-1) : morceaux 2-5, retiré
    const c = pseudo(10, 13); // morceau 6
    const big = pseudo(SEG_PLAIN + 5, 14); // segments 1-2 (1 morceau au segment 2)
    const up = new Map<number, Uint8Array>();
    const ea = await upload(new Blob([a]), 0, up);
    const eg = await elementSealer(new Blob([gone]), 2);
    expect(eg.pieces).toEqual([{ seg: 0, from: 2, chunks: 4 }]);
    expect((await eg.piece(0)).length).toBe(4 * CHUNK_CT);
    const ec = await upload(new Blob([c]), 6, up);
    const eb = await upload(new Blob([big]), 64, up);
    expect(eb.pieces.map((p) => p.chunks)).toEqual([64, 1]);
    const keys = await contentKeys(newSeed());
    const fin = await sealFinal(
      [
        { kind: "file", name: "c", mime: "x/y", size: c.length, first: 6, k: ec.k },
        { kind: "file", name: "big", mime: "x/y", size: big.length, first: 64, k: eb.k },
        { kind: "file", name: "a", mime: "x/y", size: a.length, first: 0, k: ea.k },
      ],
      keys,
      {},
    );
    expect(fin.bucket).toBe(bucketFor(64 * CHUNK + big.length));
    const segs = assemble(fin.bucket, up, fin.header, fin.tail);
    const rd = await openStream(async (n) => new Uint8Array(segs[n]!), fin.bucket, keys);
    expect(rd.manifest.items.map((e) => e.offset)).toEqual([6 * CHUNK, SEG_PLAIN, 0]);
    expect(same(await rd.item(0), c)).toBe(true);
    expect(same(await rd.item(1), big)).toBe(true);
    expect(same(await rd.item(2), a)).toBe(true);
    await expect(
      sealFinal(
        [
          { kind: "file", name: "a", mime: "x/y", size: a.length, first: 0, k: ea.k },
          { kind: "file", name: "b", mime: "x/y", size: 10, first: 1, k: ec.k },
        ],
        await contentKeys(newSeed()),
        {},
      ),
    ).rejects.toThrow("chevauchement");
  });
});
