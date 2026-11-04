// Liens de partage et de gestion. Le secret est après le « # » : le navigateur ne
// l'envoie jamais au serveur (spec §7.1).
import { b64u, unb64u } from "../crypto/encoding";
import type { KLien, SGestion } from "../crypto/types";

/** Lien analysé : K_lien pour un lien de partage (/s/), S_gestion pour un lien de gestion (/m/). */
export type ParsedLink =
  | { kind: "s"; origin: string; id: string; kLien: KLien }
  | { kind: "m"; origin: string; id: string; sGestion: SGestion };

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

export function shareLink(origin: string, id: string, kLien: KLien): string {
  return `${checkOrigin(origin)}/s/${id}#${b64u(kLien)}`;
}

export function manageLink(origin: string, id: string, sGestion: SGestion): string {
  return `${checkOrigin(origin)}/m/${id}#${b64u(sGestion)}`;
}

function invalid(): Error {
  return new Error("lien_invalide");
}

// Décodage strict : longueur exacte et encodage canonique (unb64u refuse les bits de bourrage).
function strict(s: string, chars: number, bytes: number): Uint8Array<ArrayBuffer> {
  if (s.length !== chars || !/^[A-Za-z0-9_-]+$/.test(s)) throw invalid();
  let b: Uint8Array<ArrayBuffer>;
  try {
    b = unb64u(s);
  } catch {
    throw invalid();
  }
  if (b.length !== bytes) throw invalid();
  return b;
}

/**
 * Analyse un lien. Ne vérifie pas l'origine attendue : les fonctions du client
 * (openShare, fetchMeta, destroyShare, shareStatus) la comparent elles-mêmes.
 */
export function parseLink(url: string): ParsedLink {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw invalid();
  }
  if (!allowedScheme(u) || u.search !== "" || u.username !== "" || u.password !== "") throw invalid();
  const m = /^\/([sm])\/([^/]+)$/.exec(u.pathname);
  if (!m || !u.hash.startsWith("#")) throw invalid();
  const id = m[2]!;
  strict(id, 22, 16); // identifiant de 128 bits
  const secret = strict(u.hash.slice(1), 43, 32);
  return m[1] === "s"
    ? { kind: "s", origin: u.origin, id, kLien: secret as KLien }
    : { kind: "m", origin: u.origin, id, sGestion: secret as SGestion };
}
