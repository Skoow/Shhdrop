// Retours CLEAN4 : fichiers que le site ne peut pas lire. Sur la ligne, une note pour les types
// sans aperçu (bureautique, archive…) ; dans la visionneuse, le format que ce navigateur ne
// décode pas et le navigateur à essayer (HEIC : Safari, que Chromium ne lit pas).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "./fixtures";
import { file, freshPage, sendShare, unlock } from "./open-helpers";

test.use({ locale: "fr-FR" });
const FX = (n: string) => readFileSync(fileURLToPath(new URL(`../src/media/fixtures/${n}`, import.meta.url)));

test("note « pas d'aperçu » sur la ligne ; HEIC illisible ici : format et navigateur à essayer", async ({ page, shh, browser, browserName }) => {
  test.setTimeout(120_000);
  const s = await freshPage(browser);
  const sent = await sendShare(s.page, shh.origin + "/", {
    files: [file("foret-brume.jpg"), { name: "rapport.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", buffer: FX("meta.docx") }, { name: "IMG_0001.heic", mimeType: "image/heic", buffer: FX("meta.heic") }],
  });
  await s.ctx.close();
  await page.goto(sent.link);
  await unlock(page, sent.password);
  const row = (n: string) => page.locator("li").filter({ hasText: n }).first();
  await expect(row("rapport.docx").locator("[data-no-preview]")).toHaveText("Pas d'aperçu sur le site pour ce type de fichier : enregistrez-le pour l'ouvrir.");
  await expect(row("foret-brume.jpg").locator("[data-no-preview]")).toHaveCount(0);
  test.skip(browserName !== "chromium", "HEIC : seul Chromium est sûr de ne pas le décoder");
  await page.getByRole("button", { name: "Voir IMG_0001.heic" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "HEIC" })).toHaveText(/^\s*Ce navigateur ne sait pas lire le format HEIC\. Enregistrez le fichier, ou ouvrez le lien dans Safari\.\s*$/, { timeout: 20_000 });
});
