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
const MARKERS = ["ReperAuteur", "ReperSociete", "ReperModele", "ReperLogiciel", "ReperCustom", "ReperCommentateur", "ReperCompte", "ReperMiniature", "ReperCommentaireZip", "ReperTitre", "ReperResponsable", "ReperPersonne", "ReperMotcle", "ReperMake", "ReperModel", "ReperXMP", "2001-02-03", "2001:02:03", "PT42M"];
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

  it("DOCX : propriétés minimales, auteurs des commentaires « Auteur », dates retirées, comptes retirés, miniature retirée, image nettoyée ; suivi des modifications intact et signalé", async () => {
    const r = await clean("meta.docx");
    expect(r.state).toBe("nettoye");
    if (r.state !== "nettoye") return;
    expect(r.family).toBe("bureautique");
    expect(r.notes).toEqual(["suivi_modifs"]);
    const { zip, parts, raw, text } = await open(r);
    expect(found(raw, MARKERS)).toEqual([]);
    for (const b of allBytes(parts)) expect(found(b, MARKERS)).toEqual([]);
    // Toutes les parties XML bien formées ; mêmes noms de parties, miniature exceptée.
    const before = await readZip(new Blob([fx("meta.docx")]));
    expect(zip.entries.map((e) => e.name)).toEqual(before.entries.map((e) => e.name).filter((n) => n !== "docProps/thumbnail.jpeg"));
    for (const [n, b] of parts) if (n.endsWith(".xml") || n.endsWith(".rels")) expect(() => rewriteXml(dec.decode(b), []), n).not.toThrow();
    expect(text("docProps/core.xml")).toMatch(/^<\?xml[^>]+\?>\n<cp:coreProperties [^>]+\/>$/u);
    expect(text("docProps/app.xml")).toMatch(/<Properties xmlns="http:\/\/schemas.openxmlformats.org\/officeDocument\/2006\/extended-properties" xmlns:vt="[^"]+"\/>$/u);
    expect(text("docProps/custom.xml")).toMatch(/custom-properties" xmlns:vt="[^"]+"\/>$/u);
    expect(text("word/comments.xml")).toContain('<w:comment w:id="0" w:author="Auteur" w:initials="A">');
    expect(text("word/comments.xml")).toContain("Un commentaire");
    expect(text("word/people.xml")).not.toContain("w15:person");
    expect(text("word/commentsExtensible.xml")).toContain('w16cex:durableId="1A2B3C4D"/>');
    expect(text("_rels/.rels")).not.toContain("thumbnail");
    expect(text("_rels/.rels")).toContain("docProps/core.xml");
    expect(text("[Content_Types].xml")).not.toContain("thumbnail");
    expect(text("[Content_Types].xml")).toContain('Extension="jpeg"');
    // Suivi des modifications : laissé tel quel (décision de la spécification).
    expect(text("word/document.xml")).toContain('<w:ins w:id="1" w:author="ReperSuivi" w:date="2002-03-04T05:06:07Z">');
    // Image intégrée : nettoyée par les règles des images (orientation et ICC gardés).
    const jpg = (await entryData(new Blob([fx("meta.docx")]), before.entries.find((e) => e.name === "word/media/image1.jpeg")!, 1 << 26));
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

  it("XLSX et PPTX : auteurs, personnes, comptes et dates des commentaires retirés", async () => {
    for (const n of ["meta.xlsx", "meta.pptx"]) {
      const r = await clean(n);
      expect(r.state, n).toBe("nettoye");
      const { parts } = await open(r);
      for (const [p, b] of parts) expect(found(b, [...MARKERS, "ReperAuteurXL", "ReperAuteurPPT"]), `${n} ${p}`).toEqual([]);
      if (r.state === "nettoye") expect(r.notes).toEqual([]);
    }
    const x = await open(await clean("meta.xlsx"));
    expect(x.text("xl/comments1.xml")).toContain("<authors><author>Auteur</author></authors>");
    expect(x.text("xl/persons/person.xml")).toContain('<person displayName="Auteur" id="{00000000-0000-0000-0000-000000000001}"/>');
    expect(x.text("xl/threadedComments/threadedComment1.xml")).not.toContain("dT=");
    const p = await open(await clean("meta.pptx"));
    expect(p.text("ppt/commentAuthors.xml")).toContain('name="Auteur" initials="A"');
    expect(p.text("ppt/authors.xml")).toContain('name="Auteur" initials="A" userId="" providerId=""');
    expect(p.text("ppt/comments/comment1.xml")).toContain('<p:cm authorId="0" idx="1">');
    expect(p.text("ppt/comments/modernComment_1.xml")).toContain('created="1980-01-01T00:00:00Z"');
  });

  it("ODT : mimetype premier et stocké, meta.xml minimal (même version), annotation « Auteur », modification suivie gardée et signalée, miniature retirée", async () => {
    const r = await clean("meta.odt");
    expect(r.state).toBe("nettoye");
    if (r.state !== "nettoye") return;
    expect(r.notes).toEqual(["suivi_modifs"]);
    const { zip, parts, raw, text } = await open(r);
    expect(zip.entries[0]!.name).toBe("mimetype");
    expect(zip.entries[0]!.method).toBe(0);
    expect(dec.decode(raw.subarray(30, 38 + 39))).toBe("mimetypeapplication/vnd.oasis.opendocument.text");
    expect(text("meta.xml")).toMatch(/<office:document-meta xmlns:office="[^"]+"[^>]* office:version="1\.3"><office:meta\/><\/office:document-meta>$/u);
    expect(text("content.xml")).toContain("<office:annotation><dc:creator>Auteur</dc:creator><text:p>Un commentaire</text:p></office:annotation>");
    expect(text("content.xml")).toContain("<dc:creator>ReperSuivi</dc:creator>");
    expect(parts.has("Thumbnails/thumbnail.png")).toBe(false);
    expect(text("META-INF/manifest.xml")).not.toContain("Thumbnails");
    for (const [p, b] of parts) expect(found(b, [...MARKERS, "ReperAuteurODF"]), p).toEqual([]);
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
        if (r.state === "nettoye") for (const p of allBytes((await open(r)).parts)) expect(found(p, ["ReperAuteur", "ReperSociete", "ReperCommentateur"])).toEqual([]);
      }
    }
  });
});
