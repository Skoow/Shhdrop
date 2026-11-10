// Référencement (retours CLEAN2) : seules les pages publiques sont indexées (accueil, sécurité,
// confidentialité, offres, conditions, mentions légales), avec une description et une adresse
// canonique ; tout le reste (page d'envoi, partage ouvert, gestion, page introuvable,
// signalement) porte « noindex ». La démo (GitHub Pages) n'est jamais indexée : pas de doublon
// du vrai site. Rien ici ne lit ni n'écrit le fragment (« # » = clés) : l'adresse canonique
// n'est faite que de l'origine et d'un chemin fixe.
import { t } from "../i18n/i18n.svelte";
import type { Route } from "./router.svelte";

/** Pages indexées → chemin public (sans la base). */
export const INDEXED: Readonly<Partial<Record<Route["name"], string>>> = {
  home: "/",
  securite: "/securite",
  confidentialite: "/confidentialite",
  offres: "/offres",
  conditions: "/conditions",
  mentions: "/mentions-legales",
};

function meta(doc: Document, name: string): HTMLMetaElement {
  let m = doc.head.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);
  if (!m) {
    m = doc.createElement("meta");
    m.name = name;
    doc.head.append(m);
  }
  return m;
}

export type SeoEnv = { origin: string; base: string; demo: boolean };

export function applySeo(name: Route["name"] | "unsupported", doc: Document = document, env: SeoEnv = { origin: location.origin, base: import.meta.env.BASE_URL, demo: import.meta.env.MODE === "demo" }): void {
  const path = name === "unsupported" ? undefined : INDEXED[name];
  const indexed = path !== undefined && !env.demo;
  meta(doc, "robots").content = indexed ? "index, follow" : "noindex";
  meta(doc, "description").content = t(path !== undefined ? (`seo.${name as keyof typeof INDEXED}` as "seo.home") : "seo.home");
  let link = doc.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!indexed) return void link?.remove();
  if (!link) {
    link = doc.createElement("link");
    link.rel = "canonical";
    doc.head.append(link);
  }
  link.href = env.origin + env.base.replace(/\/$/, "") + path;
}
