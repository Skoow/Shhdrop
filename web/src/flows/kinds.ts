// Catégories du composeur (UI §9.2.4) : ordre fixe, qui est aussi l'ordre du manifeste.
export type Category = "texte" | "photos" | "videos" | "audio" | "documents" | "autres";
export const CATEGORY_ORDER: readonly Category[] = ["texte", "photos", "videos", "audio", "documents", "autres"];

const IMAGE_EXT = new Set(["jpg", "jpeg", "png", "webp", "gif", "avif", "heic", "heif", "bmp", "tif", "tiff", "svg"]);
const VIDEO_EXT = new Set(["mp4", "mov", "m4v", "webm", "mkv", "avi", "3gp"]);
const AUDIO_EXT = new Set(["mp3", "m4a", "aac", "ogg", "oga", "opus", "wav", "flac", "weba"]);
const DOC_EXT = new Set(["pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "odt", "ods", "odp", "rtf", "txt", "md", "csv", "pages", "numbers", "key", "epub"]);

/** Extension sans le point, en minuscules ; "" si aucune. */
export function extOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

export function categoryOf(kind: "file" | "text", name: string, mime: string): Category {
  if (kind === "text") return "texte";
  const m = mime.split(";")[0]!.trim().toLowerCase();
  const e = extOf(name);
  if (m.startsWith("image/") || IMAGE_EXT.has(e)) return "photos";
  if (m.startsWith("video/") || VIDEO_EXT.has(e)) return "videos";
  if (m.startsWith("audio/") || AUDIO_EXT.has(e)) return "audio";
  if (DOC_EXT.has(e) || m === "application/pdf" || m.startsWith("text/")) return "documents";
  return "autres";
}
