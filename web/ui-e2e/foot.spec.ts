// Retours du propriétaire du 11 novembre : plus de roue ni de panneau Réglages ; le pied de page
// est sur toutes les pages (accueil, composeur, pages d'information, partage ouvert), ordinateur
// et téléphone, et porte la langue, le nettoyage automatique et « À propos ». Pendant un envoi,
// ses liens et réglages sont désactivés (aucun clic ne quitte la page). Salon « bientôt » sur
// l'accueil, à part des actions d'envoi (spec §39).
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { cleanSwitch, foot, footLink, langGroup, switchLang } from "./foot-helpers";
import { freshPage, sendShare } from "./open-helpers";
import { addFile, composerFits, readyHeading, sendButton, sleep } from "./send-helpers";

const SEG = /\/api\/shares\/segments\/\d+(\?from=\d+)?$/;

/** Aucune entrée « Réglages » (roue de l'en-tête, onglet, panneau) sur la page. */
async function noSettings(page: Page) {
  await expect(page.getByRole("button", { name: /^(Réglages|Settings)$/ })).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: /^(Réglages|Settings)$/ })).toHaveCount(0);
  await expect(page.getByRole("banner").getByRole("button")).toHaveCount(0);
}

/** Pied présent, avec ses liens, sa langue, son nettoyage automatique et « À propos ». */
async function fullFoot(page: Page) {
  const f = foot(page);
  await f.scrollIntoViewIfNeeded();
  await expect(f).toBeVisible();
  await expect(footLink(page, "Sécurité")).toBeVisible();
  await expect(footLink(page, "Conditions d'utilisation")).toBeVisible();
  await expect(langGroup(page).getByRole("button")).toHaveText(["Français", "English"]);
  await expect(cleanSwitch(page)).toBeVisible();
  await expect(f.getByText("À propos", { exact: true })).toBeVisible();
  await page.evaluate(() => scrollTo(0, 0));
}

