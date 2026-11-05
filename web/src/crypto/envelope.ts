// Clé de contenu aléatoire et son enveloppe (spec §29.2). Aucune construction maison :
// HKDF-SHA-256, HMAC-SHA-256, SHA-256 et AES-256-GCM de WebCrypto seulement.
//
//   R (graine)    32 octets aléatoires, jamais envoyée en clair
//   K_contenu     HKDF(R, « shhdrop/v2/contenu »), AES-256-GCM non extractible
//   C_engagement  HMAC-SHA-256(R, « shhdrop/v2/engagement »), dans l'en-tête en clair
//   id            HKDF(K_lien, « shhdrop/v2/id »), 16 octets
//   K_maître      HKDF(K_lien ‖ K_mdp, « shhdrop/v2/maitre »)
//   K_env         HKDF(K_maître, « shhdrop/v2/enveloppe »), AES-256-GCM non extractible
//   K_preuve      HKDF(K_maître, « shhdrop/v2/preuve »), V_preuve = SHA-256(K_preuve)
//   E             nonce (12 octets aléatoires) ‖ AES-256-GCM(K_env, nonce, R,
//                 données authentifiées = « shhdrop/v2/enveloppe-ad » ‖ id ‖ en-tête de 48 octets)
// L'info HKDF de K_env et le préfixe des données authentifiées sont deux étiquettes
// distinctes : une étiquette, un usage (séparation des domaines).
import { concat, utf8 } from "./encoding";
import { checkKLien, hkdf, randomBytes, sha256 } from "./kdf";
import type { KLien, KMdp, KPreuve } from "./types";

/** Graine de contenu R (32 octets). Seul constructeur : newSeed (et open, qui la déballe). */
export type Seed = Uint8Array<ArrayBuffer> & { readonly __seed: unique symbol };

/** Clés de contenu d'un paquet : clé AES-GCM non extractible et engagement (32 octets). */
export type ContentKeys = { kContenu: CryptoKey; engagement: Uint8Array<ArrayBuffer> };

/** Clés tirées du lien et du mot de passe : K_env (non extractible), K_preuve, V_preuve. */
export type AccessKeys = { kEnv: CryptoKey; kPreuve: KPreuve; vPreuve: Uint8Array<ArrayBuffer> };

export const SEED_LEN = 32;
export const ID_LEN = 16;
export const HEADER_LEN = 48;
const NONCE_LEN = 12;
/** Taille de E : nonce (12) ‖ R chiffrée (32) ‖ tag GCM (16). */
export const ENVELOPE_LEN = NONCE_LEN + SEED_LEN + 16;
const ENV_AD = "shhdrop/v2/enveloppe-ad";

const corrupt = () => new Error("paquet_corrompu");

/** Nouvelle graine R : 32 octets de crypto.getRandomValues. */
export function newSeed(): Seed {
  return randomBytes(SEED_LEN) as Seed;
}

function checkSeed(r: Uint8Array): void {
  if (r.length !== SEED_LEN) throw new Error("graine invalide");
}

