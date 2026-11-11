// Build de la page d'essai du salon (ui-e2e/salon-page/main.ts) avec les greffons du site, en
// production (`vite build -c …`, dist/, servie par le serveur Go, précompressée comme le site).
// Jamais livrée ; global-setup.ts la construit puis la passe à check-dist comme le site.
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { precompress, salonWasm, sri } from "../../vite.config";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [sri("/"), salonWasm("/", false), precompress()],
  base: "/",
  build: { outDir: "dist", emptyOutDir: true, assetsInlineLimit: 0, modulePreload: { polyfill: false }, sourcemap: false },
});
