// Nettoyage des documents Office et ODF (spec §35.2, Task 9b) sur les fichiers d'essai de
// scripts/gen-fixtures.mjs (repères fictifs).
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { zipBytes } from "../../scripts/gen-fixtures.mjs";
import { cleanJpeg } from "./jpeg";
import { stripMetadata, type StripResult } from "./strip";
import { found } from "./test-markers";
import { rewriteXml } from "./xmlattr";
import { entryData, isNormalized, readZip, type ZipEntry } from "./zip";

const fx = (n: string) => new Uint8Array(readFileSync(new URL(`./fixtures/${n}`, import.meta.url)));
const MIME: Record<string, string> = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  odt: "application/vnd.oasis.opendocument.text",
};
const dec = new TextDecoder();

async function clean(name: string, bytes: Uint8Array = fx(name)): Promise<StripResult> {
  return stripMetadata(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: MIME[name.split(".").pop()!] }), "", name);
}
/** Sortie nettoyée : entrées et contenus décompressés. */
async function open(r: StripResult) {
  if (r.state !== "nettoye") throw new Error(`état ${r.state}`);
  const zip = await readZip(r.data);
  const parts = new Map<string, Uint8Array>();
  for (const e of zip.entries) parts.set(e.name, await entryData(r.data, e, 1 << 26));
  return { zip, parts, raw: new Uint8Array(await r.data.arrayBuffer()), text: (n: string) => dec.decode(parts.get(n)) };
}
const allBytes = (parts: Map<string, Uint8Array>) => [...parts.values()];

