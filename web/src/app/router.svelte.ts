// Routeur interne (UI §9). Il lit le chemin et, à la racine seulement, la FORME du « # »
// (spec §32 : « #<43> » partage, « #m<43> » gestion) sans jamais en garder le contenu : la
// clé est lue une fois par readLink (app/link.ts), puis retirée de l'adresse.
import { flushSync } from "svelte";
import { MANAGE_FRAGMENT, SHARE_FRAGMENT } from "../index";

// Lien du QR code (D41-29) : « #<K_lien>. » suivi du mot de passe, même mal formé (écran de saisie).
const SHARE_PW_PREFIX = /^#[A-Za-z0-9_-]{43}\./;
import { runTransition } from "../ui/viewTransition";

/**
 * Marque de l'entrée d'historique d'une ouverture déverrouillée (aucun secret) : un
 * rechargement de cette entrée, sans « # », revient à l'écran d'ouverture : état « reopen »
 * si l'onglet garde l'octroi (spec §41.4), sinon « Lien incomplet » (Terminer, destruction,
 * 30 min d'inactivité…). Une autre entrée (accueil) reste l'accueil.
 */
export const REOPEN_MARK = "shhOg";
export function markReopen(h: History): void {
  h.replaceState({ [REOPEN_MARK]: true }, "", location.pathname);
}
const reopenHere = () =>
  typeof history !== "undefined" && (history.state as Record<string, unknown> | null)?.[REOPEN_MARK] === true;

export type Route = {
  name: "home" | "open" | "manage" | "securite" | "confidentialite" | "notfound";
};

/**
 * Fragment de 20 à 44 caractères de l'alphabet des clés qui n'est pas une clé valide : un lien
 * coupé (copier-coller, message tronqué). L'écran d'ouverture dit « Lien incomplet » au lieu de
 * l'accueil, qui laisserait croire que le lien n'était qu'une adresse du site (ruling 2).
 */
const TRUNCATED_FRAGMENT = /^#[A-Za-z0-9_-]{20,44}$/;

export function match(pathname: string, hash = "", base: string = import.meta.env.BASE_URL, reopen = false): Route {
  const prefix = base.endsWith("/") ? base.slice(0, -1) : base; // "" ou "/Shhdrop"
  let p = pathname;
  if (prefix !== "") {
    if (p === prefix) p = "/";
    else if (p.startsWith(prefix + "/")) p = p.slice(prefix.length);
    else return { name: "notfound" };
  }
  if (p === "/") {
    if (SHARE_FRAGMENT.test(hash) || SHARE_PW_PREFIX.test(hash)) return { name: "open" };
    if (MANAGE_FRAGMENT.test(hash)) return { name: "manage" };
    if (TRUNCATED_FRAGMENT.test(hash)) return { name: "open" };
    if (hash === "" && reopen) return { name: "open" };
    return { name: "home" };
  }
  if (p === "/securite") return { name: "securite" };
  if (p === "/confidentialite") return { name: "confidentialite" };
  // « /s/ » reste réservé aux futurs liens universels (spec §16) : aucune route aujourd'hui.
  return { name: "notfound" };
}

export const router = $state<{ current: Route }>({
  current: typeof location === "undefined" ? { name: "home" } : match(location.pathname, location.hash, undefined, reopenHere()),
});

// Ne réaffecte que si la route change : un popstate sans effet (lien vers la page courante,
// « # » retiré) ne relance ni les effets ni le focus.
function sync(): void {
  const next = match(location.pathname, location.hash, undefined, reopenHere());
  if (next.name !== router.current.name) router.current = next;
}

// Retour du système (geste, bouton) : même glissement, vers la droite, sur téléphone.
if (typeof window !== "undefined")
  window.addEventListener("popstate", () => {
    // Un « # » (lien collé, clé) se lit tout de suite, sans transition : l'écran qui le lit et
    // le gestionnaire hashchange d'App doivent voir la route à jour dans le même tour.
    if (phone() && location.hash === "") void runTransition(() => flushSync(sync), { back: true });
    else sync();
  });

const base = () => import.meta.env.BASE_URL;

/** Adresse complète d'un chemin de l'application (préfixe de dépôt en démo). */
export function href(path: string): string {
  return base().replace(/\/$/, "") + path;
}

/** Chemin interne seulement : « /… », sans « // », « \ », « # » ni « ? » (aucun secret ne transite ici). */
export function navigate(path: string, opts: { back?: boolean } = {}): void {
  if (!/^\/(?!\/)[^\\#?]*$/.test(path)) throw new Error("chemin interne attendu");
  const go = () => {
    history.pushState(null, "", href(path));
    sync();
    if (typeof window.scrollTo === "function") window.scrollTo(0, 0);
  };
  // Téléphone : l'écran glisse (en arrière : vers la droite ; fondu en mouvement réduit).
  if (phone()) void runTransition(() => flushSync(go), { back: opts.back });
  else go();
}
const phone = () => typeof matchMedia === "function" && matchMedia("(max-width: 899px)").matches;

/** Gestionnaire de clic pour un <a href> interne : navigation sans rechargement, sauf clic modifié. */
export function followLink(e: MouseEvent, path: string): void {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  e.preventDefault();
  navigate(path);
}
