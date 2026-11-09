// Présentation d'un élément du composeur.
import { previewKindOf } from "../index";

/**
 * Aperçu d'un élément du composeur (menu « Aperçu », toucher l'icône) : mêmes règles que chez
 * le destinataire (liste blanche de types, taille au plus PREVIEW_MAX, jamais SVG, HTML ni PDF :
 * aucune visionneuse PDF sûre n'existe ici). Un programme à risque n'a jamais d'aperçu.
 */
export function composePreview(i: { kind: "file" | "text"; mime: string; size: number; risky?: boolean }): "image" | "video" | "audio" | "text" | null {
  if (i.kind === "text") return "text";
  if (i.risky) return null;
  const k = previewKindOf({ kind: "file", mime: i.mime, size: i.size } as Parameters<typeof previewKindOf>[0]);
  return k === "image" || k === "video" || k === "audio" ? k : null;
}
