/// <reference types="vite/client" />

declare module "*.svelte" {
  import type { Component } from "svelte";
  const component: Component<any>;
  export default component;
}

/** Version du site (hash court du commit, vite.config.ts) ; absente sous vitest. */
declare const __SHH_BUILD__: string | undefined;
