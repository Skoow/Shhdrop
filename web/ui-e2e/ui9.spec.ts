// Retours UI9 du propriétaire, sur le vrai serveur : bouclier de nettoyage juste après le nom
// (composeur et destinataire, ellipse du nom préservée), pied de page signé « Shhdrop © 2026 »
// en bas à gauche, papier peint de pictos sur les côtés de la page. Captures fr-FR ×2, 390 et 1440 px.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { axe, expect, test } from "./fixtures";
import { file, freshPage, sendShare, settle, unlock } from "./open-helpers";
import { openFilePicker } from "./send-helpers";
import type { Locator, Page } from "@playwright/test";

const SHOTS = fileURLToPath(new URL("../../.superpowers/sdd/2026-11-04-shhdrop-ecrans/shots/task-UI9/", import.meta.url));
test.use({ locale: "fr-FR", timezoneId: "Europe/Paris", deviceScaleFactor: 2 });
const w = (isMobile: boolean) => (isMobile ? 390 : 1440);

/** Bouclier après le nom, sur sa ligne, centré sur le texte et dans la ligne. */
async function afterName(row: Locator, name: string) {
  const [nm, sh, r] = [await row.locator(name).boundingBox(), await row.locator("[data-clean] svg").boundingBox(), await row.boundingBox()];
  expect(sh!.x).toBeGreaterThanOrEqual(nm!.x + nm!.width);
  expect(sh!.x - (nm!.x + nm!.width)).toBeLessThanOrEqual(8);
  expect(Math.abs(sh!.y + sh!.height / 2 - (nm!.y + nm!.height / 2))).toBeLessThanOrEqual(1.5);
  expect(sh!.x + sh!.width).toBeLessThanOrEqual(r!.x + r!.width);
}

test("composeur : bouclier juste après le nom, jamais repoussé par un nom long (ellipse au milieu) ; capture", async ({ page, shh, isMobile }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: w(isMobile), height: isMobile ? 844 : 1000 });
  await page.goto(shh.origin + "/");
  const jpg = readFileSync(file("plage-nuit.jpg"));
  const long = "vacances-ete-2026-plage-de-nuit-sous-les-etoiles-photo-originale-tres-longue.jpg";
  await (await openFilePicker(page)).setFiles([
    { name: "plage-nuit.jpg", mimeType: "image/jpeg", buffer: jpg },
    { name: long, mimeType: "image/jpeg", buffer: jpg },
    { name: "abime.jpg", mimeType: "image/jpeg", buffer: jpg.subarray(0, jpg.length >> 2) },
    { name: "archive.zip", mimeType: "application/zip", buffer: readFileSync(file("archive.zip")) },
  ]);
  const row = (n: string) => page.locator("[data-row]").filter({ has: page.locator(`.nm[title="${n}"]`) });
  await expect(page.locator("[data-row]")).toHaveCount(4);
  await expect(row("plage-nuit.jpg").locator('[data-clean="nettoye"]')).toBeVisible();
  await expect(row(long).locator('[data-clean="nettoye"]')).toBeVisible();
  await expect(row("abime.jpg").locator('[data-clean="echec"]')).toBeVisible();
  await expect(row("archive.zip").locator("[data-clean]")).toHaveCount(0);
  await expect(page.locator('[data-up]:not([data-up="pret"])')).toHaveCount(0, { timeout: 30_000 });
  await settle(page);
  for (const n of ["plage-nuit.jpg", long, "abime.jpg"]) await afterName(row(n), ".nm");
  // Le nom long est coupé au milieu (début en ellipse, fin « … .jpg » entière) ; le bouclier reste visible.
  const b = row(long).locator(".nm .b");
  expect(await b.evaluate((e) => e.scrollWidth > e.clientWidth)).toBe(true);
  await expect(row(long).locator(".nm .e")).toHaveText(/\.jpg$/);
  expect(await axe(page)).toEqual([]);
  await page.mouse.move(0, 0);
  await page.screenshot({ path: `${SHOTS}composeur-${w(isMobile)}.png` });
});

test("destinataire : bouclier juste après le nom ; capture", async ({ page, shh, browser, isMobile }) => {
  test.setTimeout(150_000);
  const s = await freshPage(browser);
  const sent = await sendShare(s.page, shh.origin + "/", { text: "Code de la porte : 4512B", files: [file("foret-brume.jpg"), file("archive.zip")], opens: 2 });
  await s.ctx.close();
  await page.setViewportSize({ width: w(isMobile), height: isMobile ? 844 : 1000 });
  await page.goto(sent.link);
  await unlock(page, sent.password);
  const row = (n: string) => page.locator("li.row").filter({ hasText: n });
  await expect(row("foret-brume.jpg").locator('[data-clean="nettoye"]')).toBeVisible();
  await expect(row("archive.zip").locator("[data-clean]")).toHaveCount(0);
  await afterName(row("foret-brume.jpg"), ".name");
  await expect(row("foret-brume.jpg").locator(".meta [data-clean]")).toHaveCount(0);
  await settle(page);
  await page.mouse.move(0, 0);
  expect(await axe(page)).toEqual([]);
  await page.screenshot({ path: `${SHOTS}destinataire-${w(isMobile)}.png` });
});

async function sides(page: Page) {
  return page.locator("[data-sides]").evaluate((e) => {
    const c = getComputedStyle(e);
    return { img: c.backgroundImage, o: parseFloat(c.opacity), d: c.display, pos: c.position, mask: c.maskImage || c.webkitMaskImage };
  });
}

test("pied : « Shhdrop © 2026 » en bas à gauche, plus de « publicité » ; côtés en pictos, retirés en contraste renforcé ; captures", async ({ page, shh, isMobile }) => {
  await page.setViewportSize({ width: w(isMobile), height: isMobile ? 844 : 1000 });
  await page.goto(shh.origin + "/");
  await settle(page);
  await page.screenshot({ path: `${SHOTS}accueil-${w(isMobile)}.png` });
  const foot = page.locator("footer[data-foot]");
  await foot.scrollIntoViewIfNeeded();
  await expect(foot.getByText(/publicité/)).toHaveCount(0);
  const sig = foot.locator(".base .sig");
  await expect(sig).toHaveText(/^Shhdrop\s*©\s2026$/);
  const [sb, base] = [await sig.boundingBox(), await foot.locator(".base").boundingBox()];
  expect(Math.abs(sb!.x - base!.x)).toBeLessThanOrEqual(1);
  // Côtés : fichier statique (pas de data:), fixe, très discret, colonne centrale masquée.
  const st = await sides(page);
  expect(st.img).toMatch(/assets\/motif\.svg/);
  expect(st.img).not.toContain("data:");
  expect(st.pos).toBe("fixed");
  expect(st.o).toBeLessThanOrEqual(isMobile ? 0.015 : 0.025);
  expect(st.mask).toMatch(/transparent|rgba\(0, 0, 0, 0\)/);
  const res = await page.request.get(shh.origin + "/assets/motif.svg");
  expect((await res.body()).length).toBeLessThan(4096);
  await settle(page);
  await foot.screenshot({ path: `${SHOTS}pied-${w(isMobile)}.png` });
  await page.evaluate(() => scrollTo(0, 0));
  expect(await axe(page)).toEqual([]);
  await page.emulateMedia({ contrast: "more" } as Parameters<Page["emulateMedia"]>[0]);
  expect((await sides(page)).d).toBe("none");
  await page.emulateMedia({ contrast: "no-preference", forcedColors: "active" } as Parameters<Page["emulateMedia"]>[0]);
  expect((await sides(page)).d).toBe("none");
});
