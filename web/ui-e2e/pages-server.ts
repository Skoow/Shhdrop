// Imitation de GitHub Pages pour les tests de la démo : sert web/dist-demo sous /shhdrop/,
// 404.html avec le code 404 pour tout chemin absent (pas de repli monopage), et AUCUN en-tête
// de sécurité (la démo ne compte que sur sa CSP meta, UI §14.3).
import { existsSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { extname, join, normalize, sep } from "node:path";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".wasm": "application/wasm",
  ".txt": "text/plain; charset=utf-8",
  ".json": "application/json",
};

export type PagesServer = { origin: string; close(): Promise<void> };

export async function startPagesServer(root: string, base = "/shhdrop/"): Promise<PagesServer> {
  const notFound = readFileSync(join(root, "404.html"));
  const server = createServer((req, res) => {
    const path = new URL(req.url ?? "/", "http://x").pathname;
    if (path === base.slice(0, -1)) {
      res.writeHead(301, { Location: base }).end();
      return;
    }
    let file: string | null = null;
    if (path.startsWith(base)) {
      let rel: string;
      try {
        rel = decodeURIComponent(path.slice(base.length));
      } catch {
        rel = "\0";
      }
      const p = normalize(join(root, rel));
      if ((p === root || p.startsWith(root.endsWith(sep) ? root : root + sep)) && !rel.includes("\0")) {
        const f = existsSync(p) && statSync(p).isDirectory() ? join(p, "index.html") : p;
        if (existsSync(f) && statSync(f).isFile()) file = f;
      }
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405).end();
      return;
    }
    if (file === null) {
      res.writeHead(404, { "Content-Type": TYPES[".html"]! }).end(req.method === "HEAD" ? undefined : notFound);
      return;
    }
    const body = readFileSync(file);
    res.writeHead(200, { "Content-Type": TYPES[extname(file)] ?? "application/octet-stream" });
    res.end(req.method === "HEAD" ? undefined : body);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  return {
    origin: `http://127.0.0.1:${port}`,
    // Chromium ouvre des connexions de préconnexion qui n'envoient jamais de requête. server.close()
    // ne ferme que les connexions inactives qui ont déjà servi une requête : il attendait les autres
    // jusqu'à headersTimeout (60 s), d'où l'expiration au démontage de la fixture `demo` (CI ui,
    // run 42014841025). La page a fini ses requêtes quand on ferme : on coupe tout.
    close: () =>
      new Promise<void>((r) => {
        server.close(() => r());
        server.closeAllConnections();
      }),
  };
}
