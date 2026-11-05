// Mot de passe par défaut (spec §31) : 8 caractères tirés dans un alphabet de 64 sans
// caractères ambigus, recommencé jusqu'à ce que les quatre familles soient présentes.
// 64 = 2⁶ : un octet masqué à 6 bits donne un tirage uniforme, sans biais.
// PROVISOIRE : la Task K1 livre `generatePassword` (crypto/password.ts, type GeneratedPassword)
// exporté par index.ts ; ce module sera alors retiré et l'écran branché sur celui de K1.
export const PASSWORD_ALPHABET = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!#$%+=?@";
export const PASSWORD_LENGTH = 8;

const FAMILIES = [/[a-z]/, /[A-Z]/, /[2-9]/, /[!#$%+=?@]/];

export function generatePassword(): string {
  for (;;) {
    const bytes = crypto.getRandomValues(new Uint8Array(PASSWORD_LENGTH));
    let out = "";
    for (const b of bytes) out += PASSWORD_ALPHABET[b & 63];
    bytes.fill(0);
    if (FAMILIES.every((re) => re.test(out))) return out;
  }
}
