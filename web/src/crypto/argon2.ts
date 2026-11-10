// Argon2id de libsodium (spec §29.2), seul endroit qui importe libsodium. En production ce
// module vit dans son propre fichier (assets/argon2-EMPREINTE.js, vite.config.ts), chargé à la
// demande : il ne pèse ni sur la page d'accueil ni sur le fil principal (décision du 10 novembre).
import sodium from "libsodium-wrappers-sumo";

/** Argon2id(mot de passe en UTF-8, sel de 16 octets) → 32 octets. La sortie de libsodium est mise à zéro. */
export async function argon2id(pw: Uint8Array, salt: Uint8Array, ops: number, mem: number): Promise<Uint8Array<ArrayBuffer>> {
  await sodium.ready;
  const k = sodium.crypto_pwhash(32, pw, salt, ops, mem, sodium.crypto_pwhash_ALG_ARGON2ID13);
  // Copie dans un ArrayBuffer à nous, puis effacement de la sortie de libsodium.
  const out = new Uint8Array(k);
  k.fill(0);
  return out;
}
