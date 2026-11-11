#!/usr/bin/env node
// Contrôle du site construit (UI §14.3, A41) : le code de démo est absent de la production, et
// la démo porte bien ses protections. Lancé par `make test-web` et la CI après les builds.
//   node scripts/check-dist.mjs [dossier]          production (défaut : web/dist)
//   node scripts/check-dist.mjs --demo [dossier]   démo (défaut : web/dist-demo)
// Sortie 0 si tout va bien ; sinon 1, une ligne par problème sur stderr.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { brotliDecompressSync, gunzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { DEMO_BASE, DEMO_META } from "./demo-meta.mjs";
import { findAnalytics, findErrorListeners } from "./no-analytics.mjs";
import { checkSri, sha384 } from "./sri.mjs";

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
  const raw = files(dir).map((p) => ({ rel: relative(dir, p), data: readFileSync(p) }));
  // Variantes précompressées (.br, .gz) : chacune doit redonner exactement son fichier source ;
  // elles ne sont pas relues comme du texte (le source l'est déjà). Aucune dans la démo.
  const byRel = new Map(raw.map((f) => [f.rel, f.data]));
  for (const f of raw) {
    const m = /^(.*)\.(br|gz)$/.exec(f.rel);
    if (!m) continue;
    if (demo) problems.push(`${f.rel} : variante précompressée dans la démo`);
    const src = byRel.get(m[1]);
    let out = null;
    try {
      out = m[2] === "br" ? brotliDecompressSync(f.data) : gunzipSync(f.data);
    } catch {
      out = null;
    }
    if (!src || !out || !out.equals(src)) problems.push(`${f.rel} : ne redonne pas ${m[1]}`);
  }
  const all = raw.filter((f) => !/\.(br|gz)$/.test(f.rel));
  const index = readFileSync(join(dir, "index.html"), "utf8");

  // Spec §28.3 : chaque script et feuille de style de index.html porte une empreinte exacte
  // (production et démo). Le cadre PDF (pdf-frame.html) en est exempté pour l'instant : il vit
  // dans une origine opaque, où une empreinte exigerait des en-têtes CORS sur ses deux fichiers.
  problems.push(...checkSri("index.html", index, (rel) => byRel.get(rel) ?? null, demo ? DEMO_BASE : "/"));

  // Spec §35.1 (Task M2) : aucune statistique, aucun écouteur global d'erreurs, dans tout build.
  for (const f of all) {
    if (/\.(woff2?|png|jpe?g|gif|ico|webp|avif|wasm)$/i.test(f.rel)) continue;
    const text = f.data.toString("utf8");
    for (const w of findAnalytics(text)) problems.push(`${f.rel} : statistique « ${w} » (spec §35.1)`);
    for (const m of findErrorListeners(text)) problems.push(`${f.rel} : écouteur global d'erreurs « ${m} » (spec §35.1)`);
  }

  if (!demo) {
    for (const f of all)
      for (const s of FORBIDDEN_IN_PROD) if (f.data.includes(s)) problems.push(`${f.rel} : trace de démo « ${s} »`);
    // Spec §28.3 (audit F1) : aucun import() dynamique, que l'empreinte SRI de index.html ne
    // couvrirait pas. La démo en garde un (son faux serveur, chargé à part).
    for (const f of all) {
      if (!/\.m?js$/.test(f.rel)) continue;
      // Cadre PDF isolé (UI §13) : pdf.js garde trois import() (WebAssembly, worker séparé) sur
      // des chemins que nos options n'empruntent pas (useWasm: false, worker sur le fil
      // principal). Hors SRI par construction (script classique, origine opaque, aucun secret),
      // et la CSP du cadre ne laisse charger que des scripts du site : exempté, lui seul.
      if (f.rel === "pdf-frame.js") continue;
      const n = f.data.toString("utf8").match(/(?<![\w$.])import\s*\(/g)?.length ?? 0;
      if (n > 0) problems.push(`${f.rel} : import() dynamique (${n} fois), interdit en production`);
    }
    // Moteur WebAssembly (spec moteur §7 ; il remplace libsodium et l'ancien moteur TypeScript,
    // Task 11) : le .wasm et le script du Worker d'Argon2id (assets/engine-*.js) vivent dans leurs
    // propres fichiers, chargés à la demande avec contrôle d'intégrité (fetch + integrity, puis
    // Worker ; repli : calcul dans la page avec le moteur déjà vérifié). Le script principal ne
    // contient aucun octet du .wasm (magie « \0asm » version 1, en base64 ou en tableau de
    // nombres), ne cite aucun de ces fichiers sans son empreinte SHA-384, et aucun n'est orphelin.
    const mains = all.filter((f) => /^assets\/index-[^/]+\.js$/.test(f.rel)).map((f) => ({ rel: f.rel, text: f.data.toString("utf8") }));
    for (const m of mains) {
      if (m.text.includes("AGFzbQEAAAA") || /\b0,\s*97,\s*115,\s*109,\s*1,\s*0,\s*0,\s*0\b/.test(m.text))
        problems.push(`${m.rel} : octets WebAssembly en ligne dans le script principal : le moteur doit rester dans assets/engine-*.wasm, lu avec son empreinte`);
      const cited = new Set([...m.text.matchAll(/\/(assets\/(?:engine-[A-Za-z0-9_-]+\.js|[A-Za-z0-9._-]+\.wasm))/g)].map((x) => x[1]));
      for (const rel of cited) {
        const data = byRel.get(rel);
        if (!data) problems.push(`${rel} : cité par le script principal, absent du site`);
        else if (!m.text.includes(sha384(data))) problems.push(`${rel} : son empreinte SHA-384 n'est pas inscrite dans le script principal (chargement sans contrôle d'intégrité)`);
      }
    }
    // Fichier du moteur (.wasm, script du Worker) qu'aucun script principal ne cite : orphelin
    // (chargé d'ailleurs, sans contrôle d'intégrité, ou inutile). Cité sans empreinte : ci-dessus.
    for (const f of all)
      if (/^assets\/(?:[^/]+\.wasm|engine-[^/]+\.js)$/i.test(f.rel) && !mains.some((m) => m.text.includes(`/${f.rel}`)))
        problems.push(`${f.rel} : orphelin, aucun script principal ne le cite avec son empreinte SHA-384`);
    // Moteur WebAssembly : précompressé comme le texte (vite.config.ts, COMPRESSIBLE ; servi par
    // static.go avec Content-Encoding), sinon 481 Ko seraient lus au lieu de 141 Ko en brotli.
    for (const f of all) {
      if (!/\.wasm$/i.test(f.rel) || f.data.length < 1024) continue;
      const missing = [".br", ".gz"].filter((e) => !byRel.has(f.rel + e));
      if (missing.length) problems.push(`${f.rel} : sans variante ${missing.join(" ni ")} : le moteur serait téléchargé sans compression`);
    }
    if (existsSync(join(dir, "404.html"))) problems.push("404.html : propre à la démo");
    return problems;
  }

  if (!all.some((f) => f.data.includes(MARK))) problems.push(`marque ${MARK} absente : ce n'est pas un build de démo`);
  // Spec moteur §7 : la CSP de la démo (connect-src 'none') interdit de lire un .wasm ; le moteur
  // est donc intégré à un script de la démo (base64 du module, magie « \0asm » version 1).
  for (const f of all)
    if (/\.wasm$/i.test(f.rel)) problems.push(`${f.rel} : fichier .wasm dans la démo : sa CSP (connect-src 'none') interdit de le lire, le moteur doit être intégré au script`);
  if (!all.some((f) => /\.m?js$/.test(f.rel) && f.data.includes("AGFzbQEAAAA")))
    problems.push("moteur WebAssembly absent des scripts de la démo (base64 « AGFzbQEAAAA ») : elle ne pourrait ni chiffrer ni ouvrir");
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
