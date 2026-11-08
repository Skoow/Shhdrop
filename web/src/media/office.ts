// Nettoyage des documents Office (OOXML : .docx, .xlsx, .pptx et variantes) et ODF (.odt,
// .ods, .odp…) (spec §35.2, Task 9b) : propriétés du document remplacées par des versions
// minimales de même nom, auteurs des commentaires remplacés par « Auteur », dates des
// commentaires retirées, miniatures retirées (et leurs références), images intégrées
// nettoyées, ZIP réécrit (zip.ts). Le suivi des modifications est laissé intact (décision
// de la spécification) mais signalé. Le résultat est relu par le même analyseur : il ne doit
// plus rien demander, sinon `Malformed` (→ `echec`).
import { STRIP_MAX } from "../limits";
import { Malformed, equal } from "./bytes";
import { FORMAT_HEAD, detectFormat } from "./format";
import { cleanGif } from "./gif";
import { cleanHeif } from "./heif";
import { cleanJpeg } from "./jpeg";
import { patchedBlob } from "./patch";
import { cleanPng } from "./png";
import type { CleanNote } from "./strip";
import { cleanWebp } from "./webp";
import { decodeXml, encodeXml, qn, rewriteXml, rootTag, type XmlRule } from "./xmlattr";
import { entryData, isNormalized, readZip, writeZip, type ZipEntry, type ZipFile } from "./zip";

export type OfficeKind = "ooxml" | "odf";
export type OfficeResult = { state: "protege" } | { state: "ok"; data: Blob; notes: CleanNote[] };

const AUTHOR = "Auteur";
const INITIAL = "A";
const FIXED_DATE = "1980-01-01T00:00:00Z";

// Espaces de noms (OOXML transitionnel et strict).
const W = ["http://schemas.openxmlformats.org/wordprocessingml/2006/main", "http://purl.oclc.org/ooxml/wordprocessingml/main"];
const SML = ["http://schemas.openxmlformats.org/spreadsheetml/2006/main", "http://purl.oclc.org/ooxml/spreadsheetml/main"];
const PML = ["http://schemas.openxmlformats.org/presentationml/2006/main", "http://purl.oclc.org/ooxml/presentationml/main"];
const W15 = "http://schemas.microsoft.com/office/word/2012/wordml";
const W16CEX = "http://schemas.microsoft.com/office/word/2018/wordml/cex";
const XTC = "http://schemas.microsoft.com/office/spreadsheetml/2018/threadedcomments";
const P188 = "http://schemas.microsoft.com/office/powerpoint/2018/8/main";
const RELS = "http://schemas.openxmlformats.org/package/2006/relationships";
const CT = "http://schemas.openxmlformats.org/package/2006/content-types";
const THUMB_REL = /\/metadata\/thumbnail$/u;
const OFFICE = "urn:oasis:names:tc:opendocument:xmlns:office:1.0";
const META = "urn:oasis:names:tc:opendocument:xmlns:meta:1.0";
const DC = "http://purl.org/dc/elements/1.1/";
const TEXT = "urn:oasis:names:tc:opendocument:xmlns:text:1.0";
const MANIFEST = "urn:oasis:names:tc:opendocument:xmlns:manifest:1.0";

const each = (nss: string[], f: (ns: string) => XmlRule[]) => nss.flatMap(f);

