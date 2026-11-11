// Module WebAssembly du salon (engine/salon-wasm, crate shhdrop-salon-wasm), à part du moteur des
// partages (src/engine/) : chargé une seule fois, au premier besoin du salon ; aucune page de
// partage ne l'appelle. Les octets viennent de ./source, remplacé au build (greffon shh-salon,
// vite.config.ts) : production, assets/salon-EMPREINTE.wasm lu avec son empreinte SHA-384
// (source.verified.ts) ; démo, pas de salon (source.demo.ts). Tout échec de lecture est
// Error("reseau") et ne laisse aucun module : l'appel suivant recommence.
//
// Contrat (engine/salon-wasm/src/lib.rs) :
// - octets en Uint8Array ; erreurs levées avec un message snake_case : celui du moteur
//   (`trame_corrompue`, `message_invalide`, `epoque_perdue`…), `argument_invalide` pour un
//   argument hors de son domaine ou de mauvais type (vérifié ici avant d'entrer dans le module),
//   `poignee_liberee` pour une poignée déjà libérée, `appel_concurrent` pour un appel sur une
//   poignée en cours d'usage, `salon_casse` après une panique (ci-dessous) ;
// - nonces et aléa tirés dans le module (crypto.getRandomValues) : `sceller` ne prend pas de nonce ;
// - poignées `ClesSalon` et `Salon` à libérer par `free()` (efface les clés et l'état MLS) ;
// - secrets rendus (à mettre à zéro par `fill(0)` après usage) : `cleAcces().k`,
//   `ClesSalon.kPreuve()` (montrées au serveur), `Salon.exporterSframe()` (clé des appels) et les
//   graines `r` des pièces dans les enveloppes lues ;
// - textes : passer par `nettoyerTexte`, `verifierPseudo`, `cleUnicite` et `nettoyerNom` du
//   moteur (jamais une règle refaite en TypeScript) ; l'encodeur refuse un texte non nettoyé ;
// - groupe MLS : contrat de l'appelant sur les annonces du serveur et l'ordre `seq`
//   (engine/salon/src/groupe.rs, en tête).
//
// Panique (un bogue : aucune entrée ne doit en provoquer ; comme le moteur des partages, audit
// F4) : sur wasm32, elle arrête l'instance (`WebAssembly.RuntimeError`) sans exécuter aucun
// `Drop` : les clés, l'état MLS et les clés privées resteraient dans la mémoire du module, et les
// autres poignées continueraient sur une instance à moitié modifiée. Ici : le module est marqué
// cassé, sa mémoire est mise à zéro aussitôt, et tout appel suivant (ce moteur, ses poignées)
// lève `salon_casse`. Tous les appels sont synchrones : aucune opération n'est en attente. Un
// nouvel appel de `loadSalonEngine()` rend un moteur neuf (instance neuve du même module,
// `__wbg_reset_state`) : le salon doit être rejoint de nouveau (nouvelle identité).
import init, * as wasm from "./pkg/shhdrop_salon_wasm.js";
import type { Annonce, EnTete, Enveloppe, Evenement, Message, Regle } from "./pkg/shhdrop_salon_wasm.js";
import { salonWasmBytes } from "./source";

export type { Annonce, EnTete, Enveloppe, Evenement, Message, Regle, SortePiece } from "./pkg/shhdrop_salon_wasm.js";

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

// --- Erreurs, panique ---------------------------------------------------------------------------

const err = (m: string) => new Error(m);
const CASSE = "salon_casse";

/** Génération de l'instance : +1 à chaque instance neuve (après une panique). */
let gen = 0;
let broken = false;
let module: WebAssembly.Module | undefined;

/** Mémoire de l'instance en cours (initSync rend l'instance déjà faite, sans en créer). */
function memory(): WebAssembly.Memory {
  return wasm.initSync({ module: module! }).memory;
}

/**
 * Gestionnaire de panique du module (appelé dans le module, juste avant l'arrêt) : marque le
 * module cassé, sans toucher à sa mémoire tant que le code Rust de la panique tourne encore.
 */
function panique(): void {
  broken = true;
}

/** Instance arrêtée : module cassé, mémoire mise à zéro (clés, état MLS, clés privées). */
function casser(): void {
  broken = true;
  try {
    new Uint8Array(memory().buffer).fill(0);
  } catch {
    // Pas d'instance : rien à effacer.
  }
}

