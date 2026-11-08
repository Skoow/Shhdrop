// Copie dans le presse-papiers (UI §8 CopyField). Sans API ou refus : « manual », l'écran
// montre alors la valeur sélectionnée pour une copie à la main.
// Dernière valeur copiée par cette page, en mémoire seulement : sert à ne vider le
// presse-papiers que s'il la contient encore (audit F2).
let lastCopied: string | null = null;

export async function copyText(text: string): Promise<"copied" | "manual"> {
  try {
    const clip = globalThis.navigator?.clipboard;
    if (!clip || typeof clip.writeText !== "function") return "manual";
    await clip.writeText(text);
    lastCopied = text;
    return "copied";
  } catch {
    return "manual";
  }
}

export type ClearResult = "cleared" | "changed" | "unverified" | "nothing";

/**
 * Vide le presse-papiers seulement s'il contient encore exactement la dernière copie de cette
 * page (audit F2) : on n'efface jamais ce que la personne y a mis depuis. La lecture n'est
 * tentée que si elle est déjà permise (aucune invite) ; le site refuse `clipboard-read=()`
 * (§10, audit F3), donc en production : « unverified », rien n'est effacé, et l'écran le dit.
 * Ne lève jamais ; la valeur retenue est oubliée dans tous les cas.
 */
export async function clearClipboard(): Promise<ClearResult> {
  const want = lastCopied;
  lastCopied = null;
  if (want === null) return "nothing";
  try {
    const nav = globalThis.navigator;
    const perm = await nav?.permissions?.query({ name: "clipboard-read" as PermissionName });
    if (perm?.state !== "granted" || typeof nav?.clipboard?.readText !== "function") return "unverified";
    if ((await nav.clipboard.readText()) !== want) return "changed";
    await nav.clipboard.writeText("");
    return "cleared";
  } catch {
    return "unverified";
  }
}
