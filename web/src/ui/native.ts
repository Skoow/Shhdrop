// Gestes natifs du téléphone, toujours avec repli : vibration brève et feuille de partage.
// D41-29 (décision du propriétaire, 9 novembre) : le partage natif reçoit le lien ET le mot de
// passe dans un même texte ; l'ouverture unique par défaut rend un vol visible (spec D41-29).

type Nav = { vibrate?: (p: number) => boolean; share?: (d: { text: string }) => Promise<void> } | undefined;
const nav = (): Nav => (typeof navigator === "undefined" ? undefined : (navigator as unknown as Nav));

/** Vibration légère (10 ms) si l'appareil la propose ; sans effet sinon, jamais d'erreur. */
export function haptic(n: Nav = nav()): void {
  try {
    if (typeof n?.vibrate === "function") n.vibrate(10);
  } catch {
    /* refusé (politique, page en arrière-plan) */
  }
}

export function canShareLink(n: Nav = nav()): boolean {
  return typeof n?.share === "function";
}

/**
 * Feuille de partage avec un texte (D41-29 : le lien ET le mot de passe, sur deux lignes) ;
 * « unavailable » sans API (le choix est alors absent).
 */
export async function shareText(text: string, n: Nav = nav()): Promise<"shared" | "cancelled" | "unavailable"> {
  if (!canShareLink(n)) return "unavailable";
  try {
    await n!.share!({ text });
    return "shared";
  } catch {
    return "cancelled"; // annulé par l'utilisateur, ou refusé
  }
}
