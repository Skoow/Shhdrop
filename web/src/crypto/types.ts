// Types marqués des secrets (audit M1). Tous sont des Uint8Array de 32 octets, mais le
// compilateur refuse de les confondre : K_lien ne peut pas être passé
// là où le serveur attend K_accès ou K_preuve. Ils ne sont produits que par :
//   - newKLien(), newSGestion() (crypto/kdf : tirage aléatoire) ;
//   - deriveAccess (K_accès), passwordKey / passwordKeyForCreate (K_mdp), accessKeys (K_preuve) ;
//   - parseLink (K_lien ou S_gestion lus dans le fragment du lien).
// Aucun autre code ne doit écrire « as KLien » (sauf les tests).

/** Clé du lien, dans le fragment (#) : ne quitte jamais le navigateur. */
export type KLien = Uint8Array<ArrayBuffer> & { readonly __brand: "KLien" };
/** Clé d'accès, dérivée de K_lien : envoyée au serveur (X-Shh-Access). */
export type KAcces = Uint8Array<ArrayBuffer> & { readonly __brand: "KAcces" };
/** Preuve du mot de passe, dérivée de K_lien et du mot de passe : envoyée au serveur. */
export type KPreuve = Uint8Array<ArrayBuffer> & { readonly __brand: "KPreuve" };
/** Secret de gestion, dans le fragment du lien de gestion : envoyé au serveur (X-Shh-Manage). */
export type SGestion = Uint8Array<ArrayBuffer> & { readonly __brand: "SGestion" };
/** Clé du mot de passe (Argon2id) : ne quitte jamais le navigateur, mise à zéro après usage. */
export type KMdp = Uint8Array<ArrayBuffer> & { readonly __brand: "KMdp" };
