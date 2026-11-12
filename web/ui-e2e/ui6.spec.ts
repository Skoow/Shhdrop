// Retours UI6 du propriétaire, sur le vrai serveur : menu « … » du composeur (Aperçu, Renommer,
// Nettoyer ou Réessayer seulement si utile, Supprimer ; ni Monter ni Descendre), aperçu par
// l'icône, icônes de format en couleur, icône « noms chiffrés » à côté du titre des listes,
// pastille « Téléchargé » au coin de l'icône chez le destinataire. Captures fr-FR à 390 et 1440 px.
import { fileURLToPath } from "node:url";
import { axe, expect, test } from "./fixtures";
import { file, freshPage, sendShare, settle, unlock } from "./open-helpers";
import { addText, openFilePicker } from "./send-helpers";
import type { Page } from "@playwright/test";

const SHOTS = fileURLToPath(new URL("../../.superpowers/sdd/2026-11-04-shhdrop-ecrans/shots/task-UI6/", import.meta.url));
test.use({ locale: "fr-FR", timezoneId: "Europe/Paris" });
const w = (isMobile: boolean) => (isMobile ? 390 : 1440);
const row = (page: Page, name: string) => page.locator("[data-row]").filter({ hasText: name });

test("composeur : icônes en couleur, menu « … », aperçu par l'icône, Nettoyer d'un élément tel quel ; captures", async ({ page, shh, isMobile }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: w(isMobile), height: isMobile ? 844 : 1000 });
  await page.goto(shh.origin + "/");
  await addText(page, "Code de la porte : 4512B");
  await (await openFilePicker(page)).setFiles(["plage-nuit.jpg", "contrat.pdf", "budget-2026.xlsx", "archive.zip", "anniversaire-lou.webm", "vocal.ogg", "schema.png"].map(file));
  await expect(page.locator("[data-row]")).toHaveCount(8);

  // Icônes : une teinte par famille, libellé toujours écrit.
  const tone = async (name: string) => row(page, name).locator("svg.fi").getAttribute("data-tone");
  for (const [n, t] of [["contrat.pdf", "pdf"], ["budget-2026.xlsx", "sheet"], ["archive.zip", "archive"], ["plage-nuit.jpg", "image"], ["anniversaire-lou.webm", "video"], ["vocal.ogg", "audio"], ["Note", "doc"]] as const) expect(await tone(n), n).toBe(t);
  for (const lb of await page.locator("[data-row] svg.fi text").allTextContents()) expect(lb.trim()).not.toBe("");
  // Phrase des noms : plus sous la liste ; icône à côté du titre, avec sa bulle.
  await expect(page.locator(".trust")).toHaveCount(0);
  await expect(page.locator(".tt [data-names-tip]")).toHaveAccessibleName("Les noms de fichiers sont chiffrés aussi : nous ne pouvons pas les lire.");
  // Aperçu par l'icône : photo, vidéo, son, note ; jamais le PDF ni l'archive.
  for (const n of ["plage-nuit.jpg", "anniversaire-lou.webm", "vocal.ogg", "Note"]) await expect(row(page, n).locator("[data-preview]"), n).toHaveCount(1);
  for (const n of ["contrat.pdf", "archive.zip", "budget-2026.xlsx"]) await expect(row(page, n).locator("[data-preview]"), n).toHaveCount(0);
  await settle(page);
  expect(await axe(page)).toEqual([]);
  await page.screenshot({ path: `${SHOTS}composeur-${w(isMobile)}.png`, fullPage: !isMobile });

  // Aperçu : la visionneuse, sans « Télécharger ».
  await row(page, "plage-nuit.jpg").locator("[data-preview]").click();
  const viewer = page.locator("dialog.vp[open]");
  await expect(viewer.locator("img")).toBeVisible();
  await expect(viewer.getByRole("button", { name: /Télécharger/ })).toHaveCount(0);
  await settle(page);
  await page.screenshot({ path: `${SHOTS}composeur-apercu-${w(isMobile)}.png` });
  await page.keyboard.press("Escape");
  await expect(viewer).toHaveCount(0);

  // Réglage désactivé (tel quel) : Nettoyer proposé (menu sur téléphone, lien sur ordinateur), puis plus rien.
  const photo = row(page, "plage-nuit.jpg");
  await expect(photo.locator("[data-clean]")).toHaveCount(0);
  if (isMobile) {
    await photo.getByRole("button", { name: "Actions pour plage-nuit.jpg" }).click();
    const menu = page.getByRole("dialog", { name: "plage-nuit.jpg" });
    await expect(menu.locator(".mi")).toHaveText(["Aperçu", "Renommer", "Nettoyer", "Supprimer"]);
    await settle(page);
    await page.screenshot({ path: `${SHOTS}composeur-menu-${w(isMobile)}.png` });
    // « Nettoyer » du menu : même confirmation que le balai (retours du 12 novembre).
    await menu.getByRole("button", { name: "Nettoyer" }).click();
    await expect(menu).toBeHidden();
  } else {
    await photo.getByRole("button", { name: "Nettoyer ce fichier" }).click();
  }
  await page.getByRole("dialog", { name: "Nettoyer ce fichier\u202f?" }).getByRole("button", { name: "Nettoyer", exact: true }).click();
  await expect(photo.locator('[data-clean="nettoye"]')).toBeVisible();
  await expect(photo.locator("[data-fix]")).toHaveCount(0);
  if (isMobile) {
    // PDF tel quel : ni Aperçu ni Monter/Descendre ; Nettoyer seulement.
    await row(page, "contrat.pdf").getByRole("button", { name: "Actions pour contrat.pdf" }).click();
    await expect(page.getByRole("dialog", { name: "contrat.pdf" }).locator(".mi")).toHaveText(["Renommer", "Nettoyer", "Supprimer"]);
    await page.keyboard.press("Escape");
    // Archive : jamais ouverte, rien à nettoyer.
    await row(page, "archive.zip").getByRole("button", { name: "Actions pour archive.zip" }).click();
    await expect(page.getByRole("dialog", { name: "archive.zip" }).locator(".mi")).toHaveText(["Renommer", "Supprimer"]);
    await page.keyboard.press("Escape");
  }
});

