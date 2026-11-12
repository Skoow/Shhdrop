import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { resolveConfig, type Rollup } from "vite";
import { demoGuard } from "../vite.config";

const srcDir = dirname(fileURLToPath(import.meta.url));
const webDir = dirname(srcDir);

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

const EXCLUDED_DIRS = new Set(["crypto", "transfer", "demo"]);

function isScanned(rel: string): boolean {
  if (!/\.(ts|svelte)$/.test(rel)) return false;
  if (/\.test\.ts$/.test(rel) || rel.endsWith(".d.ts")) return false;
  if (rel === "index.ts") return false;
  return !rel.split("/").slice(0, -1).some((d) => EXCLUDED_DIRS.has(d));
}

const files = walk(srcDir)
  .map((abs) => ({ abs, rel: relative(srcDir, abs).split(sep).join("/") }))
  .filter((f) => isScanned(f.rel))
  .map((f) => ({ ...f, text: readFileSync(f.abs, "utf8") }));

// Motifs des règles, testés sur des exemples (voir « motifs des règles ») pour ne pas dériver.
const Q = "[\"'`]"; // guillemet simple, double ou accent grave (import() en gabarit)
const NQ = "[^\"'`]";
// Attribut style dans une balise : style="…", style={…}, style=x, raccourci {style}, style nu.
// Les directives style:prop (CSSOM) et data-style ne comptent pas.
const RE_STYLE_ATTR = /<[a-zA-Z][^<>]*?(?<![-\w:.])style(?=\s*[={}/>\s])/;
const RE_FORBIDDEN_IMPORT = new RegExp(
  `(?:from\\s*|import\\s*\\(\\s*|import\\s+)${Q}${NQ}*\\/(?:transfer|crypto|engine(?!\\/pure(?:\\.[a-z]+)?${Q}))(?:\\/${NQ}*|\\.[a-z]+)?${Q}`,
);
const RE_DEMO_IMPORT = new RegExp(
  `(?:from\\s*|import\\s*\\(\\s*|import\\s+)${Q}${NQ}*\\bdemo(?:\\/${NQ}*|\\.[a-z]+)?${Q}\\s*\\)?`,
  "g",
);

const UI_DIRS = ["routes", "ui", "flows", "viewers", "media", "captcha", "app", "history"];
const inUiDir = (rel: string) => UI_DIRS.includes(rel.split("/")[0]!);

function offenders(
  re: RegExp,
  filter: (rel: string) => boolean = () => true,
): string[] {
  return files.filter((f) => filter(f.rel) && re.test(f.text)).map((f) => f.rel);
}

