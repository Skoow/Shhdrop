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
  async function sourceParts(name: string, bytes: Uint8Array = fx(name)) {
    const blob = new Blob([bytes as Uint8Array<ArrayBuffer>]);
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

  /** Document d'origine dont les parties `add` remplacent ou complètent celles du fichier d'essai. */
  async function variant(name: string, add: Record<string, string | Uint8Array>): Promise<Uint8Array> {
    const src = await sourceParts(name);
    for (const [n, v] of Object.entries(add)) src.set(n, typeof v === "string" ? new TextEncoder().encode(v) : v);
    return zipBytes([...src].map(([n, b]) => [n, b as Uint8Array<ArrayBuffer>]));
  }
  /** Paquet cohérent : chaque relation interne vise une partie présente, chaque Override aussi,
   *  et chaque identifiant cité (r:id, r:embed…) par une partie existe dans ses relations. */
  function consistent(parts: Map<string, Uint8Array>, before: Map<string, Uint8Array>) {
    const resolve = (base: string, t: string) => {
      const segs = t.startsWith("/") ? [] : base.split("/").slice(0, -1);
      for (const s of t.replace(/^\//u, "").split("/")) s === ".." ? segs.pop() : s !== "." && segs.push(s);
      return segs.join("/");
    };
    for (const [n, b] of parts) {
      const m = /^(.*?)_rels\/([^/]+)\.rels$/u.exec(n);
      if (!m) continue;
      const source = m[1]! + m[2]!;
      const ids = new Set<string>();
      for (const r of dec.decode(b).matchAll(/<Relationship ([^>]+)\/>/gu)) {
        const a = Object.fromEntries([...r[1]!.matchAll(/(\w+)="([^"]*)"/gu)].map((x) => [x[1]!, x[2]!]));
        ids.add(a.Id!);
        // (relation déjà sans cible dans l'original : hors sujet)
        if (a.TargetMode !== "External" && before.has(resolve(source, a.Target!))) expect(parts.has(resolve(source, a.Target!)), `${n} → ${a.Target}`).toBe(true);
      }
      if (source && parts.has(source)) for (const r of dec.decode(parts.get(source)).matchAll(/\sr:\w+="(rId\w+)"/gu)) expect(ids.has(r[1]!), `${source} ${r[1]}`).toBe(true);
    }
    for (const o of dec.decode(parts.get("[Content_Types].xml")).matchAll(/PartName="\/([^"]+)"/gu)) if (before.has(o[1]!)) expect(parts.has(o[1]!), o[1]).toBe(true);
    for (const [n, b] of parts) if (n.endsWith(".xml") || n.endsWith(".rels")) expect(() => rewriteXml(dec.decode(b), []), n).not.toThrow();
  }
  const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const RELS = (body: string) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${body}</Relationships>`;
  const PRINTER = new Uint8Array([...new TextEncoder().encode("ReperImprimante"), 0, ...[..."ReperImprimante"].flatMap((c) => [c.charCodeAt(0), 0])]);

  it("DOCX : modèle attaché (chemin local) et paramètres d'imprimante retirés, paquet cohérent", async () => {
    const src = await sourceParts("meta.docx");
    const ct = dec.decode(src.get("[Content_Types].xml")).replace("</Types>", '<Default Extension="bin" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.printerSettings"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/></Types>');
    const docRels = dec.decode(src.get("word/_rels/document.xml.rels")).replace("</Relationships>", `<Relationship Id="rId20" Type="${R}/settings" Target="settings.xml"/><Relationship Id="rId21" Type="${R}/printerSettings" Target="printerSettings/printerSettings1.bin"/></Relationships>`);
    const doc = dec.decode(src.get("word/document.xml")).replace("</w:body>", '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:printerSettings r:id="rId21"/></w:sectPr></w:body>');
    const settings = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="${R}"><w:zoom w:percent="100"/><w:attachedTemplate r:id="rId1"/><w:defaultTabStop w:val="708"/></w:settings>`;
    const setRels = RELS(`<Relationship Id="rId1" Type="${R}/attachedTemplate" Target="file:///C:\\Users\\ReperUtilisateur\\AppData\\Roaming\\Microsoft\\Templates\\Normal.dotm" TargetMode="External"/>`);
    const bytes = await variant("meta.docx", { "[Content_Types].xml": ct, "word/_rels/document.xml.rels": docRels, "word/document.xml": doc, "word/settings.xml": settings, "word/_rels/settings.xml.rels": setRels, "word/printerSettings/printerSettings1.bin": PRINTER });
    const { parts, raw, text } = await open(await clean("p.docx", bytes));
    expect(found(raw, ["ReperUtilisateur", "ReperImprimante"])).toEqual([]);
    for (const b of allBytes(parts)) expect(found(b, ["ReperUtilisateur", "ReperImprimante"])).toEqual([]);
    expect(parts.has("word/printerSettings/printerSettings1.bin")).toBe(false);
    expect(text("word/settings.xml")).toContain('<w:zoom w:percent="100"/><w:defaultTabStop w:val="708"/>');
    expect(text("word/_rels/document.xml.rels")).not.toContain("printerSettings");
    expect(text("word/_rels/document.xml.rels")).toContain('Target="settings.xml"');
    expect(text("word/document.xml")).toContain('<w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr>');
    expect(text("word/document.xml")).toContain('w:author="ReperSuivi"');
    consistent(parts, await sourceParts("", bytes));
  });

  it("XLSX : chemin local (x15ac:absPath) et paramètres d'imprimante retirés, mise en page gardée, paquet cohérent", async () => {
    const src = await sourceParts("meta.xlsx");
    const ct = dec.decode(src.get("[Content_Types].xml")).replace("</Types>", '<Override PartName="/xl/printerSettings/printerSettings1.bin" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.printerSettings"/></Types>');
    const wb = dec.decode(src.get("xl/workbook.xml")).replace("<sheets>", '<mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><mc:Choice Requires="x15"><x15ac:absPath xmlns:x15ac="http://schemas.microsoft.com/office/spreadsheetml/2010/11/ac" url="C:\\Users\\ReperUtilisateur\\Documents\\"/></mc:Choice></mc:AlternateContent><sheets>');
    const sheet = dec.decode(src.get("xl/worksheets/sheet1.xml")).replace("</sheetData>", '</sheetData><pageSetup paperSize="9" orientation="landscape" r:id="rId1"/>');
    const sheetRels = RELS(`<Relationship Id="rId1" Type="${R}/printerSettings" Target="../printerSettings/printerSettings1.bin"/>`);
    const bytes = await variant("meta.xlsx", { "[Content_Types].xml": ct, "xl/workbook.xml": wb, "xl/worksheets/sheet1.xml": sheet, "xl/worksheets/_rels/sheet1.xml.rels": sheetRels, "xl/printerSettings/printerSettings1.bin": PRINTER });
    const { parts, raw, text } = await open(await clean("p.xlsx", bytes));
    expect(found(raw, ["ReperUtilisateur", "ReperImprimante"])).toEqual([]);
    for (const b of allBytes(parts)) expect(found(b, ["ReperUtilisateur", "ReperImprimante"])).toEqual([]);
    expect(parts.has("xl/printerSettings/printerSettings1.bin")).toBe(false);
    expect(text("xl/workbook.xml")).not.toContain("absPath");
    expect(text("xl/workbook.xml")).toContain('<sheet name="Feuille1"');
    expect(text("xl/worksheets/sheet1.xml")).toContain('<pageSetup paperSize="9" orientation="landscape"/>');
    expect(text("[Content_Types].xml")).not.toContain("printerSettings");
    expect(text("xl/persons/person.xml")).toContain('displayName="ReperPersonne"');
    consistent(parts, await sourceParts("", bytes));
  });

  it("ODT : nom et réglages de l'imprimante retirés de settings.xml, autres réglages gardés", async () => {
    const C = 'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:config="urn:oasis:names:tc:opendocument:xmlns:config:1.0"';
    const settings = `<?xml version="1.0" encoding="UTF-8"?>\n<office:document-settings ${C} office:version="1.3"><office:settings><config:config-item-set config:name="ooo:configuration-settings"><config:config-item config:name="PrinterName" config:type="string">ReperImprimante</config:config-item><config:config-item config:name="PrinterSetup" config:type="base64Binary">UmVwZXJJbXByaW1hbnRl</config:config-item><config:config-item config:name="PrinterIndependentLayout" config:type="string">high-resolution</config:config-item></config:config-item-set></office:settings></office:document-settings>`;
    const src = await sourceParts("meta.odt");
    const entries = [...src].map(([n, b]): [string, Uint8Array<ArrayBuffer>, { store?: boolean }] => [n, b as Uint8Array<ArrayBuffer>, { store: n === "mimetype" }]);
    entries.push(["settings.xml", new TextEncoder().encode(settings), {}]);
    const { parts, text } = await open(await clean("s.odt", zipBytes(entries)));
    expect(found(parts.get("settings.xml")!, ["ReperImprimante", "UmVwZXJJbXByaW1hbnRl"])).toEqual([]);
    expect(text("settings.xml")).toContain('<config:config-item config:name="PrinterName" config:type="string"></config:config-item>');
    expect(text("settings.xml")).toContain('config:name="PrinterIndependentLayout"');
    expect(text("settings.xml")).not.toContain("PrinterSetup");
  });

  it("imprimante citée par une partie inconnue → echec (jamais de paquet incohérent)", async () => {
    const src = await sourceParts("meta.xlsx");
    const wb = dec.decode(src.get("xl/workbook.xml")).replace("<sheets>", '<fileVersion r:id="rId7"/><sheets>');
    const wbRels = dec.decode(src.get("xl/_rels/workbook.xml.rels")).replace("</Relationships>", `<Relationship Id="rId7" Type="${R}/printerSettings" Target="printerSettings/printerSettings1.bin"/></Relationships>`);
    const bytes = await variant("meta.xlsx", { "xl/workbook.xml": wb, "xl/_rels/workbook.xml.rels": wbRels, "xl/printerSettings/printerSettings1.bin": PRINTER });
    expect((await clean("q.xlsx", bytes)).state).toBe("echec");
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