test("destinataire : pastille « Téléchargé » au coin de l'icône (cadenas à l'autre coin), bulle ; icône des noms ; captures", async ({ page, shh, browser, isMobile }) => {
  test.setTimeout(150_000);
  const s = await freshPage(browser);
  const sent = await sendShare(s.page, shh.origin + "/", { text: "Code de la porte : 4512B", files: [file("foret-brume.jpg"), file("contrat.pdf"), file("budget-2026.xlsx")], opens: 2 });
  await s.ctx.close();
  await page.setViewportSize({ width: w(isMobile), height: isMobile ? 844 : 1000 });
  // Faux sélecteur de fichier (les octets sont jetés) : le téléchargement va jusqu'au bout.
  await page.addInitScript(() => {
    (window as unknown as Record<string, unknown>).showSaveFilePicker = async () => ({ createWritable: async () => ({ write: async () => undefined, close: async () => undefined, abort: async () => undefined }) });
  });
  await page.goto(sent.link);
  await unlock(page, sent.password);
  const pdf = page.locator("li.row").filter({ hasText: "foret-brume.jpg" });
  await expect(pdf).toBeVisible();
  await expect(page.locator("[data-names-tip]")).toHaveCount(1);
  const view = pdf.getByRole("button", { name: "Voir foret-brume.jpg" });
  const before = await view.boundingBox();
  await pdf.getByRole("button", { name: "Télécharger foret-brume.jpg" }).click();
  const got = pdf.locator("[data-downloaded] button");
  await expect(got).toHaveAccessibleName("Téléchargé", { timeout: 30_000 });
  // Le bouton ne bouge pas ; la pastille est au coin opposé du cadenas.
  expect((await view.boundingBox())!.x).toBeCloseTo(before!.x, 0);
  const [g, l, pic] = [await got.boundingBox(), await pdf.locator("[data-lock] button").boundingBox(), await pdf.locator(".pic").boundingBox()];
  const [cx, cy] = [pic!.x + pic!.width / 2, pic!.y + pic!.height / 2];
  expect(g!.x + g!.width / 2).toBeLessThan(cx);
  expect(g!.y + g!.height / 2).toBeLessThan(cy);
  expect(l!.x + l!.width / 2).toBeGreaterThan(cx);
  expect(l!.y + l!.height / 2).toBeGreaterThan(cy);
  await settle(page);
  expect(await axe(page)).toEqual([]);
  await page.screenshot({ path: `${SHOTS}destinataire-${w(isMobile)}.png`, fullPage: true });
  if (isMobile) await got.tap();
  else await got.hover();
  await expect(page.getByRole("tooltip", { name: "Téléchargé" })).toBeVisible();
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${SHOTS}destinataire-bulle-${w(isMobile)}.png` });
});

test("Offres et Sécurité : captures", async ({ page, shh, isMobile }) => {
  await page.setViewportSize({ width: w(isMobile), height: isMobile ? 844 : 1000 });
  await page.goto(shh.origin + "/offres");
  await expect(page.locator("[data-prices]")).toBeVisible();
  await settle(page);
  await page.screenshot({ path: `${SHOTS}offres-${w(isMobile)}.png`, fullPage: true });
  await page.goto(shh.origin + "/securite");
  await page.locator("[data-tech] summary").click();
  await settle(page);
  expect(await axe(page)).toEqual([]);
  await page.screenshot({ path: `${SHOTS}securite-${w(isMobile)}.png`, fullPage: true });
});
