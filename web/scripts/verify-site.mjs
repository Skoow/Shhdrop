#!/usr/bin/env node
// Vérificateur (spec §28.4) : le site servi est-il, octet pour octet, celui du manifeste ?
//   node scripts/verify-site.mjs <origine> <release.json>
// À lancer après `cosign verify-blob` (§28.2), avec une copie de ce script qui ne vient pas du
// site vérifié. Sortie 0 si tout est conforme ; 1 au premier écart ou à la première erreur
// (une ligne sur stderr, qui nomme le chemin) ; 2 sur une erreur d'usage. Jamais « vert » sur
// une erreur réseau, un statut inattendu, une redirection, un délai dépassé ou un fichier absent.
//
// Ce qui est contrôlé, dans l'ordre du manifeste :
//   1. chaque fichier listé : GET avec `Accept-Encoding: identity` et `Cache-Control: no-cache`,
//      statut 200 exigé, corps non encodé, taille et SHA-256 comparés ;
//   2. chaque variante précompressée listée (`x.br`, `x.gz` quand `x` est listé aussi) : le
//      serveur l'envoie aux navigateurs sous l'adresse de `x`, avec `Content-Encoding`
//      (server/cmd/shhdrop/static.go). On demande donc `x` avec `Accept-Encoding: br` (ou
//      `gzip`), on exige cet encodage, et on compare le corps BRUT (encore encodé) à l'entrée
//      du manifeste : ce sont les octets que reçoit un navigateur. Puis on décompresse, sous
//      plafond, et on exige les octets de `x` (une variante qui ne redonne pas sa source ferait
//      exécuter autre chose que le fichier vérifié en clair). L'adresse propre `x.br` répond
//      aussi sur le serveur Go, mais aucune page ne la demande : elle n'est pas contrôlée.
//      node:http et node:https sont utilisés directement : fetch décompresse sans le dire ;
//   3. repli monopage : `/index.html`, `/`, `/s/x` et `/x` rendent les octets de index.html, en
//      clair et dans chaque encodage listé pour index.html. Le serveur Go répond 404 à un chemin
//      inconnu (`/s/x`, `/x`) avec le corps de index.html (pas de « soft 404 », static.go) :
//      200 et 404 sont donc acceptés pour ces deux chemins, à octets identiques ; `/` et
//      `/index.html` doivent répondre 200.
//
// Limites : le repli empêche d'énumérer des fichiers en plus (spec §28.8, C5) ; un serveur qui
// ne piège que certaines victimes passe inaperçu (§28.7) ; les en-têtes (CSP…) ne sont pas
// contrôlés ici. Aucun proxy n'est utilisé (les variables HTTPS_PROXY sont ignorées).
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import { fileURLToPath } from "node:url";
import { brotliDecompressSync, gunzipSync } from "node:zlib";

const DEFAULT_TIMEOUT_MS = 15_000;
/** Chemins du repli monopage ; `strict` : statut 200 exigé (sinon 200 ou 404). */
const FALLBACKS = [
  { path: "/index.html", strict: true },
  { path: "/", strict: true },
  { path: "/s/x", strict: false },
  { path: "/x", strict: false },
];
/** Extension de variante → jeton d'Accept-Encoding et de Content-Encoding. */
const TOKENS = { br: "br", gz: "gzip" };

const sha256 = (data) => createHash("sha256").update(data).digest("hex");

/** Raison du refus de l'origine, ou null. https seulement ; http pour 127.0.0.1 et localhost (essais). */
export function checkOrigin(origin) {
  const refuse = (why) => `origine refusée (${why}) : ${JSON.stringify(origin)}`;
  let url;
  try {
    url = new URL(origin);
  } catch {
    return refuse("adresse illisible");
  }
  const local = url.hostname === "127.0.0.1" || url.hostname === "localhost";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) return refuse("https exigé, http permis seulement pour 127.0.0.1 et localhost");
  if (url.username || url.password) return refuse("identifiants dans l'adresse");
  if (url.pathname !== "/" || url.search || url.hash || origin.includes("?") || origin.includes("#")) return refuse("une origine n'a ni chemin, ni requête, ni fragment");
  return null;
}

/** Raison du refus d'un chemin du manifeste, ou null : il sert à bâtir une adresse (traversée, SSRF). */
function pathProblem(path) {
  if (typeof path !== "string" || path === "") return "vide";
  if (path.startsWith("/")) return "barre oblique initiale";
  if (path.includes("\\")) return "barre oblique inverse";
  if (path.includes("..")) return "« .. »";
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(path)) return "schéma d'URL";
  if (/[\u0000-\u001f\u007f]/.test(path)) return "caractère de contrôle";
  if (path.split("/").some((seg) => seg === "" || seg === ".")) return "segment vide ou « . »";
  return null;
}

