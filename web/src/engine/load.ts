// Chargement du moteur WebAssembly (spec moteur §7), une seule fois, au premier besoin : la page
// d'accueil n'en a pas besoin. Les octets viennent de ./source, remplacé au build (greffon
// shh-engine, vite.config.ts) : production, fichier lu avec son empreinte SHA-384
// (source.verified.ts) ; démo, intégré au script (source.demo.ts). Tout échec de lecture est
// Error("reseau") et ne laisse aucun moteur : l'appel suivant recommence. Le .wasm est compilé
// une fois (WebAssembly.Module) : la page l'instancie ici, et chaque calcul d'Argon2id
// l'instancie dans un Worker neuf (argon2.ts, `start`).
import init, * as wasm from "./pkg/shhdrop_wasm.js";
import type { StartWorker } from "./argon2";
import { createProvider, type WebCryptoProvider } from "./provider";
import { startWorker, wasmBytes } from "./source";

/** Fonctions et classes du moteur (engine/wasm/src/lib.rs). */
export type Wasm = Omit<typeof wasm, "default" | "initSync">;

export type Engine = {
  wasm: Wasm;
  /** Fournisseur WebCrypto de la page (une table de clés pour tout le site). */
  provider: WebCryptoProvider;
  /** Module compilé, pour les Workers d'Argon2id. */
  module: WebAssembly.Module;
  /** Crée le Worker d'Argon2id (production) ; absent : calcul dans la page (démo, tests). */
  start?: StartWorker;
};

async function load(): Promise<Engine> {
  const module = await WebAssembly.compile(await wasmBytes());
  await init({ module_or_path: module });
  const { default: _init, initSync: _sync, ...exports } = wasm;
  return { wasm: exports, provider: createProvider(), module, start: startWorker };
}

/**
 * Instance neuve du même module, après une panique (index.ts) : les objets de l'ancienne
 * instance deviennent inutilisables (la colle les refuse), et un fournisseur neuf remplace
 * l'ancien (ses clés ne servent plus à rien).
 */
export function resetEngine(e: Engine): void {
  // Audit F4 : les secrets que l'instance arrêtée tenait (graines, clés, clairs en cours) ne
  // restent pas dans sa mémoire jusqu'au ramasse-miettes : elle est mise à zéro avant d'être
  // remplacée. Aucun appel n'y entre plus (index.ts : `broken`, objets périmés refusés).
  new Uint8Array(engineMemory(e).buffer).fill(0);
  e.wasm.__wbg_reset_state();
  e.provider = createProvider();
}

/** Mémoire de l'instance en cours (initSync rend l'instance déjà faite, sans en créer). */
export function engineMemory(e: Engine): WebAssembly.Memory {
  return wasm.initSync({ module: e.module }).memory;
}

let loading: Promise<Engine> | undefined;

/** Le moteur, chargé une seule fois ; un échec (réseau) laisse réessayer au besoin suivant. */
export function loadEngine(): Promise<Engine> {
  if (!loading) {
    loading = load();
    loading.catch(() => (loading = undefined));
  }
  return loading;
}
