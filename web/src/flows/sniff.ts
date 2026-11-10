// Reconnaissance du type d'un fichier par ses premiers octets (« nombres magiques »), en plus
// de l'extension : un exécutable renommé en « photo.jpg » ne passe pas pour une photo. Lecture
// bornée (HEAD_BYTES), jamais le fichier entier. Aucun réseau, aucune bibliothèque.

/** Octets lus en tête : de quoi voir « CD001 » d'une image ISO (secteur 16, octet 32 769). */
export const HEAD_BYTES = 32774;

export type Sniffed =
  | "zip"
  | "rar"
  | "7z"
  | "gzip"
  | "bzip2"
  | "xz"
  | "zstd"
  | "tar"
  | "exe"
  | "elf"
  | "macho"
  | "iso"
  | "font"
  | "pdf"
  | "jpeg"
  | "png"
  | "gif"
  | "webp"
  | "heic"
  | "avif"
  | "mp4"
  | "webm"
  | "ogg"
  | "wav"
  | "mp3"
  | null;

const starts = (b: Uint8Array, sig: readonly number[], at = 0) => b.length >= at + sig.length && sig.every((x, i) => b[at + i] === x);
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));

export function sniff(b: Uint8Array): Sniffed {
  if (starts(b, [0x50, 0x4b, 0x03, 0x04]) || starts(b, [0x50, 0x4b, 0x05, 0x06]) || starts(b, [0x50, 0x4b, 0x07, 0x08])) return "zip";
  if (starts(b, ascii("Rar!\x1a\x07"))) return "rar";
  if (starts(b, [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])) return "7z";
  if (starts(b, [0x1f, 0x8b])) return "gzip";
  if (starts(b, ascii("BZh"))) return "bzip2";
  if (starts(b, [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00])) return "xz";
  if (starts(b, [0x28, 0xb5, 0x2f, 0xfd])) return "zstd";
  if (starts(b, ascii("ustar"), 257)) return "tar";
  if (starts(b, ascii("MZ"))) return "exe";
  if (starts(b, [0x7f, 0x45, 0x4c, 0x46])) return "elf";
  if (starts(b, [0xfe, 0xed, 0xfa, 0xce]) || starts(b, [0xfe, 0xed, 0xfa, 0xcf]) || starts(b, [0xce, 0xfa, 0xed, 0xfe]) || starts(b, [0xcf, 0xfa, 0xed, 0xfe]) || starts(b, [0xca, 0xfe, 0xba, 0xbe])) return "macho";
  if (starts(b, ascii("CD001"), 32769)) return "iso";
  if (starts(b, [0x00, 0x01, 0x00, 0x00, 0x00]) || starts(b, ascii("OTTO")) || starts(b, ascii("wOFF")) || starts(b, ascii("wOF2"))) return "font";
  if (starts(b, ascii("%PDF-"))) return "pdf";
  if (starts(b, [0xff, 0xd8, 0xff])) return "jpeg";
  if (starts(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
  if (starts(b, ascii("GIF8"))) return "gif";
  if (starts(b, ascii("RIFF")) && starts(b, ascii("WEBP"), 8)) return "webp";
  if (starts(b, ascii("RIFF")) && starts(b, ascii("WAVE"), 8)) return "wav";
  if (starts(b, ascii("ftyp"), 4)) {
    const brand = String.fromCharCode(...b.slice(8, 12));
    if (["heic", "heix", "hevc", "mif1", "msf1", "heis"].includes(brand)) return "heic";
    if (["avif", "avis"].includes(brand)) return "avif";
    return "mp4";
  }
  if (starts(b, [0x1a, 0x45, 0xdf, 0xa3])) return "webm";
  if (starts(b, ascii("OggS"))) return "ogg";
  if (starts(b, ascii("ID3")) || starts(b, [0xff, 0xfb]) || starts(b, [0xff, 0xf3])) return "mp3";
  return null;
}

/** Conteneurs zip qui ne sont pas des archives pour la personne (bureautique, livre, appli). */
export const ZIP_NOT_ARCHIVE = new Set(["docx", "xlsx", "pptx", "odt", "ods", "odp", "epub", "pages", "numbers", "key", "vsdx", "jar", "apk", "xpi", "crx", "msix", "appx", "ipa"]);
const ARCHIVE_SNIFF = new Set<Sniffed>(["zip", "rar", "7z", "gzip", "bzip2", "xz", "zstd", "tar"]);
const EXEC_SNIFF = new Set<Sniffed>(["exe", "elf", "macho"]);

/** Archive d'après le contenu ; un document bureautique (zip) n'en est pas une. */
export function isArchiveSniff(s: Sniffed, ext: string): boolean {
  return ARCHIVE_SNIFF.has(s) && !(s === "zip" && ZIP_NOT_ARCHIVE.has(ext));
}
export function isExecutableSniff(s: Sniffed): boolean {
  return EXEC_SNIFF.has(s);
}

/**
 * Type d'un fichier dont le navigateur ne donne aucun type (File.type vide, fréquent pour MKV,
 * FLAC ou HEIC selon le système) : d'après l'extension, pour les seuls formats que le site sait
 * afficher (retours CLEAN5) ; sinon « application/octet-stream » (téléchargement seulement).
 */
const EXT_MIME: Readonly<Record<string, string>> = {
  ".mkv": "video/x-matroska",
  ".mka": "audio/x-matroska",
  ".flac": "audio/flac",
  ".mov": "video/quicktime",
  ".m4a": "audio/mp4",
  ".opus": "audio/ogg",
  ".heic": "image/heic",
  ".pdf": "application/pdf",
};
export function mimeFromExt(ext: string): string {
  return EXT_MIME[ext.toLowerCase()] ?? "application/octet-stream";
}
