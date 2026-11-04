import { beforeAll, describe, expect, it } from "vitest";
import {
  BUCKETS,
  CHUNK,
  CHUNK_CT,
  HEADER,
  bucketFor,
  open,
  seal,
  segmentCount,
  segmentSize,
  type Item,
} from "./container";
import { concat, utf8 } from "./encoding";
import { deriveContent, KDF_MIN, randomBytes, type ContentKeys } from "./kdf";

const MIB = 1048576;
let keys: ContentKeys;

beforeAll(async () => {
  keys = await deriveContent(new Uint8Array(32).fill(3), "mot de passe", new Uint8Array(16).fill(9), KDF_MIN);
}, 60_000);

function pseudo(n: number, seed: number): Uint8Array {
  const out = new Uint8Array(n);
  let x = seed;
  for (let i = 0; i < n; i++) {
    x = (x * 1103515245 + 12345) >>> 0;
    out[i] = x >>> 24;
  }
  return out;
}

function contains(hay: Uint8Array, needle: Uint8Array): boolean {
  outer: for (let i = 0; i + needle.length <= hay.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
    return true;
  }
  return false;
}

const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);

const copy = (segs: Uint8Array[]) => segs.map((s) => new Uint8Array(s));

// Construit un paquet bien chiffré mais au clair arbitraire (expéditeur malveillant).
async function forge(plain: Uint8Array, bucket: number, k: ContentKeys): Promise<Uint8Array[]> {
  const header = concat(utf8("SHH1"), new Uint8Array([1]), new Uint8Array(11), k.engagement);
  const padded = new Uint8Array(bucket * CHUNK);
  padded.set(plain);
  const cts: Uint8Array[] = [];
  for (let i = 0; i < bucket; i++) {
    const iv = new Uint8Array(12);
    new DataView(iv.buffer).setUint32(7, i);
    iv[11] = i === bucket - 1 ? 1 : 0;
    cts.push(
      new Uint8Array(
        await crypto.subtle.encrypt(
          { name: "AES-GCM", iv, additionalData: header, tagLength: 128 },
          k.kContenu,
          padded.subarray(i * CHUNK, (i + 1) * CHUNK),
        ),
      ),
    );
  }
  const segs: Uint8Array[] = [];
  for (let s = 0; s < segmentCount(bucket); s++) {
    const parts = cts.slice(s * 64, (s + 1) * 64);
    segs.push(s === 0 ? concat(header, ...parts) : concat(...parts));
  }
  return segs;
}

function manifestPlain(m: unknown, data = new Uint8Array(0)): Uint8Array {
  const j = utf8(JSON.stringify(m));
  const len = new Uint8Array(4);
  new DataView(len.buffer).setUint32(0, j.length);
  return concat(len, j, data);
}

describe("paliers et segments", () => {
  it("bucketFor", () => {
    expect(bucketFor(0)).toBe(1);
    expect(bucketFor(1)).toBe(1);
    expect(bucketFor(65536)).toBe(1);
    expect(bucketFor(65537)).toBe(16);
    expect(bucketFor(100 * MIB)).toBe(1600);
    expect(() => bucketFor(100 * MIB + 1)).toThrow("trop_gros");
    expect(() => bucketFor(-1)).toThrow();
    expect(() => bucketFor(1.5)).toThrow();
  });
  it("segmentCount / segmentSize", () => {
    expect(segmentCount(1)).toBe(1);
    expect(segmentCount(16)).toBe(1);
    expect(segmentCount(80)).toBe(2);
    expect(segmentCount(1600)).toBe(25);
    expect(segmentSize(1600, 0)).toBe(48 + 64 * 65552);
    expect(segmentSize(16, 0)).toBe(48 + 16 * 65552);
    expect(segmentSize(80, 1)).toBe(16 * 65552);
    for (const b of BUCKETS) {
      let sum = 0;
      for (let n = 0; n < segmentCount(b); n++) sum += segmentSize(b, n);
      expect(sum).toBe(HEADER + b * CHUNK_CT);
    }
  });
});

