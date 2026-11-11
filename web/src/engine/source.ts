// Source du .wasm et du Worker d'Argon2id : tests et développement. Les builds remplacent ce
// module (greffon shh-engine, vite.config.ts) : source.verified.ts en production (fichier lu avec
// son empreinte SHA-384, Worker depuis un Blob), source.demo.ts dans la démo (moteur intégré au
// script). Ici : fichier lu sans empreinte, Argon2id dans la page.
import wasmUrl from "./pkg/shhdrop_wasm_bg.wasm?url";
import type { StartWorker } from "./argon2";

export async function wasmBytes(): Promise<ArrayBuffer> {
  let res: Response;
  try {
    res = await fetch(wasmUrl, { credentials: "omit", redirect: "error" });
    if (!res.ok) throw new Error("reseau");
    return await res.arrayBuffer();
  } catch {
    throw new Error("reseau");
  }
}

export const startWorker: StartWorker | undefined = undefined;