/** Règles par partie (OOXML). */
const OOXML_RULES: [RegExp, XmlRule[]][] = [
  [
    /^word\/comments\.xml$/u,
    each(W, (ns) => [
      { el: qn(ns, "comment"), attr: qn(ns, "author"), set: AUTHOR },
      { el: qn(ns, "comment"), attr: qn(ns, "initials"), set: INITIAL },
      { el: qn(ns, "comment"), attr: qn(ns, "date"), remove: true },
    ]),
  ],
  [/^word\/commentsExtensible\.xml$/u, [{ el: qn(W16CEX, "commentExtensible"), attr: qn(W16CEX, "dateUtc"), remove: true }]],
  // Personnes (noms, identifiants de compte) : toutes retirées ; la partie reste, vide.
  [/^word\/people\.xml$/u, [{ el: qn(W15, "person"), drop: true }]],
  [/^xl\/comments[^/]*\.xml$/u, each(SML, (ns) => [{ el: qn(ns, "author"), within: qn(ns, "authors"), text: AUTHOR }])],
  [/^xl\/threadedComments\/[^/]+\.xml$/u, [{ el: qn(XTC, "threadedComment"), attr: "dT", remove: true }]],
  [
    /^xl\/persons\/[^/]+\.xml$/u,
    [
      { el: qn(XTC, "person"), attr: "displayName", set: AUTHOR },
      { el: qn(XTC, "person"), attr: "userId", remove: true },
      { el: qn(XTC, "person"), attr: "providerId", remove: true },
    ],
  ],
  [
    /^ppt\/commentAuthors\.xml$/u,
    each(PML, (ns) => [
      { el: qn(ns, "cmAuthor"), attr: "name", set: AUTHOR },
      { el: qn(ns, "cmAuthor"), attr: "initials", set: INITIAL },
    ]),
  ],
  [/^ppt\/comments\/[^/]+\.xml$/u, [...each(PML, (ns) => [{ el: qn(ns, "cm"), attr: "dt", remove: true } as XmlRule]), { el: qn(P188, "cm"), attr: "created", set: FIXED_DATE }, { el: qn(P188, "reply"), attr: "created", set: FIXED_DATE }]],
  [
    /^ppt\/authors\.xml$/u,
    [
      { el: qn(P188, "author"), attr: "name", set: AUTHOR },
      { el: qn(P188, "author"), attr: "initials", set: INITIAL },
      { el: qn(P188, "author"), attr: "userId", set: "" },
      { el: qn(P188, "author"), attr: "providerId", set: "" },
    ],
  ],
];
const OOXML_PROPS = new Set(["docProps/core.xml", "docProps/app.xml", "docProps/custom.xml"]);
const OOXML_MEDIA = /^(word|xl|ppt)\/media\/[^/]+$/u;
const OOXML_TRACKED_PARTS = /^word\/(document|header\d*|footer\d*|footnotes|endnotes)\.xml$/u;
const WORD_TRACKED = /<[A-Za-z0-9_]+:(ins|del|moveFrom|moveTo|rPrChange|pPrChange|sectPrChange|tblPrChange|trPrChange|tcPrChange|numberingChange)[\s>/]/u;

// ODF : auteurs et dates des annotations seulement (pas des modifications suivies).
const ODF_ANNOTATION: XmlRule[] = [
  { el: qn(DC, "creator"), within: qn(OFFICE, "annotation"), text: AUTHOR },
  { el: qn(DC, "date"), within: qn(OFFICE, "annotation"), drop: true },
  { el: qn(META, "creator-initials"), within: qn(OFFICE, "annotation"), drop: true },
];
const ODF_MEDIA = /^Pictures\/[^/]+$/u;

const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

/** Version minimale d'une partie : la racine, ses déclarations d'espaces de noms, rien d'autre. */
function minimalPart(xml: string, keep: (attr: string) => boolean, child = ""): string {
  const root = rootTag(xml);
  const attrs = root.attrs.filter((a) => a.name === "xmlns" || a.name.startsWith("xmlns:") || keep(a.name));
  const open = `<${root.name}${attrs.map((a) => ` ${a.name}="${a.value}"`).join("")}`;
  return XML_DECL + (child ? `${open}>${child}</${root.name}>` : `${open}/>`);
}

async function cleanImage(bytes: Uint8Array<ArrayBuffer>, name: string): Promise<Uint8Array<ArrayBuffer>> {
  const fmt = detectFormat(bytes.subarray(0, FORMAT_HEAD), "", name);
  const small = { jpeg: cleanJpeg, png: cleanPng, webp: cleanWebp, gif: cleanGif }[fmt as string];
  if (small) return small(bytes);
  if (fmt === "heif") {
    const b = new Blob([bytes]);
    return new Uint8Array(await patchedBlob(b, await cleanHeif(b)).arrayBuffer());
  }
  return bytes; // autres formats (EMF, WMF, SVG…) : laissés tels quels
}

type Plan = { protege: boolean; edits: Map<string, Uint8Array | null>; notes: Set<CleanNote> };