/** Raison du refus du manifeste, ou null. Rien n'est demandé au serveur avant ce contrôle. */
export function checkManifest(manifest) {
  if (manifest === null || typeof manifest !== "object" || Array.isArray(manifest)) return "manifeste refusé : ce n'est pas un objet";
  if (manifest.schema !== 1) return `manifeste refusé : schéma ${JSON.stringify(manifest.schema)} (1 attendu)`;
  if (typeof manifest.name !== "string" || !/^[a-z0-9-]+$/.test(manifest.name)) return "manifeste refusé : nom (name) hors format";
  if (typeof manifest.version !== "string" || !/^\d+\.\d+\.\d+$/.test(manifest.version)) return "manifeste refusé : version hors format";
  if (typeof manifest.commit !== "string" || !/^[0-9a-f]{7,40}$/.test(manifest.commit)) return "manifeste refusé : commit hors format";
  if (!Array.isArray(manifest.files)) return "manifeste refusé : liste files absente";
  const seen = new Set();
  for (const f of manifest.files) {
    const bad = pathProblem(f?.path);
    if (bad) return `manifeste refusé : chemin refusé (${bad}) : ${JSON.stringify(f?.path)}`;
    if (seen.has(f.path)) return `manifeste refusé : ${f.path} en double`;
    seen.add(f.path);
    if (!Number.isSafeInteger(f.size) || f.size < 0) return `manifeste refusé : ${f.path} : taille hors format`;
    if (typeof f.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(f.sha256)) return `manifeste refusé : ${f.path} : empreinte hors format`;
  }
  if (!seen.has("index.html")) return "manifeste refusé : index.html n'est pas listé";
  return null;
}

/**
 * Un GET, sans suivre de redirection, borné en durée (toute la requête, pas seulement
 * l'inactivité) et en taille (lecture arrêtée au-delà de `cap` octets : `tooBig`).
 * Rend { status, encoding, body, tooBig } ; lève une erreur au message prêt à afficher.
 */
function get(ctx, path, acceptEncoding, cap) {
  return new Promise((resolve, reject) => {
    let done = false;
    // `keep` : réponse lue en entier, la connexion reste ouverte pour la requête suivante.
    const finish = (fn, value, keep = false) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (!keep) req.destroy();
      fn(value);
    };
    const network = (e) => finish(reject, new Error(`erreur réseau (${e?.code ?? e?.message ?? "inconnue"})`));
    const req = ctx.lib.request({
      protocol: ctx.url.protocol,
      hostname: ctx.url.hostname,
      port: ctx.url.port || undefined,
      path,
      method: "GET",
      agent: ctx.agent,
      headers: { "Accept-Encoding": acceptEncoding, "Cache-Control": "no-cache" },
    });
    const timer = setTimeout(() => finish(reject, new Error(`délai dépassé (${ctx.timeoutMs} ms)`)), ctx.timeoutMs);
    req.on("error", network);
    req.on("response", (res) => {
      const status = res.statusCode ?? 0;
      const raw = String(res.headers["content-encoding"] ?? "").trim().toLowerCase();
      const encoding = raw === "" || raw === "identity" ? null : raw;
      const chunks = [];
      let size = 0;
      res.on("data", (chunk) => {
        size += chunk.length;
        if (size > cap) finish(resolve, { status, encoding, body: null, tooBig: true });
        else chunks.push(chunk);
      });
      res.on("end", () => (res.complete ? finish(resolve, { status, encoding, body: Buffer.concat(chunks), tooBig: false }, true) : network({ code: "réponse tronquée" })));
      res.on("error", network);
      res.on("close", () => network({ code: "réponse tronquée" }));
    });
    req.end();
  });
}

/** Écart entre un corps reçu et une entrée du manifeste, ou null. */
function diff(r, entry) {
  if (r.tooBig) return `taille différente (attendu ${entry.size} octets, reçu plus)`;
  if (r.body.length !== entry.size) return `taille différente (attendu ${entry.size} octets, reçu ${r.body.length})`;
  if (sha256(r.body) !== entry.sha256) return "empreinte SHA-256 différente";
  return null;
}

/** Écart de statut d'un fichier listé (200 seulement), ou null. */
function statusProblem(status, alsoNotFound = false) {
  if (status === 200 || (alsoNotFound && status === 404)) return null;
  if (status >= 300 && status < 400) return `redirection refusée (HTTP ${status})`;
  return `statut HTTP ${status} (${alsoNotFound ? "200 ou 404 attendu" : "200 attendu"})`;
}

const urlPath = (path) => "/" + path.split("/").map(encodeURIComponent).join("/");