describe("seal / open", () => {
  const texte = "Bonjour MOT-REPERE-123 é😀";
  const image = pseudo(200 * 1024, 1);
  const fichier = pseudo(3 * MIB, 2);
  const items: Item[] = [
    { kind: "text", name: "", mime: "text/plain", data: utf8(texte) },
    { kind: "file", name: "photo.png", mime: "image/png", data: image },
    { kind: "file", name: "secret-nom.pdf", mime: "application/pdf", data: fichier },
  ];
  let sealed: { bucket: number; segments: Uint8Array[] };

  beforeAll(async () => {
    sealed = await seal(items, keys);
  }, 60_000);

  it("aller-retour : manifeste et octets identiques", async () => {
    expect(sealed.bucket).toBe(80);
    expect(sealed.segments.length).toBe(2);
    sealed.segments.forEach((s, n) => expect(s.length).toBe(segmentSize(80, n)));
    const o = await open(copy(sealed.segments), keys);
    expect(o.manifest.v).toBe(1);
    expect(o.manifest.items).toEqual([
      { kind: "text", name: "", mime: "text/plain", size: 0, offset: 0, text: texte },
      { kind: "file", name: "photo.png", mime: "image/png", size: image.length, offset: 0 },
      { kind: "file", name: "secret-nom.pdf", mime: "application/pdf", size: fichier.length, offset: image.length },
    ]);
    expect(o.item(0)).toEqual(utf8(texte));
    expect(same(o.item(1), image)).toBe(true);
    expect(same(o.item(2), fichier)).toBe(true);
    // copie : modifier le résultat ne change pas l'élément
    o.item(1).fill(0);
    expect(same(o.item(1), image)).toBe(true);
    expect(() => o.item(3)).toThrow();
    expect(() => o.item(-1)).toThrow();
  });

  it("en-tête en clair conforme", () => {
    const h = sealed.segments[0]!.subarray(0, HEADER);
    expect(h).toEqual(concat(utf8("SHH1"), new Uint8Array([1]), new Uint8Array(11), keys.engagement));
  });

  it("aucun nom ni texte en clair dans le paquet", () => {
    const all = concat(...sealed.segments);
    expect(contains(all, utf8("secret-nom.pdf"))).toBe(false);
    expect(contains(all, utf8("MOT-REPERE-123"))).toBe(false);
    expect(contains(all, utf8("photo.png"))).toBe(false);
  });

  const corrupt = async (segs: Uint8Array[], k: ContentKeys = keys) =>
    expect(open(segs, k)).rejects.toThrow(/^paquet_corrompu$/);

  it("octet modifié dans le morceau 3", async () => {
    const s = copy(sealed.segments);
    s[0]![HEADER + 3 * CHUNK_CT + 10]! ^= 1;
    await corrupt(s);
  });
  it("octet modifié dans un tag du second segment", async () => {
    const s = copy(sealed.segments);
    s[1]![s[1]!.length - 1]! ^= 0x80;
    await corrupt(s);
  });
  it("deux morceaux échangés", async () => {
    const s = copy(sealed.segments);
    const a = s[0]!.slice(HEADER + CHUNK_CT, HEADER + 2 * CHUNK_CT);
    const b = s[0]!.slice(HEADER + 2 * CHUNK_CT, HEADER + 3 * CHUNK_CT);
    s[0]!.set(b, HEADER + CHUNK_CT);
    s[0]!.set(a, HEADER + 2 * CHUNK_CT);
    await corrupt(s);
  });
  it("dernier segment tronqué (1 octet, puis un morceau entier)", async () => {
    const s = copy(sealed.segments);
    await corrupt([s[0]!, s[1]!.slice(0, -1)]);
    await corrupt([s[0]!, s[1]!.slice(0, -CHUNK_CT)]);
  });
  it("segment retiré, ajouté ou segments échangés", async () => {
    const s = copy(sealed.segments);
    await corrupt([s[0]!]);
    await corrupt([s[0]!, s[1]!, s[1]!]);
    await corrupt([s[1]!, s[0]!]);
    await corrupt([]);
  });
  it("en-tête modifié (magie, version, réservé, engagement)", async () => {
    for (const pos of [0, 4, 10, 20, 47]) {
      const s = copy(sealed.segments);
      s[0]![pos]! ^= 1;
      await corrupt(s);
    }
  });
  it("mauvais engagement dans les clés", async () => {
    const e = new Uint8Array(keys.engagement);
    e[31]! ^= 1;
    await corrupt(copy(sealed.segments), { ...keys, engagement: e });
  });
  it("mauvaise clé de contenu (même engagement)", async () => {
    const autre = await crypto.subtle.importKey("raw", randomBytes(32), "AES-GCM", false, ["decrypt"]);
    await corrupt(copy(sealed.segments), { ...keys, kContenu: autre });
  });
});

