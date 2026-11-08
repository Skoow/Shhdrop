// Lecture bornée d'octets pour les analyseurs de formats (spec §35.2) : chaque lecture vérifie
// ses bornes et lève `Malformed` au premier dépassement, jamais une valeur inventée.

/** Structure invalide ou hors bornes : le nettoyage rend `echec`, jamais d'exception visible. */
export class Malformed extends Error {
  constructor(what: string) {
    super(`malformed:${what}`);
  }
}

function need(b: Uint8Array, o: number, n: number): void {
  if (!Number.isSafeInteger(o) || o < 0 || o + n > b.length) throw new Malformed("bornes");
}

export function u8(b: Uint8Array, o: number): number {
  need(b, o, 1);
  return b[o]!;
}
export function u16be(b: Uint8Array, o: number): number {
  need(b, o, 2);
  return (b[o]! << 8) | b[o + 1]!;
}
export function u16le(b: Uint8Array, o: number): number {
  need(b, o, 2);
  return b[o]! | (b[o + 1]! << 8);
}
export function u32be(b: Uint8Array, o: number): number {
  need(b, o, 4);
  return ((b[o]! << 24) | (b[o + 1]! << 16) | (b[o + 2]! << 8) | b[o + 3]!) >>> 0;
}
export function u32le(b: Uint8Array, o: number): number {
  need(b, o, 4);
  return (b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16) | (b[o + 3]! << 24)) >>> 0;
}
/** Entier 64 bits gros-boutiste ; au-delà de 2^53 : `Malformed` (aucun fichier visé n'y arrive). */
export function u64be(b: Uint8Array, o: number): number {
  const hi = u32be(b, o);
  const lo = u32be(b, o + 4);
  if (hi >= 0x200000) throw new Malformed("u64");
  return hi * 0x100000000 + lo;
}
/** Entier gros-boutiste de `n` octets (0, 4 ou 8 : champs de taille variable d'ISOBMFF). */
export function uNbe(b: Uint8Array, o: number, n: number): number {
  if (n === 0) return 0;
  if (n === 4) return u32be(b, o);
  if (n === 8) return u64be(b, o);
  throw new Malformed("taille_champ");
}
/** Tranche bornée (vue, sans copie). */
export function slice(b: Uint8Array, o: number, n: number): Uint8Array {
  need(b, o, n);
  return b.subarray(o, o + n);
}
export function ascii(b: Uint8Array, o: number, n: number): string {
  return String.fromCharCode(...slice(b, o, n));
}
export function startsWith(b: Uint8Array, o: number, s: string): boolean {
  if (o < 0 || o + s.length > b.length) return false;
  for (let i = 0; i < s.length; i++) if (b[o + i] !== s.charCodeAt(i)) return false;
  return true;
}
export function concat(parts: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
export function equal(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
