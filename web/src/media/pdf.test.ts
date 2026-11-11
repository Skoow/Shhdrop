// Nettoyage des PDF (spec §35.2, Task 9b) sur les fichiers d'essai de scripts/gen-fixtures.mjs.
// La lisibilité se vérifie par la structure (chaque entrée de chaque table xref pointe toujours
// sur « N G obj », même longueur, texte de page intact) ; les images, par le décodeur de pdf.js.
import { readFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { cleanJpeg } from "./jpeg";
import { cleanPdf } from "./pdf";
import { stripMetadata, type StripResult } from "./strip";
import { found } from "./test-markers";

// Décodeur JPEG de pdf.js (déjà en dépendance, sans déclaration de types) : preuve que les
// images neutralisées en place restent décodables, pixels identiques.
const DECODERS = "pdfjs-dist/image_decoders/pdf.image_decoders.mjs";
type Jpeg = { parse(b: Uint8Array): void; width: number; height: number; getData(o: { width: number; height: number; forceRGB: boolean }): Uint8ClampedArray };
const { JpegImage } = (await import(/* @vite-ignore */ DECODERS)) as { JpegImage: new () => Jpeg };
const fx = (n: string) => new Uint8Array(readFileSync(new URL(`./fixtures/${n}`, import.meta.url)));
/** Propriétés du document (/Info des révisions, XMP du catalogue) : retirées. */
const MARKERS = ["ReperAuteur", "ReperAncien", "ReperCreateur", "ReperLogiciel", "20010203", "FEFF005200650070"];
/** Contenu du document (miniature de page, XMP d'une page) : jamais touché (décision du 11 novembre). */
const KEPT = ["ReperThumb", "ReperXMPPage", "ReperModel"];
const latin1 = (b: Uint8Array) => new TextDecoder("latin1").decode(b);

async function clean(name: string, bytes: Uint8Array = fx(name)): Promise<{ r: StripResult; out: Uint8Array }> {
  const r = await stripMetadata(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "application/pdf" }), "", name);
  return { r, out: r.state === "nettoye" ? new Uint8Array(await r.data.arrayBuffer()) : new Uint8Array(0) };
}

/** Tables xref classiques, lues indépendamment de pdf.ts : [numéro, position]. */
function classicEntries(s: string): [number, number][] {
  const out: [number, number][] = [];
  for (const m of s.matchAll(/xref\r?\n([\s\S]*?)trailer/gu)) {
    const lines = m[1]!.trim().split(/\r?\n/u);
    for (let i = 0; i < lines.length; ) {
      const [first, count] = lines[i++]!.trim().split(/\s+/u).map(Number) as [number, number];
      for (let k = 0; k < count; k++, i++) {
        const [off, , t] = lines[i]!.trim().split(/\s+/u);
        if (t === "n") out.push([first + k, Number(off)]);
      }
    }
  }
  return out;
}

