// Hygiène du lien (UI §12.1, spec §5.3) : le secret du « # » est lu une fois au démarrage de
// la route, puis retiré de la barre d'adresse et de l'entrée d'historique.
import { parseLink } from "../index";

/**
 * Résultat de la lecture. `link` contient le secret : il est passé par valeur au flux
 * (réception, gestion) et n'est jamais rangé dans un état réactif ou global.
 */
export type LinkState = { kind: "s" | "m"; link: string } | { kind: "incomplete" };

const INCOMPLETE: LinkState = Object.freeze({ kind: "incomplete" });

/**
 * Lit le lien de l'adresse courante. La base de dépôt (démo, « /Shhdrop/ ») est retirée
 * avant `parseLink`, qui n'accepte que « /s/{id} » et « /m/{id} ». La requête est ignorée :
 * nos liens n'en portent jamais, mais les applications ajoutent des paramètres de suivi
 * (`?fbclid=…`) en gardant le fragment. Tout échec (pas de « # »,
 * clé ou identifiant mal formé, type différent de `expected`) donne « incomplet » : rien n'est levé.
 */
export function readLink(href: string, expected: "s" | "m", base: string = import.meta.env.BASE_URL): LinkState {
  let u: URL;
  try {
    u = new URL(href);
  } catch {
    return INCOMPLETE;
  }
  const prefix = base.endsWith("/") ? base.slice(0, -1) : base;
  if (prefix !== "") {
    if (!u.pathname.startsWith(prefix + "/")) return INCOMPLETE;
    u.pathname = u.pathname.slice(prefix.length);
  }
  u.search = "";
  try {
    const p = parseLink(u.href);
    if (p.kind !== expected) return INCOMPLETE;
    return { kind: p.kind, link: u.href };
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
