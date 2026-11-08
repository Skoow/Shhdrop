// Gestes communs aux tests d'envoi et de « Lien prêt » (send.spec.ts, ready.spec.ts, démo).
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { expect } from "./fixtures";

/**
 * Téléphone (< 760 px) : une seule action « Ajouter » (accueil : grand bouton ; composeur : « + »
 * de la barre du bas) ouvre la feuille ; on y choisit la ligne. Rend faux sur ordinateur.
 */
export async function pickInAddSheet(page: Page, row: string): Promise<boolean> {
  // L'écran doit être monté avant de choisir le geste (accueil ou composeur, téléphone ou ordinateur).
  const any = page.getByRole("button", { name: /^(Ajouter|Parcourir les fichiers)/ }).or(page.locator(".dropzone")).filter({ visible: true }).first();
  await expect(any).toBeVisible();
  const add = page.getByRole("button", { name: /^Ajouter/ }).filter({ visible: true }).first();
  if (!(await add.isVisible().catch(() => false))) return false;
  await add.click();
  const sheet = page.getByRole("dialog", { name: "Ajouter" });
  await sheet.getByRole("button", { name: new RegExp(`^${row}`) }).click();
  return true;
}

/** Ouvre le sélecteur de fichiers par le geste visible (feuille, « Parcourir » ou zone de dépôt). */
export async function openFilePicker(page: Page) {
  const chooser = page.waitForEvent("filechooser");
  if (!(await pickInAddSheet(page, "Fichiers"))) {
    const home = page.getByRole("button", { name: "Parcourir les fichiers" });
    if (await home.isVisible()) await home.click();
    else await page.locator(".dropzone").click();
  }
  return chooser;
}

export async function addText(page: Page, text: string) {
  if (!(await pickInAddSheet(page, "Note"))) {
    const inComposer = page.getByRole("group", { name: "Créer sur place" });
    if (await inComposer.isVisible()) await inComposer.getByRole("button", { name: "Note", exact: true }).click();
    else await page.getByRole("group", { name: "Ou créez sur place" }).getByRole("button", { name: "Note", exact: true }).click();
  }
  const dlg = page.getByRole("dialog", { name: "Nouveau texte" });
  await dlg.getByLabel("Contenu").fill(text);
  await dlg.getByRole("button", { name: "Ajouter" }).click();
  await expect(dlg).toBeHidden();
  // Le composeur remplace l'accueil après la transition de vue : attendre la ligne ajoutée.
  await expect(page.locator("[data-row]").first()).toBeVisible();
}

/**
 * Fichiers que le nettoyage automatique ne sait pas (encore) nettoyer (spec §35.2, décision du
 * 8 novembre) : « Envoyer tel quel » sur chacun, comme une personne qui accepte. Les tests qui
 * ne portent pas sur le nettoyage passent par ici.
 */
export async function sendAsIs(page: Page) {
  const btn = page.getByRole("button", { name: /^Envoyer tel quel\s?: / });
  for (let n = await btn.count(); n > 0; n = await btn.count()) {
    await btn.first().click();
    await expect(btn).toHaveCount(n - 1);
  }
}

export async function addFile(page: Page, name: string, bytes: number, mimeType = "application/octet-stream") {
  const chooser = openFilePicker(page);
  const buffer = Buffer.alloc(bytes);
  for (let i = 0; i < bytes; i += 4096) buffer[i] = (i / 4096) & 255;
  await (await chooser).setFiles({ name, mimeType, buffer });
  await expect(page.locator("[data-row]").filter({ hasText: name.replace(/\.[^.]+$/, "") }).first()).toBeVisible();
  await sendAsIs(page);
}

const FILES = fileURLToPath(new URL("./files/", import.meta.url));

/** Fichier réel de ui-e2e/files (photo, vidéo) : un faux JPEG ou MP4 n'est pas un cas réaliste. */
export async function addRealFile(page: Page, name: string) {
  const chooser = openFilePicker(page);
  await (await chooser).setFiles(join(FILES, name));
  await expect(page.locator("[data-row]").filter({ hasText: name.replace(/\.[^.]+$/, "") }).first()).toBeVisible();
  await sendAsIs(page);
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
