// QR code « lien + mot de passe » (D41-29) sur le vrai serveur : ouverture sans saisie, le
// fragment entier retiré de l'adresse ; mot de passe faux ou mal formé → écran de saisie normal.
import { expect, test } from "./fixtures";
import { freshPage, noteRow, pwField, sendShare } from "./open-helpers";

test.use({ locale: "fr-FR" });
const TEXT = "Repère QR 3f9a.";
const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64url");

test("lien + mot de passe du QR : ouvert sans saisie, aucun « # » ni mot de passe dans l'adresse", async ({ page, shh, browser }) => {
  test.setTimeout(120_000);
  const s = await freshPage(browser);
  const sent = await sendShare(s.page, shh.origin + "/", { text: TEXT, opens: 2 });
  await s.ctx.close();
  await page.goto(`${sent.link}.${b64(sent.password)}`);
  await expect(noteRow(page)).toBeVisible({ timeout: 30_000 });
  expect(page.url()).not.toContain("#");
  expect(await page.evaluate(() => history.length)).toBeGreaterThan(0);
  expect(await page.content()).not.toContain(sent.password);
});

test("mot de passe du QR faux (forme générée) ou mal formé : écran de saisie normal, champ vide", async ({ page, shh, browser }) => {
  test.setTimeout(120_000);
  const s = await freshPage(browser);
  const sent = await sendShare(s.page, shh.origin + "/", { text: TEXT, opens: 2 });
  await s.ctx.close();
  await page.goto(`${sent.link}.${b64("aC3!cD5?#Fg")}`);
  await expect(page.getByText(/Mot de passe incorrect/)).toBeVisible({ timeout: 30_000 });
  await expect(pwField(page)).toHaveValue("");
  expect(page.url()).not.toContain("#");
  await page.goto(`${sent.link}.%%%`);
  await expect(pwField(page)).toBeVisible({ timeout: 30_000 });
  await expect(pwField(page)).toHaveValue("");
});
