// Retours OPT du propriétaire, remplacés le 11 novembre (audit M17) : plus de pastilles « 10 Go »
// et « 50 Go » ni de choix verrouillés ; une ligne discrète sous les limites du gratuit. Captures
// fr-FR ×2 à 390 et 1440.
import { fileURLToPath } from "node:url";
import { axe, expect, test } from "./fixtures";
import { settle } from "./open-helpers";
import { addText, composerFits } from "./send-helpers";

const SHOTS = fileURLToPath(new URL("../../.superpowers/sdd/2026-11-04-shhdrop-ecrans/shots/task-OPT/", import.meta.url));
test.use({ locale: "fr-FR", timezoneId: "Europe/Paris", deviceScaleFactor: 2 });
const w = (isMobile: boolean) => (isMobile ? 390 : 1440);

test("haut du composeur : une ligne discrète « Plus et Pro, bientôt » ; aucun verrou ; rien ne déborde", async ({ page, shh, isMobile }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: w(isMobile), height: isMobile ? 844 : 900 });
  await page.goto(shh.origin + "/");
  await addText(page, "Le code de la porte est 4471.");
  await expect(page.locator("[data-paid-space], [data-locked]")).toHaveCount(0);
  const line = page.locator("[data-paid-line]").filter({ visible: true });
  await expect(line).toHaveText("Plus de place et de durée avec Plus et Pro, bientôt");
  // Discrète : texte secondaire, jamais le vert de l'action.
  expect(await line.evaluate((e) => getComputedStyle(e).color)).not.toBe("rgb(80, 227, 168)");
  expect(await page.evaluate(() => document.scrollingElement!.scrollWidth <= innerWidth)).toBe(true);
  if (!isMobile) expect(await composerFits(page)).toBe(true);
  await settle(page);
  expect(await axe(page)).toEqual([]);
  await page.screenshot({ path: `${SHOTS}compose-top-${w(isMobile)}.png` });
});
