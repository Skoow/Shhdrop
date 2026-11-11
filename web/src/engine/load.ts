// Chargement du moteur WebAssembly (spec moteur §7), une seule fois, au premier besoin : la page
// d'accueil n'en a pas besoin. Le .wasm est compilé une fois (WebAssembly.Module) : la page
// l'instancie ici, et chaque calcul d'Argon2id l'instancie dans un Worker neuf (argon2.ts).
//
// Task 10 : `wasmBytes` lira le fichier par fetch(src, { integrity, credentials: "omit",
// redirect: "error" }) avec l'adresse et l'empreinte SHA-384 du module virtuel shh-engine ; la
// démo l'aura dans son script. Rien d'autre ne change ici.
import init, * as wasm from "./pkg/shhdrop_wasm.js";
import wasmUrl from "./pkg/shhdrop_wasm_bg.wasm?url";
import { createProvider, type WebCryptoProvider } from "./provider";

/** Fonctions et classes du moteur (engine/wasm/src/lib.rs). */
export type Wasm = Omit<typeof wasm, "default" | "initSync">;

export type Engine = {
  wasm: Wasm;
  /** Fournisseur WebCrypto de la page (une table de clés pour tout le site). */
  provider: WebCryptoProvider;
  /** Module compilé, pour les Workers d'Argon2id. */
  module: WebAssembly.Module;
};

async function wasmBytes(): Promise<ArrayBuffer> {
  let res: Response;
  try {
    res = await fetch(wasmUrl, { credentials: "omit", redirect: "error" });
  } catch {
    throw new Error("reseau");
  }
  if (!res.ok) throw new Error("reseau");
  return res.arrayBuffer();
}

async function load(): Promise<Engine> {
  const module = await WebAssembly.compile(await wasmBytes());
  await init({ module_or_path: module });
  const { default: _init, initSync: _sync, ...exports } = wasm;
  return { wasm: exports, provider: createProvider(), module };
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
