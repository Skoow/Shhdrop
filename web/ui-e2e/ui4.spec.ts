// Retours UI4 du propriétaire, sur le vrai serveur : bulle du cadenas, groupes délimités,
// « Détruire » à la dernière ouverture seulement, échéance en deux lignes, Plus en bleu ;
// captures fr-FR à 390 et 1440 px.
import { fileURLToPath } from "node:url";
import { axe, expect, test } from "./fixtures";
import { file, freshPage, noteRow, sendShare, settle, unlock } from "./open-helpers";
import { addText, readyHeading, sendButton } from "./send-helpers";

const SHOTS = fileURLToPath(new URL("../../.superpowers/sdd/2026-11-04-shhdrop-ecrans/shots/task-UI4/", import.meta.url));
const TEXT = "Code de la porte : 4512B";
test.use({ locale: "fr-FR", timezoneId: "Europe/Paris" });
const w = (isMobile: boolean) => (isMobile ? 390 : 1440);

test("destinataire, dernière ouverture : bulle du cadenas, groupes, « Détruire », pied centré sur téléphone, Signaler dans le pied de page", async ({ page, shh, browser, isMobile }) => {
  test.setTimeout(150_000);
  const s = await freshPage(browser);
  const sent = await sendShare(s.page, shh.origin + "/", { text: TEXT, files: [file("foret-brume.jpg"), file("contrat.pdf")], opens: 1 });
  await s.ctx.close();
  await page.setViewportSize({ width: w(isMobile), height: isMobile ? 844 : 1000 });
  await page.goto(sent.link);
  await unlock(page, sent.password);
  await expect(noteRow(page)).toBeVisible();
  // En-tête : seulement l'échéance (date et heure, puis le décompte ; plus « Disponible encore », UI5).
  const cap = page.locator("[data-capsule]");
  await expect(cap.locator("[data-deadline] .ends")).toHaveText(/^Se termine le \d+\s\S+ à \d+\sh\s\d{2}$/);
  await expect(cap.locator("[data-deadline] .left")).toHaveText(/^\d+\sh(\s\d{2}\smin)?$/);
  await expect(cap).not.toContainText("Disponible encore");
  await expect(cap).not.toContainText(/quittez la page|Recharger/);
  // Groupe allégé (retours LIGHT, remplace le bandeau d'UI4) : en-tête discret, sans bandeau ni filet.
  const head = page.locator('[data-group="texte"] .gh');
  expect(await head.evaluate((e) => getComputedStyle(e).borderBottomStyle)).toBe("none");
  // Dernière ouverture : « Détruire ce partage » et sa phrase ; Signaler dans le pied de page seulement (UI7).
  await expect(page.getByText(/^Vous êtes la dernière personne à pouvoir ouvrir ce partage : personne d'autre ne pourra l'ouvrir\./)).toBeVisible();
  await expect(page.getByRole("button", { name: "Détruire ce partage", exact: true })).toBeVisible();
  await expect(page.locator("header.top").getByRole("button", { name: /Signaler/ })).toHaveCount(0);
  await expect(page.locator("footer[data-foot]").getByRole("button", { name: "Signaler ce partage" })).toBeVisible();
  const eolAlign = await page.locator("[data-eol]").evaluate((e) => getComputedStyle(e).textAlign);
  expect(eolAlign).toBe(isMobile ? "center" : "start");
  await settle(page);
  expect(await axe(page)).toEqual([]);
  await page.screenshot({ path: `${SHOTS}content-last-${w(isMobile)}.png`, fullPage: true });
  // Bulle du cadenas ouverte (appui sur téléphone, survol à la souris).
  const lock = noteRow(page).locator('[data-lock="open"] button');
  await lock.scrollIntoViewIfNeeded();
  if (isMobile) await lock.tap();
  else await lock.hover();
  await expect(page.getByRole("tooltip", { name: "Déchiffré et vérifié" })).toBeVisible();
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${SHOTS}content-lock-tip-${w(isMobile)}.png` });
});

test("destinataire, ouverture non dernière : « Ce lien peut encore être ouvert 2 fois. », sans Détruire", async ({ page, shh, browser, isMobile }) => {
  test.setTimeout(150_000);
  const s = await freshPage(browser);
  const sent = await sendShare(s.page, shh.origin + "/", { text: TEXT, files: [file("foret-brume.jpg")], opens: 3 });
  await s.ctx.close();
  await page.setViewportSize({ width: w(isMobile), height: isMobile ? 844 : 1000 });
  await page.goto(sent.link);
  await unlock(page, sent.password);
  await expect(page.locator("[data-eol]")).toHaveText("Ce lien peut encore être ouvert 2 fois. Vous pouvez revenir sur ce partage depuis ce navigateur jusqu'à son échéance sans compter d'ouverture.");
  await expect(page.getByRole("button", { name: /^Détruire/ })).toHaveCount(0);
  await settle(page);
  await page.screenshot({ path: `${SHOTS}content-not-last-${w(isMobile)}.png`, fullPage: true });
});

test("Lien prêt : échéance en deux lignes", async ({ page, shh, isMobile }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: w(isMobile), height: isMobile ? 844 : 1000 });
  await page.goto(shh.origin + "/");
  await addText(page, "Le code de la porte est 4471.");
  await sendButton(page).filter({ visible: true }).click();
  await expect(readyHeading(page)).toBeVisible({ timeout: 60_000 });
  const dl = page.locator("[data-deadline]");
  await expect(dl.locator(".ends")).toHaveText(/^Se termine le \d+\s\S+ à \d+\sh\s\d{2}$/);
  // Heure de fin seule (audit M16) ; l'arrondi est dit dans la phrase.
  await expect(dl.locator(".left")).toHaveCount(0);
  await expect(page.getByText(/arrondies au quart d'heure supérieur/)).toBeVisible();
  await settle(page);
  await page.screenshot({ path: `${SHOTS}ready-deadline-${w(isMobile)}.png` });
});
