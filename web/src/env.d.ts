/// <reference types="vite/client" />

declare module "*.svelte" {
  import type { Component } from "svelte";
  const component: Component<any>;
  export default component;
}

/** Version du site (hash court du commit, vite.config.ts) ; absente sous vitest. */
declare const __SHH_BUILD__: string | undefined;

// Cadre PDF isolé : le worker de pdf.js, chargé sur le fil principal (UI §13).
declare module "pdfjs-dist/build/pdf.worker.mjs" {
  export const WorkerMessageHandler: unknown;
}

// Moteur WebAssembly (greffon shh-engine, vite.config.ts). Production : adresses et empreintes
// SRI du .wasm et du script du Worker d'Argon2id. Démo : le .wasm en base64 (`wasm`).
declare module "virtual:shh-engine" {
  export const src: string;
  export const integrity: string;
  export const workerSrc: string;
  export const workerIntegrity: string;
  export const wasm: string;
}

// Module WebAssembly du salon (greffon shh-salon, vite.config.ts), production seulement : adresse
// et empreinte SRI de assets/salon-EMPREINTE.wasm.
declare module "virtual:shh-salon" {
  export const src: string;
  export const integrity: string;
}
