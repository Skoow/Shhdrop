// PNG (spec §35.2) : reconstruction bloc par bloc, CRC vérifiés. Retirés : textes (tEXt,
// zTXt, iTXt, XMP compris), tIME, eXIf (réécrit avec la seule orientation si elle ≠ 1 et la vignette IFD1 intacte), tout
// bloc auxiliaire inconnu. Bloc critique inconnu ou CRC faux : échec.
import { Malformed, ascii, concat, slice, startsWith, u32be } from "./bytes";
import { crc32 } from "./crc32";
import { keptTiff, orientationToKeep } from "./exif";

const SIG = "\x89PNG\r\n\x1a\n";
const CRITICAL = new Set(["IHDR", "PLTE", "IDAT", "IEND"]);
const KEPT = new Set(["tRNS", "cHRM", "gAMA", "iCCP", "sRGB", "sBIT", "cICP", "mDCV", "cLLI", "pHYs", "bKGD", "hIST", "sPLT", "acTL", "fcTL", "fdAT"]);

function chunk(type: string, data: Uint8Array): Uint8Array {
  const head = new Uint8Array(8);
  new DataView(head.buffer).setUint32(0, data.length);
  for (let i = 0; i < 4; i++) head[4 + i] = type.charCodeAt(i);
  const crc = new Uint8Array(4);
  new DataView(crc.buffer).setUint32(0, crc32(head.subarray(4), data));
  return concat([head, data, crc]);
}

export function cleanPng(b: Uint8Array): Uint8Array<ArrayBuffer> {
  if (!startsWith(b, 0, SIG)) throw new Malformed("png_signature");
  const out: Uint8Array[] = [b.subarray(0, 8)];
  let o = 8;
  let first = true;
  for (;;) {
    const len = u32be(b, o);
    if (len > 0x7fffffff) throw new Malformed("png_longueur");
    const type = ascii(b, o + 4, 4);
    if (!/^[A-Za-z]{4}$/u.test(type)) throw new Malformed("png_type");
    const all = slice(b, o, 12 + len);
    const data = all.subarray(8, 8 + len);
    if (crc32(all.subarray(4, 8 + len)) !== u32be(all, 8 + len)) throw new Malformed("png_crc");
    if (first !== (type === "IHDR")) throw new Malformed("png_ihdr");
    first = false;
    const critical = type.charCodeAt(0) < 0x61;
    if (critical) {
      if (!CRITICAL.has(type)) throw new Malformed("png_critique_inconnu");
      out.push(all);
      if (type === "IEND") break; // rien après IEND
    } else if (KEPT.has(type)) out.push(all);
    else if (type === "eXIf") {
      const kept = keptTiff(data, orientationToKeep(data));
      if (kept) out.push(chunk("eXIf", kept));
    }
    o += 12 + len;
  }
  return concat(out);
}
