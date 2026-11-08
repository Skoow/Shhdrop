// Fichiers d'essai du nettoyage des images et des documents (spec §35.2, Tasks 9a et 9b), construits octet par octet,
// sans dépendance. Repères fictifs seulement (jamais une vraie photo) : GPS 12° 34′ 56″ N,
// 65° 43′ 21″ O, « ReperMake », « ReperModel », dates 2001:02:03 04:05:06. Les flux d'image
// (JPEG 16 × 8, PNG, WebP, GIF à 2 images) et le profil sRGB viennent de Pillow 12.3.0, une
// fois, recopiés ici en base64 : le script se relance partout et donne les mêmes octets
// (gen-fixtures.test.ts compare aux fichiers commités).
//   node scripts/gen-fixtures.mjs   → écrit src/media/fixtures/*
import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const b64 = (s) => new Uint8Array(Buffer.from(s, "base64"));
const ICC = b64("AAACTGxjbXMEQAAAbW50clJHQiBYWVogB+oACwAIABEADwA7YWNzcEFQUEwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAPbWAAEAAAAA0y1sY21zAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAALZGVzYwAAAQgAAAA2Y3BydAAAAUAAAABMd3RwdAAAAYwAAAAUY2hhZAAAAaAAAAAsclhZWgAAAcwAAAAUYlhZWgAAAeAAAAAUZ1hZWgAAAfQAAAAUclRSQwAAAggAAAAgZ1RSQwAAAggAAAAgYlRSQwAAAggAAAAgY2hybQAAAigAAAAkbWx1YwAAAAAAAAABAAAADGVuVVMAAAAaAAAAHABzAFIARwBCACAAYgB1AGkAbAB0AC0AaQBuAABtbHVjAAAAAAAAAAEAAAAMZW5VUwAAADAAAAAcAE4AbwAgAGMAbwBwAHkAcgBpAGcAaAB0ACwAIAB1AHMAZQAgAGYAcgBlAGUAbAB5WFlaIAAAAAAAAPbWAAEAAAAA0y1zZjMyAAAAAAABDEIAAAXe///zJQAAB5MAAP2Q///7of///aIAAAPcAADAblhZWiAAAAAAAABvoAAAOPUAAAOQWFlaIAAAAAAAACSfAAAPhAAAtsNYWVogAAAAAAAAYpcAALeHAAAY2XBhcmEAAAAAAAMAAAACZmYAAPKnAAANWQAAE9AAAApbY2hybQAAAAAAAwAAAACj1wAAVHsAAEzNAACZmgAAJmYAAA9c");
const JPG_BODY = b64("/9sAQwAGBAUGBQQGBgUGBwcGCAoQCgoJCQoUDg8MEBcUGBgXFBYWGh0lHxobIxwWFiAsICMmJykqKRkfLTAtKDAlKCko/9sAQwEHBwcKCAoTCgoTKBoWGigoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgo/8AAEQgACAAQAwEiAAIRAQMRAf/EAB8AAAEFAQEBAQEBAAAAAAAAAAABAgMEBQYHCAkKC//EALUQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/EAB8BAAMBAQEBAQEBAQEAAAAAAAABAgMEBQYHCAkKC//EALURAAIBAgQEAwQHBQQEAAECdwABAgMRBAUhMQYSQVEHYXETIjKBCBRCkaGxwQkjM1LwFWJy0QoWJDThJfEXGBkaJicoKSo1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoKDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uLj5OXm5+jp6vLz9PX29/j5+v/aAAwDAQACEQMRAD8A5bSfh3939z+ldnpPw7+7+5/SiiuTHZtidfePL4VzzGe77x//2Q==");
const JPG_PROG = b64("/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wgARCAAQACADASIAAhEBAxEB/8QAFgABAQEAAAAAAAAAAAAAAAAABAYF/8QAFQEBAQAAAAAAAAAAAAAAAAAABAX/3QAEAAH/2gAMAwEAAhADEAAAAYZ9LqCD/9DEfUqLU//EABkQAAMBAQEAAAAAAAAAAAAAAAACBAEDEf/aAAgBAQABBQJJj//QSY//0UlP/9JJD//T5zH/1Ocx/9XOHh//1ln3T//EABkRAAMAAwAAAAAAAAAAAAAAAAAEBQERUf/aAAgBAwEBPwFano//0Faeen//xAAbEQACAQUAAAAAAAAAAAAAAAAAAwECEhMxYf/aAAgBAgEBPwFLMp//0GMRRNu54f/EABUQAQEAAAAAAAAAAAAAAAAAAAAx/9oACAEBAAY/An//0H//0Y//0o//03//1H//1Y//1n//xAAYEAEBAQEBAAAAAAAAAAAAAAAAYQEhcf/aAAgBAQABPyGD/9CL/9Ev/9Iv/9OD/9SL/9XLnrX/1pXj/9oADAMBAAIAAwAAABAr/9A7/8QAFxEAAwEAAAAAAAAAAAAAAAAAAAEhEf/aAAgBAwEBPxCCn//Qcxwf/8QAHBEAAQMFAAAAAAAAAAAAAAAAAQARQSExYXGx/9oACAECAQE/EKRf/9B13nENm3Thf//EABsQAAMBAAMBAAAAAAAAAAAAAAABEcEhQVFx/9oACAEBAAE/ELTJ/9C8yf/RtMH/0rTB/9O0yf/UvMn/1W6r5rr6f//Wdrhp4kP/2Q==");
const PNG_IHDR = b64("AAAAEAAAAAgIAgAAAA==");
const PNG_IDAT = b64("eJxjZGBoEGBgIB6xMCgwkARGNRADANzuAm4=");
const WEBP_VP8L = b64("VlA4TB8AAAAvD8ABALmM6H/sIgrf/4CQgDDF/6OSPhADGBOAVG0HAA==");
const WEBP_SIMPLE = b64("UklGRlYAAABXRUJQVlA4IEoAAADQAQCdASoQAAgAAUAmJbACdAEOu5fu8AD+/GvcXPbNrhL7AXIToB07l90R+W+0flx8Jx8XV/7+f6IGQ/xBr+wZNf/9X/Hf/XgAAA==");
const GIF_ANIM = b64("R0lGODlhEAAIAIUAAAAAZjMAZmYAZpkAZswAZv8AZgAzZjMzZmYzZpkzZswzZgBmZjNmZmZmZplmZsxmZgCZZjOZZmaZZpmZZsyZZv+ZZgDMZjPMZmbMZpnMZszMZgAAmTMAmWYAmZkAmcwAmQAzmTMzmWYzmZkzmcwzmf8zmQBmmTNmmWZmmZlmmcxmmf9mmQCZmTOZmWaZmZmZmcyZmf+ZmQDMmTPMmWbMmZnMmczMmf/Mmf//mQAAAAAAAAAAAAAAAAAAAAAAAAAAACH/C05FVFNDQVBFMi4wAwEAAAAh+QQACgAAACwAAAAAEAAIAAAIggA3AOAQgIOADgI8DFD4gcCHAgY2HAgRIASCDghGDCCh4IOCEiAMhJiIQETGBCMScCyhYIEJBicYoGgwM4UDFQ9wrmCxoAWDFhFQSHjh4MUEFRRUVIDAIgJQFxKgGn1BAQaFGDIszLgwAwMNDDUy1NBgQ8MNDRZkcOXqFaxYshpwBAQAIfkEAQoAOgAsAAAAABAACACFAABmMwBmZgBmmQBmzABmADNmMzNmZjNmmTNmzDNm/zNmM2ZmZmZmmWZmzGZm/2ZmAJlmM5lmZplmmZlmzJlm/5lmAMxmM8xmZsxmmcxmzMxm/8xmAACZMwCZZgCZmQCZzACZ/wCZADOZMzOZZjOZmTOZzDOZ/zOZAGaZM2aZZmaZmWaZzGaZAJmZM5mZZpmZmZmZzJmZ/5mZAMyZM8yZZsyZmcyZzMyZ/8yZAP+ZAAAAAAAAAAAAAAAAAAAAAAAACIAAQxAAQeDDgA86PAjwEKBDAA4AFIBIYIJACQQISQQYYaBDAREnKCa4WEIHiQMkDHAUUeABCwcsGqyQqUMFgxQLUOSU4SBGzwkrdLxg4CJCiggoIFSIQSHGBBhPhUoo6gJCCxwabmTNYENHDQw1LtC4MMPCBq03uHL1KlashRwBAQA7");

