// Barre d'onglets du téléphone (< 900 px) : façon app, jusqu'à la vraie version mobile.
// Visible seulement sur les écrans « racine » de l'expéditeur : accueil (composeur vide),
// Sécurité, Confidentialité, page introuvable. Masquée chez le destinataire (ouverture,
// contenu), sur la gestion, pendant la composition (l'étape a sa propre barre d'action),
// pendant un envoi et sur « Lien prêt ».
import type { Route } from "./router.svelte";

export type TabId = "send" | "shares" | "chat";

/** Onglets dans l'ordre ; `soon` : pas encore construit (désactivé, « Bientôt »). */
export const TABS: readonly { id: TabId; soon: boolean }[] = [
  { id: "send", soon: false },
  { id: "shares", soon: true }, // Task H (historique « Vos envois »)
  { id: "chat", soon: true }, // Tasks C-1 à C-6 (salon)
];

const ROOTS: ReadonlySet<Route["name"]> = new Set(["home", "securite", "confidentialite", "conditions", "mentions", "signaler", "offres", "notfound"]);

/** Une barre d'onglets n'a de sens qu'avec au moins deux onglets qui fonctionnent. */
export function tabBarUseful(tabs: readonly { id?: TabId; soon: boolean }[]): boolean {
  return tabs.filter((t) => !t.soon).length >= 2;
}

/**
 * Masquée tant qu'un seul onglet fonctionne (décision du propriétaire du 11 novembre, audit
 * M18 : Mes partages et Salon sont « bientôt ») ; `useful` : forcé par les tests.
 */
export function tabBarVisible(o: { supported: boolean; route: Route["name"]; sending: boolean; composing: boolean }, useful = tabBarUseful(TABS)): boolean {
  return useful && o.supported && !o.sending && !o.composing && ROOTS.has(o.route);
}

/** Onglet courant : Envoyer sur l'accueil ; aucun ailleurs (plus d'onglet Réglages : langue,
 *  nettoyage et liens d'information sont dans le pied de page, retours du 11 novembre). */
export function currentTab(route: Route["name"]): TabId | null {
  if (route === "home" || route === "envoyer") return "send";
  return null;
}
