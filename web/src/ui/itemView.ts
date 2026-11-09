// Présentation d'un élément du composeur : première ligne d'une note (sous-titre dans la liste).
import { previewKindOf } from "../index";

/** Première ligne non vide d'une note (sous-titre dans la liste). */
export function firstLine(text: string | undefined, max = 120): string {
  const line = (text ?? "").split(/\r?\n/).find((l) => l.trim() !== "") ?? "";
  return line.length > max ? line.slice(0, max) : line;
}

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
