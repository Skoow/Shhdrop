// Format d'un élément pour son icône et son étiquette de type (listes du composeur et du
// destinataire). Le contenu (octets de tête, flows/sniff.ts) l'emporte sur l'extension quand il
// est reconnu : un exécutable renommé « photo.jpg » s'affiche « EXE ». Chez le destinataire, le
// contenu n'est pas lu avant le téléchargement : l'extension du nom nettoyé et la visionneuse
// permise (previewKind) décident. Étiquettes génériques maison : aucun logo de marque.
import type { Sniffed } from "../flows/sniff";

export type Family = "pdf" | "doc" | "sheet" | "slides" | "text" | "code" | "archive" | "image" | "video" | "audio" | "exec" | "disk" | "font" | "book" | "note" | "file";

export type Format = {
  /** Étiquette courte dans l'icône (« PDF », « DOC »…) ; "" : icône générique de la famille. */
  label: string;
  family: Family;
};

const EXT: Record<string, Format> = {};
const put = (family: Family, label: string, exts: string[]) => {
  for (const e of exts) EXT[e] = { family, label: label || e.toUpperCase() };
};
put("pdf", "PDF", ["pdf"]);
put("doc", "DOC", ["doc", "docx", "odt", "rtf", "pages"]);
put("sheet", "XLS", ["xls", "xlsx", "ods", "numbers"]);
put("sheet", "CSV", ["csv", "tsv"]);
put("slides", "PPT", ["ppt", "pptx", "odp", "key"]);
put("text", "TXT", ["txt", "log"]);
put("text", "MD", ["md"]);
put("code", "CODE", ["json", "xml", "yaml", "yml", "toml", "ini", "sql", "css", "js", "mjs", "ts", "tsx", "jsx", "py", "c", "h", "cpp", "hpp", "java", "kt", "go", "rs", "rb", "php", "swift", "cs", "lua", "r", "sh", "html", "htm"]);
put("archive", "", ["zip", "rar", "7z", "tar", "gz", "tgz", "bz2", "xz", "zst"]);
put("image", "JPG", ["jpg", "jpeg"]);
put("image", "", ["png", "gif", "webp", "avif", "heic", "heif", "bmp", "tif", "tiff", "svg"]);
put("video", "", ["mp4", "mov", "m4v", "webm", "mkv", "avi", "3gp"]);
put("audio", "", ["mp3", "m4a", "aac", "ogg", "oga", "opus", "wav", "flac", "weba"]);
put("exec", "", ["exe", "msi", "apk", "dmg", "app", "bat", "cmd", "com", "scr", "ps1", "vbs", "jar", "deb", "rpm", "ipa", "appimage"]);
put("disk", "ISO", ["iso", "img"]);
put("font", "", ["ttf", "otf", "woff", "woff2"]);
put("book", "EPUB", ["epub"]);
EXT["tiff"] = { family: "image", label: "TIF" };
EXT["heif"] = { family: "image", label: "HEIC" };
EXT["htm"] = { family: "code", label: "HTML" };
EXT["html"] = { family: "code", label: "HTML" };
EXT["svg"] = { family: "image", label: "SVG" };
EXT["appimage"] = { family: "exec", label: "APP" };
EXT["woff2"] = { family: "font", label: "WOFF" };
/** Extensions connues (tests : chaque libellé tient en 4 caractères). */
export const KNOWN_EXTS: readonly string[] = Object.keys(EXT);

const SNIFF: Partial<Record<NonNullable<Sniffed>, Format>> = {
  zip: { family: "archive", label: "ZIP" },
  rar: { family: "archive", label: "RAR" },
  "7z": { family: "archive", label: "7Z" },
  gzip: { family: "archive", label: "GZ" },
  bzip2: { family: "archive", label: "BZ2" },
  xz: { family: "archive", label: "XZ" },
  zstd: { family: "archive", label: "ZST" },
  tar: { family: "archive", label: "TAR" },
  exe: { family: "exec", label: "EXE" },
  elf: { family: "exec", label: "BIN" },
  macho: { family: "exec", label: "BIN" },
  iso: { family: "disk", label: "ISO" },
  font: { family: "font", label: "FONT" },
  pdf: { family: "pdf", label: "PDF" },
  jpeg: { family: "image", label: "JPG" },
  png: { family: "image", label: "PNG" },
  gif: { family: "image", label: "GIF" },
  webp: { family: "image", label: "WEBP" },
  heic: { family: "image", label: "HEIC" },
  avif: { family: "image", label: "AVIF" },
  ogg: { family: "audio", label: "OGG" },
  wav: { family: "audio", label: "WAV" },
  mp3: { family: "audio", label: "MP3" },
};

/** Familles reconnues par le contenu qui ne cèdent jamais à l'extension. */
const STRICT = new Set<Family>(["exec", "disk", "archive", "pdf", "image", "font"]);

export type FormatInput = {
  kind: "file" | "text";
  /** Extension sans le point, en minuscules ("" si aucune). */
  ext: string;
  sniffed?: Sniffed;
  /** Visionneuse permise chez le destinataire (liste blanche de types MIME). */
  preview?: "image" | "audio" | "video" | "text" | "pdf" | "none";
};


export function formatOf(x: FormatInput): Format {
  if (x.kind === "text") return { family: "note", label: "" };
  const byExt = EXT[x.ext];
  if (x.sniffed) {
    const s = SNIFF[x.sniffed];
    // Un document bureautique est un zip : l'extension le précise (« DOC », « XLS »…).
    if (x.sniffed === "zip" && byExt && byExt.family !== "archive") return labelled(byExt, x.ext);
    if (s && STRICT.has(s.family)) return s;
    if (x.sniffed === "mp4" || x.sniffed === "webm") {
      const audio = byExt?.family === "audio";
      const media = byExt && (byExt.family === "audio" || byExt.family === "video");
      return { family: audio ? "audio" : "video", label: media ? byExt.label : x.sniffed === "webm" ? "WEBM" : "MP4" };
    }
    if (s) return s;
  }
  if (byExt) return labelled(byExt, x.ext);
  // Inconnu par l'extension : la visionneuse permise donne au moins la famille.
  if (x.preview === "image" || x.preview === "video" || x.preview === "audio") return { family: x.preview, label: short(x.ext) };
  if (x.preview === "pdf") return { family: "pdf", label: "PDF" };
  return { family: "file", label: short(x.ext) };
}

function labelled(f: Format, ext: string): Format {
  return f.label ? f : { family: f.family, label: short(ext) };
}
function short(ext: string): string {
  return /^[a-z0-9]{1,4}$/.test(ext) ? ext.toUpperCase() : "";
}

/** Clé i18n de l'étiquette de type affichée dans la ligne (« Document PDF »…). */
export function typeKey(f: Format) {
  return `format.${f.family}` as const;
}

/** Libellé écrit dans l'icône : 4 caractères au plus, sinon abrégé (les 4 premiers). */
export function abbr(s: string): string {
  const up = s.trim().toUpperCase();
  return up.length <= 4 ? up : up.slice(0, 4);
}