const enc = new TextEncoder();
const str = (s) => enc.encode(s);
const cat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};
const be16 = (n) => new Uint8Array([n >> 8, n & 255]);
const be32 = (n) => new Uint8Array([n >>> 24, (n >> 16) & 255, (n >> 8) & 255, n & 255]);
const le32 = (n) => new Uint8Array([n & 255, (n >> 8) & 255, (n >> 16) & 255, n >>> 24]);
const le24 = (n) => new Uint8Array([n & 255, (n >> 8) & 255, (n >> 16) & 255]);

export const DATE = "2001:02:03 04:05:06";

// ---------- TIFF (EXIF), gros-boutiste ----------
const ASCII = 2, SHORT = 3, LONG = 4, RATIONAL = 5;
const asc = (tag, s) => ({ tag, type: ASCII, count: s.length + 1, data: str(s + "\0") });
const short = (tag, v) => ({ tag, type: SHORT, count: 1, data: cat(be16(v), new Uint8Array(2)) });
const rat = (tag, vals) => ({ tag, type: RATIONAL, count: vals.length, data: cat(...vals.flatMap((v) => [be32(v), be32(1)])) });
const ptr = (tag, ref) => ({ tag, type: LONG, count: 1, ref });

/**
 * TIFF : `ifds` dans l'ordre (le premier est l'IFD0, `next` relie IFD0 → IFD1) ; une entrée
 * `ref` reçoit la position d'un IFD (nombre) ou d'un bloc de `blobs` (nom).
 */
function tiff(ifds, blobs = {}) {
  const at = {};
  let o = 8;
  const size = (ifd) => 2 + ifd.entries.length * 12 + 4 + ifd.entries.reduce((n, e) => n + (e.data && e.data.length > 4 ? e.data.length + (e.data.length % 2) : 0), 0);
  ifds.forEach((ifd, i) => {
    at[i] = o;
    o += size(ifd);
  });
  for (const [k, v] of Object.entries(blobs)) {
    at[k] = o;
    o += v.length;
  }
  const out = new Uint8Array(o);
  out.set(str("MM\0*"), 0);
  out.set(be32(8), 4);
  ifds.forEach((ifd, i) => {
    let p = at[i];
    let data = p + 2 + ifd.entries.length * 12 + 4;
    out.set(be16(ifd.entries.length), p);
    p += 2;
    for (const e of ifd.entries) {
      out.set(be16(e.tag), p);
      out.set(be16(e.type), p + 2);
      out.set(be32(e.ref !== undefined ? 1 : e.count), p + 4);
      if (e.ref !== undefined) out.set(be32(e.ref === "len:thumb" ? blobs.thumb.length : at[e.ref]), p + 8);
      else if (e.data.length <= 4) out.set(e.data, p + 8);
      else {
        out.set(be32(data), p + 8);
        out.set(e.data, data);
        data += e.data.length + (e.data.length % 2);
      }
      p += 12;
    }
    out.set(be32(ifd.next !== undefined ? at[ifd.next] : 0), p);
  });
  for (const [k, v] of Object.entries(blobs)) out.set(v, at[k]);
  return out;
}

