// Retours UI7 du propriétaire, sur le vrai serveur : libellé de format toujours DANS l'icône,
// état de nettoyage dans la bulle du cadenas (étincelle, pastille ambre, rien), « Signaler »
// seulement dans le pied de page (confirmation du partage ouvert), pied de page refait, Offres
// (mensuel par abonnement, annuel au choix, carte et crypto-monnaies). Captures fr-FR ×2 à 390 et 1440 px.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { axe, expect, test } from "./fixtures";
import { file, freshPage, sendShare, settle, unlock } from "./open-helpers";
import { openFilePicker } from "./send-helpers";
import type { Page } from "@playwright/test";

const SHOTS = fileURLToPath(new URL("../../.superpowers/sdd/2026-11-04-shhdrop-ecrans/shots/task-UI7/", import.meta.url));
test.use({ locale: "fr-FR", timezoneId: "Europe/Paris", deviceScaleFactor: 2 });
const w = (isMobile: boolean) => (isMobile ? 390 : 1440);
const row = (page: Page, name: string) => page.locator("[data-row]").filter({ hasText: name });
const lock = (page: Page, name: string) => row(page, name).locator("[data-lock] button");

async function openTip(page: Page, btn: ReturnType<Page["locator"]>, isMobile: boolean) {
  await btn.scrollIntoViewIfNeeded();
  if (isMobile) await btn.tap();
  else await btn.hover();
  await expect(page.getByRole("tooltip").filter({ visible: true })).toHaveCount(1);
  await page.waitForTimeout(250);
}

