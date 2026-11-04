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

export function generatePassphraseWords(n = 4): string[] {
  if (!Number.isInteger(n) || n < 1) throw new RangeError("nombre de mots invalide");
  return Array.from({ length: n }, () => WORDS[uniformIndex(WORDS.length)]!);
}

export function generatePassphrase(words = 4): string {
  return generatePassphraseWords(words).join("-");
}

export type PwCheck = { ok: true } | { ok: false; reason: "trop_court" | "trop_courant" };

export function checkPassword(pw: string): PwCheck {
  const nfc = pw.normalize("NFC");
  if ([...nfc].length < PW_MIN_CHARS) return { ok: false, reason: "trop_court" };
  if (BLOCKLIST.has(nfc.toLowerCase())) return { ok: false, reason: "trop_courant" };
  return { ok: true };
}
