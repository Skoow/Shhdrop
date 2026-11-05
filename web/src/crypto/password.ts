// Mot de passe généré par défaut (spec §31) : 8 caractères tirés uniformément dans un
// alphabet de 64 symboles sans caractères ambigus, recommencé jusqu'à ce que les quatre
// familles soient présentes. 107 294 591 287 296 possibilités (2^46,6).

/** Mot de passe produit par generatePassword : accepté par checkPassword à 8 caractères. */
export type GeneratedPassword = string & { readonly __gen: unique symbol };

/** Minuscules sans l ni o, majuscules sans I ni O, chiffres 2 à 9, 8 symboles. */
export const PASSWORD_FAMILIES = ["abcdefghijkmnpqrstuvwxyz", "ABCDEFGHJKLMNPQRSTUVWXYZ", "23456789", "!#$%+=?@"] as const;
export const PASSWORD_ALPHABET = PASSWORD_FAMILIES.join("");
export const PASSWORD_LEN = 8;

// Les derniers mots de passe générés, pour que checkPassword les reconnaisse à l'exécution
// (le type marqué ne survit pas à la compilation). Bornée : 16 au plus, les plus anciens
// oubliés. Ce sont des chaînes JavaScript, déjà présentes dans l'écran qui les affiche
// (impossibles à effacer, spec §18.8) ; la liste n'ajoute aucune copie hors de la page.
const recent: string[] = [];
const RECENT_MAX = 16;

/** Vrai si `pw` est l'un des 16 derniers mots de passe produits par generatePassword. */
export function isGeneratedPassword(pw: string): pw is GeneratedPassword {
  return recent.includes(pw);
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
    if (PASSWORD_FAMILIES.every((f) => [...pw].some((c) => f.includes(c)))) {
      recent.push(pw);
      if (recent.length > RECENT_MAX) recent.shift();
      return pw as GeneratedPassword;
    }
  }
}