test("composeur : libellés dans l'icône, bulle du cadenas à deux lignes, étincelle / pastille ambre / rien ; capture", async ({ page, shh, isMobile }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: w(isMobile), height: isMobile ? 844 : 1000 });
  await page.goto(shh.origin + "/");
  const jpg = readFileSync(file("plage-nuit.jpg"));
  await (await openFilePicker(page)).setFiles([
    { name: "plage-nuit.jpg", mimeType: "image/jpeg", buffer: jpg },
    { name: "abime.jpg", mimeType: "image/jpeg", buffer: jpg.subarray(0, jpg.length >> 2) },
    { name: "archive.zip", mimeType: "application/zip", buffer: readFileSync(file("archive.zip")) },
    { name: "budget-2026.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: readFileSync(file("budget-2026.xlsx")) },
    { name: "police.woff2", mimeType: "font/woff2", buffer: Buffer.from("wOF2") },
    { name: "livre.epub", mimeType: "application/epub+zip", buffer: Buffer.from("x") },
    { name: "page.html", mimeType: "text/html", buffer: Buffer.from("<p>x</p>") },
    { name: "image.webp", mimeType: "image/webp", buffer: Buffer.from("x") },
  ]);
  await expect(page.locator("[data-row]")).toHaveCount(8);

  // Libellé : 4 caractères au plus, entièrement dans la pastille, elle-même dans la feuille.
  const boxes = await page.locator("[data-row] svg.fi").evaluateAll((svgs) =>
    svgs.map((s) => {
      const r = (sel: string) => {
        const b = (s.querySelector(sel) as SVGGraphicsElement).getBBox();
        return { x: b.x, y: b.y, width: b.width, height: b.height };
      };
      const [pg, tag, lb] = [r(".pg"), r(".tag"), r(".lb")];
      const textLen = (s.querySelector(".lb") as SVGTextElement).getComputedTextLength();
      return { label: s.querySelector(".lb")!.textContent!, pg, tag, lb, textLen };
    }),
  );
  for (const b of boxes) {
    expect(b.label.length, b.label).toBeLessThanOrEqual(4);
    expect(b.label.trim(), b.label).not.toBe("");
    expect(b.tag.x, b.label).toBeGreaterThanOrEqual(b.pg.x);
    expect(b.tag.x + b.tag.width, b.label).toBeLessThanOrEqual(b.pg.x + b.pg.width);
    expect(Math.min(b.textLen, 18), b.label).toBeLessThanOrEqual(b.tag.width);
    expect(b.lb.y, b.label).toBeGreaterThanOrEqual(b.tag.y - 0.5);
    expect(b.lb.y + b.lb.height, b.label).toBeLessThanOrEqual(b.tag.y + b.tag.height + 0.5);
  }
  // Aucune image matricielle pour une icône dans les listes.
  await expect(page.locator("[data-row] img")).toHaveCount(0);

  // Nettoyage : étincelle (nettoyé), pastille ambre (échec), rien (tel quel). Plus de texte écrit.
  await expect(row(page, "plage-nuit.jpg").locator('[data-clean="nettoye"]')).toBeVisible();
  await expect(row(page, "abime.jpg").locator('[data-clean="echec"]')).toBeVisible();
  await expect(row(page, "archive.zip").locator("[data-clean]")).toHaveCount(0);
  await expect(page.locator("[data-row]").getByText(/^(Original|Nettoyé|Non nettoyé|Archive laissée intacte)$/)).toHaveCount(0);
  await expect(page.locator("[data-unclean-sum]").filter({ visible: true })).toHaveText("2\u202ffichiers n'ont pas pu être nettoyés"); // abime.jpg, budget-2026.xlsx (factice, 8 octets)
  await expect(row(page, "budget-2026.xlsx").locator('[data-clean="echec"]')).toBeVisible();
  // Tout reste dans les libellés : le nom du cadenas porte les deux lignes.
  await expect(lock(page, "plage-nuit.jpg")).toHaveAccessibleName(/\. Nettoyé\s: position, appareil et dates retirés$/);
  await expect(lock(page, "abime.jpg")).toHaveAccessibleName(/\. Nettoyage impossible\s: structure du fichier inattendue$/);
  await expect(lock(page, "archive.zip")).toHaveAccessibleName(/\. Fichier tel quel \(non modifié\)$/);
  await expect(page.locator('[data-up]:not([data-up="pret"])')).toHaveCount(0, { timeout: 30_000 });
  await expect(lock(page, "plage-nuit.jpg")).toHaveAccessibleName(/^Chiffré et envoyé\. Nettoyé\s: position, appareil et dates retirés$/);
  await settle(page);
  expect(await axe(page)).toEqual([]);

  await openTip(page, lock(page, "plage-nuit.jpg"), isMobile);
  const tip = page.getByRole("tooltip").filter({ visible: true });
  await expect(tip.locator(".l1")).toHaveText("Chiffré et envoyé.");
  await expect(tip.locator(".l2")).toHaveText(/^Nettoyé\s: position, appareil et dates retirés$/);
  await page.screenshot({ path: `${SHOTS}composeur-bulle-${w(isMobile)}.png` });
});

