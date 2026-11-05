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
  it("pas d'attribut style=\" dans un .svelte", () =>
    expect(offenders(/\bstyle\s*=\s*["']/, (r) => r.endsWith(".svelte"))).toEqual([]));
  it("pas d'eval ni de new Function", () =>
    expect(offenders(/\beval\s*\(|new\s+Function\b/)).toEqual([]));
  it("pas d'import de transfer/ ni crypto/ dans les écrans", () =>
    expect(
      offenders(/(?:from\s*|import\s*\(\s*|import\s+)["'][^"']*\/(?:transfer|crypto)\//, inUiDir),
    ).toEqual([]));
  it("pas de fetch( ni XMLHttpRequest dans les écrans", () =>
    expect(offenders(/\bfetch\s*\(|XMLHttpRequest/, inUiDir)).toEqual([]));
  it("aucun stockage navigateur", () =>
    expect(
      offenders(/localStorage|sessionStorage|indexedDB|document\.cookie/),
    ).toEqual([]));
  it("pas de console.log", () => expect(offenders(/console\.log/)).toEqual([]));

  it("demo/ importé seulement par main.ts, sous la forme import(\"./demo/install\")", () => {
    const re = /(?:from\s*|import\s*\(\s*|import\s+)["'][^"']*\bdemo\/[^"']*["']\s*\)?/g;
    for (const f of files) {
      const found = f.text.match(re) ?? [];
      if (f.rel === "main.ts") {
        for (const m of found) expect(m).toBe('import("./demo/install")');
      } else {
        expect({ file: f.rel, found }).toEqual({ file: f.rel, found: [] });
      }
    }
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
