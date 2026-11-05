import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  BUCKETS,
  CHUNK,
  CHUNK_CT,
  CONTENT_MAX,
  HEADER,
  MANIFEST_MAX,
  PREVIEW_MAX,
  bucketFor,
  openStream,
  parseRights,
  readHeader,
  sealStream,
  segmentCount,
  segmentSize,
  type ContainerReader,
  type Item,
} from "./container";
import { concat, utf8 } from "./encoding";
import { contentKeys, newSeed, type ContentKeys } from "./envelope";

const MIB = 1048576;
let keys: ContentKeys;

beforeAll(async () => {
  keys = await contentKeys(newSeed());
});

function pseudo(n: number, seed: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(n);
  let x = seed;
  for (let i = 0; i < n; i++) {
    x = (x * 1103515245 + 12345) >>> 0;
    out[i] = x >>> 24;
  }
  return out;
}

function contains(hay: Uint8Array<ArrayBuffer>, needle: Uint8Array<ArrayBuffer>): boolean {
  outer: for (let i = 0; i + needle.length <= hay.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
    return true;
  }
  return false;
}

const same = (a: Uint8Array<ArrayBuffer>, b: Uint8Array<ArrayBuffer>) => a.length === b.length && a.every((x, i) => x === b[i]);

const copy = (segs: Uint8Array<ArrayBuffer>[]) => segs.map((s) => new Uint8Array(s));

// Chiffre les segments à envoyer ; les segments de bourrage (fill) restent vides, comme
// avant que le serveur les remplisse (le lecteur ne les lit jamais).
async function seal(items: Item[], k: ContentKeys, o?: Parameters<typeof sealStream>[2]) {
  const s = await sealStream(items, k, o);
  const segments: Uint8Array<ArrayBuffer>[] = [];
  for (let n = 0; n < s.segmentCount; n++) {
    segments.push(n >= s.fill.from && n < s.fill.to ? new Uint8Array(segmentSize(s.bucket, n)) : await s.segment(n));
  }
  return { bucket: s.bucket, segments, sealer: s };
}

// Serveur simulé : rend une copie du segment demandé (vide s'il manque) et compte les appels.
function server(segs: Uint8Array<ArrayBuffer>[]) {
  const calls: number[] = [];
  const fetch = async (n: number) => {
    calls.push(n);
    return new Uint8Array(segs[n] ?? new Uint8Array(0));
  };
  return { calls, fetch };
}

// Ouvre et lit tous les éléments ; le palier est celui annoncé par le serveur (meta).
async function open(segs: Uint8Array<ArrayBuffer>[], bucket: number, k: ContentKeys = keys) {
  const o = await openStream(server(segs).fetch, bucket, k);
  const items: Uint8Array<ArrayBuffer>[] = [];
  for (let i = 0; i < o.manifest.items.length; i++) items.push(await o.item(i));
  return { manifest: o.manifest, items, o };
}

async function streamed(o: ContainerReader, i: number): Promise<Uint8Array<ArrayBuffer>> {
  const parts: Uint8Array[] = [];
  await o.streamItem(i, (c) => {
    expect(c.length).toBeGreaterThan(0);
    expect(c.length).toBeLessThanOrEqual(CHUNK);
    parts.push(c);
  });
  return concat(...parts.map((p) => new Uint8Array(p)));
}

const hdr = (k: ContentKeys) => concat(utf8("SHH2"), new Uint8Array([2]), new Uint8Array(11), k.engagement);

// Fin du clair v2 : manifeste JSON puis sa longueur (4 octets, gros-boutiste).
function tail(m: unknown): Uint8Array<ArrayBuffer> {
  const j = typeof m === "string" ? utf8(m) : utf8(JSON.stringify(m));
  const len = new Uint8Array(4);
  new DataView(len.buffer).setUint32(0, j.length);
  return concat(j, len);
}

