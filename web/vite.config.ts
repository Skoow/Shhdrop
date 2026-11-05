import { svelte } from "@sveltejs/vite-plugin-svelte";
import { copyFileSync } from "node:fs";
import { join } from "node:path";
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

export default defineConfig(({ mode }) => {
  const demo = mode === "demo";
  return {
    plugins: [svelte(), demo ? demoMeta() : demoGuard()],
    base: demo ? DEMO_BASE : "/",
    build: {
      outDir: demo ? "dist-demo" : "dist",
      assetsInlineLimit: 0,
      modulePreload: { polyfill: false },
      sourcemap: false,
    },
  };
});
