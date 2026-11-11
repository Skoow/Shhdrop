// Lecteur bloqué (vidéo, audio) : certains navigateurs (WebKit sans le décodeur, par exemple pour
// du HEVC) ne lisent pas le fichier mais ne signalent jamais d'erreur ; l'aperçu resterait vide.
// Le fichier est déjà entier en mémoire (URL blob:), ses métadonnées arrivent en quelques
// millisecondes : sans aucune donnée après STALL_MS, le lecteur est traité comme illisible
// (message « ce navigateur ne sait pas lire le format », Télécharger reste proposé).

export const STALL_MS = 10_000;

/** HTMLMediaElement.HAVE_NOTHING : aucune information sur le média. */
const HAVE_NOTHING = 0;

type MediaLike = Pick<HTMLMediaElement, "readyState" | "error" | "addEventListener" | "removeEventListener">;

/** Action Svelte : appelle `onstall` si le lecteur n'a toujours rien chargé après `ms`. */
export function stallGuard(el: MediaLike, opts: { onstall: () => void; ms?: number }) {
  let onstall = opts.onstall;
  const clear = () => {
    clearTimeout(timer);
    el.removeEventListener("loadedmetadata", clear);
    el.removeEventListener("error", clear);
  };
  const timer = setTimeout(() => {
    clear();
    if (el.readyState === HAVE_NOTHING && el.error === null) onstall();
  }, opts.ms ?? STALL_MS);
  el.addEventListener("loadedmetadata", clear);
  el.addEventListener("error", clear);
  return {
    update(next: { onstall: () => void; ms?: number }) {
      onstall = next.onstall;
    },
    destroy: clear,
  };
}
