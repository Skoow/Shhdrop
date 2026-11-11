// « Aucune statistique » côté navigateur (spec §35.1, Task M2), bloquant : la liste de §35.1,
// sans tenir compte de la casse, dans web/src, web/scripts, web/*.html et les noms de paquets
// de package-lock.json ; aucun écouteur global d'erreurs (liste blanche vide). Le même
// contrôle tourne sur dist/, dist-verif/ et dist-demo/ (scripts/check-dist.mjs).
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ANALYTICS, findAnalytics, findErrorListeners } from "../scripts/no-analytics.mjs";

const WEB = fileURLToPath(new URL("..", import.meta.url));
const BINARY = /\.(woff2?|png|jpe?g|gif|ico|webp|avif|mp3|mp4|wasm)$/i;

/** Seuls fichiers qui contiennent ces mots : la liste elle-même et les tests (non livrés). */
const SKIP = new Set(["scripts/no-analytics.mjs", "scripts/no-analytics.d.mts"]);
/** Mots de la liste qui sont aussi des mots courants, dans un fichier donné. */
const WORDS_OK: Record<string, string[]> = {};

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? (e.name === "node_modules" ? [] : walk(join(dir, e.name))) : [join(dir, e.name)],
  );
}

const sources = () =>
  [...walk(join(WEB, "src")), ...walk(join(WEB, "scripts")), ...readdirSync(WEB).filter((n) => n.endsWith(".html")).map((n) => join(WEB, n))]
    .map((p) => relative(WEB, p).replaceAll("\\", "/"))
    .filter((r) => !BINARY.test(r) && !SKIP.has(r) && !/\.test\.ts$/.test(r));

describe("aucune statistique (spec §35.1)", () => {
  it("la recherche trouve un fichier piégé (gtag( dans une chaîne), casse comprise", () => {
    expect(findAnalytics('const s = "x GTAG( y";')).toEqual(["gtag("]);
    expect(findAnalytics("navigator.sendBeacon(u)")).toEqual(["sendbeacon"]);
    expect(findAnalytics(".scrollbar { }")).toEqual([]);
    expect(findErrorListeners('window.addEventListener("unhandledrejection", f)')).toHaveLength(1);
    expect(findErrorListeners("self.onerror = report")).toHaveLength(1);
    expect(findErrorListeners("img.onerror = () => 0")).toEqual([]);
    expect(ANALYTICS.length).toBe(37);
  });

  it("web/src, web/scripts et web/*.html : aucun mot de la liste", () => {
    const files = sources();
    expect(files.length).toBeGreaterThan(50);
    const hits = files.flatMap((r) => {
      const ok = WORDS_OK[r] ?? [];
      return findAnalytics(readFileSync(join(WEB, r), "utf8"))
        .filter((w) => !ok.includes(w))
        .map((w) => `${r} : ${w}`);
    });
    expect(hits).toEqual([]);
  });

  it("package-lock.json : aucun paquet de la liste", () => {
    const lock = JSON.parse(readFileSync(join(WEB, "package-lock.json"), "utf8")) as { packages: Record<string, unknown> };
    const names = Object.keys(lock.packages);
    expect(names.length).toBeGreaterThan(10);
    expect(names.flatMap((n) => findAnalytics(n).map((w) => `${n} : ${w}`))).toEqual([]);
  });

  it("aucun écouteur global error ni unhandledrejection (liste blanche vide)", () => {
    const hits = sources().flatMap((r) => findErrorListeners(readFileSync(join(WEB, r), "utf8")).map((m) => `${r} : ${m}`));
    expect(hits).toEqual([]);
  });
});
