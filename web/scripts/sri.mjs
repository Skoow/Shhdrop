// Intégrité des sous-ressources (spec §28.3) : attribut integrity="sha384-…" sur chaque
// <script src>, <link rel="stylesheet"> et <link rel="modulepreload"> d'une page. Avec lui,
// l'empreinte de index.html fixe tous les scripts et styles qu'il charge. Partagé par le
// greffon Vite (vite.config.ts) et le contrôle du site construit (check-dist.mjs).
import { createHash } from "node:crypto";

const TAG = /<(script|link)\b[^>]*>/g;
const attr = (tag, name) => new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1];

/** Empreinte SRI d'un contenu. */
export const sha384 = (data) => "sha384-" + createHash("sha384").update(data).digest("base64");

/** Adresse de la ressource d'une balise à protéger ; null si la balise n'en charge pas ; "" : script en ligne. */
function target(tag) {
  if (tag.startsWith("<script")) return attr(tag, "src") ?? "";
  const rel = attr(tag, "rel");
  return rel === "stylesheet" || rel === "modulepreload" ? (attr(tag, "href") ?? null) : null;
}

/** Chemin dans le dossier du site : la base (« / », « /shhdrop/ ») retirée ; chemin relatif tel quel. */
const relOf = (url, base) => (url.startsWith(base) ? url.slice(base.length) : url.replace(/^\//, ""));

/** Ajoute (ou remplace) integrity sur chaque balise ; `read(rel)` rend les octets du fichier, ou null. */
export function addSri(html, read, base = "/") {
  return html.replace(TAG, (tag) => {
    const url = target(tag);
    if (!url) return tag;
    const data = read(relOf(url, base));
    if (data === null) throw new Error(`SRI : ${url} absent du site`);
    const bare = tag.replace(/\sintegrity="[^"]*"/, "");
    const key = tag.startsWith("<script") ? "src" : "href";
    return bare.replace(`${key}="${url}"`, `${key}="${url}" integrity="${sha384(data)}"`);
  });
}

/** Problèmes d'intégrité d'une page (liste vide : tout est couvert et exact). */
export function checkSri(page, html, read, base = "/") {
  const problems = [];
  for (const [tag] of html.matchAll(TAG)) {
    const url = target(tag);
    if (url === null) continue;
    if (url === "") {
      problems.push(`${page} : script en ligne (aucune empreinte possible, spec §28.3)`);
      continue;
    }
    const data = read(relOf(url, base));
    const got = attr(tag, "integrity");
    if (data === null) problems.push(`${page} : ${url} absent du site`);
    else if (got === undefined) problems.push(`${page} : ${url} sans attribut integrity (spec §28.3)`);
    else if (got !== sha384(data)) problems.push(`${page} : ${url} : empreinte integrity différente du fichier`);
  }
  return problems;
}
