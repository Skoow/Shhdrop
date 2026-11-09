// Retours OPT du propriétaire : texte blanc dans les cadres Plus/Pro, « Jusqu'à 50 » en Pro,
// pastilles « 10 Go · Plus » et « 50 Go · Pro » à côté de la jauge ; captures fr-FR ×2 à 390 et 1440.
import { fileURLToPath } from "node:url";
import { axe, expect, test } from "./fixtures";
import { settle } from "./open-helpers";
import { addText } from "./send-helpers";

const SHOTS = fileURLToPath(new URL("../../.superpowers/sdd/2026-11-04-shhdrop-ecrans/shots/task-OPT/", import.meta.url));
test.use({ locale: "fr-FR", timezoneId: "Europe/Paris", deviceScaleFactor: 2 });
const w = (isMobile: boolean) => (isMobile ? 390 : 1440);

test("haut du composeur : pastilles 10 Go · Plus et 50 Go · Pro à côté de la jauge ; options : texte blanc, « Jusqu'à 50 » en Pro", async ({ page, shh, isMobile }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: w(isMobile), height: isMobile ? 844 : 900 });
  await page.goto(shh.origin + "/");
  await addText(page, "Le code de la porte est 4471.");
  const pills = page.locator("[data-paid-space] button");
  await expect(pills).toHaveText([/^10\sGo · Plus$/, /^50\sGo · Pro$/]);
  for (const p of await pills.all()) {
    expect(await p.evaluate((e) => [getComputedStyle(e).color, getComputedStyle(e).borderTopStyle])).toEqual(["rgb(233, 236, 242)", "dashed"]);
    expect(await p.locator(".ct").evaluate((e) => getComputedStyle(e).color)).toBe("rgb(85, 150, 248)");
    expect((await p.boundingBox())!.height).toBeGreaterThanOrEqual(24);
  }
  await expect(pills.nth(1)).toHaveAccessibleDescription("Avec Pro, bientôt disponible.");
  // Rien ne déborde : pas de défilement horizontal, et à 1440 la page tient sans défiler.
  expect(await page.evaluate(() => document.scrollingElement!.scrollWidth <= innerWidth)).toBe(true);
  if (!isMobile) expect(await page.evaluate(() => document.scrollingElement!.scrollHeight <= innerHeight)).toBe(true);
  await settle(page);
  await page.screenshot({ path: `${SHOTS}compose-top-${w(isMobile)}.png` });

  if (isMobile) await page.getByRole("button", { name: /^Options · / }).click();
  const opts = page.locator(".opts").filter({ visible: true });
  const opens = opts.locator('[data-locked="opens"]');
  await expect(opens.locator("button")).toHaveText(/^Jusqu'à 50$/);
  await expect(opens.locator(".badge")).toHaveText("Pro");
  for (const b of await opts.locator("[data-locked] button, button[data-locked]").all())
    expect(await b.evaluate((e) => getComputedStyle(e).color)).toBe("rgb(233, 236, 242)");
  await settle(page);
  expect(await axe(page)).toEqual([]);
  await page.screenshot({ path: `${SHOTS}options-${w(isMobile)}.png` });
  await opens.locator("button").click();
  await expect(page.getByRole("dialog", { name: "Shhdrop Pro" })).toContainText(/Jusqu'à 50\souvertures/);
});
