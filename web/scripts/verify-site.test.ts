// verify-site.mjs (spec §28.4) : le site servi est-il exactement celui du manifeste ?
// Les essais passent par un vrai serveur node:http sur 127.0.0.1, qui sert un dossier temporaire
// comme le serveur Go (server/cmd/shhdrop/static.go) : variantes .br/.gz selon Accept-Encoding,
// repli monopage en 404 avec les octets de index.html.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { brotliCompressSync, gzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import { manifestOf, type ReleaseManifest } from "./release-manifest.mjs";
import { checkManifest, checkOrigin, verifySite } from "./verify-site.mjs";

const SCRIPT = fileURLToPath(new URL("./verify-site.mjs", import.meta.url));
const META = { name: "shhdrop-web", version: "1.2.3", commit: "0123abc" };
const INDEX = "<!doctype html><title>Shhdrop</title><script src=/assets/app-a.js></script>";
const APP = "console.info('application');".repeat(20);

const dirs: string[] = [];
const servers: Server[] = [];
afterEach(async () => {
  for (const s of servers.splice(0)) {
    s.closeAllConnections();
    await new Promise((r) => s.close(r));
  }
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function temp(): string {
  const d = mkdtempSync(join(tmpdir(), "verify-site-"));
  dirs.push(d);
  return d;
}

/** Site d'essai : index, script et feuille avec leurs variantes, image sans variante. */
function tree(extra: Record<string, string | Buffer> = {}): string {
  const d = temp();
  const files: Record<string, string | Buffer> = {
    "index.html": INDEX,
    "index.html.br": brotliCompressSync(INDEX),
    "index.html.gz": gzipSync(INDEX),
    "assets/app-a.js": APP,
    "assets/app-a.js.br": brotliCompressSync(APP),
    "assets/app-a.js.gz": gzipSync(APP),
    "assets/style b.css": "body{margin:0}",
    "fonts/a.woff2": Buffer.from([0, 1, 2, 3, 250, 251, 252]),
    "robots.txt": "User-agent: *\n",
    ...extra,
  };
  for (const [name, data] of Object.entries(files)) {
    mkdirSync(join(d, name, ".."), { recursive: true });
    writeFileSync(join(d, name), data);
  }
  return d;
}

type Seen = { url: string; headers: IncomingMessage["headers"] };
type Hook = (req: IncomingMessage, res: ServerResponse) => boolean;
type ServeOpts = { hook?: Hook; fallbackStatus?: number; variants?: boolean };

/** Sert dir comme le serveur Go ; `hook` rend true s'il a pris la requête en charge. */
async function serve(dir: string, opts: ServeOpts = {}): Promise<{ origin: string; seen: Seen[] }> {
  const seen: Seen[] = [];
  const server = createServer((req, res) => {
    seen.push({ url: req.url!, headers: req.headers });
    if (opts.hook?.(req, res)) return;
    const path = decodeURIComponent(req.url!);
    const name = path === "/" ? "index.html" : path.slice(1);
    const accept = String(req.headers["accept-encoding"] ?? "");
    if (existsSync(join(dir, name))) {
      if (opts.variants !== false) {
        for (const [token, ext] of [["br", ".br"], ["gzip", ".gz"]] as const) {
          if (!accept.split(",").some((p) => p.trim() === token) || !existsSync(join(dir, name + ext))) continue;
          res.writeHead(200, { "Content-Encoding": token, Vary: "Accept-Encoding" }).end(readFileSync(join(dir, name + ext)));
          return;
        }
      }
      res.writeHead(200).end(readFileSync(join(dir, name)));
    } else if (!name.split("/").pop()!.includes(".")) {
      res.writeHead(opts.fallbackStatus ?? 404, { "Content-Type": "text/html; charset=utf-8" }).end(readFileSync(join(dir, "index.html")));
    } else {
      res.writeHead(404).end("introuvable");
    }
  });
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return { origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, seen };
}

const manifest = (dir: string): ReleaseManifest => manifestOf(dir, META);
/** Requêtes vues pour un chemin : liste des Accept-Encoding. */
const encodingsFor = (seen: Seen[], url: string) => seen.filter((s) => s.url === url).map((s) => s.headers["accept-encoding"]);

describe("verifySite : site conforme", () => {
  it("aucun problème ; chaque fichier demandé sans cache, variantes par le chemin de base", async () => {
    const d = tree();
    const { origin, seen } = await serve(d);
    expect(await verifySite(origin, manifest(d))).toEqual([]);
    expect(seen.length).toBeGreaterThan(0);
    for (const s of seen) expect(s.headers["cache-control"]).toBe("no-cache");
    // Fichier simple : octets décodés (identity). Variantes : même chemin, encodage demandé.
    expect(encodingsFor(seen, "/assets/app-a.js").sort()).toEqual(["br", "gzip", "identity"]);
    expect(encodingsFor(seen, "/assets/style%20b.css")).toEqual(["identity"]);
    expect(encodingsFor(seen, "/fonts/a.woff2")).toEqual(["identity"]);
    expect(seen.some((s) => /\.(br|gz)$/.test(s.url))).toBe(false);
    // Repli monopage : les quatre chemins, en clair et dans chaque encodage de index.html.
    for (const p of ["/", "/s/x", "/x"]) expect(encodingsFor(seen, p).sort()).toEqual(["br", "gzip", "identity"]);
    expect(encodingsFor(seen, "/index.html")).toContain("identity");
  });

  it("le repli peut répondre 200 comme 404 (le serveur Go répond 404 avec les octets de index.html)", async () => {
    const d = tree();
    expect(await verifySite((await serve(d, { fallbackStatus: 404 })).origin, manifest(d))).toEqual([]);
    expect(await verifySite((await serve(d, { fallbackStatus: 200 })).origin, manifest(d))).toEqual([]);
  });

  it("un .gz sans fichier de base listé est un fichier comme un autre", async () => {
    const d = tree({ "donnees.gz": gzipSync("x") });
    const { origin, seen } = await serve(d);
    expect(await verifySite(origin, manifest(d))).toEqual([]);
    expect(encodingsFor(seen, "/donnees.gz")).toEqual(["identity"]);
  });
});

describe("verifySite : écarts", () => {
  /** Vérifie contre le manifeste d'origine un site modifié ensuite sur le disque du serveur. */
  async function after(change: (dir: string) => void, opts: ServeOpts = {}, extra: Record<string, string | Buffer> = {}) {
    const d = tree(extra);
    const m = manifest(d);
    change(d);
    return verifySite((await serve(d, opts)).origin, m, { timeoutMs: 2000 });
  }

  it("un octet modifié, même taille : empreinte différente", async () => {
    const problems = await after((d) => writeFileSync(join(d, "fonts/a.woff2"), Buffer.from([0, 1, 2, 3, 250, 251, 253])));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/^fonts\/a\.woff2 : empreinte SHA-256 différente/);
  });

  it("taille différente : plus court, plus long", async () => {
    expect((await after((d) => writeFileSync(join(d, "robots.txt"), "User")))[0]).toMatch(/^robots\.txt : taille différente \(attendu 14 octets, reçu 4\)/);
    expect((await after((d) => writeFileSync(join(d, "robots.txt"), "User-agent: *\nDisallow: /\n")))[0]).toMatch(/^robots\.txt : taille différente \(attendu 14 octets, reçu plus\)/);
  });

  it("corps sans fin : lecture arrêtée à la taille listée + 1 octet", async () => {
    let sent = 0;
    const hook: Hook = (req, res) => {
      if (req.url !== "/robots.txt") return false;
      res.writeHead(200);
      const t = setInterval(() => {
        sent += 1024;
        res.write(Buffer.alloc(1024));
      }, 1);
      res.on("close", () => clearInterval(t));
      return true;
    };
    const problems = await after(() => {}, { hook });
    expect(problems[0]).toMatch(/^robots\.txt : taille différente \(attendu 14 octets, reçu plus\)/);
    expect(sent).toBeLessThan(1024 * 1024);
  });

  it("fichier absent : 404", async () => {
    const problems = await after((d) => rmSync(join(d, "assets/style b.css")));
    expect(problems).toEqual(["assets/style b.css : statut HTTP 404 (200 attendu)"]);
  });

  it("fichier absent remplacé par le repli (chemin sans extension) : jamais vert", async () => {
    const problems = await after((d) => rmSync(join(d, "LICENCE")), {}, { LICENCE: "texte" });
    expect(problems[0]).toMatch(/^LICENCE : statut HTTP 404/);
    const twice = await after((d) => rmSync(join(d, "LICENCE")), { fallbackStatus: 200 }, { LICENCE: "texte" });
    expect(twice[0]).toMatch(/^LICENCE : taille différente/);
  });

  it("redirection : refusée, jamais suivie", async () => {
    let followed = false;
    const hook: Hook = (req, res) => {
      if (req.url === "/ailleurs.txt") {
        followed = true;
        res.writeHead(200).end("User-agent: *\n"); // les bons octets, à une autre adresse
        return true;
      }
      if (req.url !== "/robots.txt") return false;
      res.writeHead(302, { Location: "/ailleurs.txt" }).end();
      return true;
    };
    expect(await after(() => {}, { hook })).toEqual(["robots.txt : redirection refusée (HTTP 302)"]);
    expect(followed).toBe(false);
  });

  it("statut autre que 200 avec les bons octets : refusé", async () => {
    const hook: Hook = (req, res) => {
      if (req.url !== "/robots.txt") return false;
      res.writeHead(203).end("User-agent: *\n");
      return true;
    };
    expect(await after(() => {}, { hook })).toEqual(["robots.txt : statut HTTP 203 (200 attendu)"]);
  });

  it("mauvaise page de repli", async () => {
    const hook: Hook = (req, res) => {
      if (req.url !== "/x") return false;
      res.writeHead(404).end(INDEX.replace("app-a", "app-b"));
      return true;
    };
    const problems = await after(() => {}, { hook });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/^\/x \(repli monopage\) : .*différente/);
  });

  it("repli : statut 500, ou 404 sur « / », refusés même avec les bons octets", async () => {
    const status = (url: string, code: number): Hook => (req, res) => {
      if (req.url !== url) return false;
      res.writeHead(code).end(INDEX);
      return true;
    };
    expect((await after(() => {}, { hook: status("/s/x", 500) }))[0]).toMatch(/^\/s\/x \(repli monopage\) : statut HTTP 500/);
    expect((await after(() => {}, { hook: status("/", 404) }))[0]).toMatch(/^\/ \(repli monopage\) : statut HTTP 404 \(200 attendu\)/);
  });

  it("serveur qui ne répond pas : délai dépassé", async () => {
    const hook: Hook = (req) => req.url === "/robots.txt";
    const d = tree();
    const t0 = Date.now();
    const problems = await verifySite((await serve(d, { hook })).origin, manifest(d), { timeoutMs: 200 });
    expect(problems).toEqual(["robots.txt : délai dépassé (200 ms)"]);
    expect(Date.now() - t0).toBeLessThan(3000);
  });

  it("serveur qui s'arrête au milieu du corps, en envoyant un octet de temps en temps : délai dépassé", async () => {
    const hook: Hook = (req, res) => {
      if (req.url !== "/assets/app-a.js") return false;
      res.writeHead(200, { "Content-Length": String(APP.length) });
      const t = setInterval(() => res.write("c"), 50); // un délai d'inactivité ne suffirait pas
      res.on("close", () => clearInterval(t));
      return true;
    };
    const d = tree();
    const problems = await verifySite((await serve(d, { hook })).origin, manifest(d), { timeoutMs: 300 });
    expect(problems).toEqual(["assets/app-a.js : délai dépassé (300 ms)"]);
  });

  it("connexion coupée au milieu du corps : erreur réseau", async () => {
    const hook: Hook = (req, res) => {
      if (req.url !== "/assets/app-a.js") return false;
      res.writeHead(200, { "Content-Length": String(APP.length) });
      res.write(APP.slice(0, 10), () => res.destroy());
      return true;
    };
    expect((await after(() => {}, { hook }))[0]).toMatch(/^assets\/app-a\.js : erreur réseau/);
  });

  it("personne n'écoute : erreur réseau", async () => {
    const d = tree();
    const { origin } = await serve(d);
    const s = servers.pop()!;
    s.closeAllConnections();
    await new Promise((r) => s.close(r));
    const problems = await verifySite(origin, manifest(d), { timeoutMs: 2000 });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/ : erreur réseau \(ECONNREFUSED\)$/);
  });

  it("réponse encodée alors que identity est demandé", async () => {
    const hook: Hook = (req, res) => {
      if (req.url !== "/robots.txt") return false;
      res.writeHead(200, { "Content-Encoding": "gzip" }).end(gzipSync("User-agent: *\n"));
      return true;
    };
    expect((await after(() => {}, { hook }))[0]).toMatch(/^robots\.txt : réponse encodée « gzip » alors que identity était demandé/);
  });

  it("variante servie différente de celle du manifeste (le fichier en clair est intact)", async () => {
    const problems = await after((d) => writeFileSync(join(d, "assets/app-a.js.br"), brotliCompressSync(APP + "fetch('//voleur')")));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/^assets\/app-a\.js\.br : (taille|empreinte SHA-256) différente/);
  });

  it("variante non servie (le serveur ignore Accept-Encoding)", async () => {
    const problems = await after(() => {}, { variants: false });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/^assets\/app-a\.js\.br : variante br non servie pour assets\/app-a\.js/);
  });

  it("variante qui ne redonne pas son fichier source (manifeste et serveur d'accord entre eux)", async () => {
    const d = tree({ "assets/app-a.js.gz": gzipSync(APP + "fetch('//voleur')") });
    const problems = await verifySite((await serve(d)).origin, manifest(d));
    expect(problems).toEqual(["assets/app-a.js.gz : ne redonne pas assets/app-a.js une fois décompressée"]);
  });

  it("variante qui n'est pas du brotli, ou qui se décompresse en bien plus gros que la source", async () => {
    const junk = tree({ "assets/app-a.js.br": "pas du brotli" });
    expect(await verifySite((await serve(junk)).origin, manifest(junk))).toEqual(["assets/app-a.js.br : ne redonne pas assets/app-a.js une fois décompressée"]);
    const bomb = tree({ "assets/app-a.js.br": brotliCompressSync(Buffer.alloc(8 * 1024 * 1024)) });
    expect(await verifySite((await serve(bomb)).origin, manifest(bomb))).toEqual(["assets/app-a.js.br : ne redonne pas assets/app-a.js une fois décompressée"]);
  });

  it("index.html.br différent servi sur « / » seulement", async () => {
    const hook: Hook = (req, res) => {
      if (req.url !== "/" || req.headers["accept-encoding"] !== "br") return false;
      res.writeHead(200, { "Content-Encoding": "br" }).end(brotliCompressSync(INDEX + "<script src=//voleur></script>"));
      return true;
    };
    const problems = await after(() => {}, { hook });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/^\/ \(repli monopage, Accept-Encoding: br\) : .*différente/);
  });
});