describe("seal : refus", () => {
  const f = (name = "a.bin", data = new Uint8Array(3)): Item => ({ kind: "file", name, mime: "application/octet-stream", data });
  it("vide / trop d'éléments", async () => {
    await expect(seal([], keys)).rejects.toThrow("vide");
    await expect(seal(Array.from({ length: 11 }, () => f()), keys)).rejects.toThrow("trop_d_elements");
  });
  it("texte trop long (10 000 caractères acceptés)", async () => {
    const ok = "é".repeat(10_000);
    // K_contenu neuve : `keys` a déjà servi à un seal réussi (clé à usage unique).
    const k2 = { ...keys, kContenu: await crypto.subtle.importKey("raw", randomBytes(32), "AES-GCM", false, ["encrypt", "decrypt"]) };
    const r = await seal([{ kind: "text", name: "", mime: "text/plain", data: utf8(ok) }], k2);
    expect((await open(r.segments, k2)).manifest.items[0]!.text).toBe(ok);
    await expect(
      seal([{ kind: "text", name: "", mime: "text/plain", data: utf8(ok + "x") }], keys),
    ).rejects.toThrow("texte_trop_long");
  });
  it("manifeste trop gros", async () => {
    await expect(seal([f("n".repeat(70_000))], keys)).rejects.toThrow("manifeste_trop_gros");
  });
  it("trop gros", async () => {
    await expect(seal([f("a", new Uint8Array(100 * MIB))], keys)).rejects.toThrow("trop_gros");
  });
});

describe("open : manifeste invalide (paquet bien chiffré)", () => {
  const good = { v: 1, items: [{ kind: "file", name: "a", mime: "x/y", size: 3, offset: 0 }] };
  const bad: [string, Uint8Array][] = [
    ["longueur > 65536", (() => { const p = manifestPlain(good); new DataView(p.buffer).setUint32(0, 65537); return p; })()],
    ["longueur hors du clair", (() => { const p = new Uint8Array(4); new DataView(p.buffer).setUint32(0, 65536); return p; })()],
    ["JSON invalide", concat(new Uint8Array([0, 0, 0, 2]), utf8("{x"))],
    ["v ≠ 1", manifestPlain({ ...good, v: 2 })],
    ["items absent", manifestPlain({ v: 1 })],
    ["items vide", manifestPlain({ v: 1, items: [] })],
    ["11 éléments", manifestPlain({ v: 1, items: Array(11).fill(good.items[0]) })],
    ["kind inconnu", manifestPlain({ v: 1, items: [{ ...good.items[0], kind: "exe" }] })],
    ["offset hors données", manifestPlain({ v: 1, items: [{ ...good.items[0], offset: CHUNK }] })],
    ["taille négative", manifestPlain({ v: 1, items: [{ ...good.items[0], size: -1 }] })],
    ["taille non entière", manifestPlain({ v: 1, items: [{ ...good.items[0], size: 1.5 }] })],
    ["nom non chaîne", manifestPlain({ v: 1, items: [{ ...good.items[0], name: 5 }] })],
    ["texte sans text", manifestPlain({ v: 1, items: [{ kind: "text", name: "", mime: "text/plain", size: 0, offset: 0 }] })],
    ["texte avec taille", manifestPlain({ v: 1, items: [{ kind: "text", name: "", mime: "text/plain", size: 1, offset: 0, text: "a" }] })],
    ["fichier avec text", manifestPlain({ v: 1, items: [{ ...good.items[0], text: "a" }] })],
  ];
  it("le forgeur produit un paquet valide", async () => {
    const o = await open(await forge(manifestPlain(good, new Uint8Array([7, 8, 9])), 1, keys), keys);
    expect(o.item(0)).toEqual(new Uint8Array([7, 8, 9]));
  });
  it.each(bad)("%s → paquet_corrompu", async (_, plain) => {
    await expect(open(await forge(plain, 1, keys), keys)).rejects.toThrow(/^paquet_corrompu$/);
  });
  it("paquet tronqué en un palier plus petit valide (drapeau dernier morceau)", async () => {
    const segs = await forge(manifestPlain(good, new Uint8Array(3)), 16, keys);
    await expect(open([segs[0]!.slice(0, HEADER + CHUNK_CT)], keys)).rejects.toThrow(/^paquet_corrompu$/);
  });
  it("palier hors liste → paquet_corrompu", async () => {
    await expect(open(await forge(manifestPlain(good), 2, keys), keys)).rejects.toThrow(/^paquet_corrompu$/);
  });
});

describe("clé à usage unique", () => {
  it("seal refuse de réutiliser la même K_contenu", async () => {
    const k = await deriveContent(randomBytes(32), "mot de passe", randomBytes(16), KDF_MIN);
    const items: Item[] = [{ kind: "text", name: "", mime: "text/plain", data: utf8("a") }];
    await seal(items, k);
    await expect(seal(items, k)).rejects.toThrow("cle_deja_utilisee");
  }, 60_000);
});
