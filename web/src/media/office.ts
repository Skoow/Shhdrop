// Nettoyage des documents Office (OOXML : .docx, .xlsx, .pptx et variantes) et ODF (.odt,
// .ods, .odp…) (spec §35.2, Task 9b) : propriétés du document remplacées par des versions
// minimales de même nom, miniatures retirées (et leurs références), métadonnées des images
// intégrées retirées (pixels inchangés), chemins locaux retirés (modèle attaché de Word et sa
// relation, x15ac:absPath d'Excel), ZIP réécrit (zip.ts). Paramètres d'imprimante gardés
// (décision du propriétaire, 10 novembre). customXml/ est gardé : il porte des données liées au
// document (bibliographie, contrôles de contenu liés), le retirer altérerait le document. Règle du propriétaire (8
// novembre, D41-27) : on ne retire que ce qui n'altère pas le document lui-même ; commentaires,
// personnes et suivi des modifications restent intacts (auteurs et dates compris). Le résultat est relu par le même analyseur : il ne doit
// plus rien demander, sinon `Malformed` (→ `echec`).
import { STRIP_MAX } from "../limits";
import { Malformed, equal } from "./bytes";
import { FORMAT_HEAD, detectFormat } from "./format";
import { cleanGif } from "./gif";
import { cleanHeif } from "./heif";
import { cleanJpeg } from "./jpeg";
import { patchedBlob } from "./patch";
import { cleanPng } from "./png";
import { cleanWebp } from "./webp";
import { decodeXml, encodeXml, qn, rewriteXml, rootTag, type XmlRule } from "./xmlattr";
import { entryData, isNormalized, readZip, writeZip, type ZipEntry, type ZipFile } from "./zip";

export type OfficeKind = "ooxml" | "odf";
export type OfficeResult = { state: "protege" } | { state: "ok"; data: Blob };


const RELS = "http://schemas.openxmlformats.org/package/2006/relationships";
const CT = "http://schemas.openxmlformats.org/package/2006/content-types";
const THUMB_REL = /\/metadata\/thumbnail$/u;
const MANIFEST = "urn:oasis:names:tc:opendocument:xmlns:manifest:1.0";
/** Modèle attaché (chemin local, nom d'utilisateur). */
const TEMPLATE_REL = /\/attachedTemplate$/u;
/** Parties qui peuvent porter un chemin local : modèle attaché (Word), dossier du classeur (Excel). */
const PATH_PARTS = ["word/settings.xml", "xl/workbook.xml"];
const RELS_PART = /^(?:.*\/)?_rels\/[^/]*\.rels$/u;
// Espaces de noms : variantes « transitional » et « strict ».
const R_NS = ["http://schemas.openxmlformats.org/officeDocument/2006/relationships", "http://purl.oclc.org/ooxml/officeDocument/relationships"];
const W_NS = ["http://schemas.openxmlformats.org/wordprocessingml/2006/main", "http://purl.oclc.org/ooxml/wordprocessingml/main"];
const X15AC = "http://schemas.microsoft.com/office/spreadsheetml/2010/11/ac";

