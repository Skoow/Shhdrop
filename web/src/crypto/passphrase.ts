import { WORDS } from "./wordlist-eff";
import { BLOCKLIST } from "./blocklist";

export const PW_MIN_CHARS = 12;

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

export type PwCheck = { ok: true } | { ok: false; reason: "trop_court" | "trop_courant" };

export function checkPassword(pw: string): PwCheck {
  const nfc = pw.normalize("NFC");
  if ([...nfc].length < PW_MIN_CHARS) return { ok: false, reason: "trop_court" };
  if (BLOCKLIST.has(nfc.toLowerCase())) return { ok: false, reason: "trop_courant" };
  return { ok: true };
}
