import { svelte } from "@sveltejs/vite-plugin-svelte";
import { execFileSync } from "node:child_process";
import { copyFileSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { brotliCompressSync, constants, gzipSync } from "node:zlib";
import { defineConfig, type Plugin } from "vite";
import { DEMO_BASE, DEMO_META } from "./scripts/demo-meta.mjs";

/**
 * Production : le build échoue si un module de src/demo/ entre dans le bundle (A41 : un faux
 * serveur qui remplace fetch serait une porte dérobée). Seconde garde : scripts/check-dist.mjs.
 */
export function demoGuard(): Plugin {
  return {
    name: "shh-demo-guard",
    apply: "build",
    generateBundle(_, bundle) {
      for (const out of Object.values(bundle)) {
        if (out.type !== "chunk") continue;
        const bad = Object.keys(out.modules).filter((id) => id.replace(/\\/g, "/").includes("/src/demo/"));
        if (bad.length > 0) this.error(`code de démo dans le build de production : ${bad.join(", ")}`);
      }
    },
  };
}

/** Démo : CSP, referrer et robots en tête de <head> ; index.html copié en 404.html (Pages). */
export function demoMeta(): Plugin {
  let outDir = "";
  return {
    name: "shh-demo-meta",
    apply: "build",
    configResolved(c) {
      outDir = join(c.root, c.build.outDir);
    },
    transformIndexHtml: {
      order: "post",
      handler: () => DEMO_META.map((attrs) => ({ tag: "meta", attrs, injectTo: "head-prepend" as const })),
    },
    // GitHub Pages n'a pas de repli monopage : une adresse profonde reçoit 404.html.
    writeBundle() {
      copyFileSync(join(outDir, "index.html"), join(outDir, "404.html"));
    },
  };
}

/**
 * Version du site affichée dans le pied de page (retours UI5) : hash court du commit, sans
 * secret. SHH_BUILD_ID (CI) sinon `git rev-parse --short=7 HEAD` ; toute autre forme → « dev ».
 * Même commit, même valeur : la construction reste reproductible (spec §28).
 */
export function buildId(): string {
  let id = process.env.SHH_BUILD_ID ?? "";
  if (id === "") {
    try {
      id = execFileSync("git", ["rev-parse", "--short=7", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    } catch {
      id = "";
    }
  }
  return /^[0-9a-f]{7,12}$/.test(id) ? id.slice(0, 7) : "dev";
}

/** Types texte précompressés (les images et polices le sont déjà) ; mêmes extensions que static.go. */
export const COMPRESSIBLE = /\.(js|css|html|svg|webmanifest|xml|txt)$/;

/**
 * Vitesse (retours CLEAN2) : à côté de chaque fichier texte de plus de 1 Kio, une variante
 * brotli (.br, qualité 11) et gzip (.gz, niveau 9, sans date : reproductible), servies par le
 * serveur Go selon Accept-Encoding. Les octets décompressés sont identiques (SRI inchangée ;
 * contrôle : scripts/check-dist.mjs). Production seulement (GitHub Pages compresse la démo).
 */
export function precompress(): Plugin {
  let outDir = "";
  return {
    name: "shh-precompress",
    apply: "build",
    configResolved(c) {
      outDir = join(c.root, c.build.outDir);
    },
    closeBundle() {
      const walk = (d: string): string[] => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)]));
      for (const f of walk(outDir)) {
        if (!COMPRESSIBLE.test(f)) continue;
        const data = readFileSync(f);
        if (data.length < 1024) continue;
        writeFileSync(f + ".br", brotliCompressSync(data, { params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: data.length } }));
        writeFileSync(f + ".gz", gzipSync(data, { level: 9 }));
      }
    },
  };
}

export default defineConfig(({ mode }) => {
  const demo = mode === "demo";
  return {
    plugins: [svelte(), ...(demo ? [demoMeta()] : [demoGuard(), precompress()])],
    base: demo ? DEMO_BASE : "/",
    define: { __SHH_BUILD__: JSON.stringify(buildId()) },
    build: {
      outDir: demo ? "dist-demo" : "dist",
      assetsInlineLimit: 0,
      modulePreload: { polyfill: false },
      sourcemap: false,
    },
  };
});
