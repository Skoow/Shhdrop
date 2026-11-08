// Copie dans le presse-papiers (UI §8 CopyField). Sans API ou refus : « manual », l'écran
// montre alors la valeur sélectionnée pour une copie à la main.
// Pas de « Vider le presse-papier » : le site refuse `clipboard-read=()` (§10), la page ne peut
// donc pas vérifier que le presse-papiers contient encore sa copie ; elle n'efface rien.

export async function copyText(text: string): Promise<"copied" | "manual"> {
  try {
    const clip = globalThis.navigator?.clipboard;
    if (!clip || typeof clip.writeText !== "function") return "manual";
    await clip.writeText(text);
    return "copied";
  } catch {
    return "manual";
  }
}
