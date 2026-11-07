// Titre de l'onglet (scan UX B9) : « écran · Shhdrop », dans la langue de la page. Seulement des
// textes fixes de l'interface : jamais un nom de fichier, un lien, une clé ni un mot de passe
// (le titre part dans l'historique, les onglets synchronisés et les captures).
import { t } from "../i18n/i18n.svelte";
import type { Route } from "./router.svelte";

export type TitleScreen = Route["name"] | "ready" | "sealing" | "unsupported";
const BRAND = "Shhdrop";

export function routeTitle(screen: TitleScreen): string {
  return `${t(`title.${screen}`)} · ${BRAND}`;
}

/** Écrit le titre de l'écran ; la démo y ajoute son préfixe (demo/install.ts). */
export function setScreenTitle(screen: TitleScreen): void {
  document.title = routeTitle(screen);
}

const DEMO_PREFIXES = ["Démo · ", "Demo · "];

/** Titre de la démo : préfixe « Démo · » ou « Demo · » selon la langue, jamais doublé. */
export function demoPrefixed(title: string, lang: string): string {
  const bare = DEMO_PREFIXES.reduce((s, p) => (s.startsWith(p) ? s.slice(p.length) : s), title);
  return (lang === "fr" ? DEMO_PREFIXES[0] : DEMO_PREFIXES[1]) + bare;
}
