// Gestes communs aux tests d'envoi et de « Lien prêt » (send.spec.ts, ready.spec.ts, démo).
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { expect } from "./fixtures";

export async function addText(page: Page, text: string) {
  const inComposer = page.getByRole("group", { name: "Créer sur place" });
  if (await inComposer.isVisible()) await inComposer.getByRole("button", { name: "Note texte" }).click();
  else await page.getByRole("group", { name: "Ou créez sur place" }).getByRole("button", { name: "Texte", exact: true }).click();
  const dlg = page.getByRole("dialog", { name: "Nouveau texte" });
  await dlg.getByLabel("Contenu").fill(text);
  await dlg.getByRole("button", { name: "Ajouter" }).click();
  await expect(dlg).toBeHidden();
}

export async function addFile(page: Page, name: string, bytes: number, mimeType = "application/octet-stream") {
  const home = page.getByRole("button", { name: "Parcourir les fichiers" });
  const chooser = page.waitForEvent("filechooser");
  if (await home.isVisible()) await home.click();
  else await page.locator(".dropzone").click();
  const buffer = Buffer.alloc(bytes);
  for (let i = 0; i < bytes; i += 4096) buffer[i] = (i / 4096) & 255;
  await (await chooser).setFiles({ name, mimeType, buffer });
  await expect(page.locator("[data-row]").filter({ hasText: name.replace(/\.[^.]+$/, "") }).first()).toBeVisible();
}

const FILES = fileURLToPath(new URL("./files/", import.meta.url));

/** Fichier réel de ui-e2e/files (photo, vidéo) : un faux JPEG ou MP4 n'est pas un cas réaliste. */
export async function addRealFile(page: Page, name: string) {
  const home = page.getByRole("button", { name: "Parcourir les fichiers" });
  const chooser = page.waitForEvent("filechooser");
  if (await home.isVisible()) await home.click();
  else await page.locator(".dropzone").click();
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
