// Barre d'onglets du téléphone (< 900 px) : façon app, jusqu'à la vraie version mobile.
// Visible seulement sur les écrans « racine » de l'expéditeur : accueil (composeur vide),
// Sécurité, Confidentialité, page introuvable. Masquée chez le destinataire (ouverture,
// contenu), sur la gestion, pendant la composition (l'étape a sa propre barre d'action),
// pendant un envoi et sur « Lien prêt ».
import type { Route } from "./router.svelte";

export type TabId = "send" | "shares" | "chat" | "settings";

/** Onglets dans l'ordre ; `soon` : pas encore construit (désactivé, « Bientôt »). */
export const TABS: readonly { id: TabId; soon: boolean }[] = [
  { id: "send", soon: false },
  { id: "shares", soon: true }, // Task H (historique « Vos envois »)
  { id: "chat", soon: true }, // Tasks C-1 à C-6 (salon)
  { id: "settings", soon: false },
];

const ROOTS: ReadonlySet<Route["name"]> = new Set(["home", "securite", "confidentialite", "conditions", "mentions", "signaler", "offres", "notfound"]);

export function tabBarVisible(o: { supported: boolean; route: Route["name"]; sending: boolean; composing: boolean }): boolean {
  return o.supported && !o.sending && !o.composing && ROOTS.has(o.route);
}

/** Onglet courant : Envoyer sur l'accueil ; Réglages sur les pages d'information. */
export function currentTab(route: Route["name"]): TabId | null {
  if (route === "home" || route === "envoyer") return "send";
  if (route === "securite" || route === "confidentialite" || route === "conditions" || route === "mentions" || route === "signaler" || route === "offres") return "settings";
  return null;
}
