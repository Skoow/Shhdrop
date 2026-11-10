// Nettoyage des images (spec §35.2, Task 9a) sur les fichiers d'essai de
// scripts/gen-fixtures.mjs et scripts/gen-media-fixtures.sh (repères fictifs).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { STRIP_MAX } from "../limits";
import { ascii, u16be, u32be, u32le } from "./bytes";
import { crc32 } from "./crc32";
import { readOrientation } from "./exif";
import { EMPTY_XMP } from "./heif";
import { children, topLevel } from "./isobmff";
import { stripMetadata, type StripResult } from "./strip";
import { found as foundAv } from "./test-markers";

const fx = (n: string) => new Uint8Array(readFileSync(new URL(`./fixtures/${n}`, import.meta.url)));
const MIME: Record<string, string> = { jpg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif", heic: "image/heic", avif: "image/avif" };
const mimeOf = (n: string) => MIME[n.split(".").pop()!]!;
const FIXTURES = ["iphone-like.jpg", "progressive.jpg", "meta.png", "meta.webp", "simple.webp", "meta.gif", "meta.heic", "meta.avif"];

const MARKERS = ["ReperMake", "ReperModel", "ReperXMP", "ReperIPTC", "ReperCOM", "ReperSecond", "ReperMotion", "ReperThumb", "ReperGIF", "ReperAuteur", "ReperTitre", "ReperDescription", "ReperUUID", "ReperDOT", "ReperLogiciel", "ReperMPF", "ReperJFXX", "ReperApres", "ReperInconnu", "2001:02:03"];
const be = (...v: number[]) => v.flatMap((n) => [n >>> 24, (n >> 16) & 255, (n >> 8) & 255, n & 255]);
const le = (...v: number[]) => v.flatMap((n) => [n & 255, (n >> 8) & 255, (n >> 16) & 255, n >>> 24]);
/** Repères : ASCII, UTF-16 BE et LE, rationnels EXIF de la latitude repère (12/1, 34/1, 56/1). */
function needles(): Uint8Array[] {
  const out: Uint8Array[] = [];
  for (const m of MARKERS) {
    const a = [...m].map((c) => c.charCodeAt(0));
    out.push(new Uint8Array(a), new Uint8Array(a.flatMap((c) => [0, c])), new Uint8Array(a.flatMap((c) => [c, 0])));
  }
  out.push(new Uint8Array(be(12, 1, 34, 1, 56, 1)), new Uint8Array(le(12, 1, 34, 1, 56, 1)));
  return out;
}
function indexOf(h: Uint8Array, n: Uint8Array, from = 0): number {
  outer: for (let i = from; i + n.length <= h.length; i++) {
    for (let j = 0; j < n.length; j++) if (h[i + j] !== n[j]) continue outer;
    return i;
  }
  return -1;
}
const found = (b: Uint8Array) => needles().filter((n) => indexOf(b, n) >= 0).map((n) => new TextDecoder().decode(n.filter((c) => c !== 0)));

async function clean(name: string, bytes: Uint8Array = fx(name)): Promise<{ r: StripResult; out: Uint8Array<ArrayBuffer> }> {
  const r = await stripMetadata(new Blob([bytes as Uint8Array<ArrayBuffer>]), mimeOf(name), name);
  return { r, out: r.state === "nettoye" ? new Uint8Array(await r.data.arrayBuffer()) : new Uint8Array(0) };
}

/** Segments JPEG jusqu'au premier SOS : [marqueur, contenu]. */
function jpegSegments(b: Uint8Array): [number, Uint8Array][] {
  const out: [number, Uint8Array][] = [];
  for (let o = 2; b[o + 1] !== 0xda; ) {
    const len = u16be(b, o + 2);
    out.push([b[o + 1]!, b.subarray(o + 4, o + 2 + len)]);
    o += 2 + len;
  }
  return out;
}
function pngChunks(b: Uint8Array): { type: string; data: Uint8Array; crcOk: boolean }[] {
  const out = [];
  for (let o = 8; o < b.length; ) {
    const len = u32be(b, o);
    const type = ascii(b, o + 4, 4);
    out.push({ type, data: b.subarray(o + 8, o + 8 + len), crcOk: crc32(b.subarray(o + 4, o + 8 + len)) === u32be(b, o + 8 + len) });
    o += 12 + len;
  }
  return out;
}

describe("nettoyage des images (spec §35.2)", () => {
  it.each(FIXTURES)("%s : nettoyé, aucun repère, déjà propre si on recommence", async (name) => {
    expect(found(fx(name)).length).toBeGreaterThan(name === "simple.webp" ? -1 : 0);
    const { r, out } = await clean(name);
    expect(r.state).toBe("nettoye");
    expect(found(out)).toEqual([]);
    const again = await clean(name, out);
    expect(again.out).toEqual(out);
  });

  it("JPEG : orientation seule, ICC dans l'ordre, JFIF et APP14 gardés, flux identique, rien après EOI", async () => {
    const src = fx("iphone-like.jpg");
    const { out } = await clean("iphone-like.jpg");
    const segs = jpegSegments(out);
    expect(segs.map(([m]) => m.toString(16))).toEqual(["e0", "e1", "e2", "e2", "ee", "db", "db", "c0", "c4", "c4", "c4", "c4"]);
    const exif = segs[1]![1];
    expect(ascii(exif, 0, 6)).toBe("Exif\0\0");
    const tiff = exif.subarray(6);
    expect(readOrientation(tiff)).toBe(6);
    expect(u16be(tiff, 8)).toBe(1); // une seule entrée
    expect(u32be(tiff, 8 + 2 + 12)).toBe(0); // aucun IFD1, donc aucune vignette
    const icc = jpegSegments(src).filter(([m, d]) => m === 0xe2 && ascii(d, 0, 12) === "ICC_PROFILE\0");
    expect(segs.filter(([m]) => m === 0xe2)).toEqual(icc);
    // Données compressées : la fin de l'image principale, octet pour octet, puis EOI en dernier.
    const sos = indexOf(src, new Uint8Array([0xff, 0xda]));
    const eoi = indexOf(src, new Uint8Array([0xff, 0xd9]), sos);
    const body = src.subarray(sos, eoi + 2);
    expect(out.subarray(out.length - body.length)).toEqual(body);
  });

  it("JPEG : APP0 JFIF réécrit sans sa vignette (16 octets, vignette 0 × 0), densité gardée", async () => {
    const src = fx("iphone-like.jpg");
    const [m0, app0] = jpegSegments(src)[0]!;
    expect(m0).toBe(0xe0);
    const thumb = [..."ReperVignetteJF"].map((c) => c.charCodeAt(0)); // 5 × 1 pixels RVB
    const jfif = [...app0.subarray(0, 12), 5, 1, ...thumb];
    const b = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, jfif.length + 2, ...jfif, ...src.subarray(2 + 2 + app0.length + 2)]);
    const { r, out } = await clean("v.jpg", b);
    expect(r.state).toBe("nettoye");
    expect(foundAv(out, ["ReperVignetteJF"])).toEqual([]);
    const [m, d] = jpegSegments(out)[0]!;
    expect(m).toBe(0xe0);
    expect([...d]).toEqual([...app0.subarray(0, 12), 0, 0]);
  });

  it("JPEG progressif : tous les balayages et marqueurs RST gardés", async () => {
    const src = fx("progressive.jpg");
    const { out } = await clean("progressive.jpg");
    const count = (b: Uint8Array, m: number) => b.reduce((n, v, i) => n + (v === 0xff && b[i + 1] === m ? 1 : 0), 0);
    expect(count(out, 0xda)).toBe(10);
    expect(count(out, 0xda)).toBe(count(src, 0xda));
    for (let m = 0xd0; m <= 0xd7; m++) expect(count(out, m)).toBe(count(src, m));
    expect(count(out, 0xdd)).toBe(1);
  });

  it("PNG : blocs retirés, eXIf réduit à l'orientation 8, iCCP et APNG gardés, CRC justes", async () => {
    const { out } = await clean("meta.png");
    const chunks = pngChunks(out);
    expect(chunks.map((c) => c.type)).toEqual(["IHDR", "iCCP", "eXIf", "acTL", "fcTL", "IDAT", "fcTL", "fdAT", "IEND"]);
    expect(chunks.every((c) => c.crcOk)).toBe(true);
    const exif = chunks.find((c) => c.type === "eXIf")!.data;
    expect(readOrientation(exif)).toBe(8);
    expect(exif.length).toBe(26);
  });

  it("PNG : CRC faux, bloc critique inconnu, longueur hors fichier → echec", async () => {
    const src = fx("meta.png");
    const bad = src.slice();
    bad[8 + 8 + 2] ^= 1; // donnée d'IHDR modifiée, CRC inchangé
    expect((await clean("x.png", bad)).r).toMatchObject({ state: "echec" });
    const crit = new Uint8Array([...src.subarray(0, 33), ...be(1), ...[0x51, 0x55, 0x55, 0x58], 0, ...be(crc32(new Uint8Array([0x51, 0x55, 0x55, 0x58, 0]))), ...src.subarray(33)]);
    expect((await clean("x.png", crit)).r).toMatchObject({ state: "echec", reason: "malformed:png_critique_inconnu" });
    const long = src.slice();
    long.set(be(0x7fff0000), 33);
    expect((await clean("x.png", long)).r).toMatchObject({ state: "echec" });
  });

  it("WebP : EXIF et XMP retirés, drapeaux VP8X et taille RIFF justes ; simple.webp identique", async () => {
    const { out } = await clean("meta.webp");
    expect(u32le(out, 4)).toBe(out.length - 8);
    expect(ascii(out, 12, 4)).toBe("VP8X");
    expect(out[20]).toBe(0x20 | 0x10 | 0x02); // ICC, alpha, animation ; ni EXIF ni XMP
    const types: string[] = [];
    for (let o = 12; o < out.length; ) {
      types.push(ascii(out, o, 4));
      const n = u32le(out, o + 4);
      o += 8 + n + (n % 2);
    }
    expect(types).toEqual(["VP8X", "ICCP", "ANIM", "ANMF", "ANMF"]);
    expect((await clean("simple.webp")).out).toEqual(fx("simple.webp"));
    const bad = fx("meta.webp").slice();
    bad.set(le(out.length * 4), 4);
    expect((await clean("x.webp", bad)).r).toMatchObject({ state: "echec" });
  });

  it("GIF : commentaire et XMP retirés, boucle et 2 images gardées, terminateur en dernier", async () => {
    const src = fx("meta.gif");
    const { out } = await clean("meta.gif");
    expect(indexOf(out, new TextEncoder().encode("NETSCAPE2.0"))).toBeGreaterThan(0);
    expect(indexOf(out, new TextEncoder().encode("XMP DataXMP"))).toBe(-1);
    expect(out[out.length - 1]).toBe(0x3b);
    // Images recopiées : la fin du fichier d'origine (2 images, terminateur) est identique.
    const tail = src.subarray(src.length - 10 - (out.length - 13 - 768), src.length - 10);
    expect(out.subarray(13 + 768)).toEqual(tail);
  });

  it("HEIC : même longueur, Exif vide puis zéros, XMP vide puis espaces, udes et uuid neutralisés, irot intact", async () => {
    const src = fx("meta.heic");
    const { out } = await clean("meta.heic");
    expect(out.length).toBe(src.length);
    const top = await topLevel(new Blob([out]));
    expect(top.map((b) => b.type)).toEqual(["ftyp", "meta", "free", "mdat"]);
    const free = top[2]!;
    expect(out.subarray(free.start + 8, free.end).every((v) => v === 0)).toBe(true);
    const mdat = top[3]!;
    const img = new TextEncoder().encode("IMAGEDATA-HEVC-FICTIF");
    expect(out.subarray(mdat.start + 8, mdat.start + 8 + img.length)).toEqual(img);
    const exif = out.subarray(mdat.start + 8 + img.length, mdat.end);
    expect([...exif.subarray(0, 18)]).toEqual([0, 0, 0, 0, 0x4d, 0x4d, 0, 42, 0, 0, 0, 8, 0, 0, 0, 0, 0, 0]);
    expect(exif.subarray(18).every((v) => v === 0)).toBe(true);
    const xmpAt = indexOf(out, new TextEncoder().encode(EMPTY_XMP));
    expect(xmpAt).toBeGreaterThan(0);
    const irot = indexOf(out, new TextEncoder().encode("irot"));
    expect(out[irot + 4]).toBe(1);
    expect(indexOf(out, new TextEncoder().encode("udes"))).toBe(-1);
  });

  it("HEIC : iloc méthode 2, extent hors fichier → echec", async () => {
    const src = fx("meta.heic");
    const iloc = indexOf(src, new TextEncoder().encode("iloc"));
    // Élément 2 (Exif) : 2e entrée ; champ « construction_method » sur 2 octets après l'identifiant.
    const m2 = src.slice();
    const entry = iloc + 4 + 4 + 2 + 2 + 16 + 2;
    expect(u16be(m2, entry - 2)).toBe(2);
    m2[entry + 1] = 2;
    expect((await clean("x.heic", m2)).r).toMatchObject({ state: "echec", reason: "malformed:heif_iloc_methode" });
    const far = src.slice();
    far.set(be(src.length), entry + 2 + 2 + 2);
    expect((await clean("x.heic", far)).r).toMatchObject({ state: "echec" });
  });

  it("AVIF réel (Pillow) : Exif et XMP vidés en place, même longueur", async () => {
    const src = fx("meta.avif");
    const { out } = await clean("meta.avif");
    expect(out.length).toBe(src.length);
    const meta = (await topLevel(new Blob([out]))).find((b) => b.type === "meta")!;
    expect(children(out, meta.start + meta.head + 4, meta.end).map((b) => b.type)).toContain("iloc");
  });

  it("pièges : fichier tronqué à 50 % → echec ; 1 000 troncatures et altérations → jamais d'exception, jamais de repère", async () => {
    let seed = 42;
    const rand = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);
    for (const name of FIXTURES) {
      const src = fx(name);
      if (name !== "simple.webp") expect((await clean(name, src.subarray(0, src.length >> 1))).r.state).toBe("echec");
      for (let i = 0; i < 1000; i++) {
        const cut = src.slice(0, Math.floor(rand() * src.length));
        if (i % 2) cut[Math.floor(rand() * cut.length)] = Math.floor(rand() * 256);
        const { r, out } = await clean(name, cut);
        // Tête trop courte pour reconnaître le format : non pris en charge (choix demandé).
        // Octet magique altéré : un autre format, ou non pris en charge (choix demandé).
        if (i % 2 === 0) expect(cut.length < 12 ? ["echec", "non_pris_en_charge"] : ["nettoye", "echec"]).toContain(r.state);
        if (r.state === "nettoye") expect(found(out)).toEqual([]);
      }
    }
  }, 60_000);

  it("image au-delà de STRIP_MAX → echec ; types non images", async () => {
    const big = new Blob([fx("iphone-like.jpg"), new Uint8Array(STRIP_MAX)]);
    expect(await stripMetadata(big, "image/jpeg", "x.jpg")).toEqual({ state: "echec", reason: "trop_gros" });
    // PDF sans table xref : échec honnête (D41-31) ; le vrai nettoyage est éprouvé dans pdf.test.ts.
    expect(await stripMetadata(new Blob(["%PDF-1.7\n"]), "application/pdf", "a.pdf")).toEqual({ state: "echec", reason: "malformed:pdf_startxref" });
    expect(await stripMetadata(new Blob(["<svg/>"]), "image/svg+xml", "a.svg")).toEqual({ state: "non_pris_en_charge", format: "inconnu" });
    expect(await stripMetadata(new Blob(["bonjour"]), "text/plain", "a.txt")).toEqual({ state: "sans" });
    const rec = await stripMetadata(new Blob([fx("chromium.webm")]), "video/webm", "v.webm", { recorded: true });
    expect(rec).toMatchObject({ state: "nettoye", family: "video" });
    // Vidéo importée (Task 9c) : nettoyée elle aussi.
    expect(await stripMetadata(new Blob([fx("chromium.webm")]), "video/webm", "v.webm")).toMatchObject({ state: "nettoye", family: "video" });
  });
});

