import sodium from "libsodium-wrappers-sumo";
import { concat, utf8 } from "./encoding";

export const KDF_MIN = { ops: 3, mem: 67108864 } as const;
export const KDF_MAX = { ops: 10, mem: 268435456 } as const;
export type KdfParams = { ops: number; mem: number };
export type AccessKeys = { kAcces: Uint8Array; vAcces: Uint8Array };
export type ContentKeys = {
  kContenu: CryptoKey;
  kPreuve: Uint8Array;
  vPreuve: Uint8Array;
  engagement: Uint8Array;
};

export function randomBytes(n: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(n));
}

export async function sha256(b: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", b));
}

// HKDF-SHA-256, sel vide (RFC 5869 : équivaut à un sel de HashLen zéros).
export async function hkdf(ikm: Uint8Array, info: string, len = 32): Promise<Uint8Array> {
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

function checkSizes(kLien: Uint8Array, salt?: Uint8Array): void {
  if (kLien.length !== 32 || (salt !== undefined && salt.length !== 16)) {
    throw new Error("clé ou sel de taille invalide");
  }
}

export async function deriveAccess(kLien: Uint8Array): Promise<AccessKeys> {
  checkSizes(kLien);
  const kAcces = await hkdf(kLien, "shhdrop/v1/acces");
  return { kAcces, vAcces: await sha256(kAcces) };
}

export async function deriveContent(
  kLien: Uint8Array,
  password: string,
  salt: Uint8Array,
  params: KdfParams,
): Promise<ContentKeys> {
  checkSizes(kLien, salt);
  checkKdfParams(params);
  await sodium.ready;
  let kMdp: Uint8Array | undefined;
  let ikm: Uint8Array | undefined;
  let kMaitre: Uint8Array | undefined;
  let kContenuBrut: Uint8Array | undefined;
  try {
    // NFC : un même mot de passe saisi sur des claviers différents donne la même clé.
    kMdp = sodium.crypto_pwhash(
      32,
      password.normalize("NFC"),
      salt,
      params.ops,
      params.mem,
      sodium.crypto_pwhash_ALG_ARGON2ID13,
    );
    ikm = concat(kLien, kMdp);
    kMaitre = await hkdf(ikm, "shhdrop/v1/maitre");
    kContenuBrut = await hkdf(kMaitre, "shhdrop/v1/contenu");
    const kPreuve = await hkdf(kMaitre, "shhdrop/v1/preuve");

    const hmacKey = await crypto.subtle.importKey(
      "raw",
      kContenuBrut,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const engagement = new Uint8Array(
      await crypto.subtle.sign("HMAC", hmacKey, utf8("shhdrop/v1/engagement")),
    );
    const kContenu = await crypto.subtle.importKey("raw", kContenuBrut, "AES-GCM", false, [
      "encrypt",
      "decrypt",
    ]);
    return { kContenu, kPreuve, vPreuve: await sha256(kPreuve), engagement };
  } finally {
    kMdp?.fill(0);
    ikm?.fill(0);
    kMaitre?.fill(0);
    kContenuBrut?.fill(0);
  }
}
