// Construit la page du banc avec les greffons du site qui décident comment le moteur se charge
// (.wasm et Worker d'Argon2id à empreinte sous /assets/, greffon shh-engine) : le moteur tourne
// comme en production.
import { defineConfig } from "vite";
import { engineWasm } from "../vite.config.ts";

export default defineConfig({
  base: "/",
  plugins: [engineWasm("/", false)],
  build: { assetsInlineLimit: 0, modulePreload: { polyfill: false }, sourcemap: false },
});