describe("nettoyage des vidéos et de l'audio (spec §35.2, Task 9c)", () => {
  const AV: [string, string, "video" | "audio"][] = [
    ["phone.mov", "video/quicktime", "video"],
    ["faststart.mp4", "video/mp4", "video"],
    ["frag.mp4", "video/mp4", "video"],
    ["tags.m4a", "audio/mp4", "audio"],
    ["meta.webm", "video/webm", "video"],
    ["meta.mkv", "video/x-matroska", "video"],
    ["meta.mp3", "audio/mpeg", "audio"],
    ["meta.opus", "audio/ogg", "audio"],
    ["meta.ogg", "audio/ogg", "audio"],
    ["long.opus", "audio/ogg", "audio"],
    ["meta.flac", "audio/flac", "audio"],
    ["meta.wav", "audio/wav", "audio"],
  ];
  const AV_MARKERS = ["ReperTitre", "ReperArtiste", "ReperComment", "ReperMake", "ReperModel", "ReperSoftware", "ReperAlbum", "ReperOriginator", "ReperLogiciel", "ReperLong", "Lavf", "2001-02-03", "+12.5822"];
  for (const [name, mime, family] of AV) {
    it(`${name} : « nettoye » (${family}), aucun repère dans le résultat`, async () => {
      const r = await stripMetadata(new Blob([fx(name)]), mime, name);
      expect(r).toMatchObject({ state: "nettoye", family });
      const out = new Uint8Array(await (r as { data: Blob }).data.arrayBuffer());
      expect(foundAv(out, AV_MARKERS)).toEqual([]);
    });
  }
  it("vidéo et audio tronqués → echec, jamais d'exception", async () => {
    for (const [name, mime] of AV) {
      const b = fx(name);
      const r = await stripMetadata(new Blob([b.subarray(0, Math.floor(b.length / 3))]), mime, name);
      expect(["echec", "nettoye"]).toContain(r.state);
    }
  });
});

describe("EXIF illisible (revue du 10 novembre)", () => {
  it("JPEG : l'EXIF abîmé est retiré, la photo est nettoyée (pas d'échec qui la laisserait partir avec sa position)", async () => {
    const b = fx("iphone-like.jpg").slice();
    const at = indexOf(b, new TextEncoder().encode("Exif\0\0"));
    expect(at).toBeGreaterThan(0);
    b[at + 6] = b[at + 7] = 0x58; // « XX » à la place de « II » ou « MM »
    const { r, out } = await clean("iphone-like.jpg", b);
    expect(r.state).toBe("nettoye");
    expect(found(out)).toEqual([]);
    expect(indexOf(out, new TextEncoder().encode("Exif\0\0"))).toBe(-1);
  });
});
