// Liens de partage et de gestion. Le secret est après le « # » : le navigateur ne
// l'envoie jamais au serveur (spec §7.1).
import { b64u, unb64u } from "../crypto/encoding";

export type ParsedLink = { kind: "s" | "m"; id: string; secret: Uint8Array };

export function shareLink(origin: string, id: string, kLien: Uint8Array): string {
  return `${origin}/s/${id}#${b64u(kLien)}`;
}

export function manageLink(origin: string, id: string, sGestion: Uint8Array): string {
  return `${origin}/m/${id}#${b64u(sGestion)}`;
}

function invalid(): Error {
  return new Error("lien_invalide");
}

// Décodage strict : longueur exacte et encodage canonique (unb64u refuse les bits de bourrage).
function strict(s: string, chars: number, bytes: number): Uint8Array {
  if (s.length !== chars || !/^[A-Za-z0-9_-]+$/.test(s)) throw invalid();
  let b: Uint8Array;
  try {
    b = unb64u(s);
  } catch {
    throw invalid();
  }
  if (b.length !== bytes) throw invalid();
  return b;
}

export function parseLink(url: string): ParsedLink {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw invalid();
  }
  if ((u.protocol !== "https:" && u.protocol !== "http:") || u.search !== "") throw invalid();
  const m = /^\/([sm])\/([^/]+)$/.exec(u.pathname);
  if (!m || !u.hash.startsWith("#")) throw invalid();
  const id = m[2]!;
  strict(id, 22, 16); // identifiant de 128 bits
  return { kind: m[1] as "s" | "m", id, secret: strict(u.hash.slice(1), 43, 32) };
}
