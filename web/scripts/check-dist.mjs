#!/usr/bin/env node
// Contrôle du site construit (UI §14.3, A41) : le code de démo est absent de la production, et
// la démo porte bien ses protections. Lancé par `make test-web` et la CI après les builds.
//   node scripts/check-dist.mjs [dossier]          production (défaut : web/dist)
//   node scripts/check-dist.mjs --demo [dossier]   démo (défaut : web/dist-demo)
// Sortie 0 si tout va bien ; sinon 1, une ligne par problème sur stderr.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { DEMO_BASE, DEMO_META } from "./demo-meta.mjs";

const MARK = "__SHH_DEMO__";

/** Traces de démo interdites en production (le texte du bandeau, sans ponctuation typographique). */
const FORBIDDEN_IN_PROD = [
  MARK,
  "fake-server",
  "fake-xhr",
  "DemoBanner",
  'http-equiv="Content-Security-Policy"',
  "le lien ne marche que dans cet onglet",
  "the link only works in this tab",
  `${DEMO_BASE}assets/`, // base de la démo dans un build de production
];

function files(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...files(p));
    else out.push(p);
  }
  return out;
}

const esc = (s) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const metaRe = (attrs) => {
  const parts = Object.entries(attrs).map(([k, v]) => `${k}="(?:${v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}|${esc(v).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})"`);
  return new RegExp(`^<meta ${parts.join(" ")}\\s*/?>`);
};

/** Rend la liste des problèmes (vide si tout va bien). */
export function checkDist(dir, demo) {
  const problems = [];
  if (!existsSync(join(dir, "index.html"))) return [`${dir} : index.html absent (build manquant ?)`];
  const all = files(dir).map((p) => ({ rel: relative(dir, p), data: readFileSync(p) }));
  const index = readFileSync(join(dir, "index.html"), "utf8");

  if (!demo) {
    for (const f of all)
      for (const s of FORBIDDEN_IN_PROD) if (f.data.includes(s)) problems.push(`${f.rel} : trace de démo « ${s} »`);
    // Spec §28.3 (audit F1) : aucun import() dynamique, que l'empreinte SRI de index.html ne
    // couvrirait pas. La démo en garde un (son faux serveur, chargé à part).
    for (const f of all) {
      if (!/\.m?js$/.test(f.rel)) continue;
      const n = f.data.toString("utf8").match(/(?<![\w$.])import\s*\(/g)?.length ?? 0;
      if (n > 0) problems.push(`${f.rel} : import() dynamique (${n} fois), interdit en production`);
    }
    if (existsSync(join(dir, "404.html"))) problems.push("404.html : propre à la démo");
    return problems;
  }

  if (!all.some((f) => f.data.includes(MARK))) problems.push(`marque ${MARK} absente : ce n'est pas un build de démo`);
  // Les balises de la démo, dans l'ordre, en tout premier dans <head>.
  const head = /<head>\s*([\s\S]*)$/.exec(index);
  let rest = head ? head[1] : "";
  for (const attrs of DEMO_META) {
    const m = metaRe(attrs).exec(rest);
    if (!m) {
      problems.push(`index.html : <meta ${Object.entries(attrs).map(([k, v]) => `${k}="${v}"`).join(" ")}> absente ou mal placée`);
      break;
    }
    rest = rest.slice(m[0].length).trimStart();
  }
  if (!existsSync(join(dir, "404.html"))) problems.push("404.html absent (adresses profondes sur Pages)");
  else if (readFileSync(join(dir, "404.html"), "utf8") !== index) problems.push("404.html différent de index.html");
  for (const [, url] of index.matchAll(/(?:src|href)="(\/[^"]*)"/g))
    if (!url.startsWith(DEMO_BASE)) problems.push(`index.html : « ${url} » hors de la base ${DEMO_BASE}`);
  return problems;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const demo = args.includes("--demo");
  const rest = args.filter((a) => a !== "--demo");
  const web = fileURLToPath(new URL("..", import.meta.url));
  const dir = rest[0] ?? join(web, demo ? "dist-demo" : "dist");
  const problems = checkDist(dir, demo);
  if (problems.length > 0) {
    for (const p of problems) console.error(`check-dist${demo ? " --demo" : ""} : ${p}`);
    process.exit(1);
  }
  console.log(`check-dist${demo ? " --demo" : ""} : ${dir} conforme`);
}
