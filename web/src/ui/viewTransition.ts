// Transitions de vue du même document (UI §20.2 K2, §20.4). Le rappel est SYNCHRONE (mutation
// du DOM seulement, jamais d'attente réseau) : le navigateur fige le rendu jusqu'à sa fin. Le
// premier appui ou la première touche saute la transition (skipTransition) : rien n'attend
// une animation plus que la fenêtre bloquante (≤ 420 ms). Sans l'API : changement direct.
import { reducedMotion } from "./motion";

type ViewTransitionLike = {
  ready: Promise<void>;
  finished: Promise<void>;
  updateCallbackDone: Promise<void>;
  skipTransition(): void;
};
type DocWithVT = Document & { startViewTransition?: (cb: () => void) => ViewTransitionLike };

/**
 * Délai après lequel un rappel jamais appelé fait sauter la transition. Le navigateur n'appelle le
 * rappel qu'après avoir peint l'état d'avant ; si cette peinture tarde (WebKit au démarrage à
 * froid, machine saturée), la mise à jour de l'écran attendrait avec elle, sans limite. Les
 * pages normales appellent le rappel à l'image suivante (~16 ms) : 420 ms = la fenêtre bloquante
 * de l'interface (UI §20.2 K2). skipTransition() appelle alors le rappel sans animation.
 */
export const STALL_MS = 420;

/**
 * `back` : retour en arrière (annuler, nouvel envoi) ; sur téléphone, l'écran glisse vers la
 * droite au lieu de la gauche (base.css, html.vt-back).
 */
export async function runTransition(update: () => void, opts: { reduced?: boolean; back?: boolean } = {}): Promise<void> {
  const doc = document as DocWithVT;
  if (typeof doc.startViewTransition !== "function") {
    update();
    return;
  }
  const root = doc.documentElement;
  // Mouvement réduit : fondu de 120 ms seulement (base.css, html.vt-reduced).
  const reduced = opts.reduced ?? reducedMotion();
  if (reduced) root.classList.add("vt-reduced");
  if (opts.back) root.classList.add("vt-back");
  let called = false;
  const vt = doc.startViewTransition.call(doc, () => {
    called = true;
    update();
  });
  // skipTransition() (appui, touche, délai) rejette `ready` (AbortError « Transition was
  // skipped ») : sans gestionnaire, une exception non attrapée par clic (audit D1). Une
  // exception du rappel rejette `updateCallbackDone` avant la fin de `finished` : marquée
  // traitée ici, elle remonte quand même par l'`await` final.
  void vt.ready.catch(() => undefined);
  void vt.updateCallbackDone.catch(() => undefined);
  const stall = setTimeout(() => {
    if (!called) vt.skipTransition();
  }, STALL_MS);
  const skip = () => vt.skipTransition();
  doc.addEventListener("pointerdown", skip, { capture: true, once: true });
  doc.addEventListener("keydown", skip, { capture: true, once: true });
  try {
    await vt.finished.catch(() => undefined);
  } finally {
    clearTimeout(stall);
    doc.removeEventListener("pointerdown", skip, { capture: true });
    doc.removeEventListener("keydown", skip, { capture: true });
    if (reduced) root.classList.remove("vt-reduced");
    if (opts.back) root.classList.remove("vt-back");
  }
  // Une exception du rappel remonte à l'appelant.
  await vt.updateCallbackDone;
}
