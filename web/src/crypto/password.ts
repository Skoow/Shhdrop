// Mot de passe généré par défaut (spec §31, 10 caractères depuis le 5 novembre) : tirés
// uniformément dans un alphabet de 64 symboles sans caractères ambigus, recommencé jusqu'à ce
// que les quatre familles soient présentes. 594 641 958 752 747 520 possibilités (2^59,0).

/** Mot de passe produit par generatePassword (10 caractères), seul accepté à la création (D41-15). */
export type GeneratedPassword = string & { readonly __gen: unique symbol };

/** Minuscules sans l ni o, majuscules sans I ni O, chiffres 2 à 9, 8 symboles. */
export const PASSWORD_FAMILIES = ["abcdefghijkmnpqrstuvwxyz", "ABCDEFGHJKLMNPQRSTUVWXYZ", "23456789", "!#$%+=?@"] as const;
export const PASSWORD_ALPHABET = PASSWORD_FAMILIES.join("");
export const PASSWORD_LEN = 10;

/**
 * Vrai si `pw` a la forme d'un mot de passe généré : exactement 10 caractères de l'alphabet,
 * les quatre familles présentes (D41-15 : le mot de passe d'un partage est toujours généré,
 * plus aucune saisie). La forme ne prouve pas le tirage ; elle refuse toute autre chaîne qui
 * arriverait jusqu'à la création (erreur de programmation), sans liste ni copie gardée.
 */
export function isGeneratedPassword(pw: string): pw is GeneratedPassword {
  const chars = [...pw];
  return chars.length === PASSWORD_LEN && chars.every((c) => PASSWORD_ALPHABET.includes(c)) && PASSWORD_FAMILIES.every((f) => chars.some((c) => f.includes(c)));
}

export function generatePassword(): GeneratedPassword {
  if (PASSWORD_ALPHABET.length !== 64) throw new Error("alphabet invalide");
  const buf = new Uint8Array(PASSWORD_LEN);
  for (;;) {
    crypto.getRandomValues(buf);
    // 64 = 2⁶ : les 6 bits de poids faible d'un octet uniforme sont uniformes (aucun biais).
    let pw = "";
    for (const b of buf) pw += PASSWORD_ALPHABET[b & 63]!;
    buf.fill(0);
    if (isGeneratedPassword(pw)) return pw;
  }
}
