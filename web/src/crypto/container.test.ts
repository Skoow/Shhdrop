import { beforeAll, describe, expect, it } from "vitest";
import {
  BUCKETS,
  CHUNK,
  CHUNK_CT,
  HEADER,
  PREVIEW_MAX,
  bucketFor,
  openStream,
  sealStream,
  segmentCount,
  segmentSize,
  type ContainerReader,
  type Item,
} from "./container";
import { concat, utf8 } from "./encoding";
import { deriveContent, KDF_MIN, newKLien, randomBytes, type ContentKeys } from "./kdf";
import type { KLien } from "./types";

const MIB = 1048576;
let keys: ContentKeys;

beforeAll(async () => {
  keys = await deriveContent(new Uint8Array(32).fill(3) as KLien, "mot de passe", new Uint8Array(16).fill(9), KDF_MIN);
}, 60_000);

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

// Chiffre tout le paquet (tests : petits paquets seulement).
async function seal(items: Item[], k: ContentKeys): Promise<{ bucket: number; segments: Uint8Array<ArrayBuffer>[] }> {
  const s = await sealStream(items, k);
  const segments: Uint8Array<ArrayBuffer>[] = [];
  for (let n = 0; n < s.segmentCount; n++) segments.push(await s.segment(n));
  return { bucket: s.bucket, segments };
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

// Construit un paquet bien chiffré mais au clair arbitraire (expéditeur malveillant).
// Seuls les `segs` premiers segments sont produits (paliers énormes sans tout allouer) ;
// `last` : indice du morceau marqué « dernier » (par défaut le vrai dernier).
async function forge(
  plain: Uint8Array<ArrayBuffer>,
  bucket: number,
  k: ContentKeys,
  o: { segs?: number; last?: number } = {},
): Promise<Uint8Array<ArrayBuffer>[]> {
  const header = concat(utf8("SHH1"), new Uint8Array([1]), new Uint8Array(11), k.engagement);
  const last = o.last ?? bucket - 1;
  const out: Uint8Array<ArrayBuffer>[] = [];
  for (let s = 0; s < Math.min(o.segs ?? Infinity, segmentCount(bucket)); s++) {
    const cts: Uint8Array<ArrayBuffer>[] = [];
    for (let i = s * 64; i < Math.min(bucket, (s + 1) * 64); i++) {
      const iv = new Uint8Array(12);
      new DataView(iv.buffer).setUint32(7, i);
      iv[11] = i === last ? 1 : 0;
      const chunk = new Uint8Array(CHUNK);
      if (i * CHUNK < plain.length) chunk.set(plain.subarray(i * CHUNK, (i + 1) * CHUNK));
      cts.push(new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: header, tagLength: 128 }, k.kContenu, chunk)));
    }
    out.push(s === 0 ? concat(header, ...cts) : concat(...cts));
  }
  return out;
}

const freshKeys = async (): Promise<ContentKeys> => ({
  ...keys,
  kContenu: await crypto.subtle.importKey("raw", randomBytes(32), "AES-GCM", false, ["encrypt", "decrypt"]),
});

function manifestPlain(m: unknown, data = new Uint8Array(0)): Uint8Array<ArrayBuffer> {
  const j = utf8(JSON.stringify(m));
  const len = new Uint8Array(4);
  new DataView(len.buffer).setUint32(0, j.length);
  return concat(len, j, data);
}

