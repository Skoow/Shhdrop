// Retours CLEAN4 et CLEAN5 : un fichier sans aperçu (bureautique, archive…) n'a que
// « Télécharger », sans message ni « Voir » ; dans la visionneuse, le format que ce navigateur
// ne décode pas et le navigateur à essayer (HEIC : Safari, que Chromium ne lit pas).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "./fixtures";
import { file, freshPage, sendShare, unlock } from "./open-helpers";

test.use({ locale: "fr-FR" });
const FX = (n: string) => readFileSync(fileURLToPath(new URL(`../src/media/fixtures/${n}`, import.meta.url)));

test("sans aperçu : Télécharger seulement ; HEIC illisible ici : format et navigateur à essayer", async ({ page, shh, browser, browserName }) => {
  test.setTimeout(120_000);
  const s = await freshPage(browser);
  const sent = await sendShare(s.page, shh.origin + "/", {
    files: [file("foret-brume.jpg"), { name: "rapport.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", buffer: FX("meta.docx") }, { name: "IMG_0001.heic", mimeType: "image/heic", buffer: FX("meta.heic") }],
  });
  await s.ctx.close();
  await page.goto(sent.link);
  await unlock(page, sent.password);
  const row = (n: string) => page.locator("li").filter({ hasText: n }).first();
  await expect(row("rapport.docx").getByRole("button", { name: "Télécharger rapport.docx" })).toBeVisible();
  await expect(row("rapport.docx").getByRole("button", { name: /^Voir/ })).toHaveCount(0);
  await expect(row("rapport.docx").locator(".note")).toHaveCount(0);
  test.skip(browserName !== "chromium", "HEIC : seul Chromium est sûr de ne pas le décoder");
  await page.getByRole("button", { name: "Voir IMG_0001.heic" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "HEIC" })).toHaveText(/^\s*Ce navigateur ne sait pas lire le format HEIC\. Enregistrez le fichier, ou ouvrez le lien dans Safari\.\s*$/, { timeout: 20_000 });
});

test("FLAC et MKV : « Voir » et lecture dans la page (Chromium), même sans type donné par le navigateur", async ({ page, shh, browser, browserName }) => {
  test.setTimeout(120_000);
  test.skip(browserName !== "chromium", "MKV : Chromium seulement");
  const s = await freshPage(browser);
  const sent = await sendShare(s.page, shh.origin + "/", {
    files: [{ name: "concert.flac", mimeType: "", buffer: FX("meta.flac") }, { name: "film.mkv", mimeType: "", buffer: FX("meta.mkv") }],
  });
  await s.ctx.close();
  await page.goto(sent.link);
  await unlock(page, sent.password);
  const viewer = page.getByRole("dialog");
  await page.getByRole("button", { name: "Voir concert.flac" }).click();
  await expect.poll(() => viewer.locator("audio").evaluate((a: HTMLAudioElement) => a.readyState), { timeout: 20_000 }).toBeGreaterThanOrEqual(1);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Voir film.mkv" }).click();
  await expect.poll(() => viewer.locator("video").evaluate((v: HTMLVideoElement) => v.readyState), { timeout: 20_000 }).toBeGreaterThanOrEqual(1);
});
