// Module WebAssembly du salon (engine/salon-wasm, crate shhdrop-salon-wasm), à part du moteur des
// partages (src/engine/) : chargé une seule fois, au premier besoin du salon ; aucune page de
// partage ne l'appelle. Les octets viennent de ./source, remplacé au build (greffon shh-salon,
// vite.config.ts) : production, assets/salon-EMPREINTE.wasm lu avec son empreinte SHA-384
// (source.verified.ts) ; démo, pas de salon (source.demo.ts). Tout échec de lecture est
// Error("reseau") et ne laisse aucun module : l'appel suivant recommence.
//
// Contrat (engine/salon-wasm/src/lib.rs) :
// - octets en Uint8Array ; erreurs levées avec le message snake_case du moteur
//   (`trame_corrompue`, `message_invalide`, `epoque_perdue`…), `argument_invalide` pour un
//   argument hors de son domaine (jamais tronqué) ;
// - nonces et aléa tirés dans le module (crypto.getRandomValues) : `sceller` ne prend pas de nonce ;
// - poignées `ClesSalon` et `Salon` à libérer par `free()` (efface les clés et l'état MLS) ;
// - secrets rendus (à mettre à zéro par `fill(0)` après usage) : `cleAcces().k`,
//   `ClesSalon.kPreuve()` (montrées au serveur), `Salon.exporterSframe()` (clé des appels) et les
//   graines `r` des pièces dans les enveloppes lues ;
// - textes : passer par `nettoyerTexte`, `verifierPseudo`, `cleUnicite` et `nettoyerNom` du
//   moteur (jamais une règle refaite en TypeScript) ; l'encodeur refuse un texte non nettoyé ;
// - groupe MLS : contrat de l'appelant sur les annonces du serveur et l'ordre `seq`
//   (engine/salon/src/groupe.rs, en tête).
import init, * as wasm from "./pkg/shhdrop_salon_wasm.js";
import type { Regle } from "./pkg/shhdrop_salon_wasm.js";
import { salonWasmBytes } from "./source";

export type { Annonce, EnTete, Enveloppe, Evenement, Message, Regle, SortePiece } from "./pkg/shhdrop_salon_wasm.js";
export type { ClesSalon, Salon } from "./pkg/shhdrop_salon_wasm.js";

/** Instant en millisecondes : entier sûr positif (Date.now()) ou bigint de 0 à 2^64 − 1. */
export type Instant = number | bigint;

export type EtatEffacement = { etat: "visible" } | { etat: "rebours"; finMs: number } | { etat: "efface" };

export type EntreeEffacement = {
  regle: Regle;
  envoyeMs: Instant;
  maintenantMs: Instant;
  moiExpediteur: boolean;
  /** Instant où ce lecteur l'a vu (affiché, page visible, 1 s), ou null. */
  vuParMoiMs: Instant | null;
  /** Le lecteur n'a pas quitté la conversation depuis. */
  encoreDansConversation: boolean;
  /** Tous les participants encore présents l'ont lu. */
  luParTous: boolean;
};

type Brut = Omit<typeof wasm, "default" | "initSync" | "etatEffacement">;

export type SalonEngine = Brut & {
  /**
   * État d'un message à l'écran (règles d'effacement, engine/salon/src/effacement.rs). Un instant
   * qui n'est ni un entier sûr positif ni un bigint de 0 à 2^64 − 1 : `argument_invalide`. `finMs`
   * est rendu en nombre (exact jusqu'à 2^53 − 1).
   */
  etatEffacement(e: EntreeEffacement): EtatEffacement;
};

const U64_MAX = (1n << 64n) - 1n;

function instant(x: Instant): bigint {
  if (typeof x === "bigint" && x >= 0n && x <= U64_MAX) return x;
  if (typeof x === "number" && Number.isSafeInteger(x) && x >= 0) return BigInt(x);
  throw new Error("argument_invalide");
}

function etatEffacement(e: EntreeEffacement): EtatEffacement {
  const r = wasm.etatEffacement(
    e.regle,
    instant(e.envoyeMs),
    instant(e.maintenantMs),
    e.moiExpediteur,
    e.vuParMoiMs === null ? undefined : instant(e.vuParMoiMs),
    e.encoreDansConversation,
    e.luParTous,
  );
  return r.etat === "rebours" ? { etat: "rebours", finMs: Number(r.finMs) } : r;
}

async function load(): Promise<SalonEngine> {
  const module = await WebAssembly.compile(await salonWasmBytes());
  await init({ module_or_path: module });
  const { default: _init, initSync: _sync, etatEffacement: _brut, ...exports } = wasm;
  return { ...exports, etatEffacement };
}

let loading: Promise<SalonEngine> | undefined;

/** Le module du salon, chargé une seule fois ; un échec (réseau) laisse réessayer au besoin suivant. */
export function loadSalonEngine(): Promise<SalonEngine> {
  if (!loading) {
    loading = load();
    loading.catch(() => (loading = undefined));
  }
  return loading;
}