// Construit un paquet bien chiffré mais au clair arbitraire (expéditeur malveillant) :
// `data` à partir de l'octet 0, `end` dans les derniers octets, zéros entre les deux.
// `segs` : segments produits (les autres restent vides) ; `last` : indice du morceau marqué
// « dernier » (par défaut le vrai dernier).
async function forge(
  data: Uint8Array<ArrayBuffer>,
  end: Uint8Array<ArrayBuffer>,
  bucket: number,
  k: ContentKeys,
  o: { segs?: number[]; last?: number } = {},
): Promise<Uint8Array<ArrayBuffer>[]> {
  const header = hdr(k);
  const last = o.last ?? bucket - 1;
  const cap = bucket * CHUNK;
  const out: Uint8Array<ArrayBuffer>[] = [];
  for (let s = 0; s < segmentCount(bucket); s++) {
    if (o.segs !== undefined && !o.segs.includes(s)) {
      out.push(new Uint8Array(0));
      continue;
    }
    const cts: Uint8Array<ArrayBuffer>[] = [];
    for (let i = s * 64; i < Math.min(bucket, (s + 1) * 64); i++) {
      const iv = new Uint8Array(12);
      new DataView(iv.buffer).setUint32(7, i);
      iv[11] = i === last ? 1 : 0;
      const a = i * CHUNK;
      const chunk = new Uint8Array(CHUNK);
      if (a < data.length) chunk.set(data.subarray(a, a + CHUNK));
      const t0 = cap - end.length;
      for (let p = Math.max(a, t0); p < a + CHUNK; p++) chunk[p - a] = end[p - t0]!;
      cts.push(new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: header, tagLength: 128 }, k.kContenu, chunk)));
    }
    out.push(s === 0 ? concat(header, ...cts) : concat(...cts));
  }
  return out;
}

const freshKeys = (): Promise<ContentKeys> => contentKeys(newSeed());

describe("paliers et segments (v2)", () => {
  it("palier canonique = plus petit palier ≥ fin des données + un morceau (manifeste ≤ 65 532 + 4 octets)", () => {
    expect(BUCKETS).toEqual([1, 16, 80, 160, 400, 800, 1600, 4000, 8000, 16385]);
    expect(MANIFEST_MAX).toBe(65532);
    const room = 4 + MANIFEST_MAX;
    expect(room).toBe(CHUNK);
    expect(bucketFor(0)).toBe(1); // texte seul : palier 1 (64 Kio)
    expect(bucketFor(1)).toBe(16);
    expect(bucketFor(16 * CHUNK - room)).toBe(16);
    expect(bucketFor(16 * CHUNK - room + 1)).toBe(80);
    for (const b of BUCKETS.slice(1)) {
      expect(bucketFor(b * CHUNK - room)).toBe(b);
      if (b !== 16385) expect(bucketFor(b * CHUNK - room + 1)).toBe(BUCKETS[BUCKETS.indexOf(b) + 1]);
    }
    expect(CONTENT_MAX).toBe(1073741824); // exactement 1 Gio de données (« 1 Go » affiché)
    expect(() => bucketFor(CONTENT_MAX + 1)).toThrow("trop_gros");
    expect(() => bucketFor(-1)).toThrow();
    expect(() => bucketFor(1.5)).toThrow();
  });
  it("segmentCount / segmentSize", () => {
    expect(segmentCount(16)).toBe(1);
    expect(segmentCount(80)).toBe(2);
    expect(segmentCount(400)).toBe(7);
    expect(segmentCount(16385)).toBe(257);
    expect(segmentSize(16385, 256)).toBe(65552); // dernier segment : le morceau du manifeste
    expect(segmentSize(1600, 0)).toBe(48 + 64 * 65552);
    expect(segmentSize(80, 1)).toBe(16 * 65552);
    for (const b of BUCKETS) {
      let sum = 0;
      for (let n = 0; n < segmentCount(b); n++) sum += segmentSize(b, n);
      expect(sum).toBe(HEADER + b * CHUNK_CT);
    }
  });
});

