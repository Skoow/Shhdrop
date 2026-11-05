// Mouvement (UI §7.5, §7.6). Aucune bibliothèque : Web Animations API, transform seulement.
const REDUCE = "(prefers-reduced-motion: reduce)";

/** Lue à chaque appel : la préférence peut changer pendant la visite. */
export function reducedMotion(): boolean {
  try {
    return globalThis.matchMedia?.(REDUCE).matches === true;
  } catch {
    return false;
  }
}

/**
 * FLIP : mesure, applique `mutate` (changement d'ordre du DOM), puis anime chaque élément
 * déplacé de son ancienne place vers la nouvelle (transform seulement, 180 ms). En mouvement
 * réduit : `mutate` seul, sans animation (UI §7.5). Si `mutate` lève, rien n'est animé.
 */
export async function flip(elements: readonly Element[], mutate: () => void): Promise<void> {
  if (reducedMotion()) {
    mutate();
    return;
  }
  const first = elements.map((e) => e.getBoundingClientRect());
  mutate();
  const runs: Promise<unknown>[] = [];
  elements.forEach((el, i) => {
    const a = first[i]!;
    const b = el.getBoundingClientRect();
    const dx = a.left - b.left;
    const dy = a.top - b.top;
    if ((dx === 0 && dy === 0) || typeof el.animate !== "function") return;
    const anim = el.animate(
      [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "translate(0, 0)" }],
      { duration: 180, easing: "cubic-bezier(0.16, 1, 0.3, 1)" },
    );
    runs.push(anim.finished.catch(() => undefined));
  });
  await Promise.all(runs);
}
