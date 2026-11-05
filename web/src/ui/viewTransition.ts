// Transitions de vue du même document (UI §20.2 K2, §20.4). Le rappel est SYNCHRONE (mutation
// du DOM seulement, jamais d'attente réseau) : le navigateur fige le rendu jusqu'à sa fin. Le
// premier appui ou la première touche saute la transition (skipTransition) : rien n'attend
// une animation plus que la fenêtre bloquante (≤ 420 ms). Sans l'API : changement direct.
import { reducedMotion } from "./motion";

type ViewTransitionLike = {
  finished: Promise<void>;
  updateCallbackDone: Promise<void>;
  skipTransition(): void;
};
type DocWithVT = Document & { startViewTransition?: (cb: () => void) => ViewTransitionLike };

export async function runTransition(update: () => void, opts: { reduced?: boolean } = {}): Promise<void> {
  const doc = document as DocWithVT;
  if (typeof doc.startViewTransition !== "function") {
    update();
    return;
  }
  const root = doc.documentElement;
  // Mouvement réduit : fondu de 120 ms seulement (base.css, html.vt-reduced).
  const reduced = opts.reduced ?? reducedMotion();
  if (reduced) root.classList.add("vt-reduced");
  const vt = doc.startViewTransition.call(doc, update);
  const skip = () => vt.skipTransition();
  doc.addEventListener("pointerdown", skip, { capture: true, once: true });
  doc.addEventListener("keydown", skip, { capture: true, once: true });
  try {
    await vt.finished.catch(() => undefined);
  } finally {
    doc.removeEventListener("pointerdown", skip, { capture: true });
    doc.removeEventListener("keydown", skip, { capture: true });
    if (reduced) root.classList.remove("vt-reduced");
  }
  // Une exception du rappel remonte à l'appelant.
  await vt.updateCallbackDone;
}
