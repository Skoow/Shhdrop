// Build de la page d'essai du moteur (ui-e2e/engine-page/main.ts) avec les greffons du site :
// production (`vite build -c …`, dist/, servie par le serveur Go) ou démo (`--mode demo`,
// dist-demo/, CSP meta de la démo, servie comme par GitHub Pages). Jamais livrée.
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { DEMO_BASE } from "../../scripts/demo-meta.mjs";
import { demoMeta, engineWasm, sri } from "../../vite.config";

export default defineConfig(({ mode }) => {
  const demo = mode === "demo";
  const base = demo ? DEMO_BASE : "/";
  return {
    root: fileURLToPath(new URL(".", import.meta.url)),
    plugins: [sri(base), engineWasm(base, demo), ...(demo ? [demoMeta()] : [])],
    base,
    build: { outDir: demo ? "dist-demo" : "dist", emptyOutDir: true, assetsInlineLimit: 0, modulePreload: { polyfill: false }, sourcemap: false },
  };
});
