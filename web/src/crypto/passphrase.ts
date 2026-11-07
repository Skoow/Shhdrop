import { WORDS } from "./wordlist-eff";
import { BLOCK, CORES_PACKED } from "./blocklist";
import { decodeCores, weakReason, type WeakReason } from "./weakpw";
import { isGeneratedPassword, type GeneratedPassword } from "./password";

export const PW_MIN_CHARS = 10;

function defaultRand(n: number): Uint8Array<ArrayBuffer> {
  return new Uint8Array(crypto.getRandomValues(new Uint32Array(n / 4)).buffer);
}

// Tirage uniforme dans [0, max) par rejet (aucun biais modulo). `rand(4)` fournit 4 octets (big-endian).
export function uniformIndex(max: number, rand: (n: number) => Uint8Array<ArrayBuffer> = defaultRand): number {
  if (!Number.isInteger(max) || max < 1 || max > 2 ** 32) throw new RangeError("max hors bornes");
  const limit = Math.floor(2 ** 32 / max) * max;
  for (;;) {
    const b = rand(4);
    const x = new DataView(b.buffer, b.byteOffset, 4).getUint32(0);
    if (x < limit) return x % max;
  }
}

/** Nombre minimal de mots d'une phrase générée (4 mots EFF ≈ 51,7 bits ; audit F9). */
export const PASSPHRASE_MIN_WORDS = 4;

export function generatePassphraseWords(n = PASSPHRASE_MIN_WORDS): string[] {
  if (!Number.isInteger(n) || n < PASSPHRASE_MIN_WORDS) throw new RangeError("nombre de mots invalide (4 au moins)");
  return Array.from({ length: n }, () => WORDS[uniformIndex(WORDS.length)]!);
}

export function generatePassphrase(words = PASSPHRASE_MIN_WORDS): string {
  return generatePassphraseWords(words).join("-");
}

export type PwCheck = { ok: true } | { ok: false; reason: "trop_court" | WeakReason };

const LISTS = { block: new Set(BLOCK), cores: decodeCores(CORES_PACKED) };

/**
 * Mot de passe accepté à la création : un mot de passe généré récent (generatePassword,
 * 10 caractères, spec §31), ou un mot de passe saisi de 10 caractères au moins (points de
 * code NFC) qui n'est ni une répétition, ni une suite, ni une rangée de clavier, ni un mot de
 * passe courant ou un mot courant entouré de chiffres et de symboles (weakpw.ts, audit M1) :
 * un humain choisit moins bien qu'un tirage.
 */
export function checkPassword(pw: string | GeneratedPassword): PwCheck {
  if (isGeneratedPassword(pw)) return { ok: true };
  const nfc = pw.normalize("NFC");
  if ([...nfc].length < PW_MIN_CHARS) return { ok: false, reason: "trop_court" };
  const weak = weakReason(nfc, LISTS);
  return weak === null ? { ok: true } : { ok: false, reason: weak };
}
