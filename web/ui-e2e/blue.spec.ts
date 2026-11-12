// Retours BLUE du propriétaire : deux bleus distincts, Plus = ciel, Pro = profond ; chaque
// verrou, badge, carte et colonne au bleu de SON offre. Captures fr-FR ×2 à 390 et 1440.
import { fileURLToPath } from "node:url";
import { axe, expect, test } from "./fixtures";
import { settle } from "./open-helpers";
import { addText } from "./send-helpers";

const SHOTS = fileURLToPath(new URL("../../.superpowers/sdd/2026-11-04-shhdrop-ecrans/shots/task-BLUE/", import.meta.url));
test.use({ locale: "fr-FR", timezoneId: "Europe/Paris", deviceScaleFactor: 2 });
const w = (isMobile: boolean) => (isMobile ? 390 : 1440);
const PLUS = "rgb(62, 193, 245)";
const PRO = "rgb(92, 128, 255)";
const color = (e: Element) => getComputedStyle(e).color;

// Décision du propriétaire du 11 novembre (audit M17) : plus aucun verrou ni pastille Plus ou Pro
// dans le composeur ; depuis le 12 novembre, le bloc des offres (Plus, Pro) ouvre la feuille
// d'information (« bientôt » en tête).
test("composeur et options : aucun choix payant verrouillé ; le bloc des offres ouvre la feuille ; captures", async ({ page, shh, isMobile }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: w(isMobile), height: isMobile ? 844 : 900 });
  await page.goto(shh.origin + "/");
  await addText(page, "Le code de la porte est 4471.");
  await expect(page.locator("[data-paid-space], [data-locked]")).toHaveCount(0);
  const line = page.locator('[data-offer-strip] [data-offer="plus"] button').filter({ visible: true });
  await expect(line).toContainText("bientôt");
  await settle(page);
  await page.screenshot({ path: `${SHOTS}compose-top-${w(isMobile)}.png` });
  if (isMobile) await page.getByRole("button", { name: /^Options · / }).click();
  const opts = page.locator(".opts").filter({ visible: true });
  await expect(opts.getByText(/jours|première ouverture|Jusqu'à 50/)).toHaveCount(0);
  await settle(page);
  expect(await axe(page)).toEqual([]);
  await page.screenshot({ path: `${SHOTS}options-${w(isMobile)}.png` });
  if (isMobile) await page.keyboard.press("Escape");
  await line.click();
  const sheet = page.getByRole("dialog", { name: "Shhgone Plus" });
  await expect(sheet.locator("[data-paid] > *").first()).toContainText("Bientôt disponible.");
});

test("Offres : cartes et colonnes au bleu de leur offre ; feuille Pro en bleu Pro ; capture", async ({ page, shh, isMobile }) => {
  await page.setViewportSize({ width: w(isMobile), height: isMobile ? 844 : 1000 });
  await page.goto(shh.origin + "/offres");
  expect(await page.locator('[data-price="plus"] .tier').evaluate(color)).toBe(PLUS);
  expect(await page.locator('[data-price="pro"] .tier').evaluate(color)).toBe(PRO);
  expect(await page.locator("[data-offers] thead th.plus").evaluate(color)).toBe(PLUS);
  expect(await page.locator("[data-offers] thead th.pro").evaluate(color)).toBe(PRO);
  await settle(page);
  expect(await axe(page)).toEqual([]);
  await page.screenshot({ path: `${SHOTS}offres-${w(isMobile)}.png`, fullPage: true });
});
