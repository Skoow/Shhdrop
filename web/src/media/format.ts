// Reconnaissance du format à nettoyer (spec §35.2) : octets magiques d'abord, puis type MIME,
// puis extension. Un nom ou un type menteur ne fait jamais sauter un analyseur.
import { ascii, startsWith } from "./bytes";

/** Images : nettoyées ici (Task 9a). */
export const IMAGE_FORMATS = ["jpeg", "png", "webp", "gif", "heif"] as const;
/** Nettoyage prévu (Tasks 9b et 9c) : « bientôt pris en charge » d'ici là. */
export const SOON_FORMATS = ["pdf", "ooxml", "odf", "mp4", "webm", "mp3", "ogg", "flac", "wav"] as const;
export type Format = (typeof IMAGE_FORMATS)[number] | (typeof SOON_FORMATS)[number] | "texte" | "inconnu";

/** Octets de tête à lire pour `detectFormat`. */
export const FORMAT_HEAD = 64;

const HEIF_BRANDS = new Set(["heic", "heix", "heim", "heis", "hevc", "hevx", "mif1", "msf1", "avif", "avis", "mif2"]);
const TEXT_EXT = new Set(["txt", "md", "csv", "json", "tsv", "log"]);
const OOXML_EXT = new Set(["docx", "docm", "dotx", "dotm", "xlsx", "xlsm", "xltx", "xltm", "pptx", "pptm", "potx", "potm", "ppsx", "ppsm"]);
const ODF_EXT = new Set(["odt", "ods", "odp", "odg", "ott", "ots", "otp"]);

function extOf(name: string): string {
  const d = name.lastIndexOf(".");
  return d > 0 ? name.slice(d + 1).toLowerCase() : "";
}

function ftyp(head: Uint8Array): Format | null {
  if (!startsWith(head, 4, "ftyp") || head.length < 12) return null;
  const size = ((head[0]! << 24) | (head[1]! << 16) | (head[2]! << 8) | head[3]!) >>> 0;
  const brands = [ascii(head, 8, 4)];
  for (let o = 16; o + 4 <= Math.min(size, head.length); o += 4) brands.push(ascii(head, o, 4));
  // Une image HEIF se reconnaît à sa marque principale ou compatible ; une vidéo MP4 peut
  // porter « mif1 » sans être une image : la marque principale décide d'abord.
  const major = brands[0]!;
  if (HEIF_BRANDS.has(major)) return "heif";
  if (/^(isom|iso\d|mp4\d|avc1|qt  |M4A |M4V |M4B |3gp\d|3g2\w|dash|f4v )$/u.test(major)) return "mp4";
  return brands.some((b) => HEIF_BRANDS.has(b)) ? "heif" : "mp4";
}

export function detectFormat(head: Uint8Array, mime: string, name: string): Format {
  const ext = extOf(name);
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return "jpeg";
  if (startsWith(head, 0, "\x89PNG\r\n\x1a\n")) return "png";
  if (startsWith(head, 0, "RIFF") && startsWith(head, 8, "WEBP")) return "webp";
  if (startsWith(head, 0, "RIFF") && startsWith(head, 8, "WAVE")) return "wav";
  if (startsWith(head, 0, "GIF87a") || startsWith(head, 0, "GIF89a")) return "gif";
  const iso = ftyp(head);
  if (iso) return iso;
  if (startsWith(head, 0, "\x1a\x45\xdf\xa3")) return "webm";
  if (startsWith(head, 0, "%PDF-")) return "pdf";
  if (startsWith(head, 0, "OggS")) return "ogg";
  if (startsWith(head, 0, "fLaC")) return "flac";
  if (startsWith(head, 0, "ID3")) return "mp3";
  if (startsWith(head, 0, "PK\x03\x04")) return OOXML_EXT.has(ext) ? "ooxml" : ODF_EXT.has(ext) ? "odf" : "inconnu";
  const m = mime.split(";")[0]!.trim().toLowerCase();
  if (m === "audio/mpeg" || ext === "mp3") return head[0] === 0xff && (head[1]! & 0xe0) === 0xe0 ? "mp3" : "inconnu";
  if (m.startsWith("text/plain") || m === "text/markdown" || m === "text/csv" || m === "application/json" || TEXT_EXT.has(ext)) return "texte";
  return "inconnu";
}
