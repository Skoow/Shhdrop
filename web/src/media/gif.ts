// GIF (spec §35.2) : reconstruction des blocs. Retirés : extensions Commentaire et
// Application autres que NETSCAPE2.0, ANIMEXTS1.0, ICCRGBG1 (XMP compris), tout ce qui suit le
// terminateur. Images recopiées sans décodage. Bloc inconnu ou sous-bloc hors fichier : échec.
import { Malformed, ascii, concat, slice, startsWith, u8 } from "./bytes";

const APPS = new Set(["NETSCAPE2.0", "ANIMEXTS1.0", "ICCRGBG1012"]);

/** Fin d'une suite de sous-blocs commençant en `o` (après le bloc de taille 0). */
function subBlocks(b: Uint8Array, o: number): number {
  for (;;) {
    const n = u8(b, o);
    if (n === 0) return o + 1;
    slice(b, o + 1, n);
    o += 1 + n;
  }
}

export function cleanGif(b: Uint8Array): Uint8Array<ArrayBuffer> {
  if (!startsWith(b, 0, "GIF87a") && !startsWith(b, 0, "GIF89a")) throw new Malformed("gif_entete");
  const packed = u8(b, 10);
  let o = 13 + (packed & 0x80 ? 3 << ((packed & 7) + 1) : 0);
  slice(b, 0, o);
  const out: Uint8Array[] = [b.subarray(0, o)];
  let images = 0;
  for (;;) {
    const t = u8(b, o);
    if (t === 0x3b) {
      if (images === 0) throw new Malformed("gif_sans_image");
      out.push(b.subarray(o, o + 1));
      break;
    }
    if (t === 0x2c) {
      const p = u8(b, o + 9);
      const data = o + 10 + (p & 0x80 ? 3 << ((p & 7) + 1) : 0);
      u8(b, data); // taille minimale des codes LZW
      const end = subBlocks(b, data + 1);
      out.push(b.subarray(o, end));
      images++;
      o = end;
    } else if (t === 0x21) {
      const label = u8(b, o + 1);
      const end = subBlocks(b, o + 2);
      if (label === 0xf9 || label === 0x01) out.push(b.subarray(o, end));
      else if (label === 0xff) {
        if (u8(b, o + 2) === 11 && APPS.has(ascii(b, o + 3, 11))) out.push(b.subarray(o, end));
      } else if (label !== 0xfe) throw new Malformed("gif_extension_inconnue");
      o = end;
    } else throw new Malformed("gif_bloc_inconnu");
  }
  return concat(out);
}