describe("règles de sources", () => {
  it("analyse bien des fichiers (main.ts, App.svelte)", () => {
    const rels = files.map((f) => f.rel);
    expect(rels).toContain("main.ts");
    expect(rels).toContain("App.svelte");
  });

  it("pas de {@html", () => expect(offenders(/\{@html/)).toEqual([]));
  it("pas d'attribut style (style=\"…\" ni style={…}) dans un .svelte", () =>
    expect(offenders(RE_STYLE_ATTR, (r) => r.endsWith(".svelte"))).toEqual([]));
  it("pas d'eval ni de new Function", () =>
    expect(offenders(/\beval\s*\(|new\s+Function\b/)).toEqual([]));
  // Moteur (Task 11) : les écrans n'en voient que la partie sans clé (engine/pure.ts) ; le reste
  // passe par l'interface publique (index.ts).
  it("pas d'import de transfer/, crypto/ ni engine/ (hors engine/pure) dans les écrans", () =>
    expect(offenders(RE_FORBIDDEN_IMPORT, inUiDir)).toEqual([]));
  it("pas de fetch( ni XMLHttpRequest dans les écrans", () =>
    expect(offenders(/\bfetch\s*\(|XMLHttpRequest/, inUiDir)).toEqual([]));
  it("aucun stockage navigateur (hors historique local et retours, ci-dessous)", () =>
    expect(
      offenders(/localStorage|indexedDB|document\.cookie/, (r) => r !== "history/live.svelte.ts" && r !== "history/returns.ts"),
    ).toEqual([]));
  // Spec §33, §33.1 : exception écrite, l'historique local chiffré des envois. Seul
  // history/live.svelte.ts lit `indexedDB` (pour le passer à history/store.ts, qui chiffre) ;
  // aucun localStorage ni cookie, même là ; et rien d'autre que history/ ne lit le stockage.
  it("historique : indexedDB lu seulement par history/live.svelte.ts, jamais localStorage ni cookie", () => {
    const live = files.find((f) => f.rel === "history/live.svelte.ts");
    expect(live?.text).toMatch(/indexedDB/);
    expect(live?.text).not.toMatch(/localStorage|document\.cookie|sessionStorage/);
    expect(offenders(/\bIDB(?:Factory|Database|ObjectStore|Transaction)\b/, (r) => !r.startsWith("history/"))).toEqual([]);
  });
  // D42-22 : exception écrite, l'octroi d'ouverture gardé chiffré pour revenir jusqu'à
  // l'échéance (history/returns.ts, voisin de l'historique et même mécanisme : AES-GCM, clé non
  // extractible, base IndexedDB à part). Il lit `indexedDB` lui-même (base à part, sans passer
  // par l'état des écrans de l'historique) ; jamais localStorage, sessionStorage ni cookie ;
  // l'entrée n'a que l'étiquette, l'octroi et l'échéance (jamais K_lien ni mot de passe).
  it("retours : indexedDB seulement, entrée sans K_lien ni mot de passe", () => {
    const r = files.find((f) => f.rel === "history/returns.ts")!;
    expect(r.text).toMatch(/indexedDB/);
    expect(r.text).not.toMatch(/localStorage|document\.cookie|sessionStorage/);
    const type = r.text.match(/export type ReturnEntry = \{([\s\S]*?)\n\};/)![1]!;
    expect([...type.matchAll(/^\s+(\w+):/gm)].map((m) => m[1])).toEqual(["tag", "grant", "expiresAt"]);
  });
  it("historique : aucun secret de partage ni nom d'élément dans HistoryEntry", () => {
    const store = files.find((f) => f.rel === "history/store.ts")!;
    const type = store.text.match(/export type HistoryEntry = \{([\s\S]*?)\n\};/)![1]!;
    const fields = [...type.matchAll(/^\s+(\w+):/gm)].map((m) => m[1]);
    expect(fields).toEqual(["id", "manage", "createdAt", "sizeBytes", "itemsCount", "expiresAt", "maxOpens", "opensUsed", "opens", "state", "lastSeenAt", "endedAt", "destroyedHere"]);
  });
  // Spec §41.4 : exception écrite, l'octroi d'ouverture de l'onglet (session/open-grant.ts),
  // et plus tard le salon (chat/session.ts, §39.13.3). Nulle part ailleurs.
  it("sessionStorage seulement dans session/open-grant.ts (et chat/session.ts)", () =>
    expect(offenders(/sessionStorage/, (r) => r !== "session/open-grant.ts" && r !== "chat/session.ts")).toEqual([]));
  it("pas de console.log", () => expect(offenders(/console\.log/)).toEqual([]));
  // Exception démo (UI §14.3) : le faux serveur de la démo garde son état (ce que garderait le
  // vrai serveur : empreintes, segments chiffrés) en IndexedDB, rangé par onglet (identifiant
  // en sessionStorage), pour qu'un rechargement retrouve le partage. Seulement dans
  // demo/persist.ts, jamais dans le build de production (demoGuard, check-dist).
  it("démo : stockage navigateur seulement dans demo/persist.ts", () => {
    const demoFiles = walk(join(srcDir, "demo"))
      .filter((a) => /\.(ts|svelte)$/.test(a) && !/\.test\.ts$/.test(a))
      .map((a) => ({ rel: relative(srcDir, a).split(sep).join("/"), text: readFileSync(a, "utf8") }));
    const bad = demoFiles.filter((f) => f.rel !== "demo/persist.ts" && /localStorage|indexedDB|sessionStorage|document\.cookie/.test(f.text));
    expect(bad.map((f) => f.rel)).toEqual([]);
    const p = demoFiles.find((f) => f.rel === "demo/persist.ts");
    expect(p?.text).not.toMatch(/localStorage|document\.cookie/);
  });

  // UI §20.2 S6 et §20.4 (poussière) : styles par CSSOM et WAAPI seulement, aucune lecture de
  // pixels du contenu hors des visionneuses. Ces deux règles valent pour TOUS les sources.
  const everySource = walk(srcDir)
    .map((abs) => ({ rel: relative(srcDir, abs).split(sep).join("/"), abs }))
    .filter((f) => /\.(ts|svelte)$/.test(f.rel) && !/\.test\.ts$/.test(f.rel) && !f.rel.endsWith(".d.ts"))
    .map((f) => ({ ...f, text: readFileSync(f.abs, "utf8") }));
  it("jamais setAttribute(\"style\") (CSSOM seulement, S6), dans tout src/", () =>
    expect(everySource.filter((f) => /setAttribute\s*\(\s*["'`]style["'`]/.test(f.text)).map((f) => f.rel)).toEqual([]));
  it("getImageData seulement sous viewers/ (aucune lecture des pixels du contenu)", () =>
    expect(
      everySource.filter((f) => !f.rel.startsWith("viewers/") && /getImageData/.test(f.text)).map((f) => f.rel),
    ).toEqual([]));

  // Task R2 (spec §28.3, §41.6) : l'écrivain .zip, les visionneuses et les écrans sont importés
  // statiquement ; aucun import() dynamique hors de main.ts (démo).
  it("aucun import() dynamique dans zip/, viewers/, flows/, ui/, routes/", () =>
    expect(
      everySource
        .filter((f) => /^(zip|viewers|flows|ui|routes)\//.test(f.rel) && /\bimport\s*\(/.test(f.text))
        .map((f) => f.rel),
    ).toEqual([]));

  it("demo/ importé seulement par main.ts, sous la forme import(\"./demo/install\")", () => {
    for (const f of files) {
      const found = f.text.match(RE_DEMO_IMPORT) ?? [];
      if (f.rel === "main.ts") {
        for (const m of found) expect(m).toBe('import("./demo/install")');
      } else {
        expect({ file: f.rel, found }).toEqual({ file: f.rel, found: [] });
      }
    }
  });
});

describe("marque de démo", () => {
  const MARK_RE = /__SHH_DEMO__/;
  const all = walk(srcDir)
    .map((abs) => ({ abs, rel: relative(srcDir, abs).split(sep).join("/") }))
    .filter((f) => /\.(ts|svelte)$/.test(f.rel) && !/\.test\.ts$/.test(f.rel));

  it("chaque module de src/demo/ porte la marque", () => {
    const demo = all.filter((f) => f.rel.startsWith("demo/"));
    expect(demo.length).toBeGreaterThanOrEqual(4);
    for (const f of demo) expect(readFileSync(f.abs, "utf8"), f.rel).toMatch(/const MARK = "__SHH_DEMO__"/);
  });

  it("aucun fichier hors de src/demo/ ne porte la marque (app/demo-hooks.ts compris)", () => {
    const out = all.filter((f) => !f.rel.startsWith("demo/") && MARK_RE.test(readFileSync(f.abs, "utf8"))).map((f) => f.rel);
    expect(out).toEqual([]);
  });
});

describe("motifs des règles", () => {
  const matches = (re: RegExp, text: string) => new RegExp(re.source, re.flags.replace("g", "")).test(text);

  it("style : attribut texte ou expression", () => {
    for (const t of ['<div style="color:red">', "<div style='x'>", "<div style={s}>", "<div style = {`a:${b}`}>", "<div style=`x`>", "<div style=color:red>", "<div {style}>", "<div class=\"a\" {style} id=\"b\">"])
      expect(matches(RE_STYLE_ATTR, t), t).toBe(true);
    for (const t of ["<div class:on={x}>", "<div style:color={c}>", "<style>a{}</style>", "const lifestyle = 1", "const style = { a: 1 };", "let { style } = $props();", "<div data-style=\"a\">"])
      expect(matches(RE_STYLE_ATTR, t), t).toBe(false);
  });

  it("imports interdits dans les écrans : toutes les écritures", () => {
    for (const t of [
      'import { a } from "../transfer/api"',
      "import x from '../crypto/keys'",
      'import("../transfer/api")',
      "import(`../transfer/api`)",
      'import "../crypto/boot"',
      'import { a } from "../transfer"',
      'import("../crypto")',
      "import(`../crypto`)",
      'import { a } from "../transfer.ts"',
      'import("../crypto.js")',
      "import(`../transfer/api.ts`)",
      'import { a } from "../engine"',
      'import { a } from "../engine/index"',
      'import { a } from "../engine/load.ts"',
      'import("../engine/argon2")',
      'import { a } from "../engine/pured"',
    ])
      expect(matches(RE_FORBIDDEN_IMPORT, t), t).toBe(true);
    for (const t of ['import { a } from "../engine/pure"', 'import { a } from "../engine/pure.ts"', 'import { a } from "../ui/transfer-badge"', 'import { a } from "./transferred"', 'import { a } from "node:crypto"'])
      expect(matches(RE_FORBIDDEN_IMPORT, t), t).toBe(false);
  });

  it("demo : import avec ou sans barre finale, guillemets ou gabarit", () => {
    for (const t of [
      'import("./demo/install")',
      "import(`./demo/install`)",
      'import("./demo")',
      "import('./demo')",
      "import(`./demo`)",
      'import { x } from "./demo"',
      'import "../demo/install"',
      'import("./demo.ts")',
      "import(`./demo.js`)",
      'import { x } from "./demo/install.ts"',
    ])
      expect(matches(RE_DEMO_IMPORT, t), t).toBe(true);
    for (const t of ['import { x } from "./demographie"', 'import { x } from "./ui/predemo"'])
      expect(matches(RE_DEMO_IMPORT, t), t).toBe(false);
  });

  it("demo : le motif capture l'import entier (forme exacte exigée dans main.ts)", () => {
    expect("import(`./demo`)".match(RE_DEMO_IMPORT)).toEqual(["import(`./demo`)"]);
    expect('import("./demo/install")'.match(RE_DEMO_IMPORT)).toEqual(['import("./demo/install")']);
  });
});

describe("vite.config.ts résolu", () => {
  it("assetsInlineLimit 0 et pas de polyfill modulepreload", async () => {
    const cfg = await resolveConfig(
      { configFile: join(webDir, "vite.config.ts"), root: webDir },
      "build",
    );
    expect(cfg.build.assetsInlineLimit).toBe(0);
    const mp = cfg.build.modulePreload;
    expect(mp).not.toBe(false);
    expect(typeof mp === "object" && mp.polyfill).toBe(false);
    expect(cfg.build.sourcemap).toBe(false);
  });

  it("production : base /, sortie dist, garde demoGuard, sans demoMeta", async () => {
    const cfg = await resolveConfig({ configFile: join(webDir, "vite.config.ts"), root: webDir }, "build");
    expect(cfg.base).toBe("/");
    expect(cfg.build.outDir).toBe("dist");
    const names = cfg.plugins.map((p) => p.name);
    expect(names).toContain("shh-demo-guard");
    expect(names).not.toContain("shh-demo-meta");
  });

  it("mode demo : base /shhdrop/, sortie dist-demo, demoMeta", async () => {
    const cfg = await resolveConfig({ configFile: join(webDir, "vite.config.ts"), root: webDir, mode: "demo" }, "build");
    expect(cfg.base).toBe("/shhdrop/");
    expect(cfg.build.outDir).toBe("dist-demo");
    const names = cfg.plugins.map((p) => p.name);
    expect(names).toContain("shh-demo-meta");
    expect(names).not.toContain("shh-demo-guard");
  });

  it("demoGuard fait échouer le build si un module de src/demo/ est dans un morceau", () => {
    const hook = demoGuard().generateBundle as (this: unknown, o: unknown, b: Rollup.OutputBundle) => void;
    const ctx = { error: (m: string) => { throw new Error(m); } };
    const chunk = (ids: string[]) => ({ "a.js": { type: "chunk", modules: Object.fromEntries(ids.map((i) => [i, {}])) } }) as unknown as Rollup.OutputBundle;
    expect(() => hook.call(ctx, {}, chunk(["/w/src/main.ts", "/w/src/app/demo-hooks.ts"]))).not.toThrow();
    expect(() => hook.call(ctx, {}, chunk(["/w/src/main.ts", "/w/src/demo/fake-server.ts"]))).toThrow(/code de démo/);
    expect(() => hook.call(ctx, {}, chunk(["C:\\w\\src\\demo\\install.ts"]))).toThrow(/code de démo/);
  });
});
