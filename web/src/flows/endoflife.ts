// Fin de vie chez le destinataire (UI §9.8 pied, §9.10, §12.2).
// - Fin de lecture complète (fermeture « partage disparu », gone.svelte.ts) : done() → wipe() →
//   révocation des URL. Plus de bouton « Terminer et effacer » (retours UI4, décision du propriétaire).
// - Sortie de page (pagehide, démontage) : wipe() et révocation seulement, SANS done() (spec
//   §41.4, D42-22) : l'ouverture reste valable jusqu'à l'échéance, pour qu'un rechargement ou un
//   retour depuis ce navigateur la rouvre.
// - Détruire, Signaler : opened.destroy() (ou destroy("report"), motif non conservé), puis
//   wipe() ; la dissolution (onDestroyed) ne commence qu'après la réponse du serveur.
import { LimitError, NotFoundError, type Opened } from "../index";
import { revokeAll } from "../viewers/blobs";

/** Sortie de page : effacement local, aucune requête (l'octroi rouvre l'ouverture au rechargement). */
export function release(opened: Opened): void {
  opened.wipe();
  revokeAll();
}

/**
 * Fin de lecture complète. Ne lève jamais : un done() en échec (réseau) n'empêche
 * pas l'effacement local ; le serveur efface de toute façon à l'échéance.
 */
export async function finish(opened: Opened): Promise<void> {
  try {
    await opened.done();
  } catch {
    /* réseau : sans conséquence pour l'effacement local */
  } finally {
    opened.wipe();
    revokeAll();
  }
}

export type DestroyOutcome = "destroyed" | "gone" | "network" | "limit";

/**
 * Détruire (report = false) ou Signaler (report = true) depuis l'écran de contenu.
 * - succès → wipe(), révocation, onDestroyed(), « destroyed » ;
 * - NotFoundError (déjà expiré ou détruit) → même fin, « gone » ;
 * - 429 (LimitError) → rien n'est effacé, « limit » : « Trop de demandes… » (ruling 7) ;
 * - toute autre erreur (réseau) → rien n'est effacé, « network » : Réessayer reste possible.
 */
export async function destroyFromContent(
  opened: Opened,
  report: boolean,
  deps: { onDestroyed: () => void } = { onDestroyed: () => undefined },
): Promise<DestroyOutcome> {
  let outcome: DestroyOutcome;
  try {
    await (report ? opened.destroy("report") : opened.destroy());
    outcome = "destroyed";
  } catch (e) {
    if (e instanceof LimitError) return "limit";
    if (!(e instanceof NotFoundError)) return "network";
    outcome = "gone";
  }
  opened.wipe();
  revokeAll();
  deps.onDestroyed();
  return outcome;
}