describe("refus avant toute requête", () => {
  it.each(["http://example.com", "http://127.0.0.1.example.com", "ftp://127.0.0.1", "example.com", "", "https://", "https://u:p@example.com", "https://example.com/chemin", "https://example.com/?a=1", "https://example.com/#a", "http://[::1]:8080"])(
    "origine refusée : %j",
    (origin) => {
      expect(checkOrigin(origin)).toMatch(/origine refusée/);
    },
  );

  it.each(["https://shhdrop.app", "https://shhdrop.app/", "https://shhdrop.app:8443", "http://127.0.0.1:8080", "http://localhost:8080", "http://localhost"])("origine acceptée : %j", (origin) => {
    expect(checkOrigin(origin)).toBeNull();
  });

  const f = (path: string) => ({ path, size: 1, sha256: "0".repeat(64) });
  const M = (over: object) => ({ schema: 1, ...META, files: [f("index.html")], ...over });

  it.each([
    ["schéma 2", M({ schema: 2 }), /schéma/],
    ["schéma « 1 »", M({ schema: "1" }), /schéma/],
    ["sans index.html", M({ files: [f("a.js")] }), /index\.html/],
    ["aucun fichier", M({ files: [] }), /index\.html/],
    ["files absent", M({ files: undefined }), /files/],
    ["pas un objet", null, /manifeste/],
    ["chemin ../x", M({ files: [f("index.html"), f("../x")] }), /chemin refusé/],
    ["chemin a/../b", M({ files: [f("index.html"), f("a/../b")] }), /chemin refusé/],
    ["chemin /x", M({ files: [f("index.html"), f("/x")] }), /chemin refusé/],
    ["chemin //hote/x", M({ files: [f("index.html"), f("//127.0.0.1/x")] }), /chemin refusé/],
    ["barre oblique inverse", M({ files: [f("index.html"), f("a\\b")] }), /chemin refusé/],
    ["schéma d'URL", M({ files: [f("index.html"), f("http://169.254.169.254/x")] }), /chemin refusé/],
    ["schéma d'URL sans barres", M({ files: [f("index.html"), f("javascript:x")] }), /chemin refusé/],
    ["segment vide", M({ files: [f("index.html"), f("a//b")] }), /chemin refusé/],
    ["chemin vide", M({ files: [f("index.html"), f("")] }), /chemin refusé/],
    ["caractère de contrôle", M({ files: [f("index.html"), f("a\r\nHost: x")] }), /chemin refusé/],
    ["chemin en double", M({ files: [f("index.html"), f("index.html")] }), /en double/],
    ["taille négative", M({ files: [{ ...f("index.html"), size: -1 }] }), /taille/],
    ["taille en texte", M({ files: [{ ...f("index.html"), size: "1" }] }), /taille/],
    ["empreinte hors format", M({ files: [{ ...f("index.html"), sha256: "ABC" }] }), /empreinte/],
    ["version hors format", M({ version: "\u001b[2J" }), /version/],
  ])("manifeste refusé : %s", async (_, m, re) => {
    expect(checkManifest(m)).toMatch(re);
    const d = tree();
    const { origin, seen } = await serve(d);
    const problems = await verifySite(origin, m as unknown as ReleaseManifest);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(re);
    expect(seen).toEqual([]);
  });

  it("origine refusée : aucune requête, un problème", async () => {
    const d = tree();
    expect(await verifySite("http://example.com", manifest(d))).toEqual([expect.stringMatching(/origine refusée/)]);
  });
});