describe("sealStream / openStream", () => {
  const texte = "Bonjour MOT-REPERE-123 é😀";
  const a = pseudo(3 * MIB + 123, 1);
  const b = pseudo(2.5 * MIB, 2);
  const items: Item[] = [
    { kind: "text", name: "", mime: "text/plain", data: utf8(texte) },
    { kind: "file", name: "photo.png", mime: "image/png", data: new Blob([a]) },
    { kind: "file", name: "secret-nom.pdf", mime: "application/pdf", data: new Blob([b]) },
  ];
  let sealed: Awaited<ReturnType<typeof seal>>;

  beforeAll(async () => {
    sealed = await seal(items, keys);
  }, 60_000);

  it("aller-retour (Blob) : palier 160, 3 segments, manifeste v2 en fin, octets identiques", async () => {
    expect(sealed.bucket).toBe(160); // 5,5 Mio + 64 Kio + 4 > 80 morceaux
    expect(sealed.segments.length).toBe(3);
    sealed.segments.forEach((s, n) => expect(s.length).toBe(segmentSize(160, n)));
    const { manifest, items: got, o } = await open(sealed.segments, 160);
    expect(manifest).toEqual({
      v: 2,
      rights: "enregistrer",
      items: [
        { kind: "text", name: "", mime: "text/plain", size: 0, offset: 0, text: texte },
        { kind: "file", name: "photo.png", mime: "image/png", size: a.length, offset: 0 },
        { kind: "file", name: "secret-nom.pdf", mime: "application/pdf", size: b.length, offset: a.length },
      ],
    });
    expect(got[0]).toEqual(utf8(texte));
    expect(same(got[1]!, a)).toBe(true);
    expect(same(got[2]!, b)).toBe(true);
    (await o.item(1)).fill(0); // copie
    expect(same(await o.item(1), a)).toBe(true);
    await expect(o.item(3)).rejects.toThrow("element_inexistant");
    await expect(o.item(-1)).rejects.toThrow("element_inexistant");
    await expect(o.streamItem(1.5, () => undefined)).rejects.toThrow("element_inexistant");
  });

  it("clair : données à partir de l'octet 0, manifeste en fin, longueur dans les 4 derniers octets", async () => {
    // Déchiffrement direct des morceaux 0 et 159 (le dernier) avec K_contenu.
    const dec = async (seg: Uint8Array<ArrayBuffer>, start: number, i: number) => {
      const iv = new Uint8Array(12);
      new DataView(iv.buffer).setUint32(7, i);
      iv[11] = i === 159 ? 1 : 0;
      const ct = seg.subarray(start, start + CHUNK_CT);
      return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv, additionalData: hdr(keys) }, keys.kContenu, ct));
    };
    const c0 = await dec(sealed.segments[0]!, HEADER, 0);
    expect(same(c0, a.subarray(0, CHUNK))).toBe(true);
    const last = await dec(sealed.segments[2]!, 31 * CHUNK_CT, 159);
    const mlen = new DataView(last.buffer).getUint32(CHUNK - 4);
    const json = new TextDecoder().decode(last.subarray(CHUNK - 4 - mlen, CHUNK - 4));
    expect(JSON.parse(json).v).toBe(2);
    expect(last.subarray(0, CHUNK - 4 - mlen).every((x) => x === 0)).toBe(true); // zéros avant le manifeste
  });

  it("lecture : segment 0 (en-tête) et dernier segment (manifeste), puis à la demande", async () => {
    const srv = server(sealed.segments);
    const o = await openStream(srv.fetch, 160, keys);
    expect(srv.calls).toEqual([0, 2]);
    expect(same(await o.item(1), a)).toBe(true); // morceaux 0..48 : segment 0
    expect(srv.calls).toEqual([0, 2, 0]);
    expect(same(await o.item(2), b)).toBe(true); // morceaux 48..88 : segments 0 et 1
    expect(srv.calls).toEqual([0, 2, 0, 1]);
    expect(await o.item(0)).toEqual(utf8(texte)); // texte : dans le manifeste
    expect(srv.calls).toEqual([0, 2, 0, 1]);
    o.wipe();
    expect(same(await o.item(1), a)).toBe(true); // après wipe : rechargé
    expect(srv.calls).toEqual([0, 2, 0, 1, 0]);
  });

  it("streamItem : morceaux dans l'ordre, sortie identique à la source", async () => {
    const srv = server(sealed.segments);
    const o = await openStream(srv.fetch, 160, keys);
    expect(same(await streamed(o, 2), b)).toBe(true);
    expect(same(await streamed(o, 1), a)).toBe(true);
    expect(await streamed(o, 0)).toEqual(utf8(texte));
  });

  it("chaque segment n'est chiffré qu'une fois : second appel refusé, n hors palier refusé", async () => {
    const s = await sealStream(items, await freshKeys());
    expect(s.bucket).toBe(160);
    await s.segment(1);
    await expect(s.segment(1)).rejects.toThrow("segment_deja_produit");
    for (const n of [-1, 3, 1.5]) await expect(s.segment(n)).rejects.toThrow("segment_invalide");
  });

  it("aucun numéro de morceau chiffré deux fois (espion sur encrypt : aucun doublon de nonce)", async () => {
    const spy = vi.spyOn(crypto.subtle, "encrypt");
    try {
      const k = await freshKeys();
      const s = await sealStream(items, k);
      for (const n of s.toSend) await s.segment(n);
      for (const n of s.toSend) await expect(s.segment(n)).rejects.toThrow("segment_deja_produit");
      const ivs = spy.mock.calls
        .filter((c) => c[1] === k.kContenu)
        .map((c) => Buffer.from((c[0] as AesGcmParams).iv as Uint8Array).toString("hex"));
      expect(ivs.length).toBe(160);
      expect(new Set(ivs).size).toBe(ivs.length);
    } finally {
      spy.mockRestore();
    }
  });

  it("opérations simultanées sur un même lecteur : sérialisées, sans fausse corruption", async () => {
    const srv = server(sealed.segments);
    const slow = async (n: number) => {
      await new Promise((r) => setTimeout(r, 1));
      return srv.fetch(n);
    };
    const o = await openStream(slow, 160, keys);
    const [t, x, y, z] = await Promise.all([o.item(0), o.item(1), streamed(o, 2), o.item(2)]);
    expect(t).toEqual(utf8(texte));
    expect(same(x, a)).toBe(true);
    expect(same(y, b)).toBe(true);
    expect(same(z, b)).toBe(true);
    const p = o.item(2);
    o.wipe();
    expect(same(await p, b)).toBe(true);
  });

  it("une entrée Uint8Array modifiée après sealStream ne change pas le paquet", async () => {
    const data = pseudo(100_000, 5);
    const k = await freshKeys();
    const s = await sealStream([{ kind: "file", name: "x", mime: "x/y", data }], k);
    data.fill(0);
    const first = await s.segment(0);
    const o = await openStream(server([first]).fetch, s.bucket, k);
    expect(same(await o.item(0), pseudo(100_000, 5))).toBe(true);
  });

  it("texte fourni en Blob", async () => {
    const k = await freshKeys();
    const r = await seal([{ kind: "text", name: "", mime: "text/plain", data: new Blob([utf8("é-blob")]) }], k);
    expect((await open(r.segments, r.bucket, k)).manifest.items[0]!.text).toBe("é-blob");
  });

  it("en-tête en clair « SHH2 », version 2, engagement ; readHeader le relit", () => {
    const h = sealed.segments[0]!.subarray(0, HEADER);
    expect(h).toEqual(hdr(keys));
    expect(sealed.sealer.header).toEqual(hdr(keys));
    expect(readHeader(sealed.segments[0]!)).toEqual({ header: hdr(keys), engagement: keys.engagement });
    for (const pos of [0, 3, 4, 5, 15]) {
      const x = new Uint8Array(sealed.segments[0]!.subarray(0, HEADER));
      x[pos]! ^= 1;
      expect(() => readHeader(x), String(pos)).toThrow(/^paquet_corrompu$/);
    }
    expect(() => readHeader(new Uint8Array(47))).toThrow(/^paquet_corrompu$/);
  });

  it("aucun nom ni texte en clair dans le paquet", () => {
    const all = concat(...sealed.segments);
    expect(contains(all, utf8("secret-nom.pdf"))).toBe(false);
    expect(contains(all, utf8("MOT-REPERE-123"))).toBe(false);
    expect(contains(all, utf8("photo.png"))).toBe(false);
  });

  const corrupt = async (segs: Uint8Array<ArrayBuffer>[], k: ContentKeys = keys, bucket = 160) =>
    expect(open(segs, bucket, k)).rejects.toThrow(/^paquet_corrompu$/);

  it("octet modifié dans le morceau 3", async () => {
    const s = copy(sealed.segments);
    s[0]![HEADER + 3 * CHUNK_CT + 10]! ^= 1;
    await corrupt(s);
  });
  it("octet modifié dans un tag du second segment (morceau 70)", async () => {
    const s = copy(sealed.segments);
    s[1]![7 * CHUNK_CT - 1]! ^= 0x80;
    await corrupt(s);
  });
  it("octet modifié dans le manifeste (dernier morceau)", async () => {
    const s = copy(sealed.segments);
    s[2]![32 * CHUNK_CT - 100]! ^= 1;
    await corrupt(s);
  });
  it("octet modifié : aussi détecté par streamItem", async () => {
    const s = copy(sealed.segments);
    s[1]![10]! ^= 1;
    const o = await openStream(server(s).fetch, 160, keys);
    await expect(streamed(o, 2)).rejects.toThrow(/^paquet_corrompu$/);
  });
  it("deux morceaux échangés", async () => {
    const s = copy(sealed.segments);
    const x = s[0]!.slice(HEADER + CHUNK_CT, HEADER + 2 * CHUNK_CT);
    const y = s[0]!.slice(HEADER + 2 * CHUNK_CT, HEADER + 3 * CHUNK_CT);
    s[0]!.set(y, HEADER + CHUNK_CT);
    s[0]!.set(x, HEADER + 2 * CHUNK_CT);
    await corrupt(s);
  });
  it("paquet tronqué ou allongé (segments de mauvaise taille)", async () => {
    const s = copy(sealed.segments);
    await corrupt([s[0]!, s[1]!, s[2]!.slice(0, -1)]);
    await corrupt([s[0]!, s[1]!, s[2]!.slice(0, -CHUNK_CT)]);
    await corrupt([s[0]!, s[1]!, concat(s[2]!, new Uint8Array(1))]);
    await corrupt([s[0]!.slice(0, -1), s[1]!, s[2]!]);
  });
  it("segment retiré ou segments échangés", async () => {
    const s = copy(sealed.segments);
    await corrupt([s[0]!, s[1]!]);
    await corrupt([s[0]!, s[2]!, s[1]!]);
    await corrupt([s[1]!, s[0]!, s[2]!]);
    await corrupt([]);
  });
  it("palier annoncé faux (le serveur ment)", async () => {
    const s = copy(sealed.segments);
    await corrupt(s, keys, 80);
    await corrupt(s, keys, 400);
    await corrupt(s, keys, 2);
    await corrupt(s, keys, 1);
  });
  it("en-tête modifié (magie, version, réservé, engagement)", async () => {
    for (const pos of [0, 4, 10, 20, 47]) {
      const s = copy(sealed.segments);
      s[0]![pos]! ^= 1;
      await corrupt(s);
    }
  });
  it("paquet d'un autre partage (autre R) ou mauvais engagement dans les clés", async () => {
    const e = new Uint8Array(keys.engagement);
    e[31]! ^= 1;
    await corrupt(copy(sealed.segments), { ...keys, engagement: e });
    const other = await freshKeys();
    await corrupt(copy(sealed.segments), other);
    await corrupt(copy(sealed.segments), { ...keys, kContenu: other.kContenu });
  });
});

