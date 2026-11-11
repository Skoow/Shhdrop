// URL blob du destinataire (UI §9.8, §12.4) : seul point où le contenu reçu devient une URL.
// Le type du Blob vient d'une table fixe (TYPE_SUR), jamais du manifeste tel quel ; aucune URL
// n'est créée pour un type hors de cette table. Toute URL créée est suivie pour être révoquée
// à la fin (Terminer, destruction, sortie de page) ; une image l'est dès son chargement.
import type { PreviewKind } from "../index";

/**
 * Types sûrs par visionneuse. SVG absent : jamais affiché (scan de sécurité du 7 novembre),
 * comme HTML et XML. Un type de vidéo ou d'audio inconnu prend le type par défaut de la
 * visionneuse (le navigateur reconnaît le conteneur au contenu).
 */
export const TYPE_SUR = {
  image: ["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif", "image/heic"],
  audio: ["audio/mpeg", "audio/mp4", "audio/aac", "audio/ogg", "audio/webm", "audio/wav", "audio/flac", "audio/x-flac", "audio/x-matroska"],
  video: ["video/mp4", "video/quicktime", "video/webm", "video/x-matroska"],
} as const;

const DEFAULT = { audio: "audio/mp4", video: "video/mp4" } as const;

/** Type du Blob d'aperçu, ou null : pas d'aperçu (aucune URL ne doit être créée). */
export function safeBlobType(kind: PreviewKind, manifestMime: string): string | null {
  // PDF : jamais d'URL ; le Blob part tel quel vers le cadre isolé (PdfViewer, UI §13).
  if (kind === "pdf") return "application/pdf";
  if (kind !== "image" && kind !== "audio" && kind !== "video") return null;
  const m = manifestMime.split(";")[0]!.trim().toLowerCase();
  const list: readonly string[] = TYPE_SUR[kind];
  if (list.includes(m)) return m;
  return kind === "image" ? null : DEFAULT[kind];
}

const live = new Set<string>();

/** URL blob suivie (révoquée par revoke ou revokeAll). */
export function trackUrl(blob: Blob): string {
  const url = URL.createObjectURL(blob);
  live.add(url);
  return url;
}

export function revoke(url: string): void {
  if (!live.delete(url)) return;
  URL.revokeObjectURL(url);
}

/** Révoque toutes les URL encore vivantes (Terminer, destruction, pagehide). */
export function revokeAll(): void {
  for (const u of live) URL.revokeObjectURL(u);
  live.clear();
}

/** Nombre d'URL vivantes (tests). */
export function liveUrls(): number {
  return live.size;
}