describe("ligne de commande", () => {
  // spawn asynchrone : le serveur d'essai vit dans ce processus (spawnSync le bloquerait).
  const run = (args: string[]) =>
    new Promise<{ status: number | null; stdout: string; stderr: string }>((resolve) => {
      const p = spawn(process.execPath, [SCRIPT, ...args]);
      let stdout = "";
      let stderr = "";
      p.stdout.on("data", (b) => (stdout += b));
      p.stderr.on("data", (b) => (stderr += b));
      p.on("close", (status) => resolve({ status, stdout, stderr }));
    });
  const saved = (m: unknown) => {
    const p = join(temp(), "release.json");
    writeFileSync(p, typeof m === "string" ? m : JSON.stringify(m));
    return p;
  };

  it("site conforme : sortie 0", async () => {
    const d = tree();
    const { origin } = await serve(d);
    const r = await run([origin, saved(manifest(d))]);
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/^verify-site : .* conforme à shhdrop-web 1\.2\.3 \(0123abc\), 9 fichiers\n$/);
  });

  it("écart : sortie 1, une ligne qui nomme le chemin", async () => {
    const d = tree();
    const m = saved(manifest(d));
    writeFileSync(join(d, "assets/app-a.js"), APP.replace("i", "j"));
    const r = await run([(await serve(d)).origin, m]);
    expect(r.status).toBe(1);
    expect(r.stdout).toBe("");
    expect(r.stderr).toBe("verify-site : assets/app-a.js : empreinte SHA-256 différente\n");
  });

  it("manifeste illisible, pas du JSON ou refusé : sortie 1", async () => {
    expect((await run(["https://shhdrop.app", join(temp(), "absent.json")])).status).toBe(1);
    expect((await run(["https://shhdrop.app", saved("{")])).status).toBe(1);
    const r = await run(["https://shhdrop.app", saved({ schema: 2 })]);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/^verify-site : .*schéma[^\n]*\n$/);
  });

  it.each([[[]], [["https://shhdrop.app"]], [["https://shhdrop.app", "a.json", "b.json"]], [["http://example.com", "a.json"]], [["--insecure", "https://shhdrop.app", "a.json"]], [["https://shhdrop.app", "a.json", "--skip"]]])(
    "erreur d'usage → sortie 2 : %j",
    async (args) => {
      const r = await run(args);
      expect(r.status).toBe(2);
      expect(r.stderr).toMatch(/^verify-site : .*\nusage : /);
    },
  );
});