describe("bourrage rempli par le serveur (fill)", () => {
  it("palier de 400 morceaux, 11 Mio de données : segments envoyés 0, 1, 2 et 6 ; fill = [3, 6)", async () => {
    // Le brief dit « 9 Mio » : 9 Mio + 64 Kio + 4 tiennent dans le palier 160 (palier
    // canonique). Pour le palier 400 avec des données dans les segments 0 à 2, il faut entre
    // 10 Mio − 65 540 octets et 12 Mio de données (signalé dans le rapport).
    expect(bucketFor(9 * MIB)).toBe(160);
    const k = await freshKeys();
    const s = await sealStream([{ kind: "file", name: "x", mime: "x/y", data: new Blob([new Uint8Array(11 * MIB)]) }], k);
    expect(s.bucket).toBe(400);
    expect(s.segmentCount).toBe(7);
    expect(s.fill).toEqual({ from: 3, to: 6 });
    expect(s.toSend).toEqual([0, 1, 2, 6]);
    await expect(s.segment(4)).rejects.toThrow("segment_invalide");
  });
  it("rien à remplir : fill vide [0, 0) (palier d'un seul segment, ou données jusqu'au manifeste)", async () => {
    const k = await freshKeys();
    const t = await sealStream([{ kind: "text", name: "", mime: "text/plain", data: utf8("a") }], k);
    expect(t.bucket).toBe(1);
    expect(t.fill).toEqual({ from: 0, to: 0 });
    expect(t.toSend).toEqual([0]);
    const f = await sealStream([{ kind: "file", name: "x", mime: "x/y", data: new Blob([new Uint8Array(5 * MIB)]) }], await freshKeys());
    expect(f.bucket).toBe(160);
    expect(f.fill).toEqual({ from: 0, to: 0 });
    expect(f.toSend).toEqual([0, 1, 2]);
  });
  it("aller-retour sur tous les paliers (bourrage jamais lu, laissé vide ici)", async () => {
    for (const b of BUCKETS) {
      const size = Math.max(0, b * CHUNK - 4 - MANIFEST_MAX - 1000);
      const blob = { size, slice: (lo: number, hi: number) => new Blob([new Uint8Array(hi - lo).fill(lo % 251)]) } as unknown as Blob;
      const k = await freshKeys();
      const s = await sealStream([{ kind: "file", name: "f", mime: "x/y", data: blob }], k);
      expect(s.bucket, `palier ${b}`).toBe(b);
      // Seuls le segment 0 et le dernier sont chiffrés : un paquet de 1 Gio ne tient pas ici ;
      // l'ouverture lit l'en-tête et le manifeste, puis vérifie le palier canonique.
      const segs: Uint8Array<ArrayBuffer>[] = Array.from({ length: s.segmentCount }, () => new Uint8Array(0));
      segs[0] = await s.segment(0);
      if (s.segmentCount > 1) segs[s.segmentCount - 1] = await s.segment(s.segmentCount - 1);
      const o = await openStream(server(segs).fetch, b, k);
      expect(o.manifest.items[0]!.size).toBe(size);
      // Le manifeste tient dans le dernier morceau, donc dans le dernier segment.
      expect(s.fill.from === s.fill.to || s.fill.to === s.segmentCount - 1).toBe(true);
    }
  }, 120_000);
});

