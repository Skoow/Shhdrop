// Cycle de vie de la page (UI §12.2, §9.4.6, §9.2.2).

/** Rappel à `pagehide` (arrêt d'envoi, effacement). Rend la fonction de retrait. */
export function onPageHide(cb: () => void): () => void {
  const h = () => cb();
  window.addEventListener("pagehide", h);
  return () => window.removeEventListener("pagehide", h);
}

/** Page restaurée du cache « page précédente » : rechargement (aucun état déchiffré ne revient). */
export function reloadIfRestored(w: Window): void {
  w.addEventListener("pageshow", (e) => {
    if ((e as PageTransitionEvent).persisted) w.location.reload();
  });
}

/** Dialogue de sortie du navigateur tant que `active()` est vrai (relu à chaque tentative). */
export function guardUnload(active: () => boolean): () => void {
  const h = (e: BeforeUnloadEvent) => {
    if (!active()) return;
    e.preventDefault();
    e.returnValue = ""; // anciens Chrome et Edge
  };
  window.addEventListener("beforeunload", h);
  return () => window.removeEventListener("beforeunload", h);
}

/**
 * Hors du composeur (`allow()` faux), un fichier déposé ne doit pas faire naviguer l'onglet
 * vers lui (ce qui abandonnerait un envoi ou perdrait un contenu ouvert). Écoute en capture :
 * aucun élément ne peut l'éviter par stopPropagation.
 */
export function guardFileDrop(w: Window, allow: () => boolean): () => void {
  const h = (e: Event) => {
    if (allow()) return;
    e.preventDefault();
    const dt = (e as DragEvent).dataTransfer;
    if (dt) dt.dropEffect = "none";
  };
  w.addEventListener("dragover", h, true);
  w.addEventListener("drop", h, true);
  return () => {
    w.removeEventListener("dragover", h, true);
    w.removeEventListener("drop", h, true);
  };
}
