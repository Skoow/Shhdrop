// Audit web D2 (13 novembre) : l'entrée de l'onglet (shh.og, qui contient K_lien) est effacée après
// 30 min sans activité même une fois l'écran de contenu quitté (garde de l'application).
import { expect, test } from "./fixtures";
import { freshPage, noteRow, sendShare, unlock } from "./open-helpers";

test.use({ locale: "fr-FR" });

test("contenu ouvert, retour à l'accueil, 31 min sans activité : shh.og effacé", async ({ page, shh, browser }) => {
  test.setTimeout(150_000);
  const s = await freshPage(browser);
  const sent = await sendShare(s.page, shh.origin + "/", { text: "Inactivité", opens: 3 });
  await s.ctx.close();
  await page.clock.install();
  await page.goto(sent.link);
  await unlock(page, sent.password);
  await expect(noteRow(page)).toBeVisible();
  const key = sent.link.slice(sent.link.indexOf("#") + 1);
  expect(await page.evaluate(() => sessionStorage.getItem("shh.og") ?? "")).toContain(key);
  await page.locator("header a.logo").click();
  await expect(noteRow(page)).toHaveCount(0);
  expect(await page.evaluate(() => sessionStorage.getItem("shh.og") ?? "")).toContain(key); // pas encore
  await page.clock.fastForward("31:00");
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem("shh.og"))).toBeNull();
});