describe("sealStream : refus", () => {
  const f = (name = "a.bin", data: Uint8Array<ArrayBuffer> | Blob = new Uint8Array(3)): Item => ({
    kind: "file",
    name,
    mime: "application/octet-stream",
    data,
  });
  it("vide / trop d'éléments", async () => {
    await expect(sealStream([], keys)).rejects.toThrow("vide");
    await expect(sealStream(Array.from({ length: 11 }, () => f()), keys)).rejects.toThrow("trop_d_elements");
  });
  it("texte trop long (10 000 caractères acceptés)", async () => {
    const ok = "é".repeat(10_000);
    const k2 = await freshKeys();
    const r = await seal([{ kind: "text", name: "", mime: "text/plain", data: utf8(ok) }], k2);
    expect((await open(r.segments, r.bucket, k2)).manifest.items[0]!.text).toBe(ok);
    await expect(sealStream([{ kind: "text", name: "", mime: "text/plain", data: utf8(ok + "x") }], keys)).rejects.toThrow(
      "texte_trop_long",
    );
    await expect(
      sealStream([{ kind: "text", name: "", mime: "text/plain", data: new Blob([new Uint8Array(40_001).fill(97)]) }], keys),
    ).rejects.toThrow("texte_trop_long");
  });
  it("texte invalide", async () => {
    await expect(sealStream([{ kind: "text", name: "", mime: "text/plain", data: new Uint8Array([0xff]) }], keys)).rejects.toThrow(
      "texte_invalide",
    );
  });
  it("manifeste trop gros", async () => {
    await expect(sealStream([f("n".repeat(70_000))], keys)).rejects.toThrow("manifeste_trop_gros");
  });
  it("trop gros : CONTENT_MAX au plus (taille lue sur le Blob, rien n'est lu)", async () => {
    const huge = (size: number) =>
      ({
        size,
        slice() {
          throw new Error("ne doit pas être lu");
        },
      }) as unknown as Blob;
    await expect(sealStream([f("a", huge(CONTENT_MAX + 1))], keys)).rejects.toThrow("trop_gros");
    await expect(sealStream([f("a", huge(600 * MIB)), f("b", huge(500 * MIB))], keys)).rejects.toThrow("trop_gros");
  });
  it("droits invalides refusés à la création", async () => {
    const t: Item[] = [{ kind: "text", name: "", mime: "text/plain", data: utf8("a") }];
    await expect(sealStream(t, keys, { rights: "admin" as never })).rejects.toThrow("droits_invalides");
    await expect(sealStream(t, keys, { rights: "coffre" })).rejects.toThrow("droits_invalides");
    await expect(sealStream(t, keys, { rights: "coffre", keepTtlH: 5 as never })).rejects.toThrow("droits_invalides");
    await expect(sealStream(t, keys, { rights: "voir", keepTtlH: 12 })).rejects.toThrow("droits_invalides");
  });
  it("droits écrits dans le manifeste chiffré : voir, enregistrer (défaut), coffre + keep_ttl_h", async () => {
    const t: Item[] = [{ kind: "text", name: "", mime: "text/plain", data: utf8("a") }];
    for (const [o, want] of [
      [undefined, { rights: "enregistrer" }],
      [{ rights: "voir" }, { rights: "voir" }],
      [{ rights: "coffre", keepTtlH: 12 }, { rights: "coffre", keep_ttl_h: 12 }],
    ] as const) {
      const k = await freshKeys();
      const r = await seal(t, k, o);
      const m = (await open(r.segments, r.bucket, k)).manifest;
      expect({ rights: m.rights, ...(m.keep_ttl_h === undefined ? {} : { keep_ttl_h: m.keep_ttl_h }) }).toEqual(want);
    }
  });
});

