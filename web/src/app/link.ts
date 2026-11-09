// Hygiène du lien (UI §12.1, spec §5.3) : le secret du « # » est lu une fois au démarrage de
// la route, puis retiré de la barre d'adresse et de l'entrée d'historique.
import { manageLink, parseLink, shareLink, splitPassword } from "../index";

/**
 * Résultat de la lecture. `link` contient le secret : il est passé par valeur au flux
 * (réception, gestion) et n'est jamais rangé dans un état réactif ou global.
 */
export type LinkState = { kind: "s" | "m"; link: string } | { kind: "incomplete" };

/** Lien de partage lu d'un QR code (D41-29) : mot de passe pris dans le fragment, ou null. */
export type ShareTake = { state: LinkState; password: string | null };

const INCOMPLETE: LinkState = Object.freeze({ kind: "incomplete" });

/**
 * Lit le lien de l'adresse courante (spec §32 : `${base}#<clé>` ou `${base}#m<clé>`).
 * `parseLink` exige le chemin de la base (« / », ou « /shhdrop/ » en démo) et ignore la
 * requête : nos liens n'en portent jamais, mais les applications ajoutent des paramètres de
 * suivi (`?fbclid=…`) en gardant le fragment. Le lien rendu est remis à la racine de
 * l'origine (`${origin}/#…`), la forme qu'attendent les fonctions du client. Tout échec (pas
 * de « # », clé mal formée, autre chemin, type différent de `expected`) donne « incomplet » :
 * rien n'est levé.
 */
export function readLink(href: string, expected: "s" | "m", base: string = import.meta.env.BASE_URL): LinkState {
  try {
    const p = parseLink(href, base);
    if (p.kind !== expected) return INCOMPLETE;
    return { kind: p.kind, link: p.kind === "s" ? shareLink(p.origin, p.kLien) : manageLink(p.origin, p.sGestion) };
  } catch {
    return INCOMPLETE;
  }
}

// Chemin nu : commence par un seul « / », sans « # », « ? » ni « \\ » (comme navigate()). Une
// adresse complète (location.href) réécrirait le secret : elle est refusée.
const BARE_PATH = /^\/(?!\/)[^\\#?]*$/;

/**
 * Remplace l'entrée courante par `pathname` seul : ni « # », ni requête (aucune entrée
 * ajoutée, état nul). Rend `false` sans rien écrire si `pathname` n'est pas un chemin nu ;
 * ne lève jamais (appelée dans un effet).
 */
export function scrubAddressBar(h: History, pathname: string): boolean {
  if (!BARE_PATH.test(pathname)) return false;
  h.replaceState(null, "", pathname);
  return true;
}

/**
 * Lecture d'un lien de partage, mot de passe du QR code compris (D41-29) : le mot de passe
 * est séparé du fragment avant l'analyse ; le lien rendu est le lien simple. Un mot de passe
 * mal formé est ignoré (écran de saisie normal).
 */
export function readShare(href: string, base: string = import.meta.env.BASE_URL): ShareTake {
  const { href: plain, password } = splitPassword(href);
  const state = readLink(plain, "s", base);
  return { state, password: state.kind === "s" ? password : null };
}