test.describe("fr-FR", () => {
  test.use({ locale: "fr-FR" });

  test("pied de page sur l'accueil, le composeur, une page d'info et un partage ouvert ; aucune entrée Réglages", async ({ page, shh, browser, isMobile }) => {
    test.setTimeout(120_000);
    await page.goto(shh.origin + "/");
    await noSettings(page);
    await fullFoot(page);

    await page.goto(shh.origin + "/envoyer");
    await expect(page.getByRole("heading", { name: "Votre envoi" })).toBeVisible();
    await noSettings(page);
    await fullFoot(page);
    // Ordinateur : l'écran d'envoi tient entier dans l'écran, le pied vient dessous.
    if (!isMobile) expect(await composerFits(page)).toBe(true);

    await page.goto(shh.origin + "/securite");
    await fullFoot(page);
    await expect(page.getByRole("button", { name: /^(Réglages|Settings)$/ })).toHaveCount(0);

    const { ctx, page: sender } = await freshPage(browser);
    const s = await sendShare(sender, shh.origin + "/", { text: "Le code de la porte est 4471." });
    await ctx.close();
    await page.goto(s.link);
    await noSettings(page);
    await fullFoot(page);
  });

  test("langue et nettoyage automatique changés depuis le pied de page", async ({ page, shh }) => {
    await page.goto(shh.origin + "/envoyer");
    await switchLang(page, "English");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(langGroup(page).getByRole("button", { name: "English" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("heading", { name: "Your share" })).toBeAttached();
    await switchLang(page, "Français");
    await expect(page.locator("html")).toHaveAttribute("lang", "fr");

    const sw = cleanSwitch(page);
    await sw.scrollIntoViewIfNeeded();
    await expect(sw).toHaveAttribute("aria-checked", "false"); // désactivé par défaut (CLEAN4)
    await expect(sw).toHaveAccessibleDescription(/informations cachées/);
    await sw.click();
    await expect(sw).toHaveAttribute("aria-checked", "true");
    // Le même réglage est vu par toute l'app : il survit à une navigation interne.
    await footLink(page, "Sécurité").click();
    await expect(page).toHaveURL(/\/securite$/);
    await expect(cleanSwitch(page)).toHaveAttribute("aria-checked", "true");
    await cleanSwitch(page).click();
    await expect(cleanSwitch(page)).toHaveAttribute("aria-checked", "false");
  });

  test("pendant un envoi : pied affiché, liens, langue et nettoyage désactivés avec leur raison", async ({ page, shh }) => {
    test.setTimeout(120_000);
    await page.goto(shh.origin + "/envoyer");
    await addFile(page, "doc.bin", 6 * 1048576);
    await page.route(SEG, async (route) => {
      await sleep(1500);
      await route.continue().catch(() => undefined);
    });
    await sendButton(page).click();
    await expect(page.getByRole("heading", { name: "Chiffrement et envoi" })).toBeVisible({ timeout: 30_000 });
    const f = foot(page);
    await expect(f).toBeAttached();
    const reason = f.locator("[data-foot-busy]");
    await expect(reason).toContainText("désactivés pendant l'envoi");
    // Liens : désactivés, décrits par la raison, hors du clavier ; un clic ne quitte pas la page.
    const sec = footLink(page, "Sécurité");
    await expect(sec).toHaveAttribute("aria-disabled", "true");
    await expect(sec).toHaveAccessibleDescription(/désactivés pendant l'envoi/);
    await expect(sec).toHaveAttribute("tabindex", "-1");
    await expect(footLink(page, /^Code source/)).toHaveAttribute("aria-disabled", "true");
    await expect(f.getByRole("link", { name: "Shhdrop, accueil" })).toHaveAttribute("aria-disabled", "true");
    for (const l of await f.getByRole("link").all()) await expect(l).toHaveAttribute("aria-disabled", "true");
    await sec.click({ force: true });
    expect(new URL(page.url()).pathname).toBe("/envoyer");
    // Langue : boutons désactivés, la langue ne change pas.
    const en = langGroup(page).getByRole("button", { name: "English" });
    await expect(en).toHaveAttribute("aria-disabled", "true");
    await expect(en).toHaveAccessibleDescription(/désactivés pendant l'envoi/);
    await en.click({ force: true });
    await expect(page.locator("html")).toHaveAttribute("lang", "fr");
    // Nettoyage automatique : interrupteur désactivé.
    await expect(cleanSwitch(page)).toBeDisabled();
    await expect(cleanSwitch(page)).toHaveAccessibleDescription(/désactivés pendant l'envoi/);
    // Toujours en cours d'envoi (aucun écran quitté).
    await expect(page.getByRole("heading", { name: "Chiffrement et envoi" })).toBeVisible();
    await expect(readyHeading(page)).toBeVisible({ timeout: 90_000 });
  });

  test("accueil : bouton Salon à part, visible, « bientôt », désactivé avec sa raison", async ({ page, shh }) => {
    await page.goto(shh.origin + "/");
    const room = page.locator("[data-room]").getByRole("button", { name: /^Salon/ });
    await expect(room).toBeVisible();
    await expect(room).toBeInViewport();
    await expect(room).toHaveAttribute("aria-disabled", "true");
    await expect(room).toContainText("bientôt");
    await expect(room).toHaveAccessibleDescription("Bientôt\u202f: un salon de discussion chiffré et éphémère.");
    // À part des actions d'envoi : hors du coffre (Commencer, Créer sur place).
    await expect(page.locator('[data-slot="compose"] [data-room]')).toHaveCount(0);
    await room.click({ force: true }); // aria-disabled : un appui annonce « Bientôt », rien d'autre
    await expect(page).toHaveURL(new RegExp(`${shh.origin.replace(/[.:/]/g, "\\$&")}/$`));
  });

  test("ordinateur : plus de lumière au pointeur (contour lumineux gardé) ; « Créer sur place » en haut ; flèche sous le texte", async ({ page, shh, isMobile }) => {
    test.skip(isMobile, "ordinateur seulement (téléphone : feuille « Ajouter », inchangée)");
    await page.goto(shh.origin + "/");
    // Lumière ambiante du contour du réceptacle vide : gardée ; projecteur au pointeur : retiré.
    await expect(page.locator(".vessel [data-ambient]").first()).toBeAttached();
    await expect(page.locator(".vessel .spot, .vessel .spot-clip")).toHaveCount(0);
    await page.mouse.move(1000, 500);
    await expect(page.locator(".vessel.lit")).toHaveCount(0);

    await page.goto(shh.origin + "/envoyer");
    const make = page.getByRole("group", { name: "Créer sur place" });
    await expect(make).toBeVisible();
    const zone = page.locator(".dropzone.empty");
    const [cap, mk, dz] = [await page.locator(".top .cap").boundingBox(), await make.boundingBox(), await zone.boundingBox()];
    // Sous la ligne de capacité, au-dessus de la zone de dépôt.
    expect(mk!.y).toBeGreaterThanOrEqual(cap!.y + cap!.height - 1);
    expect(mk!.y + mk!.height).toBeLessThanOrEqual(dz!.y + 1);
    // Libellés écrits à côté des icônes ; « Photo ou vidéo » est UN seul bouton.
    await expect(make.getByRole("button", { name: "Photo ou vidéo", exact: true })).toHaveCount(1);
    for (const b of await make.getByRole("button").all()) expect(await b.locator(":scope > span").last().evaluate((e) => e.getBoundingClientRect().width)).toBeGreaterThan(20);
    // Flèche SOUS « Déposez… » / « ou cliquez… », sans phrase de collage.
    const [tx, ic] = [await zone.locator(".dz-tx").boundingBox(), await zone.locator(".dz-ic").boundingBox()];
    expect(ic!.y).toBeGreaterThanOrEqual(tx!.y + tx!.height);
    await expect(zone).toHaveText(/^\s*Déposez des fichiers n'importe où sur la page\s*ou cliquez ici pour les choisir\s*$/);
    expect(await composerFits(page)).toBe(true);
  });
});
