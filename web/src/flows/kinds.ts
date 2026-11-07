// Catégories du composeur (UI §9.2.4) : ordre fixe, qui est aussi l'ordre du manifeste.
// Le contenu (octets de tête, sniff.ts) l'emporte sur l'extension quand il est reconnu.
import { isArchiveSniff, isExecutableSniff, type Sniffed } from "./sniff";

export type Category = "texte" | "photos" | "videos" | "audio" | "documents" | "archives" | "autres";
export const CATEGORY_ORDER: readonly Category[] = ["texte", "photos", "videos", "audio", "documents", "archives", "autres"];

const IMAGE_EXT = new Set(["jpg", "jpeg", "png", "webp", "gif", "avif", "heic", "heif", "bmp", "tif", "tiff", "svg"]);
const VIDEO_EXT = new Set(["mp4", "mov", "m4v", "webm", "mkv", "avi", "3gp"]);
const AUDIO_EXT = new Set(["mp3", "m4a", "aac", "ogg", "oga", "opus", "wav", "flac", "weba"]);
/** Documents : bureautique, tableurs, présentations, livres, textes et fichiers de code. */
const DOC_EXT = new Set([
  "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "odt", "ods", "odp", "rtf", "txt", "md", "csv", "tsv", "pages", "numbers", "key", "epub",
  "json", "xml", "yaml", "yml", "toml", "ini", "log", "sql", "css", "ts", "tsx", "jsx", "py", "c", "h", "cpp", "hpp", "java", "kt", "go", "rs", "rb", "php", "swift", "cs", "lua", "r",
]);
export const ARCHIVE_EXT = new Set(["zip", "rar", "7z", "tar", "gz", "tgz", "bz2", "tbz2", "xz", "txz", "zst"]);

/** Extension sans le point, en minuscules ; "" si aucune. */
export function extOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

export function categoryOf(kind: "file" | "text", name: string, mime: string, sniffed: Sniffed = null): Category {
  if (kind === "text") return "texte";
  const m = mime.split(";")[0]!.trim().toLowerCase();
  const e = extOf(name);
  // Le contenu d'abord : un exécutable, une image disque ou une police ne passe jamais pour une photo.
  if (sniffed) {
    if (isArchiveSniff(sniffed, e)) return "archives";
    if (isExecutableSniff(sniffed) || sniffed === "iso" || sniffed === "font") return "autres";
    if (["jpeg", "png", "gif", "webp", "heic", "avif"].includes(sniffed)) return "photos";
    if (sniffed === "pdf") return "documents";
    if (sniffed === "ogg" || sniffed === "wav" || sniffed === "mp3") return "audio";
    if ((sniffed === "mp4" || sniffed === "webm") && (m.startsWith("audio/") || AUDIO_EXT.has(e))) return "audio";
    if (sniffed === "mp4" || sniffed === "webm") return "videos";
  }
  if (ARCHIVE_EXT.has(e) || m === "application/zip" || m === "application/x-7z-compressed" || m === "application/vnd.rar" || m === "application/gzip") return "archives";
  if (m.startsWith("image/") || IMAGE_EXT.has(e)) return "photos";
  if (m.startsWith("video/") || VIDEO_EXT.has(e)) return "videos";
  if (m.startsWith("audio/") || AUDIO_EXT.has(e)) return "audio";
  if (DOC_EXT.has(e) || m === "application/pdf" || m.startsWith("text/")) return "documents";
  return "autres";
}

/**
 * Catégorie d'un élément reçu (UI §9.8), purement visuelle : la visionneuse permise
 * (previewKind), sinon la même table que categoryOf (extension du nom nettoyé, type MIME du
 * manifeste). Ce type n'est lu que pour choisir le groupe : jamais affiché, jamais donné à un Blob.
 */
export function categoryOfReceived(
  kind: "file" | "text",
  preview: "image" | "audio" | "video" | "text" | "pdf" | "none",
  safeName: string,
  manifestMime: string,
): Category {
  if (kind === "text" || preview === "text") return "texte";
  if (preview === "image") return "photos";
  if (preview === "video") return "videos";
  if (preview === "audio") return "audio";
  if (preview === "pdf") return "documents";
  return categoryOf("file", safeName, manifestMime);
}
