// Gestes communs aux tests d'envoi et de « Lien prêt » (send.spec.ts, ready.spec.ts, démo).
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { expect } from "./fixtures";

/**
 * Téléphone (< 760 px) : une seule action « Ajouter » (accueil : grand bouton ; composeur : « + »
 * de la barre du bas) ouvre la feuille ; on y choisit la ligne. Rend faux sur ordinateur.
 */
/**
 * Aucune transition de vue en cours (accueil → composeur) : pendant l'échange, l'ancien écran
 * est encore visible un instant ; le choisir sous charge faisait cliquer un bouton aussitôt
 * détaché (le sélecteur ne s'ouvrait jamais). On attend la fin de l'échange, pas un délai fixe.
 */
export async function noViewTransition(page: Page) {
  await page.waitForFunction(() => !document.getAnimations().some((a) => String((a.effect as KeyframeEffect | null)?.pseudoElement ?? "").startsWith("::view-transition")));
}

/**
 * Accueil : « Commencer » mène à la page d'envoi « /envoyer » (retours DROP) ; ailleurs (déjà
 * dans le composeur), rien à faire.
 */
export async function enterComposer(page: Page) {
  await noViewTransition(page);
  // L'écran doit être monté avant de choisir le geste (accueil ou composeur, téléphone ou ordinateur).
  const any = page.getByRole("button", { name: /^(Ajouter|Commencer)/ }).or(page.locator(".dropzone")).filter({ visible: true }).first();
  await expect(any).toBeVisible();
  const start = page.getByRole("button", { name: /^Commencer/ }).filter({ visible: true }).first();
  if (!(await start.isVisible().catch(() => false))) return;
  await start.click();
  await expect(page).toHaveURL(/\/envoyer$/);
  await noViewTransition(page);
}

export async function pickInAddSheet(page: Page, row: string): Promise<boolean> {
  await enterComposer(page);
  // Composeur sur téléphone : « Ajouter » ouvre la feuille ; sur ordinateur : zone de dépôt et « Créer sur place ».
  const add = page.getByRole("button", { name: /^Ajouter/ }).filter({ visible: true }).first();
  if (!(await add.isVisible().catch(() => false))) return false;
  await add.click();
  const sheet = page.getByRole("dialog", { name: "Ajouter" });
  await sheet.getByRole("button", { name: new RegExp(`^${row}`) }).click();
  return true;
}

/** Ouvre le sélecteur de fichiers par le geste visible (feuille d'ajout ou zone de dépôt). */
export async function openFilePicker(page: Page) {
  const chooser = page.waitForEvent("filechooser");
  if (!(await pickInAddSheet(page, "Fichiers"))) {
    await page.locator(".dropzone").click();
  }
  return chooser;
}

export async function addText(page: Page, text: string) {
  if (!(await pickInAddSheet(page, "Note"))) {
    await page.getByRole("group", { name: "Créer sur place" }).getByRole("button", { name: "Note", exact: true }).click();
  }
  const dlg = page.getByRole("dialog", { name: "Nouveau texte" });
  await dlg.getByLabel("Contenu").fill(text);
  await dlg.getByRole("button", { name: "Ajouter" }).click();
  await expect(dlg).toBeHidden();
  // Le composeur remplace l'accueil après la transition de vue : attendre la ligne ajoutée.
  await expect(page.locator("[data-row]").first()).toBeVisible();
}

export async function addFile(page: Page, name: string, bytes: number, mimeType = "application/octet-stream") {
  const chooser = openFilePicker(page);
  const buffer = Buffer.alloc(bytes);
  for (let i = 0; i < bytes; i += 4096) buffer[i] = (i / 4096) & 255;
  await (await chooser).setFiles({ name, mimeType, buffer });
  await expect(page.locator("[data-row]").filter({ hasText: name.replace(/\.[^.]+$/, "") }).first()).toBeVisible();
}

const FILES = fileURLToPath(new URL("./files/", import.meta.url));

/** Fichier réel de ui-e2e/files (photo, vidéo) : un faux JPEG ou MP4 n'est pas un cas réaliste. */
export async function addRealFile(page: Page, name: string) {
  const chooser = openFilePicker(page);
  await (await chooser).setFiles(join(FILES, name));
  await expect(page.locator("[data-row]").filter({ hasText: name.replace(/\.[^.]+$/, "") }).first()).toBeVisible();
}

export const sendButton = (page: Page) => page.getByRole("button", { name: "Chiffrer et envoyer" });
export const readyHeading = (page: Page) => page.getByRole("heading", { name: "Lien prêt" });
export const noHScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
/** Un `beforeunload` synthétique est-il annulé par la page ? */
export const armed = (page: Page) =>
  page.evaluate(() => {
    const e = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(e);
    return e.defaultPrevented;
  });
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Réglage « Nettoyer automatiquement les fichiers » (désactivé par défaut, retours CLEAN4). */
export async function autoClean(page: Page, on: boolean) {
  const tab = page.getByRole("navigation", { name: /^(Navigation principale|Main navigation)$/ }).getByRole("button", { name: /^(Réglages|Settings)$/ });
  if (await tab.isVisible()) await tab.click();
  else await page.getByRole("banner").getByRole("button", { name: /^(Réglages|Settings)$/ }).click();
  const sw = page.getByRole("dialog", { name: /^(Réglages|Settings)$/ }).getByRole("switch", { name: /^(Nettoyer automatiquement les fichiers|Clean files automatically)$/ });
  if ((await sw.getAttribute("aria-checked")) !== String(on)) await sw.click();
  await expect(sw).toHaveAttribute("aria-checked", String(on));
  await page.keyboard.press("Escape");
}
