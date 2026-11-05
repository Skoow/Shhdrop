// Clavier virtuel (UI §9) : ouvert quand visualViewport.height < 0,75 × hauteur de référence.

export function keyboardOpen(vv: VisualViewport | null, innerHeight: number): boolean {
  return vv !== null && innerHeight > 0 && vv.height < 0.75 * innerHeight;
}

const FIELD = "input, textarea, select, [contenteditable]";

/**
 * Suit l'ouverture du clavier et appelle `set` à chaque changement (et une fois au départ).
 * Référence = plus grande `innerHeight` vue à la largeur courante : avec
 * `interactive-widget=resizes-content` (Chrome Android), `innerHeight` rétrécit avec le clavier
 * et ne peut pas servir seule ; elle repart à chaque changement de largeur (rotation).
 * Seulement avec un pointeur grossier (téléphone, tablette) : sur ordinateur, réduire la
 * fenêtre n'est pas un clavier. À l'ouverture, le champ actif est amené au centre.
 */
export function watchKeyboard(
  w: Window,
  set: (open: boolean) => void,
  coarse: () => boolean = () => w.matchMedia?.("(pointer: coarse)").matches === true,
  active: () => Element | null = () => w.document.activeElement,
): () => void {
  let width = w.innerWidth;
  let ref = w.innerHeight;
  let open: boolean | undefined;
  const update = () => {
    if (w.innerWidth !== width) {
      width = w.innerWidth;
      ref = w.innerHeight;
    }
    ref = Math.max(ref, w.innerHeight);
    const next = coarse() && keyboardOpen(w.visualViewport, ref);
    if (next === open) return;
    open = next;
    set(next);
    const el = next ? active() : null;
    if (el?.matches(FIELD)) el.scrollIntoView({ block: "center" });
  };
  update();
  const vv = w.visualViewport;
  vv?.addEventListener("resize", update);
  w.addEventListener("resize", update);
  return () => {
    vv?.removeEventListener("resize", update);
    w.removeEventListener("resize", update);
  };
}
