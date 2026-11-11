// Pied de page (retours du 11 novembre) : plus de roue ni de panneau Réglages ; langue,
// nettoyage automatique, À propos et liens d'information sont dans le pied, sur toutes les pages.
import type { Page } from "@playwright/test";

export const foot = (page: Page) => page.locator("footer[data-foot]");

/** Groupe du choix de langue du pied (nommé « Langue » ou « Language »). */
export const langGroup = (page: Page) => foot(page).getByRole("group", { name: /^(Langue|Language)$/ });

/** Change la langue depuis le pied de page. */
export async function switchLang(page: Page, to: "English" | "Français") {
  const b = langGroup(page).getByRole("button", { name: to });
  await b.scrollIntoViewIfNeeded();
  await b.click();
}

/** Interrupteur « Nettoyer automatiquement les fichiers » du pied. */
export const cleanSwitch = (page: Page) => foot(page).getByRole("switch", { name: /^(Nettoyer automatiquement les fichiers|Clean files automatically)$/ });

/** Lien du pied de page (Sécurité, Confidentialité…). */
export const footLink = (page: Page, name: string | RegExp) => foot(page).getByRole("link", { name, exact: typeof name === "string" ? true : undefined });