async function plan(file: Blob, zip: ZipFile, kind: OfficeKind): Promise<Plan> {
  const p: Plan = { protege: false, edits: new Map(), notes: new Set() };
  const byName = new Map(zip.entries.map((e) => [e.name, e]));
  const xml = async (en: ZipEntry) => decodeXml(await entryData(file, en, STRIP_MAX));
  const edit = async (en: ZipEntry, next: string) => {
    const now = await entryData(file, en, STRIP_MAX);
    const b = encodeXml(next);
    if (!equal(now, b)) p.edits.set(en.name, b);
  };
  const rewrite = async (en: ZipEntry, rules: readonly XmlRule[]) => edit(en, rewriteXml(await xml(en), rules));
  const image = async (en: ZipEntry) => {
    const now = await entryData(file, en, STRIP_MAX);
    const next = await cleanImage(now, en.name);
    if (!equal(now, next)) p.edits.set(en.name, next);
  };

  if (kind === "ooxml") {
    if (zip.entries.some((e) => e.name.startsWith("_xmlsignatures/"))) return { ...p, protege: true };
    if (!byName.has("[Content_Types].xml")) throw new Malformed("ooxml");
    // Miniatures : parties docProps/thumbnail.* et cibles des relations « thumbnail ».
    const thumbs = new Set(zip.entries.filter((e) => /^docProps\/thumbnail\.[^/]+$/iu.test(e.name)).map((e) => e.name));
    const rels = byName.get("_rels/.rels");
    const norm = (t: string) => t.replace(/^\//u, "");
    if (rels) {
      rewriteXml(await xml(rels), [
        {
          el: qn(RELS, "Relationship"),
          when: (a) => {
            if (THUMB_REL.test(a.get("Type") ?? "") && byName.has(norm(a.get("Target") ?? ""))) thumbs.add(norm(a.get("Target")!));
            return false;
          },
          drop: true,
        },
      ]);
      await rewrite(rels, [{ el: qn(RELS, "Relationship"), when: (a) => THUMB_REL.test(a.get("Type") ?? "") || thumbs.has(norm(a.get("Target") ?? "")), drop: true }]);
    }
    for (const t of thumbs) p.edits.set(t, null);
    const lower = new Set([...thumbs].map((t) => t.toLowerCase()));
    await rewrite(byName.get("[Content_Types].xml")!, [{ el: qn(CT, "Override"), when: (a) => lower.has(norm(a.get("PartName") ?? "").toLowerCase()), drop: true }]);
    for (const en of zip.entries) {
      if (thumbs.has(en.name) || en.name === "_rels/.rels" || en.name === "[Content_Types].xml") continue;
      if (OOXML_PROPS.has(en.name)) await edit(en, minimalPart(await xml(en), () => false));
      else if (OOXML_MEDIA.test(en.name)) await image(en);
      else {
        const r = OOXML_RULES.find(([re]) => re.test(en.name));
        if (r) await rewrite(en, r[1]);
      }
      if (OOXML_TRACKED_PARTS.test(en.name) && WORD_TRACKED.test(await xml(en))) p.notes.add("suivi_modifs");
      if (/^xl\/revisions\//u.test(en.name)) p.notes.add("suivi_modifs");
    }
    return p;
  }

  // ODF : « mimetype » en premier et sans compression (exigé), gardé tel quel.
  const first = zip.entries[0];
  if (!first || first.name !== "mimetype" || first.method !== 0) throw new Malformed("odf_mimetype");
  if (byName.has("META-INF/documentsignatures.xml") || byName.has("META-INF/macrosignatures.xml")) return { ...p, protege: true };
  const manifest = byName.get("META-INF/manifest.xml");
  if (!manifest) throw new Malformed("odf_manifest");
  const seen = new Set<string>();
  const thumb = (path: string) => path.startsWith("Thumbnails/");
  const mxml = rewriteXml(await xml(manifest), [{ el: qn(MANIFEST, "file-entry"), when: (a) => thumb(a.get(qn(MANIFEST, "full-path")) ?? ""), drop: true }], seen);
  if (seen.has(qn(MANIFEST, "encryption-data"))) return { ...p, protege: true };
  await edit(manifest, mxml);
  for (const en of zip.entries) {
    if (thumb(en.name)) p.edits.set(en.name, null);
    else if (en.name === "meta.xml") {
      const src = await xml(en);
      const office = rootTag(src).name.split(":")[0]!;
      await edit(en, minimalPart(src, (a) => a === `${office}:version`, `<${office}:meta/>`));
    } else if (en.name === "content.xml" || en.name === "styles.xml") {
      const s = new Set<string>();
      await edit(en, rewriteXml(await xml(en), ODF_ANNOTATION, s));
      if (s.has(qn(TEXT, "changed-region"))) p.notes.add("suivi_modifs");
    } else if (ODF_MEDIA.test(en.name)) await image(en);
  }
  return p;
}

export async function cleanOffice(file: Blob, kind: OfficeKind, type: string): Promise<OfficeResult> {
  const head = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  // Document Office protégé par mot de passe : conteneur OLE chiffré.
  if (head[0] === 0xd0 && head[1] === 0xcf && head[2] === 0x11 && head[3] === 0xe0) return { state: "protege" };
  const zip = await readZip(file);
  const p = await plan(file, zip, kind);
  if (p.protege) return { state: "protege" };
  const data = writeZip(file, zip, p.edits, type);
  // Vérification : relu par le même analyseur, plus rien à changer.
  const zip2 = await readZip(data);
  const p2 = await plan(data, zip2, kind);
  if (p2.protege || p2.edits.size > 0 || zip2.commentLength > 0 || !zip2.entries.every(isNormalized)) throw new Malformed("verification");
  return { state: "ok", data, notes: [...p.notes] };
}