/** Partie source d'un fichier de relations : « word/_rels/document.xml.rels » → « word/document.xml » ; paquet → "". */
function relsSource(rels: string): string {
  const i = rels.lastIndexOf("_rels/");
  return rels.slice(0, i) + rels.slice(i + 6, -5);
}
/** Partie visée par `target` depuis `source` (chemin relatif ou absolu, « .. » résolus). */
function partPath(source: string, target: string): string {
  const segs = target.startsWith("/") ? [] : source.split("/").slice(0, -1);
  for (const s of target.split(/[/\\]/u)) {
    if (s === "..") segs.pop();
    else if (s && s !== ".") segs.push(s);
  }
  return segs.join("/");
}
const norm = (t: string) => t.replace(/^\//u, "");

const OOXML_PROPS = new Set(["docProps/core.xml", "docProps/app.xml", "docProps/custom.xml"]);
const OOXML_MEDIA = /^(word|xl|ppt)\/media\/[^/]+$/u;

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

type Plan = { protege: boolean; edits: Map<string, Uint8Array | null> };

async function plan(file: Blob, zip: ZipFile, kind: OfficeKind): Promise<Plan> {
  const p: Plan = { protege: false, edits: new Map() };
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
    // Parties retirées : miniatures (docProps/thumbnail.* et cibles des relations « thumbnail »
    // du paquet).
    const removed = new Set(zip.entries.filter((e) => /^docProps\/thumbnail\.[^/]+$/iu.test(e.name)).map((e) => e.name));
    const relsFiles = zip.entries.filter((e) => RELS_PART.test(e.name));
    const relRule = (en: ZipEntry, keep: (a: ReadonlyMap<string, string>, target: string | null) => boolean): XmlRule => ({
      el: qn(RELS, "Relationship"),
      when: (a) => !keep(a, a.get("TargetMode") === "External" ? null : partPath(relsSource(en.name), a.get("Target") ?? "")),
      drop: true,
    });
    const doomed = (root: boolean, type: string) => root && THUMB_REL.test(type);
    for (const en of relsFiles) {
      const root = en.name === "_rels/.rels";
      rewriteXml(await xml(en), [
        relRule(en, (a, target) => {
          if (target !== null && doomed(root, a.get("Type") ?? "") && byName.has(target)) removed.add(target);
          return true;
        }),
      ]);
    }
    // Relations retirées (vers une partie retirée, modèle attaché) ; identifiants
    // retirés, par partie source, pour que plus rien ne les cite.
    const droppedIds = new Map<string, Set<string>>();
    for (const en of relsFiles) {
      const root = en.name === "_rels/.rels";
      const ids = new Set<string>();
      await rewrite(en, [
        relRule(en, (a, target) => {
          const type = a.get("Type") ?? "";
          const gone = doomed(root, type) || TEMPLATE_REL.test(type) || (target !== null && removed.has(target));
          if (gone) ids.add(a.get("Id") ?? "");
          return !gone;
        }),
      ]);
      if (!root && ids.size > 0) droppedIds.set(relsSource(en.name), ids);
    }
    for (const t of removed) p.edits.set(t, null);
    const lower = new Set([...removed].map((t) => t.toLowerCase()));
    await rewrite(byName.get("[Content_Types].xml")!, [{ el: qn(CT, "Override"), when: (a) => lower.has(norm(a.get("PartName") ?? "").toLowerCase()), drop: true }]);
    // Parties qui citent une relation retirée, et chemins locaux : modèle attaché (Word),
    // dossier du classeur (Excel, x15ac:absPath). Une citation restante → `Malformed`.
    const cited = new Set([...droppedIds.keys(), ...PATH_PARTS].filter((n) => byName.has(n) && !removed.has(n)));
    for (const n of cited) {
      const ids = droppedIds.get(n) ?? new Set<string>();
      const next = rewriteXml(await xml(byName.get(n)!), [
        ...W_NS.map((w): XmlRule => ({ el: qn(w, "attachedTemplate"), drop: true })),
        { el: qn(X15AC, "absPath"), drop: true },
      ]);
      for (const id of ids) if (new RegExp(`=\\s*["']${id.replace(/[^\w.-]/gu, "\\$&")}["']`, "u").test(next)) throw new Malformed("ooxml_relation");
      await edit(byName.get(n)!, next);
    }
    for (const en of zip.entries) {
      if (removed.has(en.name) || cited.has(en.name) || RELS_PART.test(en.name) || en.name === "[Content_Types].xml") continue;
      if (OOXML_PROPS.has(en.name)) await edit(en, minimalPart(await xml(en), () => false));
      else if (OOXML_MEDIA.test(en.name)) await image(en);
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
  return { state: "ok", data };
}