/** K_contenu et C_engagement tirés de R. R n'est pas modifiée (l'appelant l'efface). */
export async function contentKeys(r: Seed): Promise<ContentKeys> {
  checkSeed(r);
  const raw = await hkdf(r, "shhdrop/v2/contenu");
  try {
    const kContenu = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
    const mac = await crypto.subtle.importKey("raw", r, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const engagement = new Uint8Array(await crypto.subtle.sign("HMAC", mac, utf8("shhdrop/v2/engagement")));
    return { kContenu, engagement };
  } finally {
    raw.fill(0);
  }
}

/**
 * Clés de contenu à l'ouverture : vérifie d'abord que `engagement` (lu dans l'en-tête en
 * clair) est bien HMAC(R, « shhdrop/v2/engagement »), par crypto.subtle.verify (comparaison
 * faite par WebCrypto) ; sinon Error("paquet_corrompu").
 */
export async function contentKeysChecked(r: Seed, engagement: Uint8Array<ArrayBuffer>): Promise<ContentKeys> {
  checkSeed(r);
  const mac = await crypto.subtle.importKey("raw", r, { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  const ok = engagement.length === 32 && (await crypto.subtle.verify("HMAC", mac, engagement, utf8("shhdrop/v2/engagement")));
  if (!ok) throw corrupt();
  return contentKeys(r);
}

/** id du partage = HKDF(K_lien, « shhdrop/v2/id »), 16 octets (spec §29.2, §32). */
export async function shareId(kLien: KLien): Promise<Uint8Array<ArrayBuffer>> {
  checkKLien(kLien);
  return hkdf(kLien, "shhdrop/v2/id", ID_LEN);
}

/**
 * K_env, K_preuve et V_preuve tirés de K_lien et K_mdp. K_maître et la concaténation
 * K_lien ‖ K_mdp sont mis à zéro avant de rendre la main ; K_lien et K_mdp ne sont pas
 * modifiés (l'appelant les efface).
 */
export async function accessKeys(kLien: KLien, kMdp: KMdp): Promise<AccessKeys> {
  checkKLien(kLien);
  if (kMdp.length !== 32) throw new Error("clé ou sel de taille invalide");
  const ikm = concat(kLien, kMdp);
  let kMaitre: Uint8Array<ArrayBuffer> | undefined;
  let kEnvRaw: Uint8Array<ArrayBuffer> | undefined;
  try {
    kMaitre = await hkdf(ikm, "shhdrop/v2/maitre");
    kEnvRaw = await hkdf(kMaitre, "shhdrop/v2/enveloppe");
    const kPreuve = (await hkdf(kMaitre, "shhdrop/v2/preuve")) as KPreuve;
    const kEnv = await crypto.subtle.importKey("raw", kEnvRaw, "AES-GCM", false, ["encrypt", "decrypt"]);
    return { kEnv, kPreuve, vPreuve: await sha256(kPreuve) };
  } finally {
    ikm.fill(0);
    kMaitre?.fill(0);
    kEnvRaw?.fill(0);
  }
}

function aad(id: Uint8Array, header: Uint8Array): Uint8Array<ArrayBuffer> {
  if (id.length !== ID_LEN || header.length !== HEADER_LEN) throw new Error("enveloppe : id ou en-tête invalide");
  return concat(utf8(ENV_AD), id, header);
}

/**
 * Enveloppe R sous K_env : E = nonce aléatoire (12 octets) ‖ AES-256-GCM(R), 60 octets ;
 * données authentifiées = « shhdrop/v2/enveloppe-ad » ‖ id ‖ en-tête. Un nonce neuf à
 * chaque appel (une K_env n'enveloppe qu'une R, mais deux appels ne réutilisent jamais un nonce).
 */
export async function seal(kEnv: CryptoKey, r: Seed, id: Uint8Array, header: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
  checkSeed(r);
  const ad = aad(id, header);
  const iv = randomBytes(NONCE_LEN);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: ad, tagLength: 128 }, kEnv, r));
  return concat(iv, ct);
}

/**
 * Déballe R. Toute erreur (taille, autre id, autre en-tête, E modifiée, autre K_env donc
 * autre lien ou autre mot de passe) donne la même Error("paquet_corrompu").
 */
export async function open(kEnv: CryptoKey, e: Uint8Array, id: Uint8Array, header: Uint8Array): Promise<Seed> {
  if (e.length !== ENVELOPE_LEN || id.length !== ID_LEN || header.length !== HEADER_LEN) throw corrupt();
  const ad = aad(id, header);
  const iv = new Uint8Array(e.subarray(0, NONCE_LEN));
  const ct = new Uint8Array(e.subarray(NONCE_LEN));
  let pt: ArrayBuffer;
  try {
    pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv, additionalData: ad, tagLength: 128 }, kEnv, ct);
  } catch {
    throw corrupt();
  }
  const r = new Uint8Array(pt);
  if (r.length !== SEED_LEN) {
    r.fill(0);
    throw corrupt();
  }
  return r as Seed;
}
