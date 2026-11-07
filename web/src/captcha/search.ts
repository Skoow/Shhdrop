// Recherche de la preuve de travail ALTCHA (UI §9.4.2) : le nombre n de 0 à maxNumber tel que
// hex(SHA-256(sel + n)) = challenge. SHA-256 du navigateur (crypto.subtle) seulement, par lots
// de 64 condensés en parallèle ; aucune donnée secrète : le défi est public.

export type Challenge = { algorithm: "SHA-256"; challenge: string; maxNumber: number; salt: string; signature: string };

/** Plafond accepté (le serveur va jusqu'à 50 000 × 2⁵) : un défi démesuré est refusé. */
export const MAX_NUMBER_CAP = 10_000_000;
const BATCH = 64;

export function parseChallenge(c: unknown): Challenge {
  const o = (c ?? {}) as Record<string, unknown>;
  const ok =
    o.algorithm === "SHA-256" &&
    typeof o.challenge === "string" &&
    /^[0-9a-f]{64}$/.test(o.challenge) &&
    typeof o.salt === "string" &&
    o.salt.length > 0 &&
    o.salt.length <= 200 &&
    typeof o.signature === "string" &&
    Number.isSafeInteger(o.maxNumber) &&
    (o.maxNumber as number) >= 0 &&
    (o.maxNumber as number) <= MAX_NUMBER_CAP;
  if (!ok) throw new Error("defi_invalide");
  return { algorithm: "SHA-256", challenge: o.challenge as string, maxNumber: o.maxNumber as number, salt: o.salt as string, signature: o.signature as string };
}

const hex = (b: ArrayBuffer) => Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, "0")).join("");

/** Rend le nombre trouvé, ou null s'il n'existe pas jusqu'à maxNumber. `onTried` : avancée. */
export async function search(
  c: Pick<Challenge, "challenge" | "maxNumber" | "salt">,
  subtle: SubtleCrypto,
  onTried?: (tried: number) => void,
  stopped: () => boolean = () => false,
): Promise<number | null> {
  const enc = new TextEncoder();
  for (let start = 0; start <= c.maxNumber; start += BATCH) {
    if (stopped()) return null;
    const end = Math.min(c.maxNumber, start + BATCH - 1);
    const batch: Promise<ArrayBuffer>[] = [];
    for (let n = start; n <= end; n++) batch.push(subtle.digest("SHA-256", enc.encode(c.salt + n)));
    const hashes = await Promise.all(batch);
    for (let i = 0; i < hashes.length; i++) if (hex(hashes[i]!) === c.challenge) return start + i;
    onTried?.(end + 1);
  }
  return null;
}

/** Charge utile envoyée au serveur (base64 du JSON, format ALTCHA). */
export function payload(c: Challenge, number: number, took: number): string {
  const json = JSON.stringify({ algorithm: c.algorithm, challenge: c.challenge, number, salt: c.salt, signature: c.signature, took });
  return btoa(json);
}
