// Réécriture bornée de parties XML (Office, ODF ; spec §35.2) sans DOMParser, pour rester
// utilisable hors fenêtre : valeurs d'attributs, texte d'éléments nommés, éléments retirés.
// Tout le reste est recopié caractère pour caractère. Les noms sont résolus par espace de
// noms (le préfixe peut varier d'un logiciel à l'autre). Le document doit être bien formé
// (balises équilibrées, une seule racine, attributs uniques) ; DOCTYPE refusé (entités).
import { Malformed } from "./bytes";

/** Nom qualifié résolu : « {espace de noms}local ». */
export const qn = (ns: string, local: string) => `{${ns}}${local}`;

export type XmlRule = {
  /** Élément visé (qn), et ancêtre exigé (qn) le cas échéant. */
  el: string;
  within?: string;
  /** Condition sur les attributs de l'élément (noms résolus, valeurs brutes). */
  when?: (attrs: ReadonlyMap<string, string>) => boolean;
} & (
  | { attr: string; set: string } // valeur remplacée si l'attribut existe
  | { attr: string; remove: true } // attribut retiré
  | { text: string } // contenu remplacé par ce texte (éléments enfants compris)
  | { drop: true } // élément retiré en entier
);

type Attr = { raw: string; name: string; value: string };
type Open = { name: string; q: string; scope: Map<string, string> };

const NAME = /^[A-Za-z_:][-A-Za-z0-9_:.·À-￿]*/u;
const XML_NS = "http://www.w3.org/XML/1998/namespace";

function resolve(name: string, scope: Map<string, string>, isAttr: boolean): string {
  const c = name.indexOf(":");
  const prefix = c > 0 ? name.slice(0, c) : "";
  const local = c > 0 ? name.slice(c + 1) : name;
  if (prefix === "xmlns" || (!prefix && name === "xmlns")) return qn("xmlns", local);
  if (prefix === "xml") return qn(XML_NS, local);
  if (!prefix) return isAttr ? local : qn(scope.get("") ?? "", local);
  const ns = scope.get(prefix);
  if (ns === undefined) throw new Malformed("xml_prefixe");
  return qn(ns, local);
}

function parseTag(s: string): { name: string; attrs: Attr[]; selfClose: boolean } {
  // s : contenu entre « < » et « > » (sans eux), commence par le nom.
  const m = NAME.exec(s);
  if (!m) throw new Malformed("xml_nom");
  const name = m[0];
  const attrs: Attr[] = [];
  let i = name.length;
  let selfClose = false;
  for (;;) {
    const ws = /^\s*/u.exec(s.slice(i))![0].length;
    i += ws;
    if (i >= s.length) break;
    if (s[i] === "/" && i === s.length - 1) {
      selfClose = true;
      break;
    }
    if (ws === 0) throw new Malformed("xml_attribut");
    const am = /^([A-Za-z_:][-A-Za-z0-9_:.·À-￿]*)\s*=\s*(?:"([^"<]*)"|'([^'<]*)')/u.exec(s.slice(i));
    if (!am) throw new Malformed("xml_attribut");
    attrs.push({ raw: am[0], name: am[1]!, value: am[2] ?? am[3]! });
    i += am[0].length;
  }
  if (new Set(attrs.map((a) => a.name)).size !== attrs.length) throw new Malformed("xml_attribut_double");
  return { name, attrs, selfClose };
}

/** Fin de la construction qui commence en `i` (après « < ») ; balise : guillemets respectés. */
function tagEnd(xml: string, i: number): number {
  let q = "";
  for (let k = i; k < xml.length; k++) {
    const c = xml[k]!;
    if (q) {
      if (c === q) q = "";
    } else if (c === '"' || c === "'") q = c;
    else if (c === ">") return k;
    else if (c === "<") break;
  }
  throw new Malformed("xml_balise");
}

/**
 * Applique `rules` à `xml` (texte déjà décodé) et rend le texte réécrit. Lève `Malformed` si
 * le document n'est pas bien formé. `seen` (facultatif) reçoit les noms (qn) rencontrés.
 */