/** Erreurs de la colle de wasm-bindgen (mauvais usage d'une poignée) → codes snake_case. */
function traduire(x: unknown): unknown {
  if (x instanceof WebAssembly.RuntimeError) {
    casser();
    return err(CASSE);
  }
  if (!(x instanceof Error)) return x;
  const m = x.message;
  if (m === "null pointer passed to rust") return err("poignee_liberee");
  if (m.startsWith("recursive use of an object") || m.startsWith("attempted to take ownership of Rust value while it was borrowed")) return err("appel_concurrent");
  if (m.startsWith("Invalid stale object")) return err(CASSE);
  return x;
}

/** Appel dans le module, refusé s'il est cassé ou si `g` est une génération passée. */
function appel<T>(g: number, f: () => T): T {
  if (broken || g !== gen) throw err(CASSE);
  try {
    return f();
  } catch (x) {
    throw traduire(x);
  }
}

// --- Contrôle des arguments ---------------------------------------------------------------------

function octets(x: unknown): Uint8Array {
  if (!(x instanceof Uint8Array)) throw err("argument_invalide");
  return x;
}

function texte(x: unknown): string {
  if (typeof x !== "string") throw err("argument_invalide");
  return x;
}

function nombre(x: unknown): number {
  if (typeof x !== "number") throw err("argument_invalide");
  return x;
}

function booleen(x: unknown): boolean {
  if (typeof x !== "boolean") throw err("argument_invalide");
  return x;
}

function objet<T>(x: T): T {
  if (typeof x !== "object" || x === null) throw err("argument_invalide");
  return x;
}

const U64_MAX = (1n << 64n) - 1n;

function instant(x: unknown): bigint {
  if (typeof x === "bigint" && x >= 0n && x <= U64_MAX) return x;
  if (typeof x === "number" && Number.isSafeInteger(x) && x >= 0) return BigInt(x);
  throw err("argument_invalide");
}

// --- Poignées -----------------------------------------------------------------------------------

