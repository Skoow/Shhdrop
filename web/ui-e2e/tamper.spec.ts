// Audit web D3 (13 novembre) : un contenu modifié par le serveur est refusé avec un texte fixe,
// choisi par le client, jamais « Ce lien n'existe pas ».
import { expect, test } from "./fixtures";
import { freshPage, noteRow, pwField, sendShare, unlockButton } from "./open-helpers";

test.use({ locale: "fr-FR" });

test("segment 0 altéré en route : « Le contenu a été modifié en route ; il n'a pas été ouvert. »", async ({ page, shh, browser }) => {
  test.setTimeout(150_000);
  const s = await freshPage(browser);
  const sent = await sendShare(s.page, shh.origin + "/", { text: "Contenu authentique", opens: 2 });
  await s.ctx.close();
  await page.route(/\/api\/shares\/segments\/0$/, async (route) => {
    const res = await route.fetch();
    const body = Buffer.from(await res.body());
    body[10]! ^= 1; // dans l'en-tête : l'engagement ne correspond plus
    await route.fulfill({ response: res, body });
  });
  await page.goto(sent.link);
  await pwField(page).fill(sent.password);
  await unlockButton(page).click();
  await expect(page.getByRole("heading", { name: "Le contenu a été modifié en route ; il n'a pas été ouvert." })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("n'existe pas")).toHaveCount(0);
  await expect(noteRow(page)).toHaveCount(0);
  await expect(page.getByText("Contenu authentique")).toHaveCount(0);
});
