// Présentation d'un élément du composeur : première ligne d'une note (sous-titre dans la liste).

/** Première ligne non vide d'une note (sous-titre dans la liste). */
export function firstLine(text: string | undefined, max = 120): string {
  const line = (text ?? "").split(/\r?\n/).find((l) => l.trim() !== "") ?? "";
  return line.length > max ? line.slice(0, max) : line;
}
