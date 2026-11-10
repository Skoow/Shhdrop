// Retours UI8 du propriétaire, sur le vrai serveur : fond sobre de « Comment ça marche », pied de
// page sans aucun soulignement (couleur et anneau de focus), pastilles qui rentrent dans l'icône
// de format (découpe de la couleur du fond), bouclier de nettoyage avec sa bulle, nettoyage dit au
// destinataire par le manifeste chiffré, icônes maison. Captures fr-FR ×2 à 390 et 1440 px.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { axe, expect, test } from "./fixtures";
import { file, freshPage, sendShare, settle, unlock } from "./open-helpers";
import { autoClean, openFilePicker } from "./send-helpers";
import type { Locator, Page } from "@playwright/test";

const SHOTS = fileURLToPath(new URL("../../.superpowers/sdd/2026-11-04-shhdrop-ecrans/shots/task-UI8/", import.meta.url));
test.use({ locale: "fr-FR", timezoneId: "Europe/Paris", deviceScaleFactor: 2 });
const w = (isMobile: boolean) => (isMobile ? 390 : 1440);

async function openTip(page: Page, btn: Locator, isMobile: boolean) {
  await btn.scrollIntoViewIfNeeded();
  if (isMobile) await btn.tap();
  else await btn.hover();
  await expect(page.getByRole("tooltip").filter({ visible: true })).toHaveCount(1);
  await page.waitForTimeout(250);
}

/** La pastille (18 px) rentre dans le coin de la feuille : son centre est DANS l'icône de format. */
async function insideIcon(row: Locator, pill: string) {
  const [p, fi] = [await row.locator(pill).boundingBox(), await row.locator("svg.fi").boundingBox()];
  const [cx, cy] = [p!.x + p!.width / 2, p!.y + p!.height / 2];
  expect(cx).toBeGreaterThan(fi!.x);
  expect(cx).toBeLessThan(fi!.x + fi!.width);
  expect(cy).toBeGreaterThan(fi!.y);
  expect(cy).toBeLessThan(fi!.y + fi!.height);
  // Découpe de 2 px de la couleur du fond ; 18 px (à l'échelle près du composeur de l'accueil).
  expect(await row.locator(pill).evaluate((e) => getComputedStyle(e).boxShadow)).toMatch(/0px 0px 0px 2px/);
  expect(p!.width).toBeCloseTo(18, 0);
  expect(p!.height).toBeCloseTo(18, 0);
}

test("accueil : « Comment ça marche » sur un fond sobre (ni biais, ni réglure, ni motif) ; capture", async ({ page, shh, isMobile }) => {
  await page.setViewportSize({ width: w(isMobile), height: isMobile ? 844 : 1000 });
  await page.goto(shh.origin + "/");
  const how = page.locator("#comment");
  await how.scrollIntoViewIfNeeded();
  const bg = how.locator(".sec-bg.tide");
  const st = await bg.evaluate((e) => ({ clip: getComputedStyle(e).clipPath, tex: getComputedStyle(e.querySelector(".tex")!).backgroundImage }));
  expect(st.clip).toBe("none");
  expect(st.tex).not.toMatch(/repeating|url\(/);
  await settle(page);
  await how.screenshot({ path: `${SHOTS}accueil-comment-${w(isMobile)}.png`, animations: "disabled" });
});

test("pied de page : aucun soulignement (repos, survol, focus), couleur et anneau de focus au clavier ; capture", async ({ page, shh, isMobile }) => {
  await page.setViewportSize({ width: w(isMobile), height: isMobile ? 844 : 1000 });
  await page.goto(shh.origin + "/");
  const foot = page.locator("footer[data-foot]");
  await foot.scrollIntoViewIfNeeded();
  const links = foot.locator(".fl");
  const deco = (l: Locator) => l.evaluate((e) => [e, ...e.querySelectorAll("*")].map((x) => getComputedStyle(x).textDecorationLine + getComputedStyle(x).backgroundImage).join());
  for (const l of await links.all()) expect(await deco(l)).toMatch(/^(nonenone,?)+$/);
  const link = foot.getByRole("link", { name: /^Signaler un abus/ });
  const color = () => link.evaluate((e) => getComputedStyle(e).color);
  const rest = await color();
  if (!isMobile) {
    await link.hover();
    await expect.poll(color).not.toBe(rest);
    expect(await deco(link)).toMatch(/^(nonenone,?)+$/);
    await page.mouse.move(0, 0);
  }
  // Clavier : anneau visible (2 px), toujours pas de soulignement.
  await link.focus();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  await expect(link).toBeFocused();
  const ring = await link.evaluate((e) => ({ m: e.matches(":focus-visible"), s: getComputedStyle(e).outlineStyle, w: getComputedStyle(e).outlineWidth }));
  expect(ring).toEqual({ m: true, s: "solid", w: "2px" });
  expect(await deco(link)).toMatch(/^(nonenone,?)+$/);
  await settle(page);
  await foot.screenshot({ path: `${SHOTS}pied-${w(isMobile)}.png` });
  await page.emulateMedia({ forcedColors: "active" });
  expect(await deco(link)).toMatch(/^(nonenone,?)+$/);
});

test("composeur : bouclier de nettoyage avant le nom avec sa bulle, pastille cadenas dans l'icône ; capture", async ({ page, shh, isMobile }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: w(isMobile), height: isMobile ? 844 : 1000 });
  await page.goto(shh.origin + "/");
  await autoClean(page, true);
  const jpg = readFileSync(file("plage-nuit.jpg"));
  await (await openFilePicker(page)).setFiles([
    { name: "plage-nuit.jpg", mimeType: "image/jpeg", buffer: jpg },
    { name: "abime.jpg", mimeType: "image/jpeg", buffer: jpg.subarray(0, jpg.length >> 2) },
    { name: "archive.zip", mimeType: "application/zip", buffer: readFileSync(file("archive.zip")) },
  ]);
  const row = (n: string) => page.locator("[data-row]").filter({ hasText: n });
  await expect(page.locator("[data-row]")).toHaveCount(3);
  const done = row("plage-nuit.jpg").locator('[data-clean="nettoye"]');
  const fail = row("abime.jpg").locator('[data-clean="echec"]');
  await expect(done).toBeVisible();
  await expect(fail).toBeVisible();
  await expect(row("archive.zip").locator("[data-clean]")).toHaveCount(0);
  // Bouclier : 15 px, juste AVANT le nom (retours CLEAN2), centré sur le texte ; bouton nommé par sa bulle.
  const sh = await done.locator("svg").boundingBox();
  expect(sh!.width).toBeCloseTo(15, 0);
  const sz = await row("plage-nuit.jpg").locator(".nm").boundingBox();
  expect(sh!.x + sh!.width).toBeLessThanOrEqual(sz!.x);
  expect(Math.abs(sh!.y + sh!.height / 2 - (sz!.y + sz!.height / 2))).toBeLessThanOrEqual(1.5);
  await expect(done.getByRole("button")).toHaveAccessibleName(/^Nettoyé\s: position, appareil et dates retirés$/);
  await expect(fail.getByRole("button")).toHaveAccessibleName(/^Nettoyage impossible\s: structure du fichier inattendue$/);
  expect(await done.locator(".sh").evaluate((e) => getComputedStyle(e).fill)).not.toBe(await fail.locator(".sh").evaluate((e) => getComputedStyle(e).fill));
  await expect(page.locator('[data-up]:not([data-up="pret"])')).toHaveCount(0, { timeout: 30_000 });
  await settle(page);
  await page.mouse.move(0, 0);
  for (const n of ["plage-nuit.jpg", "abime.jpg", "archive.zip"]) await insideIcon(row(n), "[data-lock] .pill");
  expect(await axe(page)).toEqual([]);
  await openTip(page, done.getByRole("button"), isMobile);
  await expect(page.getByRole("tooltip").filter({ visible: true })).toHaveText(/^Nettoyé\s: position, appareil et dates retirés$/);
  await page.screenshot({ path: `${SHOTS}composeur-${w(isMobile)}.png` });
});

