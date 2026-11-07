// Composeur sur téléphone : glisser une ligne vers la gauche pour la retirer (geste natif). Le
// bouton « Retirer » reste (clavier, lecteurs d'écran) ; « Annuler » suit dans un avis. Toucher
// seulement : à la souris, le glisser sert à réordonner. Le défilement vertical garde la main.
const LOCK_PX = 10;
const RATIO = 0.35;

export function swipeAxis(dx: number, dy: number): "x" | "y" | null {
  if (Math.hypot(dx, dy) < LOCK_PX) return null;
  return Math.abs(dx) > Math.abs(dy) * 1.5 ? "x" : "y";
}

export function swipeEnd(dx: number, width: number): "remove" | "back" {
  return dx < 0 && -dx >= width * RATIO ? "remove" : "back";
}

/** Attache Svelte ({@attach}) ; la ligne suit le doigt (translate), la variable --swipe (0 à 1) règle le fond. */
export function swipeToRemove(onremove: () => void, o: { reduced?: boolean } = {}) {
  return (node: HTMLElement) => {
    let x0 = 0;
    let y0 = 0;
    let dx = 0;
    let axis: "x" | "y" | null = null;
    let active = false;
    const set = (px: number) => {
      node.style.translate = px === 0 ? "" : `${px}px 0`;
      node.classList.toggle("swiping", px !== 0);
      node.style.setProperty("--swipe", String(Math.min(1, -px / (node.offsetWidth * RATIO || 1))));
    };
    const down = (e: PointerEvent) => {
      if (e.pointerType !== "touch" || !e.isPrimary) return;
      active = true;
      axis = null;
      dx = 0;
      x0 = e.clientX;
      y0 = e.clientY;
      node.classList.remove("swipe-back");
    };
    const move = (e: PointerEvent) => {
      if (!active) return;
      const mx = e.clientX - x0;
      axis ??= swipeAxis(mx, e.clientY - y0);
      if (axis !== "x") {
        if (axis === "y") active = false;
        return;
      }
      try {
        node.setPointerCapture?.(e.pointerId);
      } catch {
        /* pointeur déjà relâché */
      }
      dx = Math.min(0, mx);
      set(dx);
    };
    const up = () => {
      if (!active) return;
      active = false;
      if (axis !== "x") return;
      if (swipeEnd(dx, node.offsetWidth) === "remove") {
        if (!o.reduced) set(-node.offsetWidth);
        onremove();
      } else {
        node.classList.add("swipe-back");
        set(0);
      }
    };
    const cancel = () => {
      active = false;
      node.classList.add("swipe-back");
      set(0);
    };
    node.addEventListener("pointerdown", down);
    node.addEventListener("pointermove", move);
    node.addEventListener("pointerup", up);
    node.addEventListener("pointercancel", cancel);
    return () => {
      node.removeEventListener("pointerdown", down);
      node.removeEventListener("pointermove", move);
      node.removeEventListener("pointerup", up);
      node.removeEventListener("pointercancel", cancel);
    };
  };
}
