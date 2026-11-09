// Téléphone : la croix « Fermer » est TOUJOURS en haut à droite (demande du propriétaire), dans
// chaque fenêtre ouvrable : feuilles du bas (Ajouter, Nouveau texte, Options, menu d'une ligne,
// Réglages, Partager et QR, confirmation, Signaler), caméra, enregistreur vocal, visionneuse.
// Vérifié : dans le quart supérieur droit de la fenêtre (partie visible), cible ≥ 44 px, dans
// l'écran. Le retour (flèche) des en-têtes reste à gauche : ce n'est pas une fermeture.
// Captures fr-FR 390 × 844 (×2) : .superpowers/sdd/2026-11-04-shhdrop-ecrans/shots/task-CLOSE/.
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { file, freshPage, sendShare, settle, unlock } from "./open-helpers";
import { addText, readyHeading, sendButton, enterComposer } from "./send-helpers";

const SHOTS = fileURLToPath(new URL("../../.superpowers/sdd/2026-11-04-shhdrop-ecrans/shots/task-CLOSE/", import.meta.url));
const local = process.env.PW_LOCAL_CHROMIUM === "1" ? { executablePath: "/opt/pw-browsers/chromium" } : {};
test.use({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  locale: "fr-FR",
  launchOptions: { ...local, args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] },
  permissions: ["camera", "microphone"],
});
// Fausse caméra et faux micro : Chromium seulement ; une seule série (téléphone).
test.skip(({ browserName }) => browserName !== "chromium", "fausse caméra : Chromium seulement");
test.beforeEach(({}, info) => test.skip(info.project.name !== "chromium-mobile", "une seule série : téléphone"));

async function shot(page: Page, name: string) {
  mkdirSync(SHOTS, { recursive: true });
  await settle(page);
  await page.screenshot({ path: `${SHOTS}${name}.png` });
}

/** « Fermer » dans le quart supérieur droit de la partie visible de la fenêtre, ≥ 44 px, à l'écran. */
async function closeTopRight(dlg: Locator) {
  await expect(dlg).toBeVisible();
  // Mesure après la montée de la feuille (animation d'ouverture terminée).
  await dlg.evaluate((el) => Promise.all(el.getAnimations({ subtree: true }).filter((x) => x.effect?.getComputedTiming().iterations !== Infinity).map((x) => x.finished.catch(() => undefined))));
  const close = dlg.getByRole("button", { name: "Fermer", exact: true });
  await expect(close).toHaveCount(1);
  await expect(close).toBeVisible();
  const d = (await dlg.boundingBox())!;
  const b = (await close.boundingBox())!;
  const vp = dlg.page().viewportSize()!;
  const top = Math.max(d.y, 0);
  const bottom = Math.min(d.y + d.height, vp.height);
  const left = Math.max(d.x, 0);
  const right = Math.min(d.x + d.width, vp.width);
  const cx = b.x + b.width / 2;
  const cy = b.y + b.height / 2;
  const where = `${await dlg.getAttribute("aria-label") ?? ""} croix ${Math.round(cx)},${Math.round(cy)} fenêtre ${Math.round(left)}–${Math.round(right)} × ${Math.round(top)}–${Math.round(bottom)}`;
  expect(cx, where).toBeGreaterThan((left + right) / 2);
  expect(cy, where).toBeLessThan((top + bottom) / 2);
  expect(b.width, where).toBeGreaterThanOrEqual(44);
  expect(b.height, where).toBeGreaterThanOrEqual(44);
  expect(b.x + b.width, where).toBeLessThanOrEqual(vp.width);
  expect(b.y, where).toBeGreaterThanOrEqual(0);
  return close;
}

/** Vérifie la croix puis ferme par elle : la fenêtre disparaît. */
async function checkAndClose(page: Page, dlg: Locator, shotName?: string) {
  const close = await closeTopRight(dlg);
  if (shotName) await shot(page, shotName);
  await close.click();
  await expect(dlg).toBeHidden();
}