test("destinataire : nettoyage dit par le manifeste (2ᵉ ligne du cadenas, bouclier), pastilles dans l'icône ; capture", async ({ page, shh, browser, isMobile }) => {
  test.setTimeout(150_000);
  const s = await freshPage(browser);
  const sent = await sendShare(s.page, shh.origin + "/", { text: "Code de la porte : 4512B", files: [file("foret-brume.jpg"), file("archive.zip")], opens: 2, clean: true });
  await s.ctx.close();
  await page.setViewportSize({ width: w(isMobile), height: isMobile ? 844 : 1000 });
  await page.addInitScript(() => {
    (window as unknown as Record<string, unknown>).showSaveFilePicker = async () => ({ createWritable: async () => ({ write: async () => undefined, close: async () => undefined, abort: async () => undefined }) });
  });
  await page.goto(sent.link);
  await unlock(page, sent.password);
  const row = (n: string) => page.locator("li.row").filter({ hasText: n });
  const jpg = row("foret-brume.jpg");
  await expect(jpg).toBeVisible();
  await expect(jpg.locator("[data-lock] button")).toHaveAccessibleName(/\. Nettoyé avant l'envoi\s: position, appareil et dates retirés$/);
  await expect(jpg.locator('[data-clean="nettoye"] button')).toHaveAccessibleName(/^Nettoyé avant l'envoi\s: position, appareil et dates retirés$/);
  await expect(row("archive.zip").locator("[data-lock] button")).toHaveAccessibleName(/\. Fichier tel quel$/);
  await expect(row("archive.zip").locator("[data-clean]")).toHaveCount(0);
  // Un texte n'a rien à nettoyer : une seule ligne.
  await expect(row("Note").locator("[data-lock] button")).not.toHaveAccessibleName(/Nettoy|tel quel/);
  await jpg.getByRole("button", { name: "Télécharger foret-brume.jpg" }).click();
  await expect(jpg.locator("[data-downloaded] button")).toHaveAccessibleName("Téléchargé", { timeout: 30_000 });
  await settle(page);
  await page.mouse.move(0, 0);
  await insideIcon(jpg, "[data-lock] .pill");
  await insideIcon(jpg, ".got-pill");
  expect(await axe(page)).toEqual([]);
  await openTip(page, jpg.locator("[data-lock] button"), isMobile);
  const tip = page.getByRole("tooltip").filter({ visible: true });
  await expect(tip.locator(".l2")).toHaveText(/^Nettoyé avant l'envoi\s: position, appareil et dates retirés$/);
  await page.screenshot({ path: `${SHOTS}destinataire-${w(isMobile)}.png` });
});
