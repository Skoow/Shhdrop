#!/usr/bin/env node
// Banc de vitesse du moteur : node web/bench/run.mjs <sortie.json> [--ref <révision git>]
// Sans --ref : mesure l'arbre courant. Avec --ref : construit tout (banc et site) depuis cette
// révision dans un `git worktree` temporaire, pour comparer avant/après dans la même session.
// 1. construit le site (npm run build) ; 2. construit la page du banc (bench/vite.config.ts) ;
// 3. la lance dans Chromium (Playwright) servie sur 127.0.0.1 (contexte sécurisé) ;
// 4. pèse ce que le navigateur télécharge réellement sur le site construit (octets brotli).
import { execFileSync } from "node:child_process";
import { createReadStream, existsSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, extname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const mainWeb = resolve(here, "..");
const argv = process.argv.slice(2);
const ri = argv.indexOf("--ref");
const ref = ri >= 0 ? argv[ri + 1] : undefined;
if (ri >= 0) argv.splice(ri, 2);
const out = argv[0];
if (!out || (ri >= 0 && !ref)) {
  console.error("usage : node web/bench/run.mjs <sortie.json> [--ref <révision>]");
  process.exit(2);
}
const { chromium } = createRequire(join(mainWeb, "package.json"))("playwright");

const scratch = mkdtempSync(join(tmpdir(), "shh-bench-"));
let worktree;
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css", ".wasm": "application/wasm", ".svg": "image/svg+xml", ".json": "application/json", ".webmanifest": "application/manifest+json" };

/** Sert `dir` en statique sur 127.0.0.1 ; brotli précompressé (.br) si le navigateur l'accepte, comme le serveur Go. `log` reçoit {path, bytes}. */
async function serve(dir, spa, log) {
  const server = createServer((req, res) => {
    const p = decodeURIComponent((req.url ?? "/").split("?")[0]);
    let f = resolve(dir, "." + (p === "/" ? "/index.html" : p));
    if (!f.startsWith(dir) || !existsSync(f) || !statSync(f).isFile()) {
      if (!spa) return void res.writeHead(404).end();
      f = join(dir, "index.html");
    }
    const br = /\bbr\b/.test(req.headers["accept-encoding"] ?? "") && existsSync(f + ".br");
    const file = br ? f + ".br" : f;
    const h = { "content-type": TYPES[extname(f)] ?? "application/octet-stream", "content-length": statSync(file).size };
    if (br) h["content-encoding"] = "br";
    res.writeHead(200, h);
    log?.({ path: "/" + f.slice(dir.length + 1), bytes: statSync(file).size, br });
    createReadStream(file).pipe(res);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { server, url: `http://127.0.0.1:${server.address().port}` };
}

async function launch() {
  const o = { headless: true };
  if (process.env.PW_LOCAL_CHROMIUM === "1") o.executablePath = "/opt/pw-browsers/chromium";
  return chromium.launch(o);
}

/**
 * Octets brotli que télécharge un visiteur : ce que le navigateur charge réellement en ouvrant la
 * route (index, scripts, styles), plus, de façon générique, tout fichier /assets/*.js|css|wasm que
 * ces scripts désignent (Worker, Argon2, moteur .wasm...), de proche en proche : ces fichiers ne
 * se chargent que quand on envoie ou ouvre vraiment, ce qu'on ne peut pas jouer sans serveur.
 * Exclus : images, polices et le cadre d'aperçu PDF (chargés à la demande, non liés au moteur).
 */
async function weigh(browser, dist, route) {
  const seen = new Map();
  const { server, url } = await serve(dist, true, (e) => seen.has(e.path) || seen.set(e.path, e.bytes));
  try {
    const page = await browser.newPage();
    await page.goto(url + route, { waitUntil: "networkidle" });
    await page.close();
  } finally {
    server.close();
  }
  const ref = /\/assets\/[A-Za-z0-9_.-]+\.(?:js|css|wasm)/g;
  const queue = [...seen.keys()].filter((p) => /\.(js|css|wasm)$/.test(p));
  const sizeOf = (p) => {
    const f = join(dist, p);
    return existsSync(f + ".br") ? statSync(f + ".br").size : null;
  };
  while (queue.length) {
    const p = queue.pop();
    if (!/\.js$/.test(p)) continue;
    for (const m of readFileSync(join(dist, p), "utf8").matchAll(ref)) {
      if (seen.has(m[0])) continue;
      const s = sizeOf(m[0]);
      if (s === null) throw new Error(`${m[0]} cité par ${p} mais absent (ou sans .br) dans web/dist`);
      seen.set(m[0], s);
      queue.push(m[0]);
    }
  }
  const files = [...seen].filter(([p]) => /\.(html|js|css|wasm)$/.test(p) && !p.startsWith("/pdf-frame")).sort();
  return { bytes: files.reduce((s, [, b]) => s + b, 0), files: files.map(([file, br_bytes]) => ({ file, br_bytes })) };
}

const quiet = (cmd, args, o) => {
  try {
    execFileSync(cmd, args, o);
  } catch (e) {
    console.error(String(e.stderr ?? e));
    throw e;
  }
};

try {
  let web = mainWeb;
  let commit;
  const git = (...a) => execFileSync("git", a, { encoding: "utf8", cwd: mainWeb }).trim();
  if (ref) {
    commit = git("rev-parse", "--short", ref);
    worktree = join(scratch, "wt");
    git("worktree", "add", "--detach", worktree, ref);
    web = join(worktree, "web");
    symlinkSync(join(mainWeb, "node_modules"), join(web, "node_modules"));
  } else {
    commit = git("rev-parse", "--short", "HEAD");
  }

  quiet("npm", ["run", "build"], { cwd: web, stdio: ["ignore", "ignore", "pipe"] });
  const benchDir = join(scratch, "page");
  quiet(join(web, "node_modules/.bin/vite"), ["build", join(web, "bench"), "--outDir", benchDir, "--emptyOutDir", "--logLevel", "warn"], { cwd: web, stdio: ["ignore", "ignore", "pipe"] });

  const browser = await launch();
  const chromiumVersion = browser.version();
  let bench, send, open;
  try {
    const { server, url } = await serve(benchDir, false);
    try {
      const page = await browser.newPage();
      const crashed = new Promise((_, rej) => page.on("pageerror", (e) => rej(new Error(`pageerror : ${e}`))));
      await page.goto(url + "/");
      bench = await Promise.race([page.waitForFunction(() => window.__bench !== undefined, null, { timeout: 15 * 60_000, polling: 1000 }).then(() => page.evaluate(() => window.__bench)), crashed]);
    } finally {
      server.close();
    }
    if ("error" in bench) throw new Error(`banc : ${bench.error}`);
    const dist = join(web, "dist");
    send = await weigh(browser, dist, "/");
    open = await weigh(browser, dist, "/#" + "A".repeat(43));
  } finally {
    await browser.close();
  }

  const r1 = (x) => Math.round(x * 10) / 10;
  const stat = (s, f) => ({ median: f(s.median), min: f(s.min), iqr: f(s.iqr), runs: s.runs.map(f) });
  const result = {
    commit,
    chromium: chromiumVersion,
    seal_mib_s: r1(bench.seal_mib_s.median),
    open_mib_s: r1(bench.open_mib_s.median),
    argon2_ms: Math.round(bench.argon2_ms.median),
    argon2_first_ms: Math.round(bench.argon2_first_ms),
    send_bytes: send.bytes,
    open_bytes: open.bytes,
    stats: { seal_mib_s: stat(bench.seal_mib_s, r1), open_mib_s: stat(bench.open_mib_s, r1), argon2_ms: stat(bench.argon2_ms, Math.round) },
    files: { send: send.files, open: open.files },
    note:
      "Médiane de 15 passes après une passe d'échauffement écartée (min et écart interquartile dans stats). 128 Mio pseudo-aléatoires (xorshift32) chiffrés puis rouverts en mémoire, octets vérifiés hors chrono. " +
      "Copies comprises dans le temps mesuré : lecture du Blob par tranches de 4 Mio (chiffrement) ; à l'ouverture, une copie de chaque segment de 4 Mio donné au lecteur (il met à zéro ce qu'il reçoit). " +
      "argon2_ms : médiane de 15 appels avec les paramètres de création, après un premier appel à froid (argon2_first_ms, instanciation comprise). " +
      "send_bytes/open_bytes : octets brotli de ce que le navigateur charge sur le site construit (web/dist rebâti par ce script), route / pour envoyer, /#<partage> pour ouvrir, plus tout fichier assets/*.js|css|wasm cité de proche en proche par ces scripts (Argon2, Worker de preuve de travail, futur .wasm) ; cadre d'aperçu PDF exclu. " +
      "Les deux ensembles sont aujourd'hui identiques (un seul bundle).",
  };
  writeFileSync(out, JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify({ ...result, stats: undefined, files: undefined, note: undefined }, null, 2));
} finally {
  if (worktree) try { execFileSync("git", ["worktree", "remove", "--force", worktree], { cwd: mainWeb }); } catch {}
  rmSync(scratch, { recursive: true, force: true });
}
