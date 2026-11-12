// Page d'envoi « /envoyer », retours du propriétaire du 12 novembre : défilement à la molette
// partout sur la page, zone de dépôt compacte, titre et trois assurances, bloc des offres,
// entrée « Salon », nettoyage par le balai (bulle, confirmation, « Tout nettoyer »), plus
// d'interrupteur « Nettoyage automatique » ni de langues dans le pied de page.
import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import { axe, expect, test } from "./fixtures";
import { file } from "./open-helpers";
import { openFilePicker } from "./send-helpers";

test.use({ locale: "fr-FR", timezoneId: "Europe/Paris" });

const rows = (page: Page) => page.locator("[data-row]");
async function openSend(page: Page, origin: string) {
  await page.goto(origin + "/envoyer");
  await expect(page.locator("[data-composer]")).toBeVisible();
}
async function addPdfAndPhoto(page: Page) {
  await (await openFilePicker(page)).setFiles([
    { name: "contrat.pdf", mimeType: "application/pdf", buffer: readFileSync(file("contrat.pdf")) },
    { name: "foret-brume.jpg", mimeType: "image/jpeg", buffer: readFileSync(file("foret-brume.jpg")) },
  ]);
  await expect(rows(page)).toHaveCount(2);
}

test("molette au centre de la zone de dépôt, puis sur la liste : la page défile", async ({ page, shh, isMobile }) => {
  test.skip(isMobile, "molette : ordinateur");
  await openSend(page, shh.origin);
  expect(await page.evaluate(() => document.documentElement.scrollHeight > innerHeight)).toBe(true);
  const box = (await page.locator(".dropzone").boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, 400);
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(0);
  // Liste non vide : molette sur une ligne.
  await page.evaluate(() => scrollTo(0, 0));
  await addPdfAndPhoto(page);
  await page.evaluate(() => scrollTo(0, 0));
  const row = (await rows(page).first().boundingBox())!;
  await page.mouse.move(row.x + row.width / 2, row.y + row.height / 2);
  await page.mouse.wheel(0, 400);
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(0);
});

test("ordinateur : la carte du composeur a un contour entier (pas d'ouverture en haut)", async ({ page, shh, isMobile }) => {
  test.skip(isMobile, "téléphone : composeur sans cadre");
  await openSend(page, shh.origin);
  const track = page.locator("[data-composer]").locator("xpath=ancestor::div[contains(@class,'vessel')][1]").locator("svg.line .track");
  await expect(track).toHaveCount(1);
  expect(await track.evaluate((e) => getComputedStyle(e).strokeDasharray)).toBe("none");
});

