// Présentation commune d'un élément du composeur (lignes, grille, tableau) : icône, première
// ligne d'une note, type affiché, vignette (URL blob de la propre donnée de l'expéditeur,
// révoquée dès le chargement et à la sortie).
import type { ComposeItem } from "../flows/compose.svelte";
import { STRIP_MAX } from "../index";
import { AudioLines, File as FileIcon, FileArchive, FileTerminal, FileText, Film, Image as ImageIcon, NotebookPen } from "./Icon";

export function iconFor(i: ComposeItem) {
  if (i.risky) return FileTerminal;
  switch (i.category) {
    case "texte":
      return NotebookPen;
    case "photos":
      return ImageIcon;
    case "videos":
      return Film;
    case "audio":
      return AudioLines;
    case "documents":
      return FileText;
    case "archives":
      return FileArchive;
    default:
      return FileIcon;
  }
}

/** Première ligne non vide d'une note (sous-titre dans la liste). */
export function firstLine(text: string | undefined, max = 120): string {
  const line = (text ?? "").split(/\r?\n/).find((l) => l.trim() !== "") ?? "";
  return line.length > max ? line.slice(0, max) : line;
}

/** Type affiché dans le tableau : l'extension en capitales (« PDF », « ZIP »), sinon « — ». */
export function typeLabel(i: ComposeItem): string {
  return i.ext ? i.ext.slice(1).toUpperCase() : "—";
}

const THUMBABLE = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"]);
export function canThumb(i: ComposeItem): boolean {
  return i.kind === "file" && !i.risky && THUMBABLE.has(i.mime.toLowerCase()) && i.size <= STRIP_MAX;
}

/** Attachement d'une vignette ; `onfail` si l'image ne se décode pas (HEIC hors Safari). */
export function thumb(item: ComposeItem, onfail: () => void) {
  return (node: HTMLImageElement) => {
    const data = item.data;
    const blob = data instanceof Blob ? data : new Blob([data as BlobPart], { type: item.mime });
    const url = URL.createObjectURL(blob);
    let revoked = false;
    const revoke = () => {
      if (!revoked) URL.revokeObjectURL(url);
      revoked = true;
    };
    node.onload = revoke;
    node.onerror = () => {
      revoke();
      onfail();
    };
    node.src = url;
    return revoke;
  };
}

/**
 * Nom raccourci au milieu (« photo-de-vac…tagne.jpg ») : le début et la fin, extension comprise,
 * restent lisibles ; `max` points de code au plus. Affichage seulement : le nom complet reste
 * dans le nom accessible et l'infobulle.
 */
export function middleEllipsis(name: string, max: number): string {
  const cps = [...name];
  if (cps.length <= max) return name;
  const head = Math.ceil((max - 1) / 2) + 1;
  const tail = max - 1 - head;
  return cps.slice(0, head).join("") + "…" + cps.slice(cps.length - tail).join("");
}