test("destinataire : plus de « Signaler » en haut ; le lien du pied ouvre la confirmation de CE partage ; capture", async ({ page, shh, browser, isMobile }) => {
  test.setTimeout(150_000);
  const s = await freshPage(browser);
  const sent = await sendShare(s.page, shh.origin + "/", { text: "Code de la porte : 4512B", files: [file("foret-brume.jpg"), file("contrat.pdf")], opens: 2 });
  await s.ctx.close();
  await page.setViewportSize({ width: w(isMobile), height: isMobile ? 844 : 1000 });
  await page.goto(sent.link);
  await unlock(page, sent.password);
  await expect(page.locator("li.row").filter({ hasText: "foret-brume.jpg" })).toBeVisible();
  await expect(page.locator("main").getByRole("button", { name: /Signaler/ })).toHaveCount(0);
  const foot = page.locator("footer[data-foot]");
  await expect(foot).toBeVisible(); // téléphone compris : sinon plus aucun moyen de signaler
  const report = foot.getByRole("button", { name: "Signaler ce partage" });
  await expect(foot.getByRole("link", { name: /^Signaler un abus/ })).toHaveCount(0);
  await settle(page);
  expect(await axe(page)).toEqual([]);
  await page.screenshot({ path: `${SHOTS}destinataire-${w(isMobile)}.png`, fullPage: true });
  await report.click();
  const sheet = page.getByRole("dialog", { name: "Signaler ce contenu" });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole("button", { name: "Signaler et détruire" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  // Le partage n'a pas été signalé : toujours là.
  await expect(page.locator("li.row").filter({ hasText: "contrat.pdf" })).toBeVisible();
});

test("pied de page : logo au bord intérieur de l'en-tête, liens sans soulignement, trait au survol, mouvement réduit ; Signaler ailleurs → page ; capture", async ({ page, shh, isMobile }) => {
  await page.setViewportSize({ width: w(isMobile), height: isMobile ? 844 : 1000 });
  await page.goto(shh.origin + "/");
  const foot = page.locator("footer[data-foot]");
  await foot.scrollIntoViewIfNeeded();
  const [fl, hl] = [await foot.locator(".foot-logo").boundingBox(), await page.locator("header a.logo").boundingBox()];
  expect(Math.abs(fl!.x - hl!.x)).toBeLessThanOrEqual(1);
  const link = foot.getByRole("link", { name: /^Signaler un abus/ });
  expect(await link.evaluate((e) => getComputedStyle(e).textDecorationLine)).toBe("none");
  // Papier peint maison : un SVG statique (aucun data:), très discret, retiré en contraste renforcé.
  const bg = await foot.evaluate((e) => { const c = getComputedStyle(e, "::after"); return { img: c.backgroundImage, o: parseFloat(c.opacity) }; });
  expect(bg.img).toMatch(/assets\/motif\.svg/);
  expect(bg.img).not.toContain("data:");
  expect(bg.o).toBeLessThanOrEqual(0.06);
  const res = await page.request.get(shh.origin + "/assets/motif.svg");
  expect(res.ok()).toBe(true);
  expect((await res.body()).length).toBeLessThan(4096);
  await settle(page);
  await foot.screenshot({ path: `${SHOTS}pied-${w(isMobile)}.png` });
  // Audit en haut de page : l'accueil estompe le composeur au défilement (animation liée au défilement).
  await page.evaluate(() => scrollTo(0, 0));
  expect(await axe(page)).toEqual([]);
  await link.scrollIntoViewIfNeeded();
  await link.click();
  await expect(page).toHaveURL(/\/signaler$/);
  await expect(page.getByRole("heading", { level: 1, name: "Signaler un abus" })).toBeVisible();
  await page.emulateMedia({ reducedMotion: "reduce", contrast: "more" } as Parameters<Page["emulateMedia"]>[0]);
  expect(await foot.locator(".fl").first().evaluate((e) => getComputedStyle(e).transitionDuration)).toMatch(/^0s/);
  expect(await foot.evaluate((e) => getComputedStyle(e, "::after").display)).toBe("none");
});

test("Offres : mensuel par abonnement, annuel au choix, carte et crypto-monnaies, rien à acheter ; capture", async ({ page, shh, isMobile }) => {
  await page.setViewportSize({ width: w(isMobile), height: isMobile ? 844 : 1000 });
  await page.goto(shh.origin + "/offres");
  const prices = page.locator("[data-prices]");
  await expect(prices).toBeVisible();
  const txt = (await prices.innerText()).replace(/[  ]/g, " ");
  for (const x of ["Au mois :", "abonnement renouvelé automatiquement chaque mois", "À l'année, au choix :", "paiement unique", "Moyens de paiement", "Carte bancaire", "Crypto-monnaies", "Aucun frais caché."]) expect(txt).toContain(x);
  await expect(page.locator("main")).toContainText("Bientôt disponible.");
  await expect(page.locator("main button, main form, main input, main img")).toHaveCount(0);
  await settle(page);
  expect(await axe(page)).toEqual([]);
  await page.screenshot({ path: `${SHOTS}offres-${w(isMobile)}.png`, fullPage: true });
});