describe("bureautique (spec §35.2)", () => {
  afterEach(() => vi.unstubAllGlobals());

  /** Parties du document d'origine, décompressées. */
  async function sourceParts(name: string) {
    const blob = new Blob([fx(name)]);
    const z = await readZip(blob);
    const m = new Map<string, Uint8Array>();
    for (const e of z.entries) m.set(e.name, await entryData(blob, e, 1 << 26));
    return m;
  }
  /** Règle du propriétaire (D41-27) : seules ces parties changent ; tout le reste (commentaires,
   *  personnes, suivi des modifications, corps du document) est recopié octet pour octet. */
  const TOUCHED = /^(docProps\/|meta\.xml$|_rels\/\.rels$|\[Content_Types\]\.xml$|META-INF\/manifest\.xml$|Thumbnails\/|(word|xl|ppt)\/media\/|Pictures\/)/u;
  async function untouched(name: string, parts: Map<string, Uint8Array>) {
    for (const [n, b] of await sourceParts(name)) if (!TOUCHED.test(n)) expect(parts.get(n), `${name} ${n}`).toEqual(b);
  }
  const PROPS_MARKERS = ["ReperSociete", "ReperModele", "ReperLogiciel", "ReperCustom", "ReperMiniature", "ReperCommentaireZip", "ReperTitre", "ReperResponsable", "ReperMotcle", "ReperMake", "ReperModel", "ReperXMP", "2001:02:03", "PT42M"];

  it("DOCX : propriétés minimales, miniature retirée, image nettoyée ; commentaires, personnes et suivi des modifications intacts (D41-27)", async () => {
    const r = await clean("meta.docx");
    expect(r.state).toBe("nettoye");
    if (r.state !== "nettoye") return;
    expect(r.family).toBe("bureautique");
    const { zip, parts, raw, text } = await open(r);
    expect(found(raw, ["ReperCommentaireZip"])).toEqual([]);
    for (const n of ["docProps/core.xml", "docProps/app.xml", "docProps/custom.xml"]) expect(found(parts.get(n)!, [...PROPS_MARKERS, "ReperAuteur", "2001-02-03"]), n).toEqual([]);
    for (const b of allBytes(parts)) expect(found(b, PROPS_MARKERS)).toEqual([]);
    await untouched("meta.docx", parts);
    // Toutes les parties XML bien formées ; mêmes noms de parties, miniature exceptée.
    const before = await readZip(new Blob([fx("meta.docx")]));
    expect(zip.entries.map((e) => e.name)).toEqual(before.entries.map((e) => e.name).filter((n) => n !== "docProps/thumbnail.jpeg"));
    for (const [n, b] of parts) if (n.endsWith(".xml") || n.endsWith(".rels")) expect(() => rewriteXml(dec.decode(b), []), n).not.toThrow();
    expect(text("docProps/core.xml")).toMatch(/^<\?xml[^>]+\?>\n<cp:coreProperties [^>]+\/>$/u);
    expect(text("docProps/app.xml")).toMatch(/<Properties xmlns="http:\/\/schemas.openxmlformats.org\/officeDocument\/2006\/extended-properties" xmlns:vt="[^"]+"\/>$/u);
    expect(text("docProps/custom.xml")).toMatch(/custom-properties" xmlns:vt="[^"]+"\/>$/u);
    // Commentaires et suivi des modifications : laissés tels quels, auteurs et dates compris.
    expect(text("word/comments.xml")).toContain('w:author="ReperCommentateur" w:date="2001-02-03T04:05:06Z"');
    expect(text("word/people.xml")).toContain("w15:person");
    expect(text("word/document.xml")).toContain('<w:ins w:id="1" w:author="ReperSuivi" w:date="2002-03-04T05:06:07Z">');
    expect(text("_rels/.rels")).not.toContain("thumbnail");
    expect(text("_rels/.rels")).toContain("docProps/core.xml");
    expect(text("[Content_Types].xml")).not.toContain("thumbnail");
    expect(text("[Content_Types].xml")).toContain('Extension="jpeg"');
    // Image intégrée : métadonnées retirées par les règles des images (pixels, orientation et ICC gardés).
    const jpg = await entryData(new Blob([fx("meta.docx")]), before.entries.find((e) => e.name === "word/media/image1.jpeg")!, 1 << 26);
    expect(parts.get("word/media/image1.jpeg")).toEqual(cleanJpeg(jpg));
    // Entrées inchangées : données compressées et CRC identiques ; toutes normalisées.
    const doc = (z: { entries: readonly ZipEntry[] }) => z.entries.find((e) => e.name === "word/document.xml")!;
    const src = fx("meta.docx");
    expect(doc(zip).crc).toBe(doc(before).crc);
    expect(doc(zip).method).toBe(8);
    expect(raw.subarray(doc(zip).dataOffset, doc(zip).dataOffset + doc(zip).csize)).toEqual(src.subarray(doc(before).dataOffset, doc(before).dataOffset + doc(before).csize));
    expect(zip.entries.every(isNormalized)).toBe(true);
    expect(zip.commentLength).toBe(0);
  });

  it("XLSX et PPTX : propriétés retirées ; commentaires, personnes et auteurs intacts", async () => {
    for (const n of ["meta.xlsx", "meta.pptx"]) {
      const r = await clean(n);
      expect(r.state, n).toBe("nettoye");
      const { parts } = await open(r);
      for (const [p, b] of parts) expect(found(b, PROPS_MARKERS), `${n} ${p}`).toEqual([]);
      for (const p of ["docProps/core.xml", "docProps/app.xml"]) if (parts.has(p)) expect(found(parts.get(p)!, ["ReperAuteur", "2001-02-03"]), `${n} ${p}`).toEqual([]);
      await untouched(n, parts);
    }
    const x = await open(await clean("meta.xlsx"));
    expect(x.text("xl/persons/person.xml")).toContain('displayName="ReperPersonne"');
    const p = await open(await clean("meta.pptx"));
    expect(p.text("ppt/commentAuthors.xml")).toContain("ReperAuteurPPT");
  });

  it("ODT : mimetype premier et stocké, meta.xml minimal (même version), annotations et suivi intacts, miniature retirée", async () => {
    const r = await clean("meta.odt");
    expect(r.state).toBe("nettoye");
    if (r.state !== "nettoye") return;
    const { zip, parts, raw, text } = await open(r);
    expect(zip.entries[0]!.name).toBe("mimetype");
    expect(zip.entries[0]!.method).toBe(0);
    expect(dec.decode(raw.subarray(30, 38 + 39))).toBe("mimetypeapplication/vnd.oasis.opendocument.text");
    expect(text("meta.xml")).toMatch(/<office:document-meta xmlns:office="[^"]+"[^>]* office:version="1\.3"><office:meta\/><\/office:document-meta>$/u);
    expect(text("content.xml")).toContain("<dc:creator>ReperAuteurODF</dc:creator><dc:date>2001-02-03T04:05:06</dc:date>");
    expect(text("content.xml")).toContain("<dc:creator>ReperSuivi</dc:creator>");
    await untouched("meta.odt", parts);
    expect(parts.has("Thumbnails/thumbnail.png")).toBe(false);
    expect(text("META-INF/manifest.xml")).not.toContain("Thumbnails");
    for (const [p, b] of parts) expect(found(b, PROPS_MARKERS), p).toEqual([]);
    expect(found(raw, ["ReperCommentaireZip"])).toEqual([]);
  });

  it("refus : document protégé (OLE) ou signé → protege ; ZIP64, nom en double, tronqué, sans [Content_Types] → echec ; sans DecompressionStream → echec", async () => {
    expect((await clean("protected.docx")).state).toBe("protege");
    expect((await clean("signed.docx")).state).toBe("protege");
    const odfSigned = zipBytes([["mimetype", new TextEncoder().encode("application/vnd.oasis.opendocument.text"), { store: true }], ["META-INF/documentsignatures.xml", new TextEncoder().encode("<a/>")]]);
    expect((await clean("signed.odt", odfSigned)).state).toBe("protege");
    const docx = fx("meta.docx");
    expect((await clean("t.docx", docx.subarray(0, docx.length >> 1))).state).toBe("echec");
    expect((await clean("d.docx", zipBytes([["[Content_Types].xml", new TextEncoder().encode("<a/>")], ["[Content_Types].xml", new TextEncoder().encode("<b/>")]]))).state).toBe("echec");
    expect((await clean("v.docx", zipBytes([["a.xml", new TextEncoder().encode("<a/>")]]))).state).toBe("echec");
    const z64 = docx.slice();
    const z = await readZip(new Blob([docx]));
    const v = new DataView(z64.buffer);
    const cdAt = v.getUint32(docx.length - 22 - "ReperCommentaireZip".length + 16, true);
    v.setUint32(cdAt + 24, 0xffffffff, true);
    expect(z.entries.length).toBeGreaterThan(1);
    expect((await clean("z.docx", z64)).state).toBe("echec");
    vi.stubGlobal("DecompressionStream", undefined);
    expect((await clean("meta.docx")).state).toBe("echec");
    expect((await clean("meta.odt")).state).toBe("echec");
  });

  it("pièges : 300 troncatures et altérations à graine fixe → jamais d'exception, jamais « nettoye » avec un repère", async () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);
    for (const n of ["meta.docx", "meta.odt"]) {
      const src = fx(n);
      for (let k = 0; k < 150; k++) {
        const b = k % 2 ? src.subarray(0, Math.floor(rnd() * src.length)) : src.slice();
        if (!(k % 2)) for (let j = 0; j < 4; j++) b[Math.floor(rnd() * b.length)] = Math.floor(rnd() * 256);
        const r = await clean(n, b);
        if (r.state === "nettoye") for (const p of allBytes((await open(r)).parts)) expect(found(p, ["ReperSociete", "ReperTitre", "ReperMiniature"])).toEqual([]);
      }
    }
  });
});
