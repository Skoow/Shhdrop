// Titre de l'onglet (scan UX B9) : « écran · Shhdrop », dans la langue de la page. Seulement des
// textes fixes de l'interface : jamais un nom de fichier, un lien, une clé ni un mot de passe
// (le titre part dans l'historique, les onglets synchronisés et les captures).
import { t } from "../i18n/i18n.svelte";
import type { Route } from "./router.svelte";

export type TitleScreen = Route["name"] | "ready" | "sealing" | "unsupported" | "offline" | "server" | "limit" | "maintenance" | "invalid" | "incomplete" | "gone";
const BRAND = "Shhdrop";

export function routeTitle(screen: TitleScreen): string {
  return `${t(`title.${screen}`)} · ${BRAND}`;
}

// Une page d'état (erreur, lien invalide) montrée à l'intérieur d'un écran garde le titre de
// l'onglet tant qu'elle est là, quel que soit l'ordre des effets ; à son départ, le titre de
// l'écran revient.
let screenNow: TitleScreen | null = null;
let claimed: TitleScreen | null = null;

/** Écrit le titre de l'écran ; la démo y ajoute son préfixe (demo/install.ts). */
export function setScreenTitle(screen: TitleScreen): void {
  screenNow = screen;
  document.title = routeTitle(claimed ?? screen);
}

/** Page d'état : prend le titre jusqu'à l'appel de la fonction rendue. */
export function claimScreenTitle(screen: TitleScreen): () => void {
  claimed = screen;
  document.title = routeTitle(screen);
  return () => {
    if (claimed !== screen) return;
    claimed = null;
    if (screenNow !== null) document.title = routeTitle(screenNow);
  };
}

const DEMO_PREFIXES = ["Démo · ", "Demo · "];

/** Titre de la démo : préfixe « Démo · » ou « Demo · » selon la langue, jamais doublé. */
export function demoPrefixed(title: string, lang: string): string {
  const bare = DEMO_PREFIXES.reduce((s, p) => (s.startsWith(p) ? s.slice(p.length) : s), title);
  return (lang === "fr" ? DEMO_PREFIXES[0] : DEMO_PREFIXES[1]) + bare;
}
