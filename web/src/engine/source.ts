// Source du .wasm et du Worker d'Argon2id : tests et développement. Les builds remplacent ce
// module (greffon shh-engine, vite.config.ts) : source.verified.ts en production (fichier lu avec
// son empreinte SHA-384, Worker depuis un Blob), source.demo.ts dans la démo (moteur intégré au
// script). Ici : fichier lu sans empreinte (serveur de développement), ou depuis le disque sous
// Node (vitest, Playwright) ; Argon2id dans la page.
import type { StartWorker } from "./argon2";

const WASM = new URL("./pkg/shhdrop_wasm_bg.wasm", import.meta.url);

export async function wasmBytes(): Promise<ArrayBuffer> {
  try {
    if (WASM.protocol === "file:") {
      // Node seulement (jamais dans un build : ce module y est remplacé, check-dist refuse import()).
      const fs = "node:fs/promises";
      const { readFile } = (await import(/* @vite-ignore */ fs)) as typeof import("node:fs/promises");
      const b = await readFile(WASM);
      return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
    }
    const res = await fetch(WASM, { credentials: "omit", redirect: "error" });
    if (!res.ok) throw new Error("reseau");
    return await res.arrayBuffer();
  } catch {
    throw new Error("reseau");
  }
}

export const startWorker: StartWorker | undefined = undefined;
