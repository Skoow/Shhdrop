// Construit la page du banc avec les greffons du site qui décident comment le moteur se charge
// (Argon2 dans son Worker, fichier à empreinte sous /assets/) : le moteur tourne comme en production.
import { defineConfig } from "vite";
import { argon2Chunk } from "../vite.config.ts";

export default defineConfig({
  base: "/",
  plugins: [argon2Chunk("/")],
  build: { assetsInlineLimit: 0, modulePreload: { polyfill: false }, sourcemap: false },
});
