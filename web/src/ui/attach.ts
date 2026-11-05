// Attachements de mouvement de l'accueil v3 (UI §9.1, §20.4, §20.6). Styles par CSSOM seulement
// (setProperty, classList : S6), aucune bibliothèque, aucune lecture de mise en page en boucle.
import { reducedMotion } from "./motion";

/**
 * Ambiance (§20.6 point 5) : la classe `still` met en pause les boucles de `node` (règle CSS
 * `.still … { animation-play-state: paused }`) hors écran et onglet caché.
 * À poser sur un élément dont l'attribut class est statique (Svelte le réécrirait sinon).
 */
export function ambient(node: Element): () => void {
  let onscreen = true;
  const sync = () => node.classList.toggle("still", document.hidden || !onscreen);
  const io =
    typeof IntersectionObserver === "undefined"
      ? null
      : new IntersectionObserver(([e]) => {
          onscreen = e!.isIntersecting;
          sync();
        });
  io?.observe(node);
  document.addEventListener("visibilitychange", sync);
  sync();
  return () => {
    io?.disconnect();
    document.removeEventListener("visibilitychange", sync);
  };
}

/** Vrai si le navigateur anime au défilement en CSS (`animation-timeline: view()`). */
export function scrollTimeline(): boolean {
  try {
    return globalThis.CSS?.supports?.("animation-timeline: view()") === true;
  } catch {
    return false;
  }
}

/**
 * Révélation au défilement, repli sans `animation-timeline` (WebKit, Firefox) : `rv-wait` cache
 * l'élément (opacité, translation) jusqu'à son entrée dans l'écran, puis `in` le révèle une fois.
 * Rien en mouvement réduit, ni quand le CSS s'en charge, ni sans IntersectionObserver : le
 * contenu n'est jamais caché si ce code ne tourne pas.
 */
export function reveal(node: Element): (() => void) | void {
  if (reducedMotion() || scrollTimeline() || typeof IntersectionObserver === "undefined") return;
  node.classList.add("rv-wait");
  const io = new IntersectionObserver(
    ([e]) => {
      if (!e!.isIntersecting) return;
      node.classList.add("in");
      io.disconnect();
    },
    { rootMargin: "0px 0px -8% 0px" },
  );
  io.observe(node);
  return () => io.disconnect();
}

/**
 * Suit le pointeur fin (hors mouvement réduit) : `write(x, y, largeur, hauteur)` une fois par
 * image au plus, `reset()` à la sortie. Rien au doigt.
 */
function follow(node: HTMLElement, write: (x: number, y: number, w: number, h: number) => void, reset: () => void) {
  if (reducedMotion() || globalThis.matchMedia?.("(hover: hover) and (pointer: fine)").matches !== true) return;
  let raf = 0;
  let ev: PointerEvent | null = null;
  const move = (e: PointerEvent) => {
    ev = e;
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      if (!ev) return;
      const b = node.getBoundingClientRect();
      write(ev.clientX - b.left, ev.clientY - b.top, b.width, b.height);
    });
  };
  const leave = () => {
    ev = null;
    reset();
  };
  node.addEventListener("pointermove", move);
  node.addEventListener("pointerleave", leave);
  return () => {
    cancelAnimationFrame(raf);
    node.removeEventListener("pointermove", move);
    node.removeEventListener("pointerleave", leave);
  };
}

/** Tuile magnétique : `--tx`/`--ty` (±3 px vers le pointeur), `--lx`/`--ly` (reflet sous le pointeur). */
export function magnet(node: HTMLElement): (() => void) | void {
  const set = (k: string, v: string) => node.style.setProperty(k, v);
  return follow(
    node,
    (x, y, w, h) => {
      set("--lx", `${Math.round(x)}px`);
      set("--ly", `${Math.round(y)}px`);
      set("--tx", `${((x / w - 0.5) * 6).toFixed(2)}px`);
      set("--ty", `${((y / h - 0.5) * 6).toFixed(2)}px`);
    },
    () => {
      set("--tx", "0px");
      set("--ty", "0px");
    },
  );
}

/** Inclinaison du réceptacle vers le pointeur : `--rx`/`--ry` en degrés (±2 et ±2,5). */
export function tilt(node: HTMLElement): (() => void) | void {
  const set = (k: string, v: string) => node.style.setProperty(k, v);
  return follow(
    node,
    (x, y, w, h) => {
      set("--ry", `${((x / w - 0.5) * 5).toFixed(2)}deg`);
      set("--rx", `${((0.5 - y / h) * 4).toFixed(2)}deg`);
    },
    () => {
      set("--rx", "0deg");
      set("--ry", "0deg");
    },
  );
}
