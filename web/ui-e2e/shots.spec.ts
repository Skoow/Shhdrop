// Audit visuel : capture de chaque écran (accueil, composeur rempli de 8 éléments aux noms
// longs, options, envoi, lien prêt, gestion, ouverture, contenu, visionneuse, rouvrir, détruit,
// erreurs) à une taille donnée. Hors de la suite normale : ne tourne que si SHOTS_DIR est posé.
//   SHOTS_DIR=… SHOTS_VP=390x844 PW_LOCAL_CHROMIUM=1 npx playwright test ui-e2e/shots.spec.ts --project=chromium-mobile
// SHOTS_VP=1440x900 : ordinateur (isMobile faux). Locale fr-FR, deviceScaleFactor 2.
import { mkdirSync, readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { file, settle, unlock } from "./open-helpers";
import { addText, openFilePicker, readyHeading, sendButton } from "./send-helpers";

const DIR = process.env.SHOTS_DIR ?? "";
const [W, H] = (process.env.SHOTS_VP ?? "390x844").split("x").map(Number) as [number, number];
const PHONE = W < 900;
const ctxOpts = { viewport: { width: W, height: H }, deviceScaleFactor: 2, isMobile: PHONE, hasTouch: PHONE, locale: "fr-FR" } as const;

const local = process.env.PW_LOCAL_CHROMIUM === "1" ? { executablePath: "/opt/pw-browsers/chromium" } : {};
test.use({
  ...ctxOpts,
  // Fausse caméra (Chromium) : capture de l'écran caméra.
  launchOptions: { ...local, args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] },
  permissions: ["camera", "microphone"],
});
test.skip(DIR === "", "audit visuel : SHOTS_DIR non posé");