export function rewriteXml(xml: string, rules: readonly XmlRule[], seen?: Set<string>): string {
  const out: string[] = [];
  const stack: Open[] = [];
  let scope = new Map<string, string>();
  let roots = 0;
  // Élément en cours de retrait ou de remplacement : profondeur de pile à retrouver.
  let skipping: { depth: number; text?: string } | null = null;
  let i = 0;
  const emit = (s: string) => {
    if (!skipping) out.push(s);
  };
  const matches = (r: XmlRule, q: string, am: () => Map<string, string>) => r.el === q && (!r.within || stack.some((o) => o.q === r.within)) && (!r.when || r.when(am()));
  while (i < xml.length) {
    const lt = xml.indexOf("<", i);
    const chars = lt < 0 ? xml.slice(i) : xml.slice(i, lt);
    if (chars) {
      if (stack.length === 0 && chars.trim() !== "") throw new Malformed("xml_texte_hors_racine");
      emit(chars);
    }
    if (lt < 0) break;
    if (xml.startsWith("<!--", lt)) {
      const e = xml.indexOf("-->", lt + 4);
      if (e < 0) throw new Malformed("xml_commentaire");
      emit(xml.slice(lt, e + 3));
      i = e + 3;
      continue;
    }
    if (xml.startsWith("<![CDATA[", lt)) {
      const e = xml.indexOf("]]>", lt + 9);
      if (e < 0 || stack.length === 0) throw new Malformed("xml_cdata");
      emit(xml.slice(lt, e + 3));
      i = e + 3;
      continue;
    }
    if (xml.startsWith("<?", lt)) {
      const e = xml.indexOf("?>", lt + 2);
      if (e < 0) throw new Malformed("xml_pi");
      emit(xml.slice(lt, e + 2));
      i = e + 2;
      continue;
    }
    if (xml.startsWith("<!", lt)) throw new Malformed("xml_doctype");
    const gt = tagEnd(xml, lt + 1);
    const body = xml.slice(lt + 1, gt);
    i = gt + 1;
    if (body.startsWith("/")) {
      const name = body.slice(1).trimEnd();
      const top = stack.pop();
      if (!top || top.name !== name) throw new Malformed("xml_desequilibre");
      if (skipping && skipping.depth === stack.length) {
        const t = skipping.text;
        skipping = null;
        if (t !== undefined) emit(t + `</${name}>`);
      } else emit(`</${body.slice(1)}>`);
      scope = stack.length ? stack[stack.length - 1]!.scope : new Map();
      continue;
    }
    const tag = parseTag(body);
    if (stack.length === 0 && roots++ > 0) throw new Malformed("xml_racines");
    const inner = new Map(scope);
    for (const a of tag.attrs) {
      if (a.name === "xmlns") inner.set("", a.value);
      else if (a.name.startsWith("xmlns:")) inner.set(a.name.slice(6), a.value);
    }
    const q = resolve(tag.name, inner, false);
    seen?.add(q);
    const qa = tag.attrs.map((a) => resolve(a.name, inner, true));
    if (new Set(qa).size !== qa.length) throw new Malformed("xml_attribut_double");
    let drop = false;
    let text: string | undefined;
    const attrs = tag.attrs.map((a) => a.raw);
    const am = () => new Map(qa.map((n, k) => [n, tag.attrs[k]!.value]));
    if (!skipping) {
      for (const r of rules) {
        if (!matches(r, q, am)) continue;
        if ("drop" in r) drop = true;
        else if ("text" in r) text = r.text;
        else {
          const k = qa.indexOf(r.attr);
          if (k < 0) continue;
          attrs[k] = "remove" in r ? "" : `${tag.attrs[k]!.name}="${r.set}"`;
        }
      }
    }
    if (drop) {
      if (!tag.selfClose) {
        stack.push({ name: tag.name, q, scope: inner });
        scope = inner;
        skipping = { depth: stack.length - 1 };
      }
      continue;
    }
    const rebuilt = `<${tag.name}${attrs.filter((a) => a).map((a) => " " + a).join("")}${tag.selfClose ? "/" : ""}>`;
    const changed = attrs.some((a, k) => a !== tag.attrs[k]!.raw);
    emit(changed ? rebuilt : xml.slice(lt, gt + 1));
    if (tag.selfClose) continue;
    stack.push({ name: tag.name, q, scope: inner });
    scope = inner;
    if (text !== undefined) skipping = { depth: stack.length - 1, text };
  }
  if (stack.length || roots !== 1) throw new Malformed("xml_incomplet");
  return out.join("");
}

/** Balise de l'élément racine : nom et attributs (document bien formé exigé). */
export function rootTag(xml: string): { name: string; attrs: { name: string; value: string }[] } {
  rewriteXml(xml, []);
  let i = 0;
  for (;;) {
    const lt = xml.indexOf("<", i);
    if (xml.startsWith("<?", lt)) i = xml.indexOf("?>", lt) + 2;
    else if (xml.startsWith("<!--", lt)) i = xml.indexOf("-->", lt) + 3;
    else {
      const t = parseTag(xml.slice(lt + 1, tagEnd(xml, lt + 1)));
      return { name: t.name, attrs: t.attrs.map(({ name, value }) => ({ name, value })) };
    }
  }
}

const DEC = new TextDecoder("utf-8", { fatal: true });
const ENC = new TextEncoder();

/** Décodage strict : UTF-8 seulement (déclaration comprise), sinon `Malformed`. */
export function decodeXml(b: Uint8Array): string {
  if ((b[0] === 0xfe && b[1] === 0xff) || (b[0] === 0xff && b[1] === 0xfe)) throw new Malformed("xml_utf16");
  let s: string;
  try {
    s = DEC.decode(b);
  } catch {
    throw new Malformed("xml_utf8");
  }
  const decl = /^<\?xml[^>]*encoding\s*=\s*["']([^"']+)["']/u.exec(s);
  if (decl && !/^utf-?8$/iu.test(decl[1]!)) throw new Malformed("xml_encodage");
  return s;
}
export const encodeXml = (s: string) => ENC.encode(s);
