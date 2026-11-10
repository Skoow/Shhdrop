// Retours TABLE du propriétaire : « Votre envoi » en un seul tableau sobre (un contenant, une
// catégorie = un sous-en-tête, jamais un cadre par type), icône recollée au bord gauche ; le nom
// de l'offre (Plus, Pro) plus écrit, en bulle au survol (retours CLEAN2) ; pied : « Offres … et »
// couleur des liens du pied, Plus et Pro au bleu de leur offre (jamais le vert d'accent).
// Captures fr-FR ×2 à 390 et 1440 px : .superpowers/sdd/2026-11-04-shhdrop-ecrans/shots/task-TABLE/.
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { axe, expect, test } from "./fixtures";
import { file, settle } from "./open-helpers";
import { autoClean, enterComposer, openFilePicker } from "./send-helpers";

const SHOTS = fileURLToPath(new URL("../../.superpowers/sdd/2026-11-04-shhdrop-ecrans/shots/task-TABLE/", import.meta.url));
test.use({ locale: "fr-FR", timezoneId: "Europe/Paris", deviceScaleFactor: 2 });
const w = (m: boolean) => (m ? 390 : 1440);
const WHITE = "rgb(233, 236, 242)";
const PLUS = "rgb(62, 193, 245)";
const PRO = "rgb(92, 128, 255)";
async function shot(page: Page, name: string, isMobile: boolean, full = false) {
  mkdirSync(SHOTS, { recursive: true });
  await page.evaluate(() => document.fonts.ready);
  await settle(page);
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${SHOTS}${name}-${w(isMobile)}.png`, fullPage: full });
}
const FILES = ["foret-brume.jpg", "lac-gele.jpg", "plage-nuit.jpg", "contrat.pdf", "budget-2026.xlsx"];

test("Votre envoi : un seul tableau, sous-en-têtes de catégorie, icône au bord ; badges hors cadre ; captures", async ({ page, shh, isMobile }) => {
  test.setTimeout(90_000);
  await page.setViewportSize(isMobile ? { width: 390, height: 844 } : { width: 1440, height: 900 });
  // Réglages : onglet ou en-tête depuis l'accueil (la page d'envoi n'en a pas sur téléphone).
  await page.goto(shh.origin + "/");
  await autoClean(page, true);
  await enterComposer(page);
  await (await openFilePicker(page)).setFiles(FILES.map(file));
  await expect(page.locator("[data-row]")).toHaveCount(FILES.length);

  // Un seul contenant, deux catégories dedans, chacune sans cadre propre.
  const table = page.locator(".groups");
  await expect(table).toHaveCount(1);
  expect(await table.evaluate((e) => getComputedStyle(e).borderTopStyle)).toBe("solid");
  const groups = table.locator("section.group");
  await expect(groups).toHaveCount(2);
  for (const g of await groups.all()) {
    expect(await g.evaluate((e) => getComputedStyle(e).borderTopStyle)).toBe("none");
    // Sous-en-tête en bandeau (fond), pas seulement un mot.
    expect(await g.locator(":scope > .head").evaluate((e) => getComputedStyle(e).backgroundColor)).not.toBe("rgba(0, 0, 0, 0)");
  }

  // Icône du type alignée sur le mot de la catégorie (« Photos », « Documents ») au-dessus
  // (retours CLEAN3), à 1 px près.
  for (const g of await groups.all()) {
    const h3 = (await g.locator(":scope > .head h3").boundingBox())!.x;
    for (const fi of await g.locator("[data-row] svg.fi").all()) expect(Math.abs((await fi.boundingBox())!.x - h3)).toBeLessThanOrEqual(1);
  }
  // 2ᵉ ligne (type, taille) alignée sur le début du nom.
  for (const r of await page.locator("[data-row]").all()) {
    const [nm, meta] = [(await r.locator(".nm").boundingBox())!.x, (await r.locator(".meta").boundingBox())!];
    const first = await r.locator(".meta > *").first().boundingBox();
    expect(Math.abs((first ?? meta).x - nm)).toBeLessThanOrEqual(1);
  }
  // Bouclier de nettoyage AVANT le nom, emplacement fixe : tous les noms commencent au même x,
  // qu'il y ait un bouclier (photos nettoyées, échecs) ou non.
  const xs = await page.locator("[data-row] .nm").evaluateAll((ns) => ns.map((n) => Math.round(n.getBoundingClientRect().left)));
  expect(new Set(xs).size).toBe(1);
  const before = await page.locator("[data-row]").first().evaluate((li) => li.querySelector("[data-clean]")!.getBoundingClientRect().right <= li.querySelector(".nm")!.getBoundingClientRect().left);
  expect(before).toBe(true);

  // Pastilles d'espace : le nom de l'offre n'est plus écrit (retours CLEAN2), mais reste dans le nom
  // accessible et en bulle au survol.
  const pills = page.locator("[data-paid-space] button");
  await expect(pills.nth(0)).toHaveAccessibleName(/^10\sGo · Plus$/);
  await expect(pills.nth(1)).toHaveAccessibleName(/^50\sGo · Pro$/);
  await expect(pills.nth(0).locator(".pv")).toHaveText(/^10\sGo$/);
  await expect(pills.nth(0)).toHaveAttribute("title", "Plus");
  await expect(pills.nth(1)).toHaveAttribute("title", "Pro");
  await shot(page, "composeur", isMobile);

  // Options : plus aucun badge écrit ; le nom de l'offre en bulle au survol (title).
  if (isMobile) await page.getByRole("button", { name: /^Options · / }).click();
  const opts = page.locator(".opts").filter({ visible: true });
  await expect(opts.locator('[data-locked="first-open"]')).toBeVisible();
  await expect(opts.locator(".badge")).toHaveCount(0);
  await expect(opts.locator('[data-locked="first-open"]')).toHaveAttribute("title", "Plus");
  await expect(opts.locator('[data-locked="opens"] button')).toHaveAttribute("title", "Pro");
  await settle(page);
  expect(await axe(page)).toEqual([]);
  await shot(page, "options", isMobile);
});

test("pied : « Offres … et » couleur des liens du pied, Plus et Pro en bleu, jamais le vert ; capture", async ({ page, shh, isMobile }) => {
  await page.setViewportSize(isMobile ? { width: 390, height: 844 } : { width: 1440, height: 900 });
  await page.goto(shh.origin + "/offres");
  const link = page.locator("[data-foot-offers]");
  await expect(link).toHaveText("Offres Plus et Pro");
  await expect(link).toHaveAttribute("aria-current", "page");
  const color = (sel: string) => link.locator(sel).evaluate((e) => getComputedStyle(e).color);
  // Même sur la page des offres (lien courant) : « Offres » et « et » en gris, comme le pied (CLEAN3).
  expect(await link.evaluate((e) => getComputedStyle(e).color)).not.toBe(WHITE);
  const grey = await page.locator("footer a.fl").filter({ hasText: "Conditions" }).evaluate((e) => getComputedStyle(e).color);
  expect(await link.evaluate((e) => getComputedStyle(e).color)).toBe(grey);
  expect(await color(".tier.plus")).toBe(PLUS);
  expect(await color(".tier.pro")).toBe(PRO);
  await link.scrollIntoViewIfNeeded();
  await settle(page);
  expect(await axe(page)).toEqual([]);
  await page.locator("footer").screenshot({ path: `${SHOTS}pied-${w(isMobile)}.png` });
  await page.goto(shh.origin + "/securite");
  const other = page.locator("footer a.fl:not([aria-current])").filter({ hasText: "Conditions" });
  const linkColor = await other.evaluate((e) => getComputedStyle(e).color);
  expect(await page.locator("[data-foot-offers]").evaluate((e) => getComputedStyle(e).color)).toBe(linkColor);
  expect(await page.locator("[data-foot-offers] .tier.plus").evaluate((e) => getComputedStyle(e).color)).toBe(PLUS);
});
