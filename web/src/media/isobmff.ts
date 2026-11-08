// Boîtes ISOBMFF (HEIF, AVIF ; MP4 en 9c) : lecture à bornes vérifiées. Une taille 0
// (« jusqu'à la fin ») n'est permise qu'à la dernière boîte de son parent ; une taille 1 lit
// la taille 64 bits ; toute boîte qui sort de son parent est `Malformed`.
import { Malformed, ascii, u32be, u64be, u8 } from "./bytes";

export type Box = { type: string; start: number; head: number; end: number };

function one(b: Uint8Array, o: number, to: number, base: number): Box {
  let size = u32be(b, o - base);
  const type = ascii(b, o - base + 4, 4);
  let head = 8;
  if (size === 1) {
    size = u64be(b, o - base + 8);
    head = 16;
  } else if (size === 0) size = to - o;
  if (type === "uuid") head += 16;
  if (size < head || o + size > to) throw new Malformed("boite");
  return { type, start: o, head, end: o + size };
}

/** Boîtes de [from, to) de `b`, dont l'octet 0 est à la position `base` du fichier. */
export function children(b: Uint8Array, from: number, to: number, base = 0): Box[] {
  const out: Box[] = [];
  for (let o = from; o < to; ) {
    if (to - o < 8) throw new Malformed("boite_courte");
    const x = one(b, o, to, base);
    out.push(x);
    o = x.end;
  }
  return out;
}

/** Boîtes de premier niveau d'un Blob : seules leurs en-têtes sont lus. */
export async function topLevel(blob: Blob, max = 10_000): Promise<Box[]> {
  const out: Box[] = [];
  for (let o = 0; o < blob.size; ) {
    if (out.length >= max) throw new Malformed("trop_de_boites");
    const h = new Uint8Array(await blob.slice(o, Math.min(blob.size, o + 32)).arrayBuffer());
    if (h.length < 8) throw new Malformed("boite_courte");
    const x = one(h, o, blob.size, o);
    out.push(x);
    o = x.end;
  }
  return out;
}

/** Version et drapeaux d'une « FullBox » ; le contenu commence 4 octets après l'en-tête. */
export function fullBox(b: Uint8Array, x: Box, base = 0): { version: number; flags: number; body: number } {
  const o = x.start - base + x.head;
  if (o + 4 > x.end - base) throw new Malformed("fullbox");
  return { version: u8(b, o), flags: (u8(b, o + 1) << 16) | (u8(b, o + 2) << 8) | u8(b, o + 3), body: x.start + x.head + 4 };
}