test("premier écran : titre, trois assurances, zone de dépôt compacte, offres et Salon, sans défiler", async ({ page, shh, isMobile }) => {
  await openSend(page, shh.origin);
  const h1 = page.getByRole("heading", { level: 1, name: "Un lien, un mot de passe, puis plus rien." });
  await expect(h1).toBeInViewport();
  expect(await h1.evaluate((e) => e.getBoundingClientRect().height)).toBeGreaterThan(10); // visible, plus caché à l'œil
  await expect(page.getByRole("list", { name: "En bref" }).getByRole("listitem")).toHaveText(["Chiffré dans votre navigateur", "Sans compte", "Le lien s'autodétruit"]);
  const dz = page.locator(".dropzone").filter({ visible: true });
  await expect(dz).toBeInViewport({ ratio: 1 });
  const h = await dz.evaluate((e) => e.getBoundingClientRect().height);
  expect(h).toBeGreaterThanOrEqual(88); // facile à viser au doigt
  expect(h).toBeLessThanOrEqual(isMobile ? 150 : 220);
  // Offres : trois formules, limites lues dans les constantes, « bientôt », lien vers /offres ; rien à acheter.
  const offers = page.locator("[data-offer-strip]");
  await expect(offers).toBeInViewport({ ratio: 1 });
  await expect(offers.locator("[data-offer]")).toHaveCount(3);
  const norm = (s: string) => s.replace(/[  ]/g, " ");
  expect(norm(await offers.locator('[data-offer="free"]').innerText())).toMatch(/Gratuit[\s\S]*2 Go[\s\S]*24 h[\s\S]*10 ouvertures/);
  expect(norm(await offers.locator('[data-offer="plus"]').innerText())).toMatch(/Plus[\s\S]*bientôt[\s\S]*10 Go[\s\S]*7 jours[\s\S]*10 ouvertures/);
  expect(norm(await offers.locator('[data-offer="pro"]').innerText())).toMatch(/Pro[\s\S]*bientôt[\s\S]*50 Go[\s\S]*7 jours[\s\S]*50 ouvertures/);
  await expect(offers.getByRole("link", { name: /^Voir les offres/ })).toHaveAttribute("href", "/offres");
  expect(await offers.innerText()).not.toMatch(/€|Acheter|Payer|S'abonner/i);
  await expect(offers.locator("input, form")).toHaveCount(0);
  // Plus : la feuille d'information s'ouvre sur place.
  await offers.locator('[data-offer="plus"]').getByRole("button").click();
  await expect(page.getByRole("dialog", { name: "Shhdrop Plus" })).toBeVisible();
  await page.keyboard.press("Escape");
  // Salon : même icône et même mot que l'onglet, « bientôt », désactivé avec sa raison.
  const room = page.locator("[data-room]").getByRole("button", { name: /^Salon/ });
  await expect(room).toBeInViewport({ ratio: 1 });
  await expect(room).toHaveAttribute("aria-disabled", "true");
  await expect(room).toContainText("bientôt");
  await expect(room).toHaveAccessibleDescription("Bientôt : un salon de discussion chiffré et éphémère.");
  await room.click({ force: true });
  await expect(page).toHaveURL(/\/envoyer$/);
  await axe(page);
});

test("balai : bulle au survol (ordinateur), confirmation au clic, rien de nettoyé avant « Nettoyer »", async ({ page, shh, isMobile }) => {
  await openSend(page, shh.origin);
  await addPdfAndPhoto(page);
  // Plus de mot « Nettoyer » écrit sur les lignes.
  for (const t of await rows(page).allInnerTexts()) expect(t).not.toContain("Nettoyer");
  // Nom accessible : l'action et le fichier (« Nettoyer ce fichier : nom »), FR et EN.
  const brooms = page.getByRole("button", { name: /^Nettoyer ce fichier\s:\s/ }).filter({ visible: true });
  await expect(brooms).toHaveCount(2);
  const photoRow = rows(page).filter({ hasText: "foret-brume" });
  const broom = photoRow.getByRole("button", { name: /^Nettoyer ce fichier\s:\sforet-brume\.jpg$/ });
  await expect(rows(page).filter({ hasText: "contrat" }).getByRole("button", { name: /^Nettoyer ce fichier\s:\scontrat\.pdf$/ })).toHaveCount(1);
  await expect(broom).toHaveAccessibleDescription(/lieu, appareil et dates/);
  if (!isMobile) {
    // La bulle se ferme au défilement de la fenêtre (Tip) : un défilement tardif après l'ajout
    // peut la refermer sous charge ; on ressort et on resurvole.
    await expect(async () => {
      await page.mouse.move(2, 2);
      await broom.hover();
      await expect(page.getByRole("tooltip").filter({ visible: true })).toContainText("lieu, appareil et dates", { timeout: 1500 });
    }).toPass({ timeout: 10_000 });
  }
  await broom.click();
  const dlg = page.getByRole("dialog", { name: "Nettoyer ce fichier ?" });
  await expect(dlg).toBeVisible();
  await expect(dlg).toContainText("lieu, appareil et dates");
  await expect(dlg.getByRole("button", { name: "Annuler" })).toBeFocused();
  await axe(page);
  await dlg.getByRole("button", { name: "Annuler" }).click();
  await expect(dlg).toBeHidden();
  await expect(photoRow.locator('[data-clean="nettoye"]')).toHaveCount(0);
  await expect(broom).toBeFocused();
  // Échap ferme aussi, sans nettoyer.
  await broom.click();
  await expect(dlg).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dlg).toBeHidden();
  await expect(photoRow.locator('[data-clean="nettoye"]')).toHaveCount(0);
  // Validation : nettoyée, le balai disparaît de cette ligne seulement.
  await broom.click();
  await dlg.getByRole("button", { name: "Nettoyer", exact: true }).click();
  await expect(photoRow.locator('[data-clean="nettoye"]')).toHaveCount(1);
  await expect(photoRow.getByRole("button", { name: "Nettoyer ce fichier" })).toHaveCount(0);
  await expect(brooms).toHaveCount(1);
});

