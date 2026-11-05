// Liens de partage et de gestion (spec §32) : à la racine du site, le secret après le « # ».
// Le navigateur n'envoie jamais le fragment au serveur (spec §7.1), et le chemin demandé est
// « / » : ni le lien ni la page ne portent d'identifiant. L'id du partage se calcule par
// shareId(K_lien) (crypto/envelope) et ne sort jamais du navigateur.
import { b64u, unb64u } from "../crypto/encoding";
import type { KLien, SGestion } from "../crypto/types";

/** Lien analysé : K_lien pour un lien de partage, S_gestion pour un lien de gestion. */
export type ParsedLink = { kind: "s"; origin: string; kLien: KLien } | { kind: "m"; origin: string; sGestion: SGestion };

/** Secret de 32 octets en base64url sans bourrage : 43 caractères. */
export const KEY_CHARS = 43;

/**
 * Forme du fragment, sans le décoder (routeur) : « # » + 43 caractères base64url pour un
 * partage, « #m » + 43 pour la gestion. Les longueurs diffèrent (44 et 45) : aucune ambiguïté.
 */
export const SHARE_FRAGMENT = /^#[A-Za-z0-9_-]{43}$/;
export const MANAGE_FRAGMENT = /^#m[A-Za-z0-9_-]{43}$/;

/**
 * Forme d'un lien de partage de production (benchmark M13, réutilisée par les tests de
 * pages) : `https://hôte/#` + 43 caractères, rien d'autre (ni chemin, ni requête, ni mot de passe).
 */
export const SHARE_LINK_SHAPE = /^https:\/\/[a-z0-9.-]+(?::\d+)?\/#[A-Za-z0-9_-]{43}$/;

const LOCAL = new Set(["localhost", "127.0.0.1", "[::1]"]);

// https: obligatoire, sauf http: vers la boucle locale (développement et tests).
const allowedScheme = (u: URL) => u.protocol === "https:" || (u.protocol === "http:" && LOCAL.has(u.hostname));

/**
 * Vérifie une origine (audit F1) : forme canonique exacte `https://hôte[:port]` (http
 * seulement pour localhost, 127.0.0.1, [::1]), sans chemin, requête, fragment ni
 * identifiants. Rend l'origine, ou lève Error("origine_invalide").
 */
export function checkOrigin(origin: string): string {
  let u: URL;
  try {
    u = new URL(origin);
  } catch {
    throw new Error("origine_invalide");
  }
  if (u.origin !== origin || !allowedScheme(u)) throw new Error("origine_invalide");
  return origin;
}

// Base de dépôt : « / » en production, « /Shhdrop/ » pour la démo GitHub Pages.
const BASE = /^\/(?:[A-Za-z0-9_-]+\/)*$/;

function checkBase(base: string): string {
  if (!BASE.test(base)) throw new Error("base_invalide");
  return base;
}

/** `${origin}${base}#<K_lien>` : 45 caractères de plus que l'origine avec la base « / ». */
export function shareLink(origin: string, kLien: KLien, base = "/"): string {
  return `${checkOrigin(origin)}${checkBase(base)}#${b64u(kLien)}`;
}

/** `${origin}${base}#m<S_gestion>`. */
export function manageLink(origin: string, sGestion: SGestion, base = "/"): string {
  return `${checkOrigin(origin)}${checkBase(base)}#m${b64u(sGestion)}`;
}

function invalid(): Error {
  return new Error("lien_invalide");
}

// Décodage strict : longueur exacte et encodage canonique (unb64u refuse les bits de bourrage).
function strict(s: string): Uint8Array<ArrayBuffer> {
  if (s.length !== KEY_CHARS || !/^[A-Za-z0-9_-]+$/.test(s)) throw invalid();
  let b: Uint8Array<ArrayBuffer>;
  try {
    b = unb64u(s);
  } catch {
    throw invalid();
  }
  if (b.length !== 32) throw invalid();
  return b;
}

/**
 * Analyse un lien : chemin égal à `base` exactement (« /Shhdrop » sans barre finale toléré
 * pour la démo), sans identifiants dans l'adresse. La requête est ignorée : nos liens n'en
 * portent jamais, mais les messageries ajoutent des paramètres de suivi (`?fbclid=…`) en
 * gardant le fragment. Ne vérifie pas l'origine attendue : les fonctions du client
 * (openShare, fetchMeta, destroyShare, shareStatus) la comparent elles-mêmes.
 */
export function parseLink(url: string, base = "/"): ParsedLink {
  checkBase(base);
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw invalid();
  }
  if (!allowedScheme(u) || u.username !== "" || u.password !== "") throw invalid();
  if (u.pathname !== base && u.pathname + "/" !== base) throw invalid();
  if (SHARE_FRAGMENT.test(u.hash)) return { kind: "s", origin: u.origin, kLien: strict(u.hash.slice(1)) as KLien };
  if (MANAGE_FRAGMENT.test(u.hash)) return { kind: "m", origin: u.origin, sGestion: strict(u.hash.slice(2)) as SGestion };
  throw invalid();
}
