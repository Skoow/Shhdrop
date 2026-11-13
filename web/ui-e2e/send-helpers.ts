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

/**
 * « Tout nettoyer » puis « Nettoyer » dans la confirmation (remplace l'interrupteur « Nettoyage
 * automatique », retiré le 12 novembre) : à appeler APRÈS l'ajout des fichiers. Rend quand plus
 * rien n'est à nettoyer (le nettoyage peut finir après : attendre la marque voulue).
 */
export async function cleanAll(page: Page) {
  const all = page.getByRole("button", { name: "Tout nettoyer" });
  await all.click();
  await page.getByRole("dialog", { name: /^Nettoyer \d+\s*fichiers?\s*\?$/ }).getByRole("button", { name: "Nettoyer", exact: true }).click();
  await expect(all).toHaveCount(0);
}

/**
 * Ordinateur : l'écran d'envoi tient entier dans la hauteur de l'écran (page en haut) et le pied
 * de page vient juste dessous, sans le tasser (exigence du propriétaire ; retours du 11 novembre).
 * Remplace l'ancienne vérification « la page ne défile pas » (le pied est désormais affiché).
 */
export const composerFits = (page: Page) =>
  page.evaluate(() => {
    scrollTo(0, 0);
    const app = document.querySelector("[data-composer]")!.getBoundingClientRect();
    const foot = document.querySelector("footer[data-foot]")!.getBoundingClientRect();
    return app.top >= 0 && app.bottom <= innerHeight && foot.top >= app.bottom;
  });

/**
 * Corps des PUT de segments, octet pour octet, tels que la page les remet à XMLHttpRequest.
 * Depuis A1, ce corps est un Blob : Chromium ne le donne pas à `request.postDataBuffer()` (null),
 * qui rendrait une fouille « le serveur ne voit rien » vide sans le dire. Le script de page
 * relit le Blob (mêmes octets, sans rien changer à l'envoi) et le passe au test. À appeler
 * avant `page.goto`.
 */
export async function capturePutBodies(page: Page): Promise<{ url: string; body: Buffer }[]> {
  const out: { url: string; body: Buffer }[] = [];
  await page.exposeBinding("__shhPutBody", (_src, url: string, b64: string) => void out.push({ url, body: Buffer.from(b64, "base64") }));
  await page.addInitScript(() => {
    const open = XMLHttpRequest.prototype.open;
    const send = XMLHttpRequest.prototype.send;
    const urls = new WeakMap<XMLHttpRequest, string>();
    XMLHttpRequest.prototype.open = function (this: XMLHttpRequest, method: string, url: string | URL, ...rest: unknown[]) {
      if (method === "PUT") urls.set(this, String(url));
      return (open as (...a: unknown[]) => void).call(this, method, url, ...rest);
    } as typeof XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.send = function (this: XMLHttpRequest, body?: XMLHttpRequestBodyInit | null) {
      const url = urls.get(this);
      if (url !== undefined && body instanceof Blob) {
        void body.arrayBuffer().then((ab) => {
          const u = new Uint8Array(ab);
          let s = "";
          for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
          (window as unknown as { __shhPutBody(u: string, b: string): void }).__shhPutBody(url, btoa(s));
        });
      }
      return send.call(this, body);
    };
  });
  return out;
}
