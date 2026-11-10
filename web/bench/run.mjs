#!/usr/bin/env node
// Banc de vitesse du moteur : node web/bench/run.mjs <sortie.json>
// Construit la page avec Vite, la sert sur 127.0.0.1 (contexte sécurisé), la lance dans
// Chromium (Playwright), lit les octets brotli du site dans web/dist (npm run build d'abord).
import { execFileSync } from "node:child_process";
import { createReadStream, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, extname, join, resolve } from "node:path";
import { brotliCompressSync, constants } from "node:zlib";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const here = dirname(fileURLToPath(import.meta.url));
const web = resolve(here, "..");
const out = process.argv[2];
if (!out) {
  console.error("usage : node web/bench/run.mjs <sortie.json>");
  process.exit(2);
}
const require = createRequire(join(web, "package.json"));
const { chromium } = require("playwright");

const scratch = mkdtempSync(join(tmpdir(), "shh-bench-"));
try {
  execFileSync(join(web, "node_modules/.bin/vite"), ["build", here, "--outDir", scratch, "--emptyOutDir", "--base", "./", "--logLevel", "warn"], { stdio: "inherit", cwd: web });

  const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css", ".wasm": "application/wasm" };
  const server = createServer((req, res) => {
    const p = decodeURIComponent((req.url ?? "/").split("?")[0]);
    const f = resolve(scratch, "." + (p === "/" ? "/index.html" : p));
    if (!f.startsWith(scratch) || !existsSync(f) || !statSync(f).isFile()) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { "content-type": types[extname(f)] ?? "application/octet-stream" });
    createReadStream(f).pipe(res);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${server.address().port}/`;

  const launch = { headless: true };
  if (process.env.PW_LOCAL_CHROMIUM === "1") launch.executablePath = "/opt/pw-browsers/chromium";
  const browser = await chromium.launch(launch);
  let bench;
  const chromiumVersion = browser.version();
  try {
    const page = await browser.newPage();
    page.on("pageerror", (e) => console.error("pageerror", e));
    await page.goto(url);
    await page.waitForFunction(() => window.__bench !== undefined, null, { timeout: 15 * 60_000, polling: 1000 });
    bench = await page.evaluate(() => window.__bench);
  } finally {
    await browser.close();
    server.close();
  }
  if ("error" in bench) throw new Error(`banc : ${bench.error}`);

  // Octets brotli du site construit (web/dist) : ce que télécharge un visiteur.
  const dist = join(web, "dist");
  const assets = readdirSync(join(dist, "assets"));
  const pick = (re) => {
    const m = assets.filter((n) => re.test(n));
    if (m.length !== 1) throw new Error(`web/dist/assets : ${re} trouvé ${m.length} fois (lancer npm run build)`);
    return join(dist, "assets", m[0]);
  };
  const files = [join(dist, "index.html"), pick(/^index-.*\.js$/), pick(/^index-.*\.css$/), pick(/^argon2-.*\.js$/)];
  const br = (f) => (existsSync(f + ".br") ? statSync(f + ".br").size : brotliCompressSync(readFileSync(f), { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length);
  const total = files.reduce((s, f) => s + br(f), 0);
  const round = (x) => Math.round(x * 10) / 10;

  let commit = "inconnu";
  try {
    commit = execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8", cwd: web }).trim();
  } catch {}
  const result = {
    commit,
    chromium: chromiumVersion,
    seal_mib_s: round(bench.seal_mib_s),
    open_mib_s: round(bench.open_mib_s),
    argon2_ms: Math.round(bench.argon2_ms),
    send_bytes: total,
    open_bytes: total,
    note: "send_bytes et open_bytes : même ensemble de fichiers aujourd'hui (index.html, assets/index-*.js, assets/index-*.css, assets/argon2-*.js), en octets brotli ; médiane de 5 passes après une passe d'échauffement écartée ; 128 Mio.",
    runs: { seal_mib_s: bench.seal_runs.map(round), open_mib_s: bench.open_runs.map(round), argon2_ms: bench.argon2_runs.map(Math.round) },
    files: files.map((f) => ({ file: f.slice(dist.length + 1), br_bytes: br(f) })),
  };
  writeFileSync(out, JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify(result, null, 2));
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
