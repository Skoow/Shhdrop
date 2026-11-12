// Corrections de l'audit du 11 novembre (docs/superpowers/audits/2026-11-11-verification-complete.md),
// vérifiées dans le navigateur : garde du bouton Retour (I2), en-tête et pied pendant l'envoi.
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { freshPage, sendShare, settle, unlock, pwField, unlockButton } from "./open-helpers";
import { addText, openFilePicker, readyHeading, sendButton } from "./send-helpers";

/** Captures « après » des corrections (hors dépôt), seulement si AUDIT_SHOTS est donné. */
const SHOTS = process.env.AUDIT_SHOTS;
async function shot(page: Page, name: string, isMobile: boolean, full = false) {
  if (!SHOTS) return;
  await settle(page);
  await page.screenshot({ path: `${SHOTS}/${name}-${isMobile ? "m390" : "d1440"}.png`, fullPage: full });
}

test.use({ locale: "fr-FR", timezoneId: "Europe/Paris" });

async function toReady(page: Page, origin: string) {
  await page.goto(origin + "/");
  await addText(page, "Le code de la porte est 4471.");
  await sendButton(page).filter({ visible: true }).first().click();
  await expect(readyHeading(page)).toBeVisible({ timeout: 60_000 });
}

test("I2 : Retour sur « Lien prêt » : confirmation ; refus → on reste, lien intact ; accord → composeur vide", async ({ page, shh }) => {
  test.setTimeout(120_000);
  await toReady(page, shh.origin);
  const url = page.url();
  // Logo de l'en-tête désactivé comme le pied (rien ne doit quitter la page par mégarde).
  await expect(page.locator("header.top a.logo")).toHaveAttribute("aria-disabled", "true");
  let msg = "";
  page.once("dialog", (d) => {
    msg = d.message();
    void d.dismiss();
  });
  await page.goBack();
  await expect.poll(() => msg).toContain("ne seront plus jamais affichés");
  await expect(readyHeading(page)).toBeVisible();
  expect(page.url()).toBe(url);
  // Un second Retour redemande (l'entrée de garde a été remise).
  msg = "";
  page.once("dialog", (d) => {
    msg = d.message();
    void d.accept();
  });
  await page.goBack();
  await expect.poll(() => msg).toContain("Quitter cette page");
  await expect(readyHeading(page)).toHaveCount(0);
  await expect(page.locator("header.top a.logo")).not.toHaveAttribute("aria-disabled", "true");
});

test("I2 : Terminé retire l'entrée de garde : Retour ne demande plus rien", async ({ page, shh }) => {
  test.setTimeout(120_000);
  await toReady(page, shh.origin);
  const dialogs: string[] = [];
  page.on("dialog", (d) => {
    dialogs.push(d.message());
    void d.dismiss();
  });
  await page.getByRole("button", { name: "Terminé" }).click();
  await page.getByRole("button", { name: "Terminer", exact: true }).click();
  await expect(readyHeading(page)).toHaveCount(0);
  await page.goBack();
  await page.waitForTimeout(300);
  expect(dialogs).toEqual([]);
});

test("note neuve : le curseur est dans Contenu (le titre est facultatif)", async ({ page, shh }) => {
  await page.goto(shh.origin + "/envoyer");
  const note = page.getByRole("group", { name: "Créer sur place" }).getByRole("button", { name: "Note", exact: true });
  if (await note.isVisible().catch(() => false)) await note.click();
  else {
    await page.getByRole("button", { name: /^Ajouter/ }).filter({ visible: true }).first().click();
    await page.getByRole("dialog", { name: "Ajouter" }).getByRole("button", { name: /^Note/ }).click();
  }
  await expect(page.getByRole("dialog", { name: "Nouveau texte" }).getByLabel("Contenu")).toBeFocused();
});

