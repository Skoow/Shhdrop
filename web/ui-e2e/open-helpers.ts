// Gestes communs aux tests du destinataire (open, content, save, endoflife, démo) : envoyer un
// partage par l'interface, lire le lien et le mot de passe sur « Lien prêt », puis ouvrir.
import { readFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Browser, BrowserContext, Page } from "@playwright/test";
import { expect } from "./fixtures";
import { addText, openFilePicker, readyHeading, sendButton } from "./send-helpers";

const FILES = fileURLToPath(new URL("./files/", import.meta.url));
export const file = (name: string) => join(FILES, name);

const MIME: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".webm": "video/webm",
  ".ogg": "audio/ogg",
  ".svg": "image/svg+xml",
  ".html": "text/html",
  ".mov": "video/quicktime",
  ".pdf": "application/pdf",
  ".exe": "application/x-msdownload",
  ".zip": "application/zip",
};
type Upload = { name: string; mimeType: string; buffer: Buffer };
/** Fichier de ui-e2e/files en mémoire (chemins et tampons ne se mélangent pas dans setFiles). */
const upload = (f: string | Upload): Upload =>
  typeof f === "string" ? { name: basename(f), mimeType: MIME[extname(f)] ?? "application/octet-stream", buffer: readFileSync(f) } : f;

export type Sent = { link: string; password: string; manage: string };

/**
 * Envoi par l'interface (bureau : options dans la colonne ; téléphone : feuille « Options »).
 * `files` : chemins de ui-e2e/files ou fichiers en mémoire ; ordre d'ajout = ordre du composeur.
 */
export async function sendShare(
  page: Page,
  url: string,
  o: { text?: string; files?: (string | { name: string; mimeType: string; buffer: Buffer })[]; opens?: number; download?: boolean; isMobile?: boolean } = {},
): Promise<Sent> {
  await page.goto(url);
  if (o.text !== undefined) await addText(page, o.text);
  if (o.files?.length) {
    const chooser = openFilePicker(page);
    await (await chooser).setFiles(o.files.map(upload));
    await expect(page.locator("[data-row]")).toHaveCount(o.files.length + (o.text !== undefined ? 1 : 0));
  }
  if (o.opens !== undefined || o.download === false) {
    let opts = page.locator(".side");
    if (o.isMobile) {
      await page.getByRole("button", { name: /^Options · / }).click();
      opts = page.getByRole("dialog", { name: "Options" });
    }
    if (o.opens !== undefined) {
      // Contrôle segmenté : au clavier, comme une personne (flèches depuis le choix courant).
      const group = opts.getByRole("radiogroup", { name: "Ouvertures" });
      const target = group.getByRole("radio", { name: String(o.opens), exact: true });
      await group.getByRole("radio", { checked: true }).focus();
      for (let k = 0; k < 10 && !(await target.isChecked()); k++) await page.keyboard.press("ArrowRight");
      await expect(target).toBeChecked();
    }
    if (o.download === false) {
      const sw = opts.getByRole("switch", { name: "Autoriser le téléchargement" });
      await sw.click();
      await expect(sw).toHaveAttribute("aria-checked", "false");
    }
    if (o.isMobile) await page.keyboard.press("Escape");
  }
  await sendButton(page).click();
  await expect(readyHeading(page)).toBeVisible({ timeout: 60_000 });
  const read = async (l: ReturnType<Page["locator"]>) => (await l.locator(".sr-only").first().textContent()) ?? "";
  const link = await read(page.getByRole("group", { name: "Lien" }));
  const password = await read(page.getByRole("group", { name: "Mot de passe" }));
  const manage = await read(page.locator(".manage"));
  expect(link).toMatch(/#[A-Za-z0-9_-]{43}$/);
  return { link, password, manage };
}

/** Contexte neuf (aucun état partagé avec l'expéditeur), même locale. */
export async function freshPage(browser: Browser, opts: Parameters<Browser["newContext"]>[0] = {}): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({ locale: "fr-FR", viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, ...opts });
  return { ctx, page: await ctx.newPage() };
}

export const unlockButton = (page: Page) => page.getByRole("button", { name: /^(Déverrouiller|Déchiffrement)/ });
export const pwField = (page: Page) => page.getByLabel("Mot de passe", { exact: true });

/** Saisit le mot de passe et déverrouille ; attend l'écran de contenu. */
export async function unlock(page: Page, password: string): Promise<void> {
  await pwField(page).fill(password);
  await unlockButton(page).click();
  await expect(page.getByRole("heading", { name: "Contenu", exact: true })).toBeVisible({ timeout: 30_000 });
}

/** Animations finies (entrées, dissolution) : contraste et captures stables. */
export const settle = (page: Page) =>
  page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => a.timeline === document.timeline && a.effect?.getComputedTiming().iterations !== Infinity)
        .map((a) => a.finished.catch(() => undefined)),
    ),
  );

/** Ligne d'une note dans la liste du contenu (sa première ligne y est montrée en extrait). */
export const noteRow = (page: Page, text: string) => page.locator("li.row").filter({ hasText: text.split("\n")[0]!.trim().slice(0, 80) });

/** Aller à la page Sécurité : lien du pied de page s'il est visible, sinon Réglages (onglet ou en-tête). */
export async function goSecurity(page: Page) {
  const foot = page.locator("footer.foot").getByRole("link", { name: "Sécurité", exact: true });
  if (await foot.isVisible()) return foot.click();
  const tab = page.getByRole("navigation", { name: "Navigation principale" }).getByRole("button", { name: "Réglages" });
  if (await tab.isVisible()) await tab.click();
  else await page.getByRole("banner").getByRole("button", { name: "Réglages" }).click();
  await page.getByRole("dialog", { name: "Réglages" }).getByRole("link", { name: "Sécurité", exact: true }).click();
}