describe("parseRights (spec §34 : absent, inconnu ou mal typé → « voir »)", () => {
  it.each([
    [{ rights: "coffre", keep_ttl_h: 12 }, { rights: "coffre", keepTtlH: 12 }],
    [{ rights: "coffre", keep_ttl_h: 1 }, { rights: "coffre", keepTtlH: 1 }],
    [{ rights: "coffre" }, { rights: "voir", keepTtlH: null }],
    [{ rights: "coffre", keep_ttl_h: 5 }, { rights: "voir", keepTtlH: null }],
    [{ rights: "coffre", keep_ttl_h: "12" }, { rights: "voir", keepTtlH: null }],
    [{ rights: "enregistrer" }, { rights: "enregistrer", keepTtlH: null }],
    [{ rights: "enregistrer", keep_ttl_h: 12 }, { rights: "enregistrer", keepTtlH: null }],
    [{ rights: "voir" }, { rights: "voir", keepTtlH: null }],
    [{ rights: "admin" }, { rights: "voir", keepTtlH: null }],
    [{ rights: true }, { rights: "voir", keepTtlH: null }],
    [{ rights: "Enregistrer" }, { rights: "voir", keepTtlH: null }],
    [{}, { rights: "voir", keepTtlH: null }],
    [null, { rights: "voir", keepTtlH: null }],
    ["coffre", { rights: "voir", keepTtlH: null }],
  ])("%j → %j", (m, want) => expect(parseRights(m)).toEqual(want));
});

