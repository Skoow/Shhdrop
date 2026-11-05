// Entrées du composeur hors sélecteur (UI §9.2.2, §9.2.3) : dépôt, collage, presse-papier.
// Aucune lecture du presse-papier sans geste explicite (Ctrl/Cmd + V, bouton Coller).

/**
 * Fichiers d'un dépôt ; les dossiers sont refusés (pas aplatis). Les entrées sont lues
 * pendant l'événement (un DataTransferItem n'est plus lisible après).
 */
export function filesFromDrop(dt: DataTransfer): Promise<{ files: File[]; folders: string[] }> {
  const files: File[] = [];
  const folders: string[] = [];
  const items = [...(dt.items ?? [])].filter((it) => it.kind === "file");
  if (items.length > 0) {
    for (const it of items) {
      const entry = typeof it.webkitGetAsEntry === "function" ? it.webkitGetAsEntry() : null;
      if (entry?.isDirectory) folders.push(entry.name);
      else {
        const f = it.getAsFile();
        if (f) files.push(f);
      }
    }
  } else files.push(...(dt.files ?? []));
  return Promise.resolve({ files, folders });
}

/**
 * Collage (Ctrl/Cmd + V) : des fichiers sont toujours ajoutés, même avec le focus dans un champ
 * (`native: false` → l'appelant fait preventDefault) ; du texte dans un champ suit le
 * comportement natif ; du texte hors champ devient un élément Texte. Jamais `text/html`.
 */
export function fromPasteEvent(e: ClipboardEvent, focusInTextField: boolean): { files: File[]; text: string | null; native: boolean } {
  const files = [...(e.clipboardData?.files ?? [])];
  if (files.length > 0) return { files, text: null, native: false };
  if (focusInTextField) return { files: [], text: null, native: true };
  const text = e.clipboardData?.getData("text/plain") ?? "";
  return { files: [], text: text === "" ? null : text, native: false };
}

const IMAGE_TYPES: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" };

/** Bouton Coller : images (png, jpeg, webp, gif) et texte brut. */
export async function fromClipboardRead(
  items: readonly ClipboardItem[],
  name: (n: number, ext: string) => string = (n, ext) => `Image collée ${n}.${ext}`,
): Promise<{ files: File[]; text: string | null }> {
  const files: File[] = [];
  let text: string | null = null;
  for (const item of items) {
    const img = item.types.find((t) => Object.hasOwn(IMAGE_TYPES, t));
    if (img) {
      const blob = await item.getType(img);
      files.push(new File([blob], name(files.length + 1, IMAGE_TYPES[img]!), { type: img }));
    } else if (text === null && item.types.includes("text/plain")) {
      const t = await (await item.getType("text/plain")).text();
      if (t !== "") text = t;
    }
  }
  return { files, text };
}

/** Le glisser contient-il des fichiers ? */
export const dragHasFiles = (e: DragEvent) => [...(e.dataTransfer?.types ?? [])].includes("Files");

/** Compteur d'entrées/sorties : le voile ne clignote pas en passant sur des éléments enfants. */
export function dragDepth() {
  let depth = 0;
  return {
    /** Vrai : le voile doit être ouvert. */
    enter(_e?: DragEvent): boolean {
      depth++;
      return true;
    },
    /** Vrai : le voile reste ouvert. */
    leave(_e?: DragEvent): boolean {
      depth = Math.max(0, depth - 1);
      return depth > 0;
    },
    reset(): void {
      depth = 0;
    },
  };
}
