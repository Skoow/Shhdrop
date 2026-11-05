import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { resolveConfig } from "vite";

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
const RE_STYLE_ATTR = /\bstyle\s*=\s*["'`{]/;
const RE_FORBIDDEN_IMPORT = new RegExp(
  `(?:from\\s*|import\\s*\\(\\s*|import\\s+)${Q}${NQ}*\\/(?:transfer|crypto)(?:\\/${NQ}*)?${Q}`,
);
const RE_DEMO_IMPORT = new RegExp(
  `(?:from\\s*|import\\s*\\(\\s*|import\\s+)${Q}${NQ}*\\bdemo(?:\\/${NQ}*)?${Q}\\s*\\)?`,
  "g",
);

const UI_DIRS = ["routes", "ui", "flows", "viewers", "media", "captcha", "app"];
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
  it("pas d'import de transfer/ ni crypto/ dans les écrans", () =>
    expect(offenders(RE_FORBIDDEN_IMPORT, inUiDir)).toEqual([]));
  it("pas de fetch( ni XMLHttpRequest dans les écrans", () =>
    expect(offenders(/\bfetch\s*\(|XMLHttpRequest/, inUiDir)).toEqual([]));
  it("aucun stockage navigateur", () =>
    expect(
      offenders(/localStorage|sessionStorage|indexedDB|document\.cookie/),
    ).toEqual([]));
  it("pas de console.log", () => expect(offenders(/console\.log/)).toEqual([]));

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

describe("motifs des règles", () => {
  const matches = (re: RegExp, text: string) => new RegExp(re.source, re.flags.replace("g", "")).test(text);

  it("style : attribut texte ou expression", () => {
    for (const t of ['<div style="color:red">', "<div style='x'>", "<div style={s}>", "<div style = {`a:${b}`}>", "<div style=`x`>"])
      expect(matches(RE_STYLE_ATTR, t), t).toBe(true);
    for (const t of ["<div class:on={x}>", "<div style:color={c}>", "<style>a{}</style>", "const lifestyle = 1"])
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
    ])
      expect(matches(RE_FORBIDDEN_IMPORT, t), t).toBe(true);
    for (const t of ['import { a } from "../ui/transfer-badge"', 'import { a } from "./transferred"', 'import { a } from "node:crypto"'])
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
});