async function openAdd(page: Page) {
  await enterComposer(page); // accueil : « Commencer » mène à la page d'envoi (D41-37)
  await page.getByRole("button", { name: /^Ajouter/ }).filter({ visible: true }).first().click();
  return page.getByRole("dialog", { name: "Ajouter" });
}

test("expéditeur : chaque fenêtre a « Fermer » en haut à droite", async ({ page, shh }) => {
  test.setTimeout(120_000);
  await page.goto(shh.origin + "/");

  await page.getByRole("navigation", { name: "Navigation principale" }).getByRole("button", { name: "Réglages" }).click();
  await checkAndClose(page, page.getByRole("dialog", { name: "Réglages" }));

  await checkAndClose(page, await openAdd(page), "feuille-ajouter");

  // Caméra (plein écran).
  await (await openAdd(page)).getByRole("button", { name: /^Photo ou vidéo/ }).click();
  const cam = page.locator("dialog[data-capture]");
  await expect(cam.getByRole("button", { name: "Prendre la photo" })).toBeEnabled({ timeout: 15_000 });
  await checkAndClose(page, cam, "camera");

  // Enregistreur vocal (plein écran).
  await (await openAdd(page)).getByRole("button", { name: /^Vocal/ }).click();
  await checkAndClose(page, page.locator("dialog[data-recorder]"), "vocal");

  // Éditeur de note.
  await (await openAdd(page)).getByRole("button", { name: /^Note/ }).click();
  await checkAndClose(page, page.getByRole("dialog", { name: "Nouveau texte" }));

  await addText(page, "Le code de la porte est 4471.");
  // Menu « … » d'une ligne.
  await page.getByRole("button", { name: /^Actions pour / }).first().click();
  await checkAndClose(page, page.locator("dialog[open]"));

  await page.getByRole("button", { name: /^Options · / }).click();
  await checkAndClose(page, page.getByRole("dialog", { name: "Options" }));

  await sendButton(page).click();
  await expect(readyHeading(page)).toBeVisible({ timeout: 60_000 });
  // Partager, puis le QR dans la même feuille.
  await page.getByRole("button", { name: "Partager", exact: true }).click();
  const share = page.getByRole("dialog", { name: "Partager le lien et le mot de passe" });
  await closeTopRight(share);
  await share.getByRole("button", { name: "Afficher le QR code" }).click();
  await expect(share.getByRole("img", { name: "QR code du lien et du mot de passe" })).toBeVisible();
  await checkAndClose(page, share);

  // Confirmation (feuille du bas).
  await page.getByRole("button", { name: "Terminé" }).click();
  await checkAndClose(page, page.getByRole("dialog", { name: "Terminé" }));
  await expect(readyHeading(page)).toBeVisible();
});

test("destinataire : Réglages, visionneuse et Signaler ont « Fermer » en haut à droite", async ({ page, shh, browser }) => {
  test.setTimeout(120_000);
  const { ctx, page: sender } = await freshPage(browser);
  const s = await sendShare(sender, shh.origin + "/", { files: [file("foret-brume.jpg")] });
  await ctx.close();
  await page.goto(s.link);

  await page.getByRole("banner").getByRole("button", { name: "Réglages" }).click();
  await checkAndClose(page, page.getByRole("dialog", { name: "Réglages" }));

  await unlock(page, s.password);
  await page.getByRole("button", { name: "Voir foret-brume.jpg" }).click();
  const viewer = page.locator("dialog[aria-roledescription=carousel]");
  await expect(viewer.locator("img")).toBeVisible({ timeout: 20_000 });
  await checkAndClose(page, viewer, "visionneuse");

  await page.locator("footer[data-foot]").getByRole("button", { name: "Signaler ce partage" }).click();
  await checkAndClose(page, page.getByRole("dialog", { name: "Signaler ce contenu" }));
});
