// Pied de page (retours du 11 novembre) : plus de roue ni de panneau Réglages ; « À propos » et
// liens d'information sont dans le pied, sur toutes les pages. Plus de choix de langue ni de
// « Nettoyage automatique » (12 novembre).
import type { Browser, BrowserContext, Page } from "@playwright/test";

export const foot = (page: Page) => page.locator("footer[data-foot]");

/**
 * Page dans une autre langue : plus de bouton de langue (12 novembre), la langue suit le
 * navigateur ; un nouvel onglet avec la locale voulue remplace l'ancienne bascule.
 */
export async function pageIn(browser: Browser, locale: "en-US" | "fr-FR", url: string): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({ locale });
  const page = await ctx.newPage();
  await page.goto(url);
  return { ctx, page };
}

/** Lien du pied de page (Sécurité, Confidentialité…). */
export const footLink = (page: Page, name: string | RegExp) => foot(page).getByRole("link", { name, exact: typeof name === "string" ? true : undefined });
