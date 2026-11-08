// Fichiers d'essai du nettoyage des images (spec §35.2, Task 9a), construits octet par octet,
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

export function buildFixtures() {
  return {
    "iphone-like.jpg": iphoneJpeg(),
    "progressive.jpg": progressiveJpeg(),
    "meta.png": metaPng(),
    "meta.webp": metaWebp(),
    "simple.webp": WEBP_SIMPLE,
    "meta.gif": metaGif(),
    "meta.heic": metaHeic(),
  };
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const dir = new URL("../src/media/fixtures/", import.meta.url);
  for (const [name, bytes] of Object.entries(buildFixtures())) writeFileSync(new URL(name, dir), bytes);
}
