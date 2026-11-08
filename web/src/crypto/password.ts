// Mot de passe généré par défaut (spec §31, 10 caractères) : tirés uniformément dans un alphabet
// de 68 symboles (décision du propriétaire du 8 novembre) : lettres et chiffres sans les ambigus
// (ni 0 O o 1 l I i j), 14 caractères spéciaux courants sur un clavier de téléphone, aucun espace.
// Le mot de passe entier est recommencé tant que les quatre familles ne sont pas toutes présentes
// (au moins une minuscule, une majuscule, un chiffre, un spécial) : chaque mot de passe valide a
// la même probabilité. 1 282 818 246 439 403 520 possibilités, soit 2^60,15 (exigence : au moins
// 60 bits ; avec seulement 10 spéciaux, on tombait à 2^59,19). Ce contrôle de forme ne sert qu'à
// la création ; à l'ouverture, tout mot de passe non vide est accepté (anciens alphabets compris).

/** Mot de passe produit par generatePassword (10 caractères), seul accepté à la création (D41-15). */
export type GeneratedPassword = string & { readonly __gen: unique symbol };

/** Minuscules sans i j l o (22), majuscules sans I O (24), chiffres 2 à 9 (8), 14 spéciaux courants. */
export const PASSWORD_FAMILIES = ["abcdefghkmnpqrstuvwxyz", "ABCDEFGHJKLMNPQRSTUVWXYZ", "23456789", "!?@#$%&*+-=/()"] as const;
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
  if (n !== 68) throw new Error("alphabet invalide");
  // Tirage par rejet : un octet uniforme n'est gardé que sous 204 = 3 × 68 ; octet % 68 est
  // alors uniforme (aucun biais de modulo). Les octets ≥ 204 sont jetés.
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
