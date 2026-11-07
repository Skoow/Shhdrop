// Mot de passe généré par défaut (spec §31, 10 caractères depuis le 5 novembre) : tirés
// uniformément dans un alphabet de 72 symboles sans caractères ambigus (ni 0 O o 1 l I |),
// recommencé jusqu'à ce que les quatre familles soient présentes (au moins une minuscule, une
// majuscule, un chiffre, un caractère spécial). 2 245 913 002 660 331 520 possibilités
// (2^60,96 ; exigence du propriétaire du 7 novembre : au moins 60 bits). L'alphabet précédent
// (64 symboles, 2^59,0) en est un sous-ensemble : les anciens mots de passe restent valides.

/** Mot de passe produit par generatePassword (10 caractères), seul accepté à la création (D41-15). */
export type GeneratedPassword = string & { readonly __gen: unique symbol };

/** Minuscules sans l ni o, majuscules sans I ni O, chiffres 2 à 9, 16 symboles (premier clavier de symboles des téléphones, sans « | »). */
export const PASSWORD_FAMILIES = ["abcdefghijkmnpqrstuvwxyz", "ABCDEFGHJKLMNPQRSTUVWXYZ", "23456789", "!#$%+=?@&*-/:;()"] as const;
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
  const n = PASSWORD_ALPHABET.length;
  if (n !== 72) throw new Error("alphabet invalide");
  // Tirage par rejet : un octet uniforme n'est gardé que sous 216 = 3 × 72 ; octet % 72 est
  // alors uniforme (aucun biais de modulo). Les octets ≥ 216 sont jetés.
  const limit = 256 - (256 % n);
  const buf = new Uint8Array(PASSWORD_LEN * 2);
  for (;;) {
    let pw = "";
    while (pw.length < PASSWORD_LEN) {
      crypto.getRandomValues(buf);
      for (const b of buf) if (b < limit && pw.length < PASSWORD_LEN) pw += PASSWORD_ALPHABET[b % n]!;
    }
    buf.fill(0);
    if (isGeneratedPassword(pw)) return pw;
  }
}