async function shot(page: Page, name: string, full = false) {
  mkdirSync(DIR, { recursive: true });
  await page.evaluate(() => document.fonts.ready);
  await settle(page);
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${DIR}/${name}-${W}.png`, fullPage: full });
}

const LONG = [
  ["Coucher de soleil sur la plage de Biarritz en août 2026.jpg", "foret-brume.jpg", "image/jpeg"],
  ["Enregistrement de la réunion du conseil d'administration.ogg", "vocal.ogg", "audio/ogg"],
  ["Anniversaire de Lou, vidéo complète avec les bougies.webm", "anniversaire-lou.webm", "video/webm"],
  ["Contrat de location appartement rue de Belleville signé.pdf", "contrat.pdf", "application/pdf"],
  ["Budget prévisionnel 2026 version finale définitive v3.xlsx", "budget-2026.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  ["Archive des photos de vacances en Bretagne 2025.zip", "archive.zip", "application/zip"],
  ["schema-architecture-reseau-domestique-final.png", "schema.png", "image/png"],
] as const;

async function addLongFiles(page: Page) {
  const fc = await openFilePicker(page);
  await fc.setFiles(LONG.map(([name, src, mimeType]) => ({ name, mimeType, buffer: readFileSync(file(src)) })));
  await expect(page.locator("[data-row]")).toHaveCount(LONG.length + 1);
}

test("audit : tous les écrans", async ({ page, shh, browser }) => {
  test.setTimeout(240_000);
  await page.goto(shh.origin + "/");
  await shot(page, "01-accueil");
  await shot(page, "01b-accueil-page", true);
  await page.locator("section.why").scrollIntoViewIfNeeded();
  await shot(page, "02-pourquoi");
  if (PHONE) await page.getByRole("navigation", { name: "Navigation principale" }).getByRole("button", { name: "Réglages" }).click();
  else await page.getByRole("banner").getByRole("button", { name: "Réglages" }).click();
  await shot(page, "03-reglages");
  await page.keyboard.press("Escape");
  await page.evaluate(() => scrollTo(0, 0));
  if (PHONE) {
    await page.getByRole("button", { name: /^Ajouter/ }).click();
    await shot(page, "03b-feuille-ajouter");
    await page.getByRole("dialog", { name: "Ajouter" }).getByRole("button", { name: /^Photo ou vidéo/ }).click();
  } else await page.getByRole("group", { name: "Ou créez sur place" }).getByRole("button", { name: "Photo ou vidéo", exact: true }).click();
  const cam = page.getByRole("dialog", { name: "Prendre une photo" });
  await expect(cam.getByRole("button", { name: "Prendre la photo" })).toBeEnabled({ timeout: 15_000 });
  await page.waitForTimeout(800);
  await shot(page, "03c-camera");
  await cam.getByRole("button", { name: "Prendre la photo" }).click();
  await shot(page, "03d-camera-apercu");
  await cam.getByRole("button", { name: "Reprendre" }).click();
  await cam.getByRole("button", { name: "Vidéo", exact: true }).click();
  const vid = page.getByRole("dialog", { name: "Filmer une vidéo" });
  await vid.getByRole("button", { name: "Démarrer l'enregistrement" }).click({ timeout: 15_000 });
  await expect(vid.locator(".timer")).toContainText("0:03", { timeout: 8_000 });
  await shot(page, "03e-camera-video");
  await vid.getByRole("button", { name: "Arrêter l'enregistrement" }).click();
  await expect(vid.locator("video.still")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.goto(shh.origin + "/nope");
  await shot(page, "15-erreur-404");
  const KEY = Buffer.from(Uint8Array.from({ length: 32 }, (_, i) => 255 - i * 3)).toString("base64url");
  await page.goto(`${shh.origin}/#${KEY}`);
  await expect(page.getByRole("heading", { level: 1, name: "Ce lien n'existe pas ou n'est plus disponible." })).toBeVisible({ timeout: 20_000 });
  await shot(page, "16-erreur-lien-invalide");

  await page.goto(shh.origin + "/");
  await addText(page, "Le code de la porte est 4471. Le digicode change lundi, je te renvoie le nouveau.");
  await addLongFiles(page);
  await page.evaluate(() => scrollTo(0, 0));
  await shot(page, "04-composeur");
  await shot(page, "04b-composeur-page", true);
  if (PHONE) {
    await page.getByRole("button", { name: /^Options · / }).click();
    await shot(page, "05-options");
    await page.keyboard.press("Escape");
  }
  // Envoi ralenti : l'écran de scellement reste visible.
  await page.route("**/api/shares/*/**", async (r) => {
    await new Promise((res) => setTimeout(res, 2500));
    await r.continue();
  });
  await sendButton(page).click();
  await page.waitForTimeout(1500);
  await shot(page, "06-envoi");
  await expect(readyHeading(page)).toBeVisible({ timeout: 120_000 });
  await page.unroute("**/api/shares/*/**");
  await shot(page, "07-lien-pret");
  await shot(page, "07b-lien-pret-page", true);
  const read = async (n: string) => (await page.getByRole("group", { name: n }).locator(".sr-only").first().textContent()) ?? "";
  const link = await read("Lien");
  const password = await read("Mot de passe");
  const manage = (await page.locator(".manage .sr-only").first().textContent()) ?? "";

  const rc = await browser.newContext(ctxOpts);
  const r = await rc.newPage();
  await r.goto(link);
  await expect(r.getByLabel("Mot de passe", { exact: true })).toBeVisible({ timeout: 20_000 });
  await shot(r, "08-ouverture");
  await unlock(r, password);
  await shot(r, "09-contenu");
  await shot(r, "09b-contenu-page", true);
  await r.getByRole("button", { name: `Voir ${LONG[0][0]}` }).click();
  await shot(r, "10-visionneuse");
  await r.keyboard.press("Escape");
  await r.reload();
  await expect(r.getByRole("heading", { name: "Rouvrir ce partage" })).toBeVisible({ timeout: 20_000 });
  await shot(r, "11-rouvrir");

  const mc = await browser.newContext(ctxOpts);
  const m = await mc.newPage();
  await m.goto(manage);
  await expect(m.getByRole("heading", { name: "Suivi du partage" })).toBeVisible({ timeout: 20_000 });
  await shot(m, "12-gestion");
  await m.getByRole("button", { name: "Supprimer maintenant" }).click();
  await shot(m, "13-gestion-confirmer");
  await m.getByRole("button", { name: "Supprimer", exact: true }).click();
  await expect(m.getByRole("heading", { name: "Supprimé" })).toBeVisible({ timeout: 20_000 });
  await shot(m, "14-detruit");
  const r2 = await rc.newPage();
  await r2.goto(link);
  await r2.waitForTimeout(3000);
  await shot(r2, "17-partage-disparu");
  await rc.close();
  await mc.close();
});
