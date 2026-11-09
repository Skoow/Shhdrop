// Retours LIGHT du propriétaire : plus de phrase « collez avec Ctrl + V » (le collage reste) ;
// lignes et catégories allégées (un seul filet fin entre lignes, en-tête discret, aucun pavé)
// au composeur et chez le destinataire ; page d'envoi vide : cadre en pointillés, arrondi doux.
// Captures fr-FR ×2 à 390 et 1440 px : .superpowers/sdd/2026-11-04-shhdrop-ecrans/shots/task-LIGHT/.
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { file, freshPage, settle, unlock } from "./open-helpers";
import { noViewTransition, openFilePicker, readyHeading, sendButton } from "./send-helpers";

const SHOTS = fileURLToPath(new URL("../../.superpowers/sdd/2026-11-04-shhdrop-ecrans/shots/task-LIGHT/", import.meta.url));
test.use({ locale: "fr-FR", timezoneId: "Europe/Paris", deviceScaleFactor: 2 });

const w = (m: boolean) => (m ? 390 : 1440);
async function shot(page: Page, name: string, isMobile: boolean) {
  mkdirSync(SHOTS, { recursive: true });
  await page.evaluate(() => document.fonts.ready);
  await settle(page);
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${SHOTS}${name}-${w(isMobile)}.png` });
}
const css = (l: Locator, p: string) => l.evaluate((n, p) => getComputedStyle(n).getPropertyValue(p), p);

/** Un groupe léger : ni bordure ni fond propre ; lignes séparées par un seul filet. */
async function light(group: Locator, row: string) {
  expect(await css(group, "border-top-style")).toBe("none");
  expect(await css(group, "background-color")).toBe("rgba(0, 0, 0, 0)");
  const rows = group.locator(row);
  expect(await rows.count()).toBeGreaterThan(1);
  expect(await css(rows.nth(1), "border-top-width")).toBe("1px");
  expect(await css(rows.nth(0), "border-top-style")).toBe("none");
}

const FILES = ["foret-brume.jpg", "lac-gele.jpg", "plage-nuit.jpg", "contrat.pdf", "budget-2026.xlsx"];

test("page d'envoi vide : cadre en pointillés, sans phrase de collage ; captures", async ({ page, shh, isMobile }) => {
  await page.setViewportSize(isMobile ? { width: 390, height: 844 } : { width: 1440, height: 900 });
  await page.goto(shh.origin + "/envoyer");
  await noViewTransition(page);
  const zone = page.locator(".dropzone.empty");
  await expect(zone).toBeVisible();
  expect(await css(zone, "border-top-style")).toBe("dashed");
  expect(parseFloat(await css(zone, "border-top-left-radius"))).toBeGreaterThanOrEqual(16);
  await expect(page.locator("main")).not.toContainText(/Ctrl|Cmd|collez/i);
  await shot(page, "envoyer-vide", isMobile);
});

test("composeur et destinataire allégés ; captures", async ({ page, shh, browser, isMobile }) => {
  test.setTimeout(120_000);
  await page.setViewportSize(isMobile ? { width: 390, height: 844 } : { width: 1440, height: 900 });
  await page.goto(shh.origin + "/envoyer");
  const chooser = openFilePicker(page);
  await (await chooser).setFiles(FILES.map(file));
  await expect(page.locator("[data-row]")).toHaveCount(FILES.length);
  await expect(page.locator("main")).not.toContainText(/Ctrl|Cmd|collez/i);
  await light(page.locator("section.group").first(), ".li");
  await shot(page, "composeur", isMobile);
  await sendButton(page).click();
  await expect(readyHeading(page)).toBeVisible({ timeout: 60_000 });
  const read = async (name: string) => (await page.getByRole("group", { name }).locator(".sr-only").first().textContent()) ?? "";
  const [link, password] = [await read("Lien"), await read("Mot de passe")];
  const { ctx, page: rp } = await freshPage(browser, { deviceScaleFactor: 2, viewport: isMobile ? { width: 390, height: 844 } : { width: 1440, height: 900 }, isMobile, hasTouch: isMobile });
  await rp.goto(link);
  await unlock(rp, password);
  await expect(rp.locator("li[data-item]")).toHaveCount(FILES.length, { timeout: 30_000 });
  await light(rp.locator("section.group").first(), "li[data-item]");
  await shot(rp, "destinataire", isMobile);
  await ctx.close();
});