test("I4 : « Détruire » depuis le bas du contenu : l'écran « Détruit » arrive en haut, titre au focus ; I5 : texte exact, dit aussi en haut", async ({ page, shh, browser, isMobile }) => {
  test.setTimeout(150_000);
  const s = await freshPage(browser);
  const sent = await sendShare(s.page, shh.origin + "/", { text: "Le code de la porte est 4471." });
  await s.ctx.close();
  await page.goto(sent.link);
  await unlock(page, sent.password);
  await expect(page.locator("[data-last-top]")).toHaveText("Dernière ouverture\u202f: personne d'autre ne pourra l'ouvrir. En général, vous pouvez y revenir depuis ce navigateur jusqu'à l'échéance.");
  await expect(page.getByText(/En général, vous pouvez y revenir depuis ce navigateur jusqu'à son échéance, puis il sera effacé du serveur/)).toBeVisible();
  await shot(page, "i5-contenu-derniere-ouverture", isMobile);
  const destroy = page.getByRole("button", { name: "Détruire ce partage" });
  await destroy.scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollTo(0, document.scrollingElement!.scrollHeight));
  await destroy.click();
  await page.getByRole("button", { name: "Détruire", exact: true }).filter({ visible: true }).click();
  const title = page.getByRole("heading", { name: "Détruit", exact: true });
  await expect(title).toBeVisible({ timeout: 20_000 });
  await expect(title).toBeFocused();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await shot(page, "i4-detruit", isMobile);
});

test("M20 : page du mot de passe : coût d'ouverture en une ligne ; dernier essai : une seule ligne d'erreur ; écran « détruit » lisible", async ({ page, shh, browser, isMobile }) => {
  test.setTimeout(150_000);
  const s = await freshPage(browser);
  const sent = await sendShare(s.page, shh.origin + "/", { text: "x" });
  await s.ctx.close();
  await page.goto(sent.link);
  await expect(page.locator("#open-cost")).toHaveText("Dernière ouverture possible\u202f; ensuite, revenir depuis ce navigateur n'en compte en général pas d'autre, jusqu'à l'échéance.");
  for (let k = 4; k >= 1; k--) {
    await pwField(page).fill("faux-" + k);
    await unlockButton(page).click();
    await expect(page.locator("#open-err p")).toHaveCount(1, { timeout: 20_000 });
    if (k > 1) await expect(page.locator("#open-err p")).toContainText(`${k}`);
  }
  await expect(page.locator("#open-err p")).toHaveText("Mot de passe incorrect · dernier essai\u202f: au prochain échec, le partage sera détruit.");
  await shot(page, "m20-dernier-essai", isMobile);
  await pwField(page).fill("faux-0");
  await unlockButton(page).click();
  const title = page.getByRole("heading", { name: "Mot de passe incorrect. Le partage a été détruit." });
  await expect(title).toBeVisible({ timeout: 20_000 });
  await expect(title).toBeFocused();
  // Téléphone : l'illustration au-dessus, le titre garde la largeur (faible de l'audit).
  if (isMobile) {
    const w = (await title.boundingBox())!.width;
    expect(w).toBeGreaterThan(280);
  }
  await shot(page, "faible-detruit-5-essais", isMobile);
});

test("M17, M18, coffre : bloc des offres (12 novembre, remplace la ligne Plus et Pro), aucune option verrouillée ni copie chiffrée ; barre d'onglets sur téléphone seulement (deux onglets utiles) ; captures", async ({ page, shh, isMobile }) => {
  test.setTimeout(90_000);
  await page.goto(shh.origin + "/");
  // M18 (règle du 11 novembre) : visible dès deux onglets utiles ; Mes partages fonctionne.
  await expect(page.getByRole("navigation", { name: "Navigation principale" })).toHaveCount(isMobile ? 1 : 0);
  await shot(page, "m18-accueil-onglets", isMobile);
  await addText(page, "Le code de la porte est 4471.");
  await expect(page.locator("[data-offer-strip]").filter({ visible: true })).toBeVisible();
  await expect(page.locator("[data-locked], [data-paid-space]")).toHaveCount(0);
  await expect(page.getByText(/copie chiffrée/)).toHaveCount(0);
  await shot(page, "m17-composeur", isMobile);
  if (isMobile) {
    await page.getByRole("button", { name: /^Options · / }).click();
    await shot(page, "m17-options", isMobile);
    await page.keyboard.press("Escape");
  }
  await page.locator('[data-offer-strip] [data-offer="plus"] button').filter({ visible: true }).click();
  await expect(page.getByRole("dialog", { name: "Shhgone Plus" })).toBeVisible();
  await shot(page, "m17-feuille-bientot", isMobile);
});

test("M16, M22, I2 : « Lien prêt » : heure de fin seule et arrondi dit ; h1 ; Tab atteint le pied désactivé (et rien ne part)", async ({ page, shh, isMobile }) => {
  test.setTimeout(120_000);
  await toReady(page, shh.origin);
  await expect(page.locator("h1", { hasText: "Lien prêt" })).toBeVisible();
  await expect(page.locator("[data-deadline] .left")).toHaveCount(0);
  await expect(page.getByText(/arrondies au quart d'heure supérieur/)).toBeVisible();
  await shot(page, "m16-lien-pret", isMobile);
  // Du bouton Terminé, Tab mène au pied : liens désactivés mais atteignables, avec leur raison.
  await page.getByRole("button", { name: "Terminé" }).focus();
  let inFoot = false;
  for (let k = 0; k < 8 && !inFoot; k++) {
    await page.keyboard.press("Tab");
    inFoot = await page.evaluate(() => !!document.activeElement?.closest("footer.foot"));
  }
  expect(inFoot).toBe(true);
  expect(await page.evaluate(() => document.activeElement?.getAttribute("aria-disabled"))).toBe("true");
  await page.keyboard.press("Enter");
  await expect(readyHeading(page)).toBeVisible();
  await page.locator("footer.foot").scrollIntoViewIfNeeded();
  await shot(page, "m22-pied-lien-pret", isMobile, true);
});

// M19 (pied : « Nettoyage automatique » et son « En savoir plus ») : réglage retiré par décision
// du propriétaire du 12 novembre ; son explication est dans la bulle du balai (envoi.spec.ts).
test("M15 : Signaler indique le vrai bouton ; plus de « Nettoyage automatique » dans le pied ; captures", async ({ page, shh, isMobile }) => {
  await page.goto(shh.origin + "/signaler");
  await expect(page.getByText(/«\u202fSignaler ce partage\u202f» en bas de la page, dans le pied \(colonne «\u202fConfiance\u202f»\)/)).toBeVisible();
  await shot(page, "m15-signaler", isMobile);
  const foot = page.locator("footer.foot");
  await expect(foot.getByRole("switch")).toHaveCount(0);
  await expect(foot.locator("[data-clean-more]")).toHaveCount(0);
});

test("M21 : cibles d'appui ≥ 44 px : liens du pied, balai « Nettoyer ce fichier », pastille du cadenas", async ({ page, shh }) => {
  await page.goto(shh.origin + "/");
  const hit = (sel: string) =>
    page.locator(sel).filter({ visible: true }).first().evaluate((e) => {
      const b = e.getBoundingClientRect();
      const a = getComputedStyle(e, "::after");
      const t = parseFloat(a.top) || 0;
      const bo = parseFloat(a.bottom) || 0;
      return a.content === "none" ? b.height : Math.max(b.height, b.height - t - bo);
    });
  expect(await hit("footer.foot a.fl")).toBeGreaterThanOrEqual(44);
  // Fichier image laissé « Original » : le balai est proposé sur la ligne.
  await page.goto(shh.origin + "/envoyer");
  const chooser = openFilePicker(page);
  const { readFileSync } = await import("node:fs");
  await (await chooser).setFiles({ name: "IMG.jpg", mimeType: "image/jpeg", buffer: readFileSync(new URL("../src/media/fixtures/iphone-like.jpg", import.meta.url)) });
  await expect(page.locator("[data-row]")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Nettoyer ce fichier" })).toBeVisible();
  const bb = (await page.getByRole("button", { name: "Nettoyer ce fichier" }).boundingBox())!;
  expect(bb.height).toBeGreaterThanOrEqual(44);
  expect(bb.width).toBeGreaterThanOrEqual(44);
  const pill = page.locator("[data-lock] .pic-tip").filter({ visible: true }).first();
  const ph = await pill.evaluate((e) => {
    const b = e.getBoundingClientRect();
    const a = getComputedStyle(e, "::after");
    return { h: b.height - parseFloat(a.top) - parseFloat(a.bottom), w: b.width - parseFloat(a.left) - parseFloat(a.right) };
  });
  expect(ph.h).toBeGreaterThanOrEqual(44);
  expect(ph.w).toBeGreaterThanOrEqual(44);
});
