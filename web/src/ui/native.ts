// Gestes natifs du téléphone, toujours avec repli : vibration brève et feuille de partage.
// Le partage natif reçoit le lien OU le mot de passe, jamais les deux dans le même partage
// (spec : deux secrets, deux canaux ; deux gestes distincts sur « Lien prêt »).

type Nav = { vibrate?: (p: number) => boolean; share?: (d: { url: string } | { text: string }) => Promise<void> } | undefined;
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

/** Feuille de partage avec le lien seul ; « unavailable » sans API (le bouton est alors absent). */
export async function shareLink(url: string, n: Nav = nav()): Promise<"shared" | "cancelled" | "unavailable"> {
  if (!canShareLink(n)) return "unavailable";
  try {
    await n!.share!({ url });
    return "shared";
  } catch {
    return "cancelled"; // annulé par l'utilisateur, ou refusé
  }
}

/** Feuille de partage avec le mot de passe seul (texte, sans lien) : à envoyer par un autre canal. */
export async function sharePassword(password: string, n: Nav = nav()): Promise<"shared" | "cancelled" | "unavailable"> {
  if (!canShareLink(n)) return "unavailable";
  try {
    await n!.share!({ text: password });
    return "shared";
  } catch {
    return "cancelled";
  }
}