/** Poignée du module : libérée une fois ; après une panique, `free` ne touche plus au module. */
class Poignee<H extends { free(): void }> {
  #h: H | undefined;
  readonly #g: number;
  constructor(h: H, g: number) {
    this.#h = h;
    this.#g = g;
  }
  /** Appel avec la poignée brute. */
  protected avec<T>(f: (h: H) => T): T {
    return appel(this.#g, () => {
      if (!this.#h) throw err("poignee_liberee");
      return f(this.#h);
    });
  }
  /** Libère la poignée (efface ses secrets) ; sans effet la seconde fois. */
  free(): void {
    const h = this.#h;
    this.#h = undefined;
    if (h && !broken && this.#g === gen) appel(this.#g, () => h.free());
  }
}

/** Clés d'un salon (`K_trame`, étiquette, `K_preuve_s`), dans le module. */
export class ClesSalon extends Poignee<wasm.ClesSalon> {
  /** `K_preuve_s` (32 octets), montrée au serveur pour détruire le salon ; copie à effacer. */
  kPreuve(): Uint8Array {
    return this.avec((h) => h.kPreuve());
  }
  /** `V_preuve_s` = SHA-256(`K_preuve_s`), donnée au serveur à la création. */
  vPreuve(): Uint8Array {
    return this.avec((h) => h.vPreuve());
  }
  /** Identifiant public du salon (16 octets). */
  tag(): Uint8Array {
    return this.avec((h) => h.tag());
  }
  /** Interne : la poignée brute, pour un appel déjà gardé. */
  brut<T>(f: (h: wasm.ClesSalon) => T): T {
    return this.avec(f);
  }
}

function cles(x: unknown): ClesSalon {
  if (!(x instanceof ClesSalon)) throw err("argument_invalide");
  return x;
}

/** Un participant du salon et son état MLS (engine/salon/src/groupe.rs). */
export class Salon extends Poignee<wasm.Salon> {
  keyPackage(): Uint8Array {
    return this.avec((h) => h.keyPackage());
  }
  rejoindre(welcome: Uint8Array): void {
    octets(welcome);
    this.avec((h) => h.rejoindre(welcome));
  }
  /** Commit d'ajout (le Welcome vient à l'écho gagnant, `commitAccepte`). */
  ajouter(keyPackage: Uint8Array): Uint8Array {
    octets(keyPackage);
    return this.avec((h) => h.ajouter(keyPackage));
  }
  retirer(siege: number): Uint8Array {
    nombre(siege);
    return this.avec((h) => h.retirer(siege));
  }
  renouveler(): Uint8Array {
    return this.avec((h) => h.renouveler());
  }
  /** Message MLS d'une enveloppe, à sceller dans une trame. */
  chiffrer(e: Enveloppe): Uint8Array {
    objet(e);
    return this.avec((h) => h.chiffrer(e));
  }
  /** Message MLS rangé au rang `seq`, envoyé par `siegeEmetteur` (attesté par le serveur). */
  recevoir(mls: Uint8Array, seq: number, siegeEmetteur: number): Evenement {
    octets(mls);
    nombre(seq);
    nombre(siegeEmetteur);
    return this.avec((h) => h.recevoir(mls, seq, siegeEmetteur));
  }
  /** Arrivée (0x02) ou reprise (0x0A) annoncée par le serveur. */
  annoncer(siege: number, nonceArrivee: Uint8Array): void {
    nombre(siege);
    octets(nonceArrivee);
    this.avec((h) => h.annoncer(siege, nonceArrivee));
  }
  /** Liste complète des sièges occupés, donnée à l'accueil du WebSocket. */
  remplacerAnnonces(createurSiege: number, liste: Annonce[]): void {
    nombre(createurSiege);
    if (!Array.isArray(liste)) throw err("argument_invalide");
    for (const a of liste) {
      objet(a);
      nombre(a.siege);
      octets(a.nonce);
    }
    this.avec((h) => h.remplacerAnnonces(createurSiege, liste));
  }
  /** Siège annoncé parti (0x03) ou exclu (0x09). */
  marquerParti(siege: number): void {
    nombre(siege);
    this.avec((h) => h.marquerParti(siege));
  }
  abandonnerCommit(): void {
    this.avec((h) => h.abandonnerCommit());
  }
  /** Clé SFrame de l'époque (32 octets) : SECRET, copie que l'appelant met à zéro après usage. */
  exporterSframe(): Uint8Array {
    return this.avec((h) => h.exporterSframe());
  }
  /** Code de vérification du siège (4 groupes de 5 chiffres). */
  empreinte(siege: number): string {
    nombre(siege);
    return this.avec((h) => h.empreinte(siege));
  }
  /** Sièges des membres, en ordre croissant (vide hors du groupe). */
  membres(): number[] {
    return this.avec((h) => h.membres());
  }
  /** Époque MLS (`undefined` hors du groupe). */
  epoque(): number | undefined {
    return this.avec((h) => h.epoque());
  }
}

// --- Moteur -------------------------------------------------------------------------------------

export type SalonEngine = {
  /** Tailles du format (mêmes noms que engine/vectors/salon-v3.json). */
  constantes(): { TAILLE_TRAME: number; TAILLE_O: number; MAX_CHARGE: number; JSON_MAX: number };
  /** `K_accès_s` (montrée au serveur) et `V_accès_s` : copies que l'appelant efface. */
  cleAcces(kLien: Uint8Array): { k: Uint8Array; v: Uint8Array };
  clesSalon(kLien: Uint8Array, kMdp: Uint8Array): ClesSalon;
  /** Trame de 4 140 octets ; nonce tiré dans le module. */
  sceller(cles: ClesSalon, enTete: EnTete, charge: Uint8Array): Uint8Array;
  /** Tout échec : `trame_corrompue`. */
  ouvrir(cles: ClesSalon, trame: Uint8Array): EnTete & { charge: Uint8Array };
  lireEnTete(trame: Uint8Array): EnTete;
  encoder(e: Enveloppe): Uint8Array;
  decoder(octets: Uint8Array): Enveloppe;
  estVolatile(m: Message): boolean;
  nettoyerTexte(s: string): string;
  nettoyerNom(s: string): string;
  verifierPseudo(s: string): string;
  cleUnicite(s: string): string;
  codeVerification(clePublique: Uint8Array): string;
  /**
   * État d'un message à l'écran (engine/salon/src/effacement.rs). Un instant qui n'est ni un
   * entier sûr positif ni un bigint de 0 à 2^64 − 1 : `argument_invalide`. `finMs` est rendu en
   * nombre (exact jusqu'à 2^53 − 1).
   */
  etatEffacement(e: EntreeEffacement): EtatEffacement;
  Salon: {
    /** Nouveau participant au siège donné par le serveur, avec une identité éphémère neuve. */
    creer(siege: number, nonceArrivee: Uint8Array, cles: ClesSalon, createur: boolean): Salon;
  };
};

function moteur(g: number): SalonEngine {
  const a = <T>(f: () => T) => appel(g, f);
  return {
    constantes: () => a(() => wasm.constantes()),
    cleAcces: (kLien) => (octets(kLien), a(() => wasm.cleAcces(kLien))),
    clesSalon: (kLien, kMdp) => {
      octets(kLien);
      octets(kMdp);
      return new ClesSalon(
        a(() => wasm.clesSalon(kLien, kMdp)),
        g,
      );
    },
    sceller: (c, enTete, charge) => {
      objet(enTete);
      octets(charge);
      return cles(c).brut((h) => wasm.sceller(h, enTete, charge));
    },
    ouvrir: (c, trame) => (octets(trame), cles(c).brut((h) => wasm.ouvrir(h, trame))),
    lireEnTete: (trame) => (octets(trame), a(() => wasm.lireEnTete(trame))),
    encoder: (e) => (objet(e), a(() => wasm.encoder(e))),
    decoder: (b) => (octets(b), a(() => wasm.decoder(b))),
    estVolatile: (m) => (objet(m), a(() => wasm.estVolatile(m))),
    nettoyerTexte: (s) => (texte(s), a(() => wasm.nettoyerTexte(s))),
    nettoyerNom: (s) => (texte(s), a(() => wasm.nettoyerNom(s))),
    verifierPseudo: (s) => (texte(s), a(() => wasm.verifierPseudo(s))),
    cleUnicite: (s) => (texte(s), a(() => wasm.cleUnicite(s))),
    codeVerification: (c) => (octets(c), a(() => wasm.codeVerification(c))),
    etatEffacement: (e) => {
      objet(e);
      const regle = nombre(e.regle);
      const args = [instant(e.envoyeMs), instant(e.maintenantMs), booleen(e.moiExpediteur), e.vuParMoiMs === null ? undefined : instant(e.vuParMoiMs), booleen(e.encoreDansConversation), booleen(e.luParTous)] as const;
      const r = a(() => wasm.etatEffacement(regle, ...args));
      return r.etat === "rebours" ? { etat: "rebours", finMs: Number(r.finMs) } : r;
    },
    Salon: {
      creer: (siege, nonceArrivee, c, createur) => {
        nombre(siege);
        octets(nonceArrivee);
        booleen(createur);
        return new Salon(
          cles(c).brut((h) => wasm.Salon.creer(siege, nonceArrivee, h, createur)),
          g,
        );
      },
    },
  };
}

/** Le moteur courant (une génération) ; refait après une panique. */
let courant: { g: number; m: SalonEngine } | undefined;

async function load(): Promise<void> {
  const m = await WebAssembly.compile(await salonWasmBytes());
  await init({ module_or_path: m });
  module = m;
  wasm.setPanicHandler(panique);
}

let loading: Promise<void> | undefined;

/**
 * Le module du salon, chargé une seule fois ; un échec (réseau) laisse réessayer au besoin
 * suivant. Après une panique, rend un moteur neuf (instance neuve, mémoire de l'ancienne déjà
 * effacée) ; l'ancien moteur et ses poignées lèvent `salon_casse`.
 */
export async function loadSalonEngine(): Promise<SalonEngine> {
  if (!loading) {
    loading = load();
    loading.catch(() => (loading = undefined));
  }
  await loading;
  if (broken) {
    wasm.__wbg_reset_state();
    broken = false;
    gen++;
    // Le gestionnaire est gardé par la colle Rust dans l'instance : à reposer dans la neuve.
    wasm.setPanicHandler(panique);
  }
  if (courant?.g !== gen) courant = { g: gen, m: moteur(gen) };
  return courant.m;
}