test("« Tout nettoyer » : seulement s'il reste un fichier à nettoyer, même confirmation", async ({ page, shh }) => {
  await openSend(page, shh.origin);
  const all = page.getByRole("button", { name: "Tout nettoyer" });
  await expect(all).toHaveCount(0);
  await addPdfAndPhoto(page);
  await expect(all).toBeVisible();
  await all.click();
  const dlg = page.getByRole("dialog", { name: "Nettoyer 2 fichiers ?" });
  await expect(dlg).toBeVisible();
  await dlg.getByRole("button", { name: "Annuler" }).click();
  await expect(page.locator('[data-clean="nettoye"]')).toHaveCount(0);
  await all.click();
  await dlg.getByRole("button", { name: "Nettoyer", exact: true }).click();
  // La photo porte la marque « Nettoyé » ; le PDF d'essai n'a pas de propriétés à retirer (« sans »).
  await expect(rows(page).filter({ hasText: "foret-brume" }).locator('[data-clean="nettoye"]')).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Nettoyer ce fichier" })).toHaveCount(0);
  await expect(all).toHaveCount(0);
});

test("pied de page : ni choix de langue ni « Nettoyage automatique »", async ({ page, shh }) => {
  await openSend(page, shh.origin);
  const foot = page.locator("footer[data-foot]");
  await expect(foot).toBeAttached();
  await expect(foot.getByRole("group", { name: /^(Langue|Language)$/ })).toHaveCount(0);
  await expect(foot.getByRole("button", { name: /^(Français|English)$/ })).toHaveCount(0);
  await expect(foot.getByRole("switch")).toHaveCount(0);
  await expect(foot).not.toContainText("Nettoyage automatique");
});

test.describe("langue du navigateur", () => {
  test.use({ locale: "en-US" });
  test("anglais choisi tout seul, sans bouton ; balai nommé « Clean this file: nom »", async ({ page, shh, isMobile }) => {
    await openSend(page, shh.origin);
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.getByRole("list", { name: "In short" }).getByRole("listitem")).toHaveText(["Encrypted in your browser", "No account", "The link self-destructs"]);
    if (isMobile) return; // sélecteur ouvert par la zone de dépôt : ordinateur
    const chooser = page.waitForEvent("filechooser");
    await page.locator(".dropzone").click();
    await (await chooser).setFiles([{ name: "foret-brume.jpg", mimeType: "image/jpeg", buffer: readFileSync(file("foret-brume.jpg")) }]);
    await expect(rows(page).getByRole("button", { name: "Clean this file: foret-brume.jpg", exact: true })).toHaveCount(1);
  });
});