describe("openStream : manifeste invalide (paquet bien chiffré)", () => {
  const good = { v: 2, rights: "enregistrer", items: [{ kind: "file", name: "a", mime: "x/y", size: 3, offset: 0 }] };
  const d3 = new Uint8Array([7, 8, 9]);
  const lenOnly = (n: number) => {
    const p = new Uint8Array(4);
    new DataView(p.buffer).setUint32(0, n);
    return p;
  };
  const bad: [string, Uint8Array<ArrayBuffer>][] = [
    ["longueur > 65532", lenOnly(65533)],
    ["longueur hors du clair", lenOnly(16 * CHUNK)],
    ["JSON invalide", tail("{x")],
    ["v = 1", tail({ ...good, v: 1 })],
    ["v absent", tail({ items: good.items })],
    ["items absent", tail({ v: 2 })],
    ["items vide", tail({ v: 2, items: [] })],
    ["11 éléments", tail({ v: 2, items: Array(11).fill(good.items[0]) })],
    ["kind inconnu", tail({ v: 2, items: [{ ...good.items[0], kind: "exe" }] })],
    ["fichier dans la zone du manifeste", tail({ v: 2, items: [{ ...good.items[0], offset: 16 * CHUNK - 100 }] })],
    ["taille négative", tail({ v: 2, items: [{ ...good.items[0], size: -1 }] })],
    ["taille non entière", tail({ v: 2, items: [{ ...good.items[0], size: 1.5 }] })],
    ["nom non chaîne", tail({ v: 2, items: [{ ...good.items[0], name: 5 }] })],
    ["texte sans text", tail({ v: 2, items: [{ kind: "text", name: "", mime: "text/plain", size: 0, offset: 0 }] })],
    ["texte avec taille", tail({ v: 2, items: [{ kind: "text", name: "", mime: "text/plain", size: 1, offset: 0, text: "a" }] })],
    ["fichier avec text", tail({ v: 2, items: [{ ...good.items[0], text: "a" }] })],
  ];
  it("le forgeur produit un paquet valide", async () => {
    const r = await open(await forge(d3, tail(good), 16, keys), 16);
    expect(r.items[0]).toEqual(d3);
  });
  it.each(bad)("%s → paquet_corrompu", async (_, end) => {
    await expect(open(await forge(d3, end, 16, keys), 16)).rejects.toThrow(/^paquet_corrompu$/);
  });
  it("droits du manifeste inconnus : le paquet s'ouvre, en « voir »", async () => {
    const r = await open(await forge(d3, tail({ ...good, rights: "admin", keep_ttl_h: 24 }), 16, keys), 16);
    expect(r.manifest.rights).toBe("voir");
    expect(r.manifest.keep_ttl_h).toBeUndefined();
  });
  it("manifeste de 65 532 octets : remplit le dernier morceau ; 65 533 → paquet_corrompu", async () => {
    const m = (name: string) => ({ ...good, items: [{ ...good.items[0], name }] });
    const name = "n".repeat(65_532 - JSON.stringify(m("")).length);
    expect(tail(m(name)).length).toBe(65_536);
    await expect(open(await forge(d3, tail(m(name + "n")), 16, keys), 16)).rejects.toThrow(/^paquet_corrompu$/);
    const r = await open(await forge(d3, tail(m(name)), 16, keys), 16);
    expect(r.manifest.items[0]!.name).toBe(name);
    expect(r.items[0]).toEqual(d3);
  });
  it("palier non canonique (contenu tenant dans un palier plus petit) → paquet_corrompu", async () => {
    await expect(open(await forge(d3, tail(good), 80, keys), 80)).rejects.toThrow(/^paquet_corrompu$/);
  });
  it("palier 1 : texte seul seulement (aucune donnée de fichier)", async () => {
    await expect(open(await forge(d3, tail(good), 1, keys), 1)).rejects.toThrow(/^paquet_corrompu$/);
    const text = { v: 2, rights: "voir", items: [{ kind: "text", name: "", mime: "text/plain", size: 0, offset: 0, text: "a" }] };
    expect((await open(await forge(new Uint8Array(0), tail(text), 1, keys), 1)).manifest.items[0]!.text).toBe("a");
  });
  it("drapeau « dernier morceau » absent sur le dernier morceau → paquet_corrompu", async () => {
    await expect(open(await forge(d3, tail(good), 16, keys, { last: 99 }), 16)).rejects.toThrow(/^paquet_corrompu$/);
    // Drapeau posé sur un autre morceau (troncature simulée) : les données lues échouent aussi.
    const big = { ...good, items: [{ ...good.items[0], size: 14 * CHUNK }] };
    const segs = await forge(pseudo(14 * CHUNK, 7), tail(big), 16, keys, { last: 3 });
    await expect(open(segs, 16)).rejects.toThrow(/^paquet_corrompu$/);
  });
  it("palier hors liste → paquet_corrompu", async () => {
    await expect(open(await forge(d3, tail(good), 2, keys), 2)).rejects.toThrow(/^paquet_corrompu$/);
  });
  it("élément de plus de 200 Mio : aperçu refusé, sans rien télécharger de plus", async () => {
    expect(PREVIEW_MAX).toBe(200 * MIB);
    const m = { ...good, items: [{ kind: "file", name: "gros.bin", mime: "x/y", size: PREVIEW_MAX + 1, offset: 0 }] };
    // Palier 4000 (250 Mio, 63 segments) : seuls le segment 0 et le dernier sont fabriqués.
    const srv = server(await forge(new Uint8Array(0), tail(m), 4000, keys, { segs: [0, 62] }));
    const o = await openStream(srv.fetch, 4000, keys);
    expect(o.manifest.items[0]!.size).toBe(PREVIEW_MAX + 1);
    await expect(o.item(0)).rejects.toThrow("trop_gros_pour_apercu");
    expect(srv.calls).toEqual([0, 62]);
    // streamItem n'a pas cette limite : il livre le segment 0 puis bute sur le segment 1 (absent).
    let got = 0;
    await expect(o.streamItem(0, (c) => void (got += c.length))).rejects.toThrow(/^paquet_corrompu$/);
    expect(got).toBe(64 * CHUNK);
    expect(srv.calls).toEqual([0, 62, 0, 1]);
  });
});

describe("clé à usage unique", () => {
  it("sealStream refuse de réutiliser la même K_contenu", async () => {
    const k = await freshKeys();
    const items: Item[] = [{ kind: "text", name: "", mime: "text/plain", data: utf8("a") }];
    await sealStream(items, k);
    await expect(sealStream(items, k)).rejects.toThrow("cle_deja_utilisee");
  });
  it("un refus de validation ne consomme pas la clé", async () => {
    const k = await freshKeys();
    await expect(sealStream([], k)).rejects.toThrow("vide");
    await sealStream([{ kind: "text", name: "", mime: "text/plain", data: utf8("a") }], k);
  });
});