/** Fichier en clair : octets décodés demandés (identity). */
async function checkPlain(ctx, entry) {
  const r = await get(ctx, urlPath(entry.path), "identity", entry.size + 1);
  const bad = statusProblem(r.status);
  if (bad) return bad;
  if (r.encoding) return `réponse encodée « ${r.encoding} » alors que identity était demandé`;
  return diff(r, entry);
}

/** Variante précompressée : octets bruts servis sous l'adresse du fichier de base, puis décodage. */
async function checkVariant(ctx, entry, base, token) {
  const r = await get(ctx, urlPath(base.path), token, entry.size + 1);
  const bad = statusProblem(r.status);
  if (bad) return bad;
  if (r.encoding !== token) return `variante ${token} non servie pour ${base.path} (Content-Encoding : ${r.encoding ?? "absent"})`;
  const d = diff(r, entry);
  if (d) return d;
  let plain = null;
  try {
    const opts = { maxOutputLength: base.size + 1 }; // plafond : pas de bombe de décompression
    plain = token === "br" ? brotliDecompressSync(r.body, opts) : gunzipSync(r.body, opts);
  } catch {
    plain = null;
  }
  if (!plain || plain.length !== base.size || sha256(plain) !== base.sha256) return `ne redonne pas ${base.path} une fois décompressée`;
  return null;
}

/** Repli monopage : mêmes octets que index.html (ou que sa variante si le serveur encode). */
async function checkFallback(ctx, fallback, index, token, variant) {
  const r = await get(ctx, fallback.path, token ?? "identity", Math.max(index.size, variant?.size ?? 0) + 1);
  const bad = statusProblem(r.status, !fallback.strict);
  if (bad) return bad;
  if (!r.encoding) return diff(r, index);
  if (r.encoding !== token) return `réponse encodée « ${r.encoding} » alors que ${token ?? "identity"} était demandé`;
  return diff(r, variant);
}

/**
 * Vérifie le site servi par `origin` contre le manifeste. Rend la liste des problèmes (vide :
 * conforme) ; s'arrête au premier écart, la liste a donc au plus un élément.
 */
export async function verifySite(origin, manifest, opts = {}) {
  const refused = checkOrigin(origin) ?? checkManifest(manifest);
  if (refused) return [refused];
  const url = new URL(origin);
  const lib = url.protocol === "https:" ? https : http;
  const agent = new lib.Agent({ keepAlive: true, maxSockets: 1 });
  const ctx = { url, lib, agent, timeoutMs: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS };
  const byPath = new Map(manifest.files.map((f) => [f.path, f]));
  /** Base et jeton d'une variante précompressée ; null pour un fichier en clair. */
  const variantOf = (entry) => {
    const m = /^(.+)\.(br|gz)$/.exec(entry.path);
    const base = m ? byPath.get(m[1]) : undefined;
    return base ? { base, token: TOKENS[m[2]] } : null;
  };
  try {
    for (const entry of manifest.files) {
      const v = variantOf(entry);
      let problem;
      try {
        problem = v ? await checkVariant(ctx, entry, v.base, v.token) : await checkPlain(ctx, entry);
      } catch (e) {
        problem = e.message;
      }
      if (problem) return [`${entry.path} : ${problem}`];
    }
    const index = byPath.get("index.html");
    const encodings = [[null, null]];
    for (const [ext, token] of Object.entries(TOKENS)) {
      const variant = byPath.get(`index.html.${ext}`);
      if (variant) encodings.push([token, variant]);
    }
    for (const fallback of FALLBACKS) {
      for (const [token, variant] of encodings) {
        let problem;
        try {
          problem = await checkFallback(ctx, fallback, index, token, variant);
        } catch (e) {
          problem = e.message;
        }
        if (problem) return [`${fallback.path} (repli monopage${token ? `, Accept-Encoding: ${token}` : ""}) : ${problem}`];
      }
    }
    return [];
  } finally {
    agent.destroy();
  }
}

const USAGE = "usage : node scripts/verify-site.mjs <origine https://…> <release.json>";

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  // Aucune option, à dessein : rien ne permet de sauter un contrôle (spec §28.8, C2).
  const usage = args.length !== 2 ? "deux arguments attendus" : args.some((a) => a.startsWith("-")) ? "aucune option n'existe" : checkOrigin(args[0]);
  if (usage) {
    console.error(`verify-site : ${usage}\n${USAGE}`);
    process.exit(2);
  }
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(args[1], "utf8"));
  } catch (e) {
    console.error(`verify-site : ${args[1]} illisible (${e.code ?? "JSON invalide"})`);
    process.exit(1);
  }
  const problems = await verifySite(args[0], manifest);
  if (problems.length > 0) {
    for (const p of problems) console.error(`verify-site : ${p}`);
    process.exit(1);
  }
  console.log(`verify-site : ${new URL(args[0]).origin} conforme à ${manifest.name} ${manifest.version} (${manifest.commit}), ${manifest.files.length} fichiers`);
}