test("photo, vidéo ou son d'un format que le nettoyage ne lit pas : « format non pris en charge » dès l'ajout, sans balai, fichier tel quel", async ({ page, shh }) => {
  await openSend(page, shh.origin);
  const bytes = Buffer.from("II*\0 contenu tiff factice avec repère");
  await (await openFilePicker(page)).setFiles([{ name: "scan.tiff", mimeType: "image/tiff", buffer: bytes }]);
  const row = rows(page).filter({ hasText: "scan" });
  await expect(row).toHaveCount(1);
  await expect(row.locator('[data-clean="echec"] button')).toHaveAccessibleName(/^Nettoyage impossible\s: format non pris en charge$/);
  await expect(row.getByRole("button", { name: /^Nettoyer ce fichier/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Tout nettoyer" })).toHaveCount(0);
  // Rien n'a été tenté : jamais « n'a pas pu » (audit D5).
  await expect(page.locator("[data-unclean-sum]").filter({ visible: true })).toHaveText("1\u202ffichier ne peut pas être nettoyé (format non pris en charge)");
});

test("balai au clavier : Entrée, Tab, Entrée nettoie ; le focus va sur un bouton sûr de la ligne, jamais « Supprimer » (audit D3)", async ({ page, shh, isMobile }) => {
  await openSend(page, shh.origin);
  await addPdfAndPhoto(page);
  const photoRow = rows(page).filter({ hasText: "foret-brume" });
  const broom = photoRow.getByRole("button", { name: /^Nettoyer ce fichier\s:\sforet-brume\.jpg$/ });
  await broom.focus();
  await page.keyboard.press("Enter");
  const dlg = page.getByRole("dialog", { name: "Nettoyer ce fichier ?" });
  await expect(dlg.getByRole("button", { name: "Annuler" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(dlg.getByRole("button", { name: "Nettoyer", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(photoRow.locator('[data-clean="nettoye"]')).toHaveCount(1);
  const safe = photoRow.getByRole("button", { name: isMobile ? "Actions pour foret-brume.jpg" : "Renommer foret-brume.jpg" });
  await expect(safe).toBeFocused();
  // Un second Entrée réflexe ne retire rien.
  if (!isMobile) {
    await page.keyboard.press("Enter");
    await page.keyboard.press("Escape");
  }
  await expect(rows(page)).toHaveCount(2);
});

test("confirmation du balai : Tab au-delà de la bulle la ferme ; Échap la ferme et rend le focus au balai (audit D4)", async ({ page, shh }) => {
  await openSend(page, shh.origin);
  await addPdfAndPhoto(page);
  const photoRow = rows(page).filter({ hasText: "foret-brume" });
  const broom = photoRow.getByRole("button", { name: /^Nettoyer ce fichier\s:\sforet-brume\.jpg$/ });
  const dlg = page.getByRole("dialog", { name: "Nettoyer ce fichier ?" });
  // Tab, Tab : le focus sort de la bulle, qui se ferme ; rien n'est nettoyé.
  await broom.focus();
  await page.keyboard.press("Enter");
  await expect(dlg.getByRole("button", { name: "Annuler" })).toBeFocused();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await expect(dlg).toBeHidden();
  expect(await page.evaluate(() => document.activeElement?.closest("[data-clean-confirm]") ?? null)).toBeNull();
  await expect(photoRow.locator('[data-clean="nettoye"]')).toHaveCount(0);
  // Maj+Tab depuis « Annuler » : fermée aussi.
  await broom.focus();
  await page.keyboard.press("Enter");
  await expect(dlg.getByRole("button", { name: "Annuler" })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(dlg).toBeHidden();
  // Échap (ouverte au clavier) : fermée, focus rendu au balai.
  await broom.focus();
  await page.keyboard.press("Enter");
  await expect(dlg.getByRole("button", { name: "Annuler" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dlg).toBeHidden();
  await expect(broom).toBeFocused();
  await expect(photoRow.locator('[data-clean="nettoye"]')).toHaveCount(0);
});

// Audit R4 : à 720 px (zoom 200 %) et sur téléphone, les offres ne coupent jamais la carte
// « Votre envoi » entre ses boutons et son compteur : avant la carte entière.
for (const vp of [null, { width: 720, height: 450 }]) {
  test(`offres hors de la carte « Votre envoi » (${vp ? "720 px" : "projet"}), liste vide puis remplie (audit R4)`, async ({ page, shh, isMobile }) => {
    if (vp) {
      test.skip(isMobile, "720 px : projet ordinateur");
      await page.setViewportSize(vp);
    } else test.skip(!isMobile, "téléphone");
    await openSend(page, shh.origin);
    const strip = page.locator("[data-offer-strip]").filter({ visible: true });
    const title = page.locator("#compose-title");
    const cap = page.locator(".capg");
    const check = async () => {
      await expect(strip).toHaveCount(1);
      const [o, h, c] = [(await strip.boundingBox())!, (await title.boundingBox())!, (await cap.boundingBox())!];
      // Avant le titre de la carte : ni entre le titre et le compteur, ni dedans.
      expect(o.y + o.height).toBeLessThanOrEqual(h.y);
      expect(h.y).toBeLessThan(c.y);
    };
    await check();
    await addPdfAndPhoto(page);
    await check();
    // Boutons de la carte, puis compteur, sans rien entre eux.
    const clear = page.getByRole("button", { name: "Tout supprimer" });
    expect((await clear.boundingBox())!.y).toBeLessThan((await cap.boundingBox())!.y);
  });
}
