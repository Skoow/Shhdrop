// Nom affiché : Shhgone (décision du propriétaire, 12 novembre ; spec D42-24, UI P9). Tout ce qu'un
// visiteur voit porte ce nom ; l'interne (dépôt, paquets, bases locales, étiquettes HKDF,
// en-têtes X-Shh-*, base /shhdrop/ de la démo) garde « shhdrop » pour ne rien casser.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { en } from "./i18n/en";
import { fr } from "./i18n/fr";

const srcDir = dirname(fileURLToPath(import.meta.url));
const webDir = dirname(srcDir);
const read = (rel: string) => readFileSync(join(webDir, rel), "utf8");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

/** Sans commentaires (JS, CSS, HTML) : seul reste ce qui peut s'afficher. */
const code = (s: string) =>
  s
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("nom affiché : Shhgone", () => {
  it("textes FR et EN : jamais l'ancien nom, le nouveau là où le nom paraît", () => {
    for (const [lang, dict] of [["fr", fr], ["en", en]] as const) {
      for (const [k, v] of Object.entries(dict)) expect(String(v), `${lang} ${k}`).not.toMatch(/shhdrop/i);
      expect(dict["shell.home"], lang).toMatch(/^Shhgone, /);
      expect(dict["paid.title"], lang).toBe("Shhgone {tier}");
    }
  });

  it("index.html : titre, nom d'app iOS et texte sans JavaScript", () => {
    const html = code(read("index.html"));
    expect(html).toMatch(/<title>[^<]* · Shhgone<\/title>/);
    expect(html).toContain('<meta name="apple-mobile-web-app-title" content="Shhgone" />');
    expect(html).toContain("<h1>Shhgone : ");
    expect(html).not.toMatch(/shhdrop/i);
  });

  it("manifeste : nom et nom court", () => {
    const m = JSON.parse(read("public/manifest.webmanifest")) as { name: string; short_name: string };
    expect([m.name, m.short_name]).toEqual(["Shhgone", "Shhgone"]);
  });

  it("logo, robots et plan du site : nouveau nom, domaine shhgone.com", () => {
    expect(read("public/logo.svg")).toContain('aria-label="Shhgone"');
    expect(read("public/robots.txt")).toContain("Sitemap: https://shhgone.com/sitemap.xml");
    const map = read("public/sitemap.xml");
    expect(map).toContain("<loc>https://shhgone.com/</loc>");
    for (const f of ["public/logo.svg", "public/robots.txt", "public/sitemap.xml", "public/favicon.svg"])
      expect(read(f), f).not.toMatch(/shhdrop/i);
  });

  it("composants et pages : l'ancien nom n'est plus écrit hors commentaires (seules les adresses du dépôt gardent « shhdrop »)", () => {
    const files = walk(srcDir).filter((p) => /\.(svelte|ts)$/.test(p) && !/\.test\.ts$|\.d\.ts$|[/\\]pkg[/\\]/.test(p));
    for (const abs of files) {
      const rel = relative(srcDir, abs).split(sep).join("/");
      const text = code(readFileSync(abs, "utf8")).replace(/https:\/\/github\.com\/Skoow\/shhdrop[^"'`\s]*/g, "");
      expect(text, rel).not.toMatch(/Shhdrop/);
      expect(text, rel).not.toContain("shhdrop.zip");
    }
  });
});