function exifTiff({ orientation, make = "ReperMake", thumb = true, extra = [] }) {
  const gps = [asc(1, "N"), rat(2, [12, 34, 56]), asc(3, "W"), rat(4, [65, 43, 21])];
  const ifd0 = [asc(0x010f, make), asc(0x0110, "ReperModel"), ...(orientation ? [short(0x0112, orientation)] : []), asc(0x0132, DATE), asc(0x0131, "ReperLogiciel"), ...extra, ptr(0x8769, 1), ptr(0x8825, 2)];
  const ifds = [{ entries: ifd0, next: thumb ? 3 : undefined }, { entries: [asc(0x9003, DATE), asc(0x9004, DATE)] }, { entries: gps }];
  if (!thumb) return tiff(ifds);
  ifds.push({ entries: [ptr(0x0201, "thumb"), { tag: 0x0202, type: LONG, count: 1, ref: "len:thumb" }] });
  return tiff(ifds, { thumb: cat(new Uint8Array([0xff, 0xd8]), str("ReperThumb"), new Uint8Array([0xff, 0xd9])) });
}

// ---------- JPEG ----------
const seg = (m, body) => cat(new Uint8Array([0xff, m]), be16(body.length + 2), body);
const JFIF = seg(0xe0, cat(str("JFIF\0"), new Uint8Array([1, 1, 0, 0, 1, 0, 1, 0, 0])));
const JFXX = seg(0xe0, cat(str("JFXX\0"), new Uint8Array([0x10]), str("ReperJFXX")));
const ADOBE = seg(0xee, cat(str("Adobe"), new Uint8Array([0, 100, 0, 0, 0, 0, 1])));
const XMP = (marker) => `<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:tiff="http://ns.adobe.com/tiff/1.0/" tiff:Make="${marker}" tiff:Model="ReperModel"/></rdf:RDF></x:xmpmeta><?xpacket end="w"?>`;
const iccParts = () => {
  const half = Math.ceil(ICC.length / 2);
  return [ICC.subarray(0, half), ICC.subarray(half)].map((p, i) => seg(0xe2, cat(str("ICC_PROFILE\0"), new Uint8Array([i + 1, 2]), p)));
};

function iphoneJpeg() {
  const exif = seg(0xe1, cat(str("Exif\0\0"), exifTiff({ orientation: 6 })));
  const xmp = seg(0xe1, cat(str("http://ns.adobe.com/xap/1.0/\0"), str(XMP("ReperXMP"))));
  const xmpExt = seg(0xe1, cat(str("http://ns.adobe.com/xmp/extension/\0"), str("0123456789ABCDEF0123456789ABCDEF"), be32(12), be32(0), str("ReperXMPExt!")));
  const mpf = seg(0xe2, cat(str("MPF\0"), str("MM\0*"), be32(8), str("ReperMPF")));
  const iptc = seg(0xed, cat(str("Photoshop 3.0\0"), str("8BIM\x04\x04\0\0\0\0\0\x0c\x1c\x02\x50\0\x09ReperIPTC")));
  const com = seg(0xfe, str("ReperCOM"));
  const second = cat(new Uint8Array([0xff, 0xd8]), seg(0xe1, cat(str("Exif\0\0"), exifTiff({ orientation: 1, make: "ReperSecond", thumb: false }))), JPG_BODY);
  const motion = cat(be32(24), str("ftypmp42"), be32(0), str("isommp42"), be32(20), str("mdat"), str("ReperMotion!"));
  return cat(new Uint8Array([0xff, 0xd8]), JFIF, JFXX, exif, xmp, xmpExt, ...iccParts(), mpf, iptc, com, ADOBE, JPG_BODY, second, motion);
}

function progressiveJpeg() {
  // Pillow : SOI, APP0, puis tables et 10 balayages avec marqueurs RST ; commentaire ajouté.
  return cat(JPG_PROG.subarray(0, 20), seg(0xfe, str("ReperCOM")), seg(0xe1, cat(str("Exif\0\0"), exifTiff({ orientation: 1, thumb: false }))), JPG_PROG.subarray(20));
}

