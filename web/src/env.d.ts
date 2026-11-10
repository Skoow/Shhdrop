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
