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

test("lecteur bloqué (ni lecture ni erreur, WebKit sans décodeur) : après 10 s, format et Télécharger", async ({ page, shh, browser }) => {
  test.setTimeout(120_000);
  const s = await freshPage(browser);
  const sent = await sendShare(s.page, shh.origin + "/", { files: [{ name: "film.mov", mimeType: "video/quicktime", buffer: FX("phone.mov") }] });
  await s.ctx.close();
  // Le navigateur ne charge jamais rien et ne signale aucune erreur (readyState reste à 0).
  await page.addInitScript(() => {
    Object.defineProperty(HTMLMediaElement.prototype, "readyState", { configurable: true, get: () => 0 });
    Object.defineProperty(HTMLMediaElement.prototype, "error", { configurable: true, get: () => null });
    // Les événements de média ne remontent pas mais passent par la phase de capture : arrêtés à window.
    for (const t of ["loadedmetadata", "loadeddata", "canplay", "error"]) addEventListener(t, (e) => e.stopImmediatePropagation(), true);
  });
  await page.goto(sent.link);
  await unlock(page, sent.password);
  await page.getByRole("button", { name: "Voir film.mov" }).click();
  const viewer = page.getByRole("dialog");
  await expect(viewer.locator("video")).toHaveCount(1);
  await expect(viewer.getByText(/^Ce navigateur ne sait pas lire le format MOV\./)).toBeVisible({ timeout: 20_000 });
  await expect(viewer.locator("video")).toHaveCount(0);
  await expect(viewer.getByRole("button", { name: "Télécharger film.mov" })).toBeVisible();
});

/** JPEG du dépôt dont le SOF annonce 60000 × 60000 (bombe de décompression, test d'intrusion du 11 novembre). */
function bombJpeg(): Buffer {
  const b = Buffer.from(readFileSync(file("foret-brume.jpg")));
  for (let o = 2; o < b.length; ) {
    const m = b[o + 1]!;
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      b.writeUInt16BE(60000, o + 5);
      b.writeUInt16BE(60000, o + 7);
      return b;
    }
    o += 2 + b.readUInt16BE(o + 2);
  }
  throw new Error("SOF introuvable");
}

test("image de plus de 50 mégapixels : jamais décodée, « pas d'aperçu », Télécharger reste", async ({ page, shh, browser }) => {
  test.setTimeout(120_000);
  const s = await freshPage(browser);
  const sent = await sendShare(s.page, shh.origin + "/", { files: [{ name: "bombe.jpg", mimeType: "image/jpeg", buffer: bombJpeg() }, file("foret-brume.jpg")] });
  await s.ctx.close();
  // Toute <img> insérée dans la visionneuse est notée, même si elle disparaît aussitôt (onerror).
  await page.addInitScript(() => {
    const w = window as unknown as { imgSeen: string[] };
    w.imgSeen = [];
    new MutationObserver((ms) => {
      for (const m of ms) for (const n of m.addedNodes) if (n instanceof HTMLImageElement && n.closest("dialog")) w.imgSeen.push(n.alt);
    }).observe(document, { childList: true, subtree: true });
  });
  await page.goto(sent.link);
  await unlock(page, sent.password);
  const viewer = page.getByRole("dialog");
  await page.getByRole("button", { name: "Voir bombe.jpg" }).click();
  await expect(viewer.getByRole("alert")).toHaveText(/^\s*Ce fichier ne peut pas être lu sur cet appareil\. Enregistrez-le pour l'ouvrir avec une autre application\.\s*$/, { timeout: 20_000 });
  await expect(viewer.getByRole("button", { name: "Télécharger bombe.jpg" })).toBeVisible();
  // Image ordinaire juste après : toujours affichée.
  await page.keyboard.press("ArrowRight");
  await expect(viewer.locator("img")).toHaveAttribute("alt", "foret-brume.jpg", { timeout: 20_000 });
  expect(await page.evaluate(() => (window as unknown as { imgSeen: string[] }).imgSeen)).toEqual(["foret-brume.jpg"]);
});
