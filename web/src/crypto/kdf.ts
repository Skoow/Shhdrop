import sodium from "libsodium-wrappers-sumo";
import { utf8 } from "./encoding";
import { isGeneratedPassword } from "./password";
import type { KAcces, KLien, KMdp, SGestion } from "./types";

export const KDF_MIN = { ops: 3, mem: 67108864 } as const;
/**
 * Plafond accepté du serveur (audit F4) : les paramètres de création, seuls utilisés. Plus haut,
 * un serveur compromis ferait allouer jusqu'à 256 Mio et planter l'onglet d'un petit téléphone.
 */
export const KDF_MAX = { ops: 3, mem: 67108864 } as const;
export type KdfParams = { ops: number; mem: number };
/** Paramètres Argon2id des nouveaux partages (spec §29.2 : 64 Mio, 3 passes), imposés par passwordKeyForCreate. */
export const KDF_CREATE = { ops: KDF_MIN.ops, mem: KDF_MIN.mem } as const;
export type AccessKeys = { kAcces: KAcces; vAcces: Uint8Array<ArrayBuffer> };

export function randomBytes(n: number): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(n));
}

/** Nouvelle K_lien (32 octets aléatoires). Seul constructeur avec parseLink. */
export function newKLien(): KLien {
  return randomBytes(32) as KLien;
}

/** Nouveau S_gestion (32 octets aléatoires). Seul constructeur avec parseLink. */
export function newSGestion(): SGestion {
  return randomBytes(32) as SGestion;
}

export async function sha256(b: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", b));
}

// HKDF-SHA-256, sel vide (RFC 5869 : équivaut à un sel de HashLen zéros).
export async function hkdf(ikm: Uint8Array<ArrayBuffer>, info: string, len = 32): Promise<Uint8Array<ArrayBuffer>> {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: utf8(info) },
    key,
    len * 8,
  );
  return new Uint8Array(bits);
}

export function checkKdfParams(p: KdfParams): void {
  if (
    !Number.isInteger(p.ops) ||
    !Number.isInteger(p.mem) ||
    p.ops > KDF_MAX.ops ||
    p.mem > KDF_MAX.mem
  ) {
    throw new Error("paramètres KDF invalides");
  }
  // Le navigateur refuse tout paramètre inférieur au minimum, même proposé par le serveur.
  if (p.ops < KDF_MIN.ops || p.mem < KDF_MIN.mem) {
    throw new Error("paramètres KDF trop faibles");
  }
}

export function checkKLien(kLien: Uint8Array): void {
  if (kLien.length !== 32) throw new Error("clé ou sel de taille invalide");
}

/** K_accès = HKDF(K_lien, « shhdrop/v2/acces »), V_accès = SHA-256(K_accès) (spec §29.2). */
export async function deriveAccess(kLien: KLien): Promise<AccessKeys> {
  checkKLien(kLien);
  const kAcces = (await hkdf(kLien, "shhdrop/v2/acces")) as KAcces;
  return { kAcces, vAcces: await sha256(kAcces) };
}

/**
 * K_mdp pour CRÉER un partage (spec §29.2, §31, D41-15) : seulement un mot de passe de la forme
 * de generatePassword (11 caractères, quatre familles) ; sinon Error("mot_de_passe_non_genere").
 * Paramètres Argon2id fixés à KDF_CREATE (64 Mio, 3 passes). Audit F9.
 */
export async function passwordKeyForCreate(password: string, salt: Uint8Array<ArrayBuffer>): Promise<KMdp> {
  if (!isGeneratedPassword(password)) throw new Error("mot_de_passe_non_genere");
  return passwordKey(password, salt, KDF_CREATE);
}

/**
 * K_mdp = Argon2id(mot de passe NFC, sel) pour OUVRIR un partage (paramètres lus sur le
 * serveur, bornés par checkKdfParams). Tout mot de passe non vide est accepté : il a été
 * choisi à la création. L'appelant met la clé à zéro après usage.
 */
export async function passwordKey(password: string, salt: Uint8Array<ArrayBuffer>, params: KdfParams): Promise<KMdp> {
  if (password.length === 0) throw new Error("mot_de_passe_vide");
  if (salt.length !== 16) throw new Error("clé ou sel de taille invalide");
  checkKdfParams(params);
  await sodium.ready;
  // NFC : un même mot de passe saisi sur des claviers différents donne la même clé.
  const k = sodium.crypto_pwhash(32, password.normalize("NFC"), salt, params.ops, params.mem, sodium.crypto_pwhash_ALG_ARGON2ID13);
  // Copie dans un ArrayBuffer à nous, puis effacement de la sortie de libsodium.
  const out = new Uint8Array(k) as KMdp;
  k.fill(0);
  return out;
}