describe("paliers et segments", () => {
  it("bucketFor", () => {
    expect(BUCKETS).toEqual([1, 16, 80, 160, 400, 800, 1600, 4000, 8000, 16384]);
    expect(bucketFor(0)).toBe(1);
    expect(bucketFor(1)).toBe(1);
    expect(bucketFor(65536)).toBe(1);
    expect(bucketFor(65537)).toBe(16);
    expect(bucketFor(100 * MIB)).toBe(1600);
    expect(bucketFor(100 * MIB + 1)).toBe(4000);
    expect(bucketFor(250 * MIB + 1)).toBe(8000);
    expect(bucketFor(500 * MIB + 1)).toBe(16384);
    expect(bucketFor(1024 * MIB)).toBe(16384); // 1 Gio utile
    expect(() => bucketFor(1024 * MIB + 1)).toThrow("trop_gros");
    expect(() => bucketFor(-1)).toThrow();
    expect(() => bucketFor(1.5)).toThrow();
  });
  it("segmentCount / segmentSize", () => {
    expect(segmentCount(1)).toBe(1);
    expect(segmentCount(16)).toBe(1);
    expect(segmentCount(80)).toBe(2);
    expect(segmentCount(1600)).toBe(25);
    expect(segmentCount(16384)).toBe(256);
    expect(segmentSize(1600, 0)).toBe(48 + 64 * 65552);
    expect(segmentSize(16, 0)).toBe(48 + 16 * 65552);
    expect(segmentSize(80, 1)).toBe(16 * 65552);
    expect(segmentSize(4000, 62)).toBe(32 * 65552);
    expect(segmentSize(16384, 255)).toBe(64 * 65552);
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
  let sealed: { bucket: number; segments: Uint8Array<ArrayBuffer>[] };

  beforeAll(async () => {
    sealed = await seal(items, keys);
  }, 60_000);

  it("aller-retour (Blob) : palier 160, 3 segments, manifeste et octets identiques", async () => {
    expect(sealed.bucket).toBe(160);
    expect(sealed.segments.length).toBe(3);
    sealed.segments.forEach((s, n) => expect(s.length).toBe(segmentSize(160, n)));
    const { manifest, items: got, o } = await open(sealed.segments, 160);
    expect(manifest.v).toBe(1);
    expect(manifest.items).toEqual([
      { kind: "text", name: "", mime: "text/plain", size: 0, offset: 0, text: texte },
      { kind: "file", name: "photo.png", mime: "image/png", size: a.length, offset: 0 },
      { kind: "file", name: "secret-nom.pdf", mime: "application/pdf", size: b.length, offset: a.length },
    ]);
    expect(got[0]).toEqual(utf8(texte));
    expect(same(got[1]!, a)).toBe(true);
    expect(same(got[2]!, b)).toBe(true);
    // copie : modifier le résultat ne change pas l'élément
    (await o.item(1)).fill(0);
    expect(same(await o.item(1), a)).toBe(true);
    await expect(o.item(3)).rejects.toThrow("element_inexistant");
    await expect(o.item(-1)).rejects.toThrow("element_inexistant");
    await expect(o.streamItem(1.5, () => undefined)).rejects.toThrow("element_inexistant");
  });

  it("item(i) ne télécharge que les segments nécessaires (cache d'un seul segment)", async () => {
    const srv = server(sealed.segments);
    const o = await openStream(srv.fetch, 160, keys);
    expect(srv.calls).toEqual([0]); // en-tête et manifeste
    expect(same(await o.item(1), a)).toBe(true); // morceaux 0..48 : segment 0, déjà en cache
    expect(srv.calls).toEqual([0]);
    expect(same(await o.item(2), b)).toBe(true); // morceaux 48..88 : segments 0 et 1
    expect(srv.calls).toEqual([0, 1]);
    expect(same(await o.item(1), a)).toBe(true); // le segment 0 n'est plus en cache
    expect(srv.calls).toEqual([0, 1, 0]);
    expect(await o.item(0)).toEqual(utf8(texte)); // texte : dans le manifeste
    expect(srv.calls).toEqual([0, 1, 0]);
    o.wipe();
    expect(same(await o.item(1), a)).toBe(true); // après wipe : rechargé
    expect(srv.calls).toEqual([0, 1, 0, 0]);
  });

  it("streamItem : morceaux dans l'ordre, sortie identique à la source", async () => {
    const srv = server(sealed.segments);
    const o = await openStream(srv.fetch, 160, keys);
    expect(same(await streamed(o, 2), b)).toBe(true);
    expect(same(await streamed(o, 1), a)).toBe(true);
    expect(await streamed(o, 0)).toEqual(utf8(texte));
    expect(srv.calls).toEqual([0, 1, 0]);
  });

  it("segment(n) deux fois : octets identiques ; n hors palier refusé", async () => {
    const s = await sealStream(items, await freshKeys());
    expect(s.bucket).toBe(160);
    expect(s.segmentCount).toBe(3);
    expect(same(await s.segment(1), await s.segment(1))).toBe(true);
    expect(same(await s.segment(0), await s.segment(0))).toBe(true);
    for (const n of [-1, 3, 1.5]) await expect(s.segment(n)).rejects.toThrow("segment_invalide");
  });

  it("File : segment(n) ne se régénère pas (le fichier a pu changer sur le disque)", async () => {
    const file = new File([pseudo(100_000, 6)], "f.bin");
    const s = await sealStream([{ kind: "file", name: "f.bin", mime: "x/y", data: file }], await freshKeys());
    await s.segment(0);
    await expect(s.segment(0)).rejects.toThrow("segment_deja_produit");
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
    // Un wipe() au milieu d'une lecture ne la fait pas échouer : le segment est rechargé.
    const p = o.item(2);
    o.wipe();
    expect(same(await p, b)).toBe(true);
  });

  it("une entrée Uint8Array modifiée après sealStream ne change pas le paquet", async () => {
    const data = pseudo(100_000, 5);
    const k = await freshKeys();
    const s = await sealStream([{ kind: "file", name: "x", mime: "x/y", data }], k);
    const first = await s.segment(0);
    data.fill(0);
    expect(same(await s.segment(0), first)).toBe(true);
    const o = await openStream(server([first]).fetch, s.bucket, k);
    expect(same(await o.item(0), pseudo(100_000, 5))).toBe(true);
  });

  it("texte fourni en Blob", async () => {
    const k = await freshKeys();
    const r = await seal([{ kind: "text", name: "", mime: "text/plain", data: new Blob([utf8("é-blob")]) }], k);
    expect((await open(r.segments, r.bucket, k)).manifest.items[0]!.text).toBe("é-blob");
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
  it("segment de mauvaise taille (1 octet, puis un morceau en moins ; un octet de plus)", async () => {
    const s = copy(sealed.segments);
    await corrupt([s[0]!, s[1]!.slice(0, -1), s[2]!]);
    await corrupt([s[0]!, s[1]!.slice(0, -CHUNK_CT), s[2]!]);
    await corrupt([s[0]!, concat(s[1]!, new Uint8Array(1)), s[2]!]);
    await corrupt([s[0]!.slice(0, -1), s[1]!, s[2]!]);
  });
  it("segment retiré ou segments échangés", async () => {
    const s = copy(sealed.segments);
    await corrupt([s[0]!]);
    await corrupt([s[0]!, s[2]!, s[1]!]);
    await corrupt([s[1]!, s[0]!, s[2]!]);
    await corrupt([]);
  });
  it("palier annoncé faux (le serveur ment)", async () => {
    const s = copy(sealed.segments);
    await corrupt(s, keys, 80); // tailles fausses
    await corrupt(s, keys, 400); // segment 0 de bonne taille, mais palier non canonique
    await corrupt(s, keys, 2); // hors liste
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
    const k2 = await freshKeys(); // `keys` a déjà servi (clé à usage unique)
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
  it("trop gros : 1 Gio utile au plus (taille lue sur le Blob, rien n'est lu)", async () => {
    const huge = (size: number) =>
      ({
        size,
        slice() {
          throw new Error("ne doit pas être lu");
        },
      }) as unknown as Blob;
    await expect(sealStream([f("a", huge(2 ** 30))], keys)).rejects.toThrow("trop_gros");
    await expect(sealStream([f("a", huge(600 * MIB)), f("b", huge(500 * MIB))], keys)).rejects.toThrow("trop_gros");
  });
});

describe("openStream : manifeste invalide (paquet bien chiffré)", () => {
  const good = { v: 1, items: [{ kind: "file", name: "a", mime: "x/y", size: 3, offset: 0 }] };
  const bad: [string, Uint8Array<ArrayBuffer>][] = [
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
    const r = await open(await forge(manifestPlain(good, new Uint8Array([7, 8, 9])), 1, keys), 1);
    expect(r.items[0]).toEqual(new Uint8Array([7, 8, 9]));
  });
  it.each(bad)("%s → paquet_corrompu", async (_, plain) => {
    await expect(open(await forge(plain, 1, keys), 1)).rejects.toThrow(/^paquet_corrompu$/);
  });
  it("manifeste à cheval sur les morceaux 0 et 1 (65 535 octets)", async () => {
    const m = (name: string) => ({ v: 1, items: [{ kind: "file", name, mime: "x/y", size: 3, offset: 0 }] });
    const name = "n".repeat(65_535 - JSON.stringify(m("")).length);
    const plain = manifestPlain(m(name), new Uint8Array([1, 2, 3]));
    expect(plain.length).toBe(4 + 65_535 + 3);
    const r = await open(await forge(plain, 16, keys), 16);
    expect(r.manifest.items[0]!.name).toBe(name);
    expect(r.items[0]).toEqual(new Uint8Array([1, 2, 3]));
  });
  it("paquet tronqué en un palier plus petit valide (drapeau dernier morceau)", async () => {
    const segs = await forge(manifestPlain(good, new Uint8Array(3)), 16, keys);
    await expect(open([segs[0]!.slice(0, HEADER + CHUNK_CT)], 1)).rejects.toThrow(/^paquet_corrompu$/);
  });
  it("palier non canonique (contenu tenant dans un palier plus petit) → paquet_corrompu", async () => {
    await expect(open(await forge(manifestPlain(good, new Uint8Array(3)), 16, keys), 16)).rejects.toThrow(/^paquet_corrompu$/);
  });
  it("drapeau « dernier morceau » absent sur le dernier morceau, lu par item et streamItem", async () => {
    const big = { v: 1, items: [{ kind: "file", name: "a", mime: "x/y", size: 15 * CHUNK, offset: 0 }] };
    const plain = manifestPlain(big, pseudo(15 * CHUNK, 7));
    expect(bucketFor(plain.length)).toBe(16);
    const ok = await forge(plain, 16, keys);
    expect(same((await open(ok, 16)).items[0]!, pseudo(15 * CHUNK, 7))).toBe(true);
    const segs = await forge(plain, 16, keys, { last: 99 });
    await expect(open(segs, 16)).rejects.toThrow(/^paquet_corrompu$/);
    const o = await openStream(server(segs).fetch, 16, keys);
    await expect(streamed(o, 0)).rejects.toThrow(/^paquet_corrompu$/);
  });
  it("palier hors liste → paquet_corrompu", async () => {
    await expect(open(await forge(manifestPlain(good), 2, keys), 2)).rejects.toThrow(/^paquet_corrompu$/);
  });
  it("élément de plus de 200 Mio : aperçu refusé, sans rien télécharger de plus", async () => {
    expect(PREVIEW_MAX).toBe(200 * MIB);
    const m = (size: number) => ({ v: 1, items: [{ kind: "file", name: "gros.bin", mime: "x/y", size, offset: 0 }] });
    // Palier 4000 (250 Mio) : seul le segment 0 est fabriqué (4 Mio).
    const srv = server(await forge(manifestPlain(m(PREVIEW_MAX + 1)), 4000, keys, { segs: 1 }));
    const o = await openStream(srv.fetch, 4000, keys);
    expect(o.manifest.items[0]!.size).toBe(PREVIEW_MAX + 1);
    await expect(o.item(0)).rejects.toThrow("trop_gros_pour_apercu");
    expect(srv.calls).toEqual([0]);
    // streamItem n'a pas cette limite : il livre le segment 0 puis bute sur le segment 1 (absent).
    let got = 0;
    await expect(o.streamItem(0, (c) => void (got += c.length))).rejects.toThrow(/^paquet_corrompu$/);
    expect(got).toBe(64 * CHUNK - manifestPlain(m(PREVIEW_MAX + 1)).length);
    expect(srv.calls).toEqual([0, 1]);
  });
});

describe("clé à usage unique", () => {
  it("sealStream refuse de réutiliser la même K_contenu", async () => {
    const k = await deriveContent(newKLien(), "mot de passe", randomBytes(16), KDF_MIN);
    const items: Item[] = [{ kind: "text", name: "", mime: "text/plain", data: utf8("a") }];
    await sealStream(items, k);
    await expect(sealStream(items, k)).rejects.toThrow("cle_deja_utilisee");
  }, 60_000);
  it("un refus de validation ne consomme pas la clé", async () => {
    const k = await freshKeys();
    await expect(sealStream([], k)).rejects.toThrow("vide");
    await sealStream([{ kind: "text", name: "", mime: "text/plain", data: utf8("a") }], k);
  });
});
