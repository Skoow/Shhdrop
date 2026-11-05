// Copie dans le presse-papiers (UI §8 CopyField). Sans API ou refus : « manual », l'écran
// montre alors la valeur sélectionnée pour une copie à la main. Aucune lecture du presse-papiers.
let copied = false;

export async function copyText(text: string): Promise<"copied" | "manual"> {
  try {
    const clip = globalThis.navigator?.clipboard;
    if (!clip || typeof clip.writeText !== "function") return "manual";
    await clip.writeText(text);
    copied = true;
    return "copied";
  } catch {
    return "manual";
  }
}

/**
 * Efface le presse-papiers, au mieux, seulement si cette page y a copié quelque chose (on ne
 * touche pas à ce que l'utilisateur y a mis ailleurs). Ne lève jamais.
 */
export async function clearClipboard(): Promise<void> {
  if (!copied) return;
  copied = false;
  try {
    await globalThis.navigator?.clipboard?.writeText("");
  } catch {
    /* refus : rien d'autre à faire */
  }
}
