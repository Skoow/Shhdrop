// Visionneuse PDF isolée (UI §13, Task 22, retours CLEAN5), contre le serveur Go (en-têtes
// réels : CORP cross-origin et frame-ancestors 'self' sur le cadre seulement) : pdf.js dans
// <iframe sandbox="allow-scripts">, origine opaque ; pages dessinées ; un PDF qui tente du
// JavaScript à l'ouverture n'ouvre aucune boîte, ne navigue nulle part, n'envoie rien ;
// aucune violation CSP ; aucune requête hors du site.
import { expect, test } from "./fixtures";
import { file, freshPage, sendShare, unlock } from "./open-helpers";

test.use({ locale: "fr-FR" });

test("PDF : affiché dans le cadre isolé (2 pages), JavaScript du PDF jamais exécuté ; capture", async ({ page, shh, browser }) => {
  test.setTimeout(120_000);
  const s = await freshPage(browser);
  const sent = await sendShare(s.page, shh.origin + "/", { files: [file("simple.pdf"), file("js.pdf")] });
  await s.ctx.close();
  const csp: string[] = [];
  const foreign: string[] = [];
  const dialogs: string[] = [];
  page.on("console", (m) => /Content Security Policy|Refused to/i.test(m.text()) && csp.push(m.text()));
  page.on("request", (r) => !r.url().startsWith(shh.origin) && !r.url().startsWith("blob:") && !r.url().startsWith("data:") && foreign.push(r.url()));
  page.on("dialog", (d) => {
    dialogs.push(d.message());
    void d.dismiss();
  });
  await page.goto(sent.link);
  await unlock(page, sent.password);

  await page.getByRole("button", { name: "Voir simple.pdf" }).click();
  const iframe = page.locator("iframe[data-pdf-frame]");
  await expect(iframe).toHaveAttribute("sandbox", "allow-scripts");
  await expect(iframe).toHaveClass(/\bok\b/, { timeout: 30_000 });
  const frame = page.frameLocator("iframe[data-pdf-frame]");
  await expect(frame.locator("canvas[data-page]")).toHaveCount(2);
  // Origine opaque : « null » vu de l'intérieur.
  const inner = page.frames().find((f) => f.url().endsWith("/pdf-frame.html"))!;
  expect(await inner.evaluate(() => origin)).toBe("null");
  // Page 1 dessinée : le pixel central n'est pas transparent.
  await expect.poll(() => inner.evaluate(() => {
    const c = document.querySelector<HTMLCanvasElement>('canvas[data-page="1"]')!;
    if (!c.width) return 0;
    return c.getContext("2d")!.getImageData(Math.floor(c.width / 2), Math.floor(c.height / 2), 1, 1).data[3];
  }), { timeout: 15_000 }).toBeGreaterThan(0);
  await page.waitForTimeout(300);
  await page.screenshot({ path: test.info().outputPath("pdf.png") });

  // PDF avec JavaScript à l'ouverture : affiché, mais rien ne s'exécute.
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("dialog").getByRole("heading", { name: "js.pdf" })).toBeVisible();
  await expect(page.locator("iframe[data-pdf-frame]")).toHaveClass(/\bok\b/, { timeout: 30_000 });
  await page.waitForTimeout(1000);
  expect(dialogs).toEqual([]);
  expect(page.url().startsWith(shh.origin)).toBe(true);
  expect(foreign).toEqual([]);
  expect(csp).toEqual([]);
});
