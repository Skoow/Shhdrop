// Routeur interne (UI §9). Il ne lit que le chemin : jamais le « # » (clé du lien) ni la requête.
export type Route = {
  name: "home" | "open" | "manage" | "securite" | "confidentialite" | "notfound";
  id?: string;
};

const ID = /^[A-Za-z0-9_-]+$/;

export function match(pathname: string, base: string = import.meta.env.BASE_URL): Route {
  const prefix = base.endsWith("/") ? base.slice(0, -1) : base; // "" ou "/Shhdrop"
  let p = pathname;
  if (prefix !== "") {
    if (p === prefix) p = "/";
    else if (p.startsWith(prefix + "/")) p = p.slice(prefix.length);
    else return { name: "notfound" };
  }
  if (p === "/") return { name: "home" };
  if (p === "/securite") return { name: "securite" };
  if (p === "/confidentialite") return { name: "confidentialite" };
  const parts = p.split("/"); // ["", "s", id]
  if (parts.length === 3 && parts[0] === "" && (parts[1] === "s" || parts[1] === "m") && ID.test(parts[2]!))
    return { name: parts[1] === "s" ? "open" : "manage", id: parts[2]! };
  return { name: "notfound" };
}

export const router = $state<{ current: Route }>({
  current: typeof location === "undefined" ? { name: "home" } : match(location.pathname),
});

// Ne réaffecte que si la route change (nom ou identifiant) : un popstate sans effet
// (changement de « # », lien vers la page courante) ne relance ni les effets ni le focus.
function sync(): void {
  const next = match(location.pathname);
  const cur = router.current;
  if (next.name !== cur.name || next.id !== cur.id) router.current = next;
}

if (typeof window !== "undefined") window.addEventListener("popstate", sync);

const base = () => import.meta.env.BASE_URL;

/** Adresse complète d'un chemin de l'application (préfixe de dépôt en démo). */
export function href(path: string): string {
  return base().replace(/\/$/, "") + path;
}

/** Chemin interne seulement : « /… », sans « // », « \ », « # » ni « ? » (aucun secret ne transite ici). */
export function navigate(path: string): void {
  if (!/^\/(?!\/)[^\\#?]*$/.test(path)) throw new Error("chemin interne attendu");
  history.pushState(null, "", href(path));
  sync();
  if (typeof window.scrollTo === "function") window.scrollTo(0, 0);
}

/** Gestionnaire de clic pour un <a href> interne : navigation sans rechargement, sauf clic modifié. */
export function followLink(e: MouseEvent, path: string): void {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  e.preventDefault();
  navigate(path);
}