// ---------- PNG ----------
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (b) => {
  let c = 0xffffffff;
  for (const v of b) c = crcTable[(c ^ v) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => cat(be32(data.length), str(type), data, be32(crc(cat(str(type), data))));
const PNG_SIG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function metaPng() {
  const fctl = (seq) => cat(be32(seq), be32(16), be32(8), be32(0), be32(0), be16(1), be16(10), new Uint8Array([0, 0]));
  return cat(
    PNG_SIG,
    chunk("IHDR", PNG_IHDR),
    chunk("iCCP", cat(str("sRGB\0\0"), deflateSync(ICC, { level: 9 }))),
    chunk("tEXt", str("Author\0ReperAuteur")),
    chunk("zTXt", cat(str("Comment\0\0"), deflateSync(str("ReperZ")))),
    chunk("iTXt", cat(str("XML:com.adobe.xmp\0\0\0\0\0"), str(XMP("ReperXMP")))),
    chunk("tIME", new Uint8Array([0x07, 0xd1, 2, 3, 4, 5, 6])),
    chunk("eXIf", exifTiff({ orientation: 8, thumb: false })),
    chunk("iDOT", str("ReperDOT")),
    chunk("acTL", cat(be32(2), be32(0))),
    chunk("fcTL", fctl(0)),
    chunk("IDAT", PNG_IDAT),
    chunk("fcTL", fctl(1)),
    chunk("fdAT", cat(be32(2), PNG_IDAT)),
    chunk("IEND", new Uint8Array(0)),
    str("ReperApres"),
  );
}

// ---------- WebP ----------
const riffChunk = (type, data) => cat(str(type), le32(data.length), data, data.length % 2 ? new Uint8Array(1) : new Uint8Array(0));
const riff = (body) => cat(str("RIFF"), le32(body.length + 4), str("WEBP"), body);

function metaWebp() {
  const vp8l = WEBP_VP8L; // bloc « VP8L » complet (en-tête compris)
  const anmf = (x) => riffChunk("ANMF", cat(le24(x), le24(0), le24(15), le24(7), le24(100), new Uint8Array([0]), vp8l));
  const vp8x = riffChunk("VP8X", cat(new Uint8Array([0x20 | 0x10 | 0x08 | 0x04 | 0x02, 0, 0, 0]), le24(15), le24(7)));
  return riff(cat(vp8x, riffChunk("ICCP", ICC), riffChunk("ANIM", cat(le32(0), new Uint8Array([0, 0]))), anmf(0), anmf(0), riffChunk("EXIF", exifTiff({ orientation: 1 })), riffChunk("XMP ", str(XMP("ReperXMP"))), riffChunk("ReP_", str("ReperInconnu"))));
}

// ---------- GIF ----------
function metaGif() {
  // Pillow : en-tête, palette, NETSCAPE2.0, puis 2 images ; commentaire et XMP ajoutés avant
  // la première image, texte après le terminateur.
  const body = GIF_ANIM;
  let o = 13 + (body[10] & 0x80 ? 3 << ((body[10] & 7) + 1) : 0);
  const xmpData = str(XMP("ReperXMP"));
  const magic = new Uint8Array(258);
  magic[0] = 1;
  for (let i = 1; i < 257; i++) magic[i] = 256 - i;
  const sub = (b) => {
    const parts = [];
    for (let i = 0; i < b.length; i += 255) parts.push(new Uint8Array([Math.min(255, b.length - i)]), b.subarray(i, i + 255));
    return cat(...parts, new Uint8Array([0]));
  };
  const comment = cat(new Uint8Array([0x21, 0xfe]), sub(str("ReperGIF")));
  const xmp = cat(new Uint8Array([0x21, 0xff, 11]), str("XMP DataXMP"), xmpData, magic);
  return cat(body.subarray(0, o), comment, xmp, body.subarray(o), str("ReperApres"));
}

// ---------- HEIF (structure ISOBMFF synthétique : aucun encodeur HEVC libre ici) ----------
const box = (type, ...parts) => {
  const body = cat(...parts);
  return cat(be32(body.length + 8), str(type), body);
};
const full = (type, version, flags, ...parts) => box(type, new Uint8Array([version, (flags >> 16) & 255, (flags >> 8) & 255, flags & 255]), ...parts);

function metaHeic() {
  const image = str("IMAGEDATA-HEVC-FICTIF");
  const exif = cat(be32(6), str("Exif\0\0"), exifTiff({ orientation: 6, thumb: false }));
  const xmp = str(XMP("ReperXMP"));
  const infe = (id, type, extra = new Uint8Array(0)) => full("infe", 2, 0, be16(id), be16(0), str(type), str("\0"), extra);
  const build = (mdatAt) => {
    const iloc = full(
      "iloc",
      1,
      0,
      new Uint8Array([0x44, 0x00]), // offset 4 octets, longueur 4 octets, base 0, index 0
      be16(3),
      cat(be16(1), be16(0), be16(0), be16(1), be32(mdatAt), be32(image.length)),
      cat(be16(2), be16(0), be16(0), be16(1), be32(mdatAt + image.length), be32(exif.length)),
      cat(be16(3), be16(1), be16(0), be16(1), be32(0), be32(xmp.length)), // méthode 1 : dans idat
    );
    const iinf = full("iinf", 0, 0, be16(3), infe(1, "hvc1"), infe(2, "Exif"), infe(3, "mime", str("application/rdf+xml\0")));
    const ipco = box("ipco", full("ispe", 0, 0, be32(16), be32(8)), box("irot", new Uint8Array([1])), full("udes", 0, 0, str("fr\0ReperTitre\0ReperDescription\0ReperMotcle\0")));
    const ipma = full("ipma", 0, 0, be32(1), be16(1), new Uint8Array([3, 0x81, 0x02, 0x03]));
    const meta = full("meta", 0, 0, full("hdlr", 0, 0, be32(0), str("pict"), new Uint8Array(12), str("\0")), full("pitm", 0, 0, be16(1)), iloc, iinf, full("iref", 0, 0, box("cdsc", be16(2), be16(1), be16(1))), box("iprp", ipco, ipma), box("idat", xmp));
    const ftyp = box("ftyp", str("heic"), be32(0), str("mif1heic"));
    const uuid = box("uuid", str("0123456789abcdef"), str("ReperUUID"));
    return { head: cat(ftyp, meta, uuid), meta };
  };
  const first = build(0);
  const mdatAt = first.head.length + 8;
  const { head } = build(mdatAt);
  return cat(head, box("mdat", image, exif));
}

// ---------- Documents (Task 9b) : ZIP, OOXML, ODF, PDF ----------
// Deflate en blocs « stockés » (valides, sans compression) : mêmes octets partout, quelle
// que soit la version de zlib, et la décompression est quand même exercée.
const le16 = (n) => new Uint8Array([n & 255, (n >> 8) & 255]);
function deflateStored(b) {
  const parts = [];
  for (let o = 0; o === 0 || o < b.length; o += 65535) {
    const n = Math.min(65535, b.length - o);
    parts.push(new Uint8Array([o + n >= b.length ? 1 : 0]), le16(n), le16(~n & 0xffff), b.subarray(o, o + n));
  }
  return cat(...parts);
}
function zlibStored(b) {
  let a = 1, s = 0;
  for (const x of b) {
    a = (a + x) % 65521;
    s = (s + a) % 65521;
  }
  return cat(new Uint8Array([0x78, 0x01]), deflateStored(b), be32(((s << 16) | a) >>> 0));
}
// Dates réelles de l'expéditeur (2001-02-03 04:05:06) et champ « extra » UT (heure Unix).
const DOS_T = (4 << 11) | (5 << 5) | 3;
const DOS_D = (21 << 9) | (2 << 5) | 3;
const UT = cat(le16(0x5455), le16(5), new Uint8Array([1]), le32(981173106));
/** Archive ZIP : entrées [nom, octets, { store }] ; `comment` : commentaire de l'archive. */
export function zipBytes(entries, comment = "") {
  const locals = [];
  const central = [];
  let pos = 0;
  for (const [name, data, opt = {}] of entries) {
    const nm = str(name);
    const body = opt.store ? data : deflateStored(data);
    const method = opt.store ? 0 : 8;
    const c = crc(data);
    const extra = opt.store ? new Uint8Array(0) : UT;
    const head = cat(le32(0x04034b50), le16(20), le16(0x0800), le16(method), le16(DOS_T), le16(DOS_D), le32(c), le32(body.length), le32(data.length), le16(nm.length), le16(extra.length), nm, extra);
    central.push(cat(le32(0x02014b50), le16(0x0314), le16(20), le16(0x0800), le16(method), le16(DOS_T), le16(DOS_D), le32(c), le32(body.length), le32(data.length), le16(nm.length), le16(extra.length), le16(0), le16(0), le16(0), le32(0x81a40000), le32(pos), nm, extra));
    locals.push(head, body);
    pos += head.length + body.length;
  }
  const cd = cat(...central);
  const cm = str(comment);
  return cat(...locals, cd, le32(0x06054b50), le16(0), le16(0), le16(entries.length), le16(entries.length), le32(cd.length), le32(pos), le16(cm.length), cm);
}

const X = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const NS_W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const CORE = (author) => `${X}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>ReperTitre</dc:title><dc:creator>${author}</dc:creator><cp:lastModifiedBy>${author}</cp:lastModifiedBy><cp:revision>7</cp:revision><dcterms:created xsi:type="dcterms:W3CDTF">2001-02-03T04:05:06Z</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">2001-02-03T04:05:06Z</dcterms:modified></cp:coreProperties>`;
const APP = `${X}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Template>ReperModele.dotm</Template><TotalTime>42</TotalTime><Application>ReperLogiciel</Application><Company>ReperSociete</Company><Manager>ReperResponsable</Manager></Properties>`;
const CUSTOM = `${X}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="2" name="Client"><vt:lpwstr>ReperCustom</vt:lpwstr></property></Properties>`;
const RELS_NS = 'xmlns="http://schemas.openxmlformats.org/package/2006/relationships"';
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const rootRels = (main) =>
  `${X}<Relationships ${RELS_NS}><Relationship Id="rId1" Type="${REL}/officeDocument" Target="${main}"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="${REL}/extended-properties" Target="docProps/app.xml"/><Relationship Id="rId4" Type="${REL}/custom-properties" Target="docProps/custom.xml"/><Relationship Id="rId5" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/thumbnail" Target="docProps/thumbnail.jpeg"/></Relationships>`;
const types = (overrides) =>
  `${X}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="jpeg" ContentType="image/jpeg"/>${overrides
    .map(([p, t]) => `<Override PartName="${p}" ContentType="${t}"/>`)
    .join("")}<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/><Override PartName="/docProps/custom.xml" ContentType="application/vnd.openxmlformats-officedocument.custom-properties+xml"/><Override PartName="/docProps/thumbnail.jpeg" ContentType="image/jpeg"/></Types>`;
const THUMB = () => cat(new Uint8Array([0xff, 0xd8]), seg(0xfe, str("ReperMiniature")), JPG_BODY.subarray(0));
const OD = "application/vnd.openxmlformats-officedocument";

function docxEntries() {
  const doc = `${X}<w:document ${NS_W}><w:body><w:p><w:commentRangeStart w:id="0"/><w:r><w:t>Bonjour Shhdrop</w:t></w:r><w:commentRangeEnd w:id="0"/><w:r><w:commentReference w:id="0"/></w:r></w:p><w:p><w:ins w:id="1" w:author="ReperSuivi" w:date="2002-03-04T05:06:07Z"><w:r><w:t>ajout suivi</w:t></w:r></w:ins></w:p><w:p><w:r><w:drawing><a:blip xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" r:embed="rId9"/></w:drawing></w:r></w:p></w:body></w:document>`;
  const comments = `${X}<w:comments ${NS_W}><w:comment w:id="0" w:author="ReperCommentateur" w:date="2001-02-03T04:05:06Z" w:initials="RC"><w:p><w:r><w:t>Un commentaire</w:t></w:r></w:p></w:comment></w:comments>`;
  const ext = `${X}<w16cex:commentsExtensible xmlns:w16cex="http://schemas.microsoft.com/office/word/2018/wordml/cex"><w16cex:commentExtensible w16cex:durableId="1A2B3C4D" w16cex:dateUtc="2001-02-03T04:05:06Z"/></w16cex:commentsExtensible>`;
  const people = `${X}<w15:people xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml"><w15:person w15:author="ReperCommentateur"><w15:presenceInfo w15:providerId="AD" w15:userId="S::reper@ReperCompte.example"/></w15:person></w15:people>`;
  const docRels = `${X}<Relationships ${RELS_NS}><Relationship Id="rId1" Type="${REL}/comments" Target="comments.xml"/><Relationship Id="rId2" Type="http://schemas.microsoft.com/office/2011/relationships/people" Target="people.xml"/><Relationship Id="rId3" Type="http://schemas.microsoft.com/office/2018/08/relationships/commentsExtensible" Target="commentsExtensible.xml"/><Relationship Id="rId9" Type="${REL}/image" Target="media/image1.jpeg"/></Relationships>`;
  return [
    ["[Content_Types].xml", str(types([["/word/document.xml", `${OD}.wordprocessingml.document.main+xml`], ["/word/comments.xml", `${OD}.wordprocessingml.comments+xml`], ["/word/people.xml", `${OD}.wordprocessingml.people+xml`], ["/word/commentsExtensible.xml", `${OD}.wordprocessingml.commentsExtensible+xml`]]))],
    ["_rels/.rels", str(rootRels("word/document.xml"))],
    ["docProps/core.xml", str(CORE("ReperAuteur"))],
    ["docProps/app.xml", str(APP)],
    ["docProps/custom.xml", str(CUSTOM)],
    ["docProps/thumbnail.jpeg", THUMB(), { store: true }],
    ["word/document.xml", str(doc)],
    ["word/_rels/document.xml.rels", str(docRels)],
    ["word/comments.xml", str(comments)],
    ["word/commentsExtensible.xml", str(ext)],
    ["word/people.xml", str(people)],
    ["word/media/image1.jpeg", iphoneJpeg(), { store: true }],
  ];
}

function metaXlsx() {
  const S = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
  const wb = `${X}<workbook ${S}><sheets><sheet name="Feuille1" sheetId="1" r:id="rId1"/></sheets></workbook>`;
  const sheet = `${X}<worksheet ${S}><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Bonjour Shhdrop</t></is></c></row></sheetData></worksheet>`;
  const comments = `${X}<comments ${S}><authors><author>ReperAuteurXL</author></authors><commentList><comment ref="A1" authorId="0"><text><t>Note</t></text></comment></commentList></comments>`;
  const TC = 'xmlns="http://schemas.microsoft.com/office/spreadsheetml/2018/threadedcomments"';
  const threaded = `${X}<ThreadedComments ${TC}><threadedComment ref="A1" dT="2001-02-03T04:05:06.00" personId="{00000000-0000-0000-0000-000000000001}" id="{00000000-0000-0000-0000-000000000002}"><text>Note</text></threadedComment></ThreadedComments>`;
  const persons = `${X}<personList ${TC}><person displayName="ReperPersonne" id="{00000000-0000-0000-0000-000000000001}" userId="reper@ReperCompte.example" providerId="AD"/></personList>`;
  return zipBytes([
    ["[Content_Types].xml", str(types([["/xl/workbook.xml", `${OD}.spreadsheetml.sheet.main+xml`], ["/xl/worksheets/sheet1.xml", `${OD}.spreadsheetml.worksheet+xml`], ["/xl/comments1.xml", `${OD}.spreadsheetml.comments+xml`]]))],
    ["_rels/.rels", str(rootRels("xl/workbook.xml"))],
    ["docProps/core.xml", str(CORE("ReperAuteur"))],
    ["docProps/app.xml", str(APP)],
    ["xl/workbook.xml", str(wb)],
    ["xl/_rels/workbook.xml.rels", str(`${X}<Relationships ${RELS_NS}><Relationship Id="rId1" Type="${REL}/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`)],
    ["xl/worksheets/sheet1.xml", str(sheet)],
    ["xl/comments1.xml", str(comments)],
    ["xl/threadedComments/threadedComment1.xml", str(threaded)],
    ["xl/persons/person.xml", str(persons)],
  ]);
}

function metaPptx() {
  const P = 'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
  const P188 = 'xmlns:p188="http://schemas.microsoft.com/office/powerpoint/2018/8/main"';
  return zipBytes([
    ["[Content_Types].xml", str(types([["/ppt/presentation.xml", `${OD}.presentationml.presentation.main+xml`]]))],
    ["_rels/.rels", str(rootRels("ppt/presentation.xml"))],
    ["docProps/core.xml", str(CORE("ReperAuteur"))],
    ["docProps/app.xml", str(APP)],
    ["ppt/presentation.xml", str(`${X}<p:presentation ${P}/>`)],
    ["ppt/commentAuthors.xml", str(`${X}<p:cmAuthorLst ${P}><p:cmAuthor id="0" name="ReperAuteurPPT" initials="RA" lastIdx="1" clrIdx="0"/></p:cmAuthorLst>`)],
    ["ppt/comments/comment1.xml", str(`${X}<p:cmLst ${P}><p:cm authorId="0" dt="2001-02-03T04:05:06.000" idx="1"><p:pos x="10" y="10"/><p:text>Note</p:text></p:cm></p:cmLst>`)],
    ["ppt/authors.xml", str(`${X}<p188:authorLst ${P188}><p188:author id="{00000000-0000-0000-0000-000000000003}" name="ReperAuteurPPT" initials="RA" userId="reper@ReperCompte.example" providerId="AD"/></p188:authorLst>`)],
    ["ppt/comments/modernComment_1.xml", str(`${X}<p188:cmLst ${P188}><p188:cm id="{00000000-0000-0000-0000-000000000004}" authorId="{00000000-0000-0000-0000-000000000003}" created="2001-02-03T04:05:06.000"><p188:txBody/></p188:cm></p188:cmLst>`)],
  ]);
}

function metaOdt() {
  const O = 'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:meta="urn:oasis:names:tc:opendocument:xmlns:meta:1.0"';
  const meta = `${X}<office:document-meta ${O} office:version="1.3"><office:meta><meta:initial-creator>ReperAuteurODF</meta:initial-creator><dc:creator>ReperAuteurODF</dc:creator><meta:creation-date>2001-02-03T04:05:06</meta:creation-date><dc:date>2001-02-03T04:05:06</dc:date><meta:editing-duration>PT42M</meta:editing-duration><meta:editing-cycles>7</meta:editing-cycles><meta:generator>ReperLogiciel</meta:generator><dc:title>ReperTitre</dc:title><meta:keyword>ReperMotcle</meta:keyword></office:meta></office:document-meta>`;
  const content = `${X}<office:document-content ${O} office:version="1.3"><office:body><office:text><text:tracked-changes><text:changed-region text:id="ct1"><text:insertion><office:change-info><dc:creator>ReperSuivi</dc:creator><dc:date>2002-03-04T05:06:07</dc:date></office:change-info></text:insertion></text:changed-region></text:tracked-changes><text:p>Bonjour Shhdrop<office:annotation><dc:creator>ReperAuteurODF</dc:creator><dc:date>2001-02-03T04:05:06</dc:date><meta:creator-initials>RA</meta:creator-initials><text:p>Un commentaire</text:p></office:annotation></text:p><text:p><text:change-start text:change-id="ct1"/>ajout suivi<text:change-end text:change-id="ct1"/></text:p></office:text></office:body></office:document-content>`;
  const M = 'xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0"';
  const manifest = `${X}<manifest:manifest ${M} manifest:version="1.3"><manifest:file-entry manifest:full-path="/" manifest:version="1.3" manifest:media-type="application/vnd.oasis.opendocument.text"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/><manifest:file-entry manifest:full-path="meta.xml" manifest:media-type="text/xml"/><manifest:file-entry manifest:full-path="Thumbnails/thumbnail.png" manifest:media-type="image/png"/><manifest:file-entry manifest:full-path="Pictures/image1.jpg" manifest:media-type="image/jpeg"/></manifest:manifest>`;
  return zipBytes([
    ["mimetype", str("application/vnd.oasis.opendocument.text"), { store: true }],
    ["content.xml", str(content)],
    ["meta.xml", str(meta)],
    ["Thumbnails/thumbnail.png", cat(PNG_SIG, chunk("tEXt", str("Comment\0ReperMiniature")))],
    ["Pictures/image1.jpg", iphoneJpeg(), { store: true }],
    ["META-INF/manifest.xml", str(manifest)],
  ], "ReperCommentaireZip");
}

/** PDF : objets [numéro, texte ou octets] ; `base` : PDF précédent { bytes, xrefAt } (mise à jour incrémentale). */
function pdfBytes(objs, trailer, { base = null, header = "%PDF-1.7\n%\xe2\xe3\xcf\xd3\n" } = {}) {
  const start = base ? base.bytes : str(header);
  const parts = [start];
  let pos = start.length;
  const offs = [];
  for (const [n, body] of objs) {
    const b = typeof body === "string" ? str(`${n} 0 obj\n${body}\nendobj\n`) : cat(str(`${n} 0 obj\n`), body, str("\nendobj\n"));
    offs.push([n, pos]);
    parts.push(b);
    pos += b.length;
  }
  const xrefAt = pos;
  const rows = [];
  offs.sort((a, b) => a[0] - b[0]);
  if (!base) rows.push("0 1\n0000000000 65535 f\r\n");
  for (const [n, o] of offs) rows.push(`${n} 1\n${String(o).padStart(10, "0")} 00000 n\r\n`);
  const prev = base ? ` /Prev ${base.xrefAt}` : "";
  const tail = str(`xref\n${rows.join("")}trailer\n<< ${trailer}${prev} >>\nstartxref\n${xrefAt}\n%%EOF\n`);
  return { bytes: cat(...parts, tail), xrefAt };
}
const stream = (dict, data) => cat(str(`<< ${dict} /Length ${data.length} >>\nstream\n`), typeof data === "string" ? str(data) : data, str("\nendstream"));
const ID = "/ID [<0123456789ABCDEF0123456789ABCDEF> <0123456789ABCDEF0123456789ABCDEF>]";
const utf16 = (s) => "<FEFF" + [...s].map((c) => c.charCodeAt(0).toString(16).padStart(4, "0").toUpperCase()).join("") + ">";
const PAGE_TEXT = "BT /F1 12 Tf 20 100 Td (Bonjour Shhdrop) Tj ET";
const basePdfObjs = (pageExtra = "") => [
  [2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>"],
  [3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >>${pageExtra} >>`],
  [4, stream("", PAGE_TEXT)],
  [5, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"],
];

function metaPdf() {
  const xmp = XMP("ReperXMP").replace("ReperModel", "ReperAuteur");
  const r1 = pdfBytes(
    [
      [1, "<< /Type /Catalog /Pages 2 0 R /Metadata 6 0 R >>"],
      ...basePdfObjs(" /Thumb 7 0 R /Metadata 8 0 R"),
      [6, stream("/Type /Metadata /Subtype /XML", xmp)],
      [7, stream("/Width 10 /Height 1 /ColorSpace /DeviceGray /BitsPerComponent 8", "ReperThumb")],
      [8, stream("/Type /Metadata /Subtype /XML", XMP("ReperXMPPage"))],
      [9, "<< /Author (ReperAncien) /Producer (ReperLogiciel) /CreationDate (D:20010203040506Z) >>"],
    ],
    `/Size 10 /Root 1 0 R /Info 9 0 R ${ID}`,
  );
  return pdfBytes([[10, `<< /Author (ReperAuteur \\(moi\\)) /Creator (ReperCreateur) /Producer (ReperLogiciel) /CreationDate (D:20010203040506+01'00') /Title ${utf16("ReperTitre")} >>`]], `/Size 11 /Root 1 0 R /Info 10 0 R ${ID}`, { base: r1 }).bytes;
}

/** PDF à flux xref (prédicteur PNG 12, filtre « Up ») ; `objstm` : /Info rangé dans un ObjStm. */
function xrefStreamPdf(objstm) {
  const head = str("%PDF-1.7\n%\xe2\xe3\xcf\xd3\n");
  const objs = [[1, "<< /Type /Catalog /Pages 2 0 R /Metadata 6 0 R >>"], ...basePdfObjs(), [6, stream("/Type /Metadata /Subtype /XML", XMP("ReperXMP"))]];
  const info = "<< /Author (ReperAuteur) /Producer (ReperLogiciel) /CreationDate (D:20010203040506Z) >>";
  if (objstm) {
    const inner = `7 0 ${info}`;
    objs.push([8, stream(`/Type /ObjStm /N 1 /First ${"7 0 ".length}`, inner)]);
  } else objs.push([7, info]);
  const parts = [head];
  let pos = head.length;
  const offs = new Map();
  for (const [n, body] of objs) {
    const b = typeof body === "string" ? str(`${n} 0 obj\n${body}\nendobj\n`) : cat(str(`${n} 0 obj\n`), body, str("\nendobj\n"));
    offs.set(n, pos);
    parts.push(b);
    pos += b.length;
  }
  const xn = 9;
  offs.set(xn, pos);
  const rows = [];
  for (let n = 0; n <= xn; n++) {
    if (n === 0) rows.push([0, 0, 255]);
    else if (objstm && n === 7) rows.push([2, 8, 0]);
    else if (offs.has(n)) rows.push([1, offs.get(n), 0]);
    else rows.push([0, 0, 0]);
  }
  // W [1 2 1], prédicteur PNG « Up » (filtre 2) : chaque ligne moins la précédente.
  const raw = rows.map(([t, a, b]) => [t, a >> 8, a & 255, b]);
  const pred = cat(...raw.map((r, k) => new Uint8Array([2, ...r.map((v, c) => (v - (k ? raw[k - 1][c] : 0)) & 255)])));
  const data = zlibStored(pred);
  const xs = cat(str(`${xn} 0 obj\n<< /Type /XRef /Size ${xn + 1} /W [1 2 1] /Root 1 0 R /Info 7 0 R ${ID} /Filter /FlateDecode /DecodeParms << /Predictor 12 /Columns 4 >> /Length ${data.length} >>\nstream\n`), data, str("\nendstream\nendobj\n"));
  return cat(...parts, xs, str(`startxref\n${pos}\n%%EOF\n`));
}

function signedPdf() {
  return pdfBytes(
    [
      [1, "<< /Type /Catalog /Pages 2 0 R /AcroForm << /SigFlags 3 /Fields [6 0 R] >> >>"],
      ...basePdfObjs(),
      [6, "<< /FT /Sig /T (Signature1) /V << /Type /Sig /Filter /Adobe.PPKLite /ByteRange [0 10 20 10] /Contents <0000> >> >>"],
      [7, "<< /Author (ReperAuteur) >>"],
    ],
    `/Size 8 /Root 1 0 R /Info 7 0 R ${ID}`,
  ).bytes;
}
function encryptedPdf() {
  return pdfBytes(
    [[1, "<< /Type /Catalog /Pages 2 0 R >>"], ...basePdfObjs(), [6, "<< /Filter /Standard /V 1 /R 2 /O <00> /U <00> /P -4 >>"], [7, "<< /Author (ReperAuteur) >>"]],
    `/Size 8 /Root 1 0 R /Info 7 0 R /Encrypt 6 0 R ${ID}`,
  ).bytes;
}

export function buildFixtures() {
  return {
    "iphone-like.jpg": iphoneJpeg(),
    "progressive.jpg": progressiveJpeg(),
    "meta.png": metaPng(),
    "meta.webp": metaWebp(),
    "simple.webp": WEBP_SIMPLE,
    "meta.gif": metaGif(),
    "meta.heic": metaHeic(),
    "meta.docx": zipBytes(docxEntries(), "ReperCommentaireZip"),
    "signed.docx": zipBytes([...docxEntries(), ["_xmlsignatures/sig1.xml", str(`${X}<Signature xmlns="http://www.w3.org/2000/09/xmldsig#"/>`)]]),
    "protected.docx": cat(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), new Uint8Array(504)),
    "meta.xlsx": metaXlsx(),
    "meta.pptx": metaPptx(),
    "meta.odt": metaOdt(),
    "meta.pdf": metaPdf(),
    "xref-stream.pdf": xrefStreamPdf(false),
    "objstm-info.pdf": xrefStreamPdf(true),
    "signed.pdf": signedPdf(),
    "encrypted.pdf": encryptedPdf(),
  };
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const dir = new URL("../src/media/fixtures/", import.meta.url);
  for (const [name, bytes] of Object.entries(buildFixtures())) writeFileSync(new URL(name, dir), bytes);
}
