// Démo GitHub Pages (spec moteur §7) : sa CSP (connect-src 'none') interdit de lire un fichier ;
// le .wasm est donc intégré au script de la démo (base64, greffon shh-engine), comme libsodium
// l'était, couvert par l'empreinte de index.html. Pas de Worker depuis un Blob (la CSP de la démo
// n'a pas de worker-src blob:) : Argon2id dans la page, comme avant.
import { wasm } from "virtual:shh-engine";
import type { StartWorker } from "./argon2";

export async function wasmBytes(): Promise<ArrayBuffer> {
  const s = atob(wasm);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out.buffer;
}

export const startWorker: StartWorker | undefined = undefined;

/** Rien à précharger (Argon2id dans la page). */
export function preloadWorker(): void {}