describe("PDF (spec §35.2)", () => {
  it("meta.pdf : /Info des deux révisions et XMP du catalogue → null ; miniature et XMP de la page gardés ; même longueur ; xref toujours juste", async () => {
    const src = fx("meta.pdf");
    const { r, out } = await clean("meta.pdf");
    expect(r.state).toBe("nettoye");
    if (r.state !== "nettoye") return;
    expect(r.family).toBe("pdf");
    expect(found(src, MARKERS)).toEqual(MARKERS);
    expect(found(out, MARKERS)).toEqual([]);
    expect(found(out, KEPT)).toEqual(KEPT);
    // XMP du catalogue (objet 6) : seuls ses repères propres disparaissent ; celui de la page (8) reste.
    expect(latin1(out)).toMatch(/\n6 0 obj null +endobj\n/u);
    expect(out.length).toBe(src.length);
    const s = latin1(out);
    const entries = classicEntries(s);
    expect(entries.length).toBe(10);
    for (const [n, off] of entries) expect(s.slice(off, off + `${n} 0 obj`.length), `objet ${n}`).toBe(`${n} 0 obj`);
    for (const n of [6, 9, 10]) expect(s).toMatch(new RegExp(`\\n${n} 0 obj null +endobj\\n`, "u"));
    for (const n of [7, 8]) expect(s).not.toMatch(new RegExp(`\\n${n} 0 obj null`, "u"));
    // Tout le reste octet pour octet : pages, miniature, contenu, police, trailers (/ID compris).
    const diff = [...src].flatMap((b, i) => (b === out[i] ? [] : [i]));
    const neutral = entries.filter(([n]) => [6, 9, 10].includes(n)).map(([n, off]) => [off, s.indexOf("endobj", off)] as const);
    expect(diff.every((i) => neutral.some(([a, b]) => i > a && i < b))).toBe(true);
    expect(s).toContain("(Bonjour Shhdrop) Tj");
    expect(s.match(/\/ID \[<0123456789ABCDEF/gu)?.length).toBe(2);
  });

  it("flux xref (prédicteur PNG 12) : /Info et XMP neutralisés ; /Info dans un flux d'objets → echec", async () => {
    const { r, out } = await clean("xref-stream.pdf");
    expect(r.state).toBe("nettoye");
    expect(found(out, [...MARKERS, "ReperXMP", "ReperModel"])).toEqual([]); // XMP du catalogue
    expect(out.length).toBe(fx("xref-stream.pdf").length);
    expect(latin1(out)).toMatch(/\n7 0 obj null +endobj/u);
    expect((await clean("objstm-info.pdf")).r).toEqual({ state: "echec", reason: "malformed:pdf_info_objstm" });
  });

  it("signé ou chiffré → protege ; sans métadonnées → nettoye sans changement ; sans xref, tronqué → echec", async () => {
    expect((await clean("signed.pdf")).r.state).toBe("protege");
    expect((await clean("encrypted.pdf")).r.state).toBe("protege");
    const once = (await clean("meta.pdf")).out;
    const again = await clean("meta.pdf", once);
    expect(again.r.state).toBe("nettoye");
    expect(again.out).toEqual(once);
    expect(await cleanPdf(new Blob([once as Uint8Array<ArrayBuffer>]))).toEqual({ state: "ok", patches: [] });
    const noXref = new TextEncoder().encode("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n");
    expect((await clean("a.pdf", noXref)).r.state).toBe("echec");
    const src = fx("meta.pdf");
    expect((await clean("t.pdf", src.subarray(0, src.length >> 1))).r.state).toBe("echec");
    // Table xref décalée d'un octet : l'objet n'est pas là où la table l'annonce → echec.
    const shifted = latin1(src).replace(/(\d{10}) 00000 n/u, (_, o: string) => `${String(Number(o) + 1).padStart(10, "0")} 00000 n`);
    const bytes = (t: string) => new Uint8Array([...t].map((c) => c.charCodeAt(0)));
    expect((await clean("s.pdf", bytes(shifted))).r.state).toBe("echec");
    // Révision détachée de la chaîne (/Prev illisible) : son /Info resterait lisible → echec.
    expect((await clean("p.pdf", bytes(latin1(src).replace("/Prev", "/Pxev")))).r).toEqual({ state: "echec", reason: "malformed:pdf_info_orpheline" });
  });

  it("pièges : 400 troncatures et altérations à graine fixe → jamais d'exception, jamais « nettoye » avec un repère d'/Info", async () => {
    let seed = 11;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);
    for (const n of ["meta.pdf", "xref-stream.pdf"]) {
      const src = fx(n);
      for (let k = 0; k < 200; k++) {
        const b = k % 2 ? src.subarray(0, Math.floor(rnd() * src.length)) : src.slice();
        if (!(k % 2)) for (let j = 0; j < 3; j++) b[Math.floor(rnd() * b.length)] = Math.floor(rnd() * 256);
        const { r, out } = await clean(n, b);
        if (r.state === "nettoye") expect(found(out, ["ReperAuteur", "ReperLogiciel"])).toEqual([]);
      }
    }
  });
});

describe("PDF hostile (revue du 10 novembre)", () => {
  it("table de références en flux avec /W [0 0 0] : refusée tout de suite, sans boucle sur /Index", async () => {
    const pdf = "%PDF-1.5\n1 0 obj\n<< /Type /XRef /W [0 0 0] /Size 4000000 /Index [0 4000000] /Length 0 >>\nstream\n\nendstream\nendobj\nstartxref\n9\n%%EOF\n";
    const { r } = await clean("hostile.pdf", new TextEncoder().encode(pdf));
    expect(r).toEqual({ state: "echec", reason: "malformed:pdf_xref_w" });
  });
});

/** PDF minimal d'une page qui affiche l'image `img` (objet 4) ; objets de plus : `extra`. */
function imagePdf(filter: string, img: Uint8Array, extra: [number, string, Uint8Array?][] = []): Uint8Array {
  const enc = (t: string) => Uint8Array.from(t, (c) => c.charCodeAt(0));
  const objs: [number, string, Uint8Array?][] = [
    [1, "<< /Type /Catalog /Pages 2 0 R >>"],
    [2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>"],
    [3, "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 16 8] /Resources << /XObject << /Im1 4 0 R >> >> /Contents 5 0 R >>"],
    [4, `<< /Type /XObject /Subtype /Image /Width 16 /Height 8 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter ${filter}`, img],
    [5, "<<", enc("q 16 0 0 8 0 0 cm /Im1 Do Q")],
    ...extra,
  ];
  const parts: Uint8Array[] = [enc("%PDF-1.7\n%\xe2\xe3\xcf\xd3\n")];
  let pos = parts[0]!.length;
  const offs = new Map<number, number>();
  const push = (b: Uint8Array) => (parts.push(b), (pos += b.length));
  for (const [n, d, stream] of objs) {
    offs.set(n, pos);
    if (stream) {
      push(enc(`${n} 0 obj\n${d} /Length ${stream.length} >>\nstream\n`));
      push(stream);
      push(enc("\nendstream\nendobj\n"));
    } else push(enc(`${n} 0 obj\n${d}\nendobj\n`));
  }
  const size = Math.max(...offs.keys()) + 1;
  const rows = Array.from({ length: size }, (_, n) => (offs.has(n) ? `${String(offs.get(n)).padStart(10, "0")} 00000 n \n` : "0000000000 65535 f \n"));
  push(enc(`xref\n0 ${size}\n${rows.join("")}trailer\n<< /Size ${size} /Root 1 0 R >>\nstartxref\n${pos}\n%%EOF\n`));
  const out = new Uint8Array(pos);
  let o = 0;
  for (const p of parts) (out.set(p, o), (o += p.length));
  return out;
}
const PHOTO = ["ReperMake", "ReperModel", "ReperXMP", "ReperIPTC", "ReperCOM", "ReperJFXX", "ReperMPF", "ReperSecond", "ReperMotion", "2001:02:03"];
const GPS = new Uint8Array([0, 0, 0, 12, 0, 0, 0, 1, 0, 0, 0, 34, 0, 0, 0, 1, 0, 0, 0, 56, 0, 0, 0, 1]);
const pixels = (b: Uint8Array) => {
  const j = new JpegImage();
  j.parse(b);
  return j.getData({ width: j.width, height: j.height, forceRGB: true });
};
/** Segments APPn (Adobe excepté) et COM retirés d'un JPEG : reste décodable. */
function withoutApp(b: Uint8Array): Uint8Array {
  const out: number[] = [0xff, 0xd8];
  let o = 2;
  while (b[o + 1] !== 0xda) {
    const len = (b[o + 2]! << 8) | b[o + 3]!;
    const m = b[o + 1]!;
    if (!((m >= 0xe0 && m <= 0xef && m !== 0xee) || m === 0xfe)) out.push(...b.subarray(o, o + 2 + len));
    o += 2 + len;
  }
  return new Uint8Array([...out, ...b.subarray(o)]);
}

describe("PDF : images intégrées (revue du 10 novembre)", () => {
  const photo = fx("iphone-like.jpg");

  it("images intégrées jamais modifiées, quel que soit leur format (décision du propriétaire, 10 novembre)", async () => {
    const box = (t: string, body: number[]) => [0, 0, 0, 8 + body.length, ...[...t].map((c) => c.charCodeAt(0)), ...body];
    const jp2 = new Uint8Array([...box("jP  ", [13, 10, 135, 10]), ...box("ftyp", [...Buffer.from("jp2 \0\0\0\0jp2 ")]), ...box("xml ", [...Buffer.from("<x>ReperXMP</x>")]), ...box("jp2c", [0xff, 0x4f, 0xff, 0x51])]);
    for (const [filter, data] of [["/DCTDecode", photo], ["[/FlateDecode /DCTDecode]", deflateSync(photo)], ["/JPXDecode", jp2]] as const) {
      const pdf = imagePdf(filter, data);
      const { r, out } = await clean("photo.pdf", pdf);
      expect(r.state, filter).toBe("nettoye");
      const at = latin1(pdf).indexOf("stream\n", latin1(pdf).indexOf("4 0 obj")) + 7;
      expect(Buffer.from(out.subarray(at, at + data.length)).equals(Buffer.from(data)), filter).toBe(true);
    }
  });

  it("budget global de décompression : flux d'objets sous 50 Mio chacun mais 225 Mio en tout → echec, sans figer", async () => {
    const zeros = deflateSync(new Uint8Array(45 * 1048576));
    const extra: [number, string, Uint8Array][] = [6, 7, 8, 9, 10].map((n) => [n, "<< /Type /ObjStm /N 0 /First 0 /Filter /FlateDecode", zeros]);
    const { r } = await clean("bombe.pdf", imagePdf("/DCTDecode", photo, extra));
    expect(r).toEqual({ state: "echec", reason: "malformed:pdf_budget" });
  }, 30_000);
});
